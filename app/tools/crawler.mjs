// nomad discovery crawler / indexer (ADR-0014 super-peer, ADR-0016 §4 manifest-only index).
//
// A standalone, ownerless aggregation peer — NOT part of the Electron app. It joins the well-known
// INDEX_TOPIC as a client, and over the `nomad/listing` Protomux channel receives one LISTING
// record per publicly-listed Drive (its key plus manifest-only fields: title/description/topics/
// keywords). It builds an in-memory inverted index and serves a plain HTTP/JSON search API. Any
// number of these can run; none is privileged (ADR-0014 §1).
//
// It holds no privileged position: it only replicates the shared corestore so connections stay
// healthy, and reads what listed Drives volunteer. It never crawls follows (forbidden, ADR-0013)
// and — this being the manifest-only v1 — never walks post bodies. The listing record carries the
// index fields directly, so v1 indexes without opening each Drive; a later version can reopen a
// Drive by its key to re-verify the signed manifest and add full-text.
//
// Run from the app tree so bare imports resolve app/node_modules:
//   node app/tools/crawler.mjs [--port 8787] [--storage .crawler-store]
// The browser also runs it, when the synced `crawler_enabled` setting is on: crawler-process.mjs
// calls startCrawler() in a utility process (bg/hyper/crawler-host.js).

import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { LISTING_PROTOCOL, indexTopic, decodeFrame } from '../../shared/listing-wire.mjs';
import { createIndex, createLocalFeed } from './crawler-index.mjs';

const INDEX_TOPIC = indexTopic(crypto, b4a);
const pairedMuxes = new WeakSet();

export const DEFAULT_PORT = 8787;

// How often to look INDEX_TOPIC up again. A lookup only finds Drives announced at that moment, and
// Hyperswarm on its own repeats it every 10 minutes, so a Drive listed just after the crawler
// started stayed invisible that long. Look again often while starting up (when that race is
// likeliest), then settle down: with many crawlers on, the DHT nodes nearest this one topic carry
// every lookup.
const REFRESH_FAST_MS = 30_000;
const REFRESH_FAST_FOR_MS = 5 * 60_000;
const REFRESH_SLOW_MS = 3 * 60_000;

// Start a crawler: join INDEX_TOPIC, index the listings that arrive, serve the search API on
// `port`. Resolves to { close, applyLocalListings } once the corestore is open;
// applyLocalListings(frames) takes the full set of this machine's own listings (see
// createLocalFeed). If the port is taken (another crawler is
// running), the index still runs and the search page uses the one already on that port. `host`
// limits who can query it: the browser passes 127.0.0.1; the CLI default serves the network, so a
// crawler can act as a shared super-peer.
export async function startCrawler({ port = DEFAULT_PORT, host, storage } = {}) {
  const idx = createIndex();
  const store = new Corestore(storage || path.join(os.tmpdir(), 'nomad-crawler-store'));
  await store.ready();

  const swarm = new Hyperswarm();
  swarm.on('connection', (conn) => {
    store.replicate(conn); // keep the connection healthy like any peer
    openListingChannel(conn, idx);
  });

  // Serve immediately — don't block the API on swarm discovery (flush can take ~10s).
  const server = startHttp(port, host, idx);

  const discovery = swarm.join(INDEX_TOPIC, { server: false, client: true }); // look up listed Drives
  log(`joining INDEX_TOPIC (${b4a.toString(INDEX_TOPIC, 'hex').slice(0, 12)}…) as crawler…`);
  swarm.flush().then(() => log('INDEX_TOPIC discovery flushed; listening for listings'));

  const startedAt = Date.now();
  let refreshTimer = null;
  let closed = false;
  const scheduleRefresh = () => {
    if (closed) return; // a lookup that was running when close() came in
    const fast = Date.now() - startedAt < REFRESH_FAST_FOR_MS;
    refreshTimer = setTimeout(() => {
      discovery.refresh().catch(() => {}).finally(scheduleRefresh);
    }, fast ? REFRESH_FAST_MS : REFRESH_SLOW_MS);
  };
  scheduleRefresh();

  return {
    applyLocalListings: createLocalFeed(idx),
    async close() {
      closed = true;
      clearTimeout(refreshTimer);
      server.close();
      await swarm.destroy();
      await store.close();
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await startCrawler({
    port: Number(args.port || process.env.NOMAD_CRAWLER_PORT || DEFAULT_PORT),
    storage: args.storage,
  });
}

// Open the read-only listing channel on a connection and fold incoming records into the index.
function openListingChannel(conn, idx) {
  try {
    const mux = Protomux.from(conn);
    const onMessage = (data) => {
      const f = decodeFrame(b4a, data);
      if (idx.ingest(f))
        log(`indexed ${f.driveKey.slice(0, 12)}… "${f.title || ''}" topics=[${(f.topics || []).join(',')}]`);
    };
    const onOpen = () =>
      mux.createChannel({
        protocol: LISTING_PROTOCOL,
        messages: [{ encoding: c.buffer, onmessage: onMessage }],
        onopen() {},
      })?.open();
    if (!pairedMuxes.has(mux)) {
      pairedMuxes.add(mux);
      mux.pair({ protocol: LISTING_PROTOCOL }, onOpen);
    }
    onOpen();
  } catch (err) {
    log(`listing channel error: ${err?.message || err}`);
  }
}

function startHttp(PORT, HOST, idx) {
  const server = http
    .createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (url.pathname === '/search') {
        const q = url.searchParams.get('q') || '';
        const topic = url.searchParams.get('topic') || '';
        return res.end(JSON.stringify({ query: q, topic, results: idx.search(q, topic) }));
      }
      if (url.pathname === '/topics') return res.end(JSON.stringify({ topics: idx.topics() }));
      if (url.pathname === '/stats') return res.end(JSON.stringify(idx.stats()));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  server.on('listening', () =>
    log(`search API on http://localhost:${PORT}  (GET /search?q=&topic=  ·  /topics  ·  /stats)`)
  );
  server.on('error', (err) =>
    log(
      err?.code === 'EADDRINUSE'
        ? `port ${PORT} is taken (another crawler?) — indexing anyway, not serving the API`
        : `search API error: ${err?.message || err}`
    )
  );
  server.listen(PORT, HOST);
  return server;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[crawler] ${msg}`);
}

// Only launch the swarm + HTTP server when run as a script, so tests can import createIndex().
// pathToFileURL normalizes a relative argv[1] (node app/tools/crawler.mjs) to an absolute file URL.
// The endsWith check matters once bundled into crawler-process.build.js: there import.meta.url and
// argv[1] are both the bundle, and that entry starts its own crawler.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  import.meta.url.endsWith('/crawler.mjs')
) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[crawler] fatal', err);
    process.exit(1);
  });
}
