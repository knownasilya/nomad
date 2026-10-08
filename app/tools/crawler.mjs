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
import { createIndex } from './crawler-index.mjs';

const INDEX_TOPIC = indexTopic(crypto, b4a);
const pairedMuxes = new WeakSet();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const PORT = Number(args.port || process.env.NOMAD_CRAWLER_PORT || 8787);
  const STORAGE = args.storage || path.join(os.tmpdir(), 'nomad-crawler-store');
  const idx = createIndex();

  const store = new Corestore(STORAGE);
  await store.ready();

  const swarm = new Hyperswarm();
  swarm.on('connection', (conn) => {
    store.replicate(conn); // keep the connection healthy like any peer
    openListingChannel(conn, idx);
  });

  // Serve immediately — don't block the API on swarm discovery (flush can take ~10s).
  startHttp(PORT, idx);
  log(`search API on http://localhost:${PORT}  (GET /search?q=&topic=  ·  /topics  ·  /stats)`);

  swarm.join(INDEX_TOPIC, { server: false, client: true }); // look up listed Drives
  log(`joining INDEX_TOPIC (${b4a.toString(INDEX_TOPIC, 'hex').slice(0, 12)}…) as crawler…`);
  swarm.flush().then(() => log('INDEX_TOPIC discovery flushed; listening for listings'));
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

function startHttp(PORT, idx) {
  http
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
    })
    .listen(PORT);
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[crawler] fatal', err);
    process.exit(1);
  });
}
