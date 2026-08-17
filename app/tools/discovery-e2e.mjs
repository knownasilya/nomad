// Deterministic end-to-end check of the discovery transport (ADR-0016): a listed Drive's LISTING
// frame must travel announcer → crawler over a REAL Hyperswarm connection and land in the index.
//
// The unit tests lock the frame codec and the index logic; this locks the piece they can't — the
// Protomux channel over a live swarm. It runs on a LOCAL hyperdht testnet (no public DHT), so two
// same-host peers find each other in a second, deterministically.
//
// Both sides use the REAL shared contract (shared/listing-wire.mjs); the crawler uses the REAL index
// core (crawler-index.mjs) and the same channel-open code as crawler.mjs. The announcer mirrors
// discovery.js's `_openChannel`/`_send` (that file can't be imported standalone — it pulls in
// electron via daemon/logger), so the ~12 announce lines are duplicated here, not the wire format.
//
// Run from the app/ dir:  node tools/discovery-e2e.mjs

import createTestnet from 'hyperdht/testnet.js';
import Hyperswarm from 'hyperswarm';
import Corestore from 'corestore';
import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import os from 'os';
import path from 'path';
import { LISTING_PROTOCOL, indexTopic, encodeFrame, decodeFrame, listingFrame } from '../../shared/listing-wire.mjs';
import { createIndex } from './crawler-index.mjs';

const INDEX_TOPIC = indexTopic(crypto, b4a);
const REC = {
  driveKey: 'a'.repeat(64),
  type: 'walled.garden/feed',
  title: 'Permaculture Weekly',
  description: 'notes on raised beds and composting',
  topics: ['gardening', 'permaculture'],
  keywords: ['raised beds'],
  seq: 1,
};

const cleanups = [];
async function cleanup() {
  for (const fn of cleanups.reverse()) await fn().catch(() => {});
}
function fail(msg) {
  console.error(`[e2e] FAIL: ${msg}`);
  cleanup().then(() => process.exit(1));
}

async function main() {
  const testnet = await createTestnet(3);
  cleanups.push(() => testnet.destroy());
  const bootstrap = testnet.bootstrap;

  // --- Announcer: the app side (mirrors bg/hyper/discovery.js) ---
  const annStore = new Corestore(path.join(os.tmpdir(), 'nomad-e2e-ann-' + process.pid));
  await annStore.ready();
  const announcer = new Hyperswarm({ bootstrap });
  cleanups.push(() => announcer.destroy());
  const annPaired = new WeakSet();
  announcer.on('connection', (conn) => {
    annStore.replicate(conn);
    const mux = Protomux.from(conn);
    const open = () => {
      const ch = mux.createChannel({
        protocol: LISTING_PROTOCOL,
        messages: [{ encoding: c.buffer, onmessage: () => {} }],
        onopen() {
          ch.messages[0].send(encodeFrame(b4a, listingFrame(REC)));
          console.log('[e2e] announcer sent LISTING');
        },
      });
      ch?.open();
    };
    if (!annPaired.has(mux)) {
      annPaired.add(mux);
      mux.pair({ protocol: LISTING_PROTOCOL }, open);
    }
    open();
  });
  announcer.join(INDEX_TOPIC, { server: true, client: false });

  // --- Crawler: the real index core + the real channel-open code from crawler.mjs ---
  const crawlStore = new Corestore(path.join(os.tmpdir(), 'nomad-e2e-crawl-' + process.pid));
  await crawlStore.ready();
  const idx = createIndex();
  const crawler = new Hyperswarm({ bootstrap });
  cleanups.push(() => crawler.destroy());
  const crawlPaired = new WeakSet();
  crawler.on('connection', (conn) => {
    crawlStore.replicate(conn);
    const mux = Protomux.from(conn);
    const onMessage = (data) => idx.ingest(decodeFrame(b4a, data));
    const open = () =>
      mux
        .createChannel({ protocol: LISTING_PROTOCOL, messages: [{ encoding: c.buffer, onmessage: onMessage }], onopen() {} })
        ?.open();
    if (!crawlPaired.has(mux)) {
      crawlPaired.add(mux);
      mux.pair({ protocol: LISTING_PROTOCOL }, open);
    }
    open();
  });
  crawler.join(INDEX_TOPIC, { server: false, client: true });

  // --- Wait for the frame to arrive and land in the index (deterministic on a local testnet) ---
  const deadline = Date.now() + 20000;
  while (idx.stats().drives === 0) {
    if (Date.now() > deadline) return fail('no listing indexed within 20s');
    await new Promise((r) => setTimeout(r, 200));
  }

  // --- Assert the record round-tripped intact and is searchable ---
  const stats = idx.stats();
  if (stats.drives !== 1) return fail(`expected 1 drive, got ${stats.drives}`);
  const byKeyword = idx.search('raised', '');
  if (byKeyword.length !== 1 || byKeyword[0].driveKey !== REC.driveKey)
    return fail('keyword search did not return the announced drive');
  const byTopic = idx.search('', 'gardening');
  if (byTopic.length !== 1 || byTopic[0].title !== REC.title)
    return fail('topic facet did not return the announced drive');
  const wrongShelf = idx.search('raised', 'games');
  if (wrongShelf.length !== 0) return fail('topic facet leaked across shelves');

  console.log('[e2e] PASS — LISTING crossed a real swarm, indexed, searchable by keyword + topic facet');
  await cleanup();
  process.exit(0);
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));
