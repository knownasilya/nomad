// Verifies the discovery index end-to-end at the wire+logic level (ADR-0016): a normalized listing
// record → LISTING frame → encode → decode → ingest → search/topics/stats. Loads the app's own
// resolved b4a/hypercore-crypto the same way ai-bridge.test.js and fs-core-golden do. The swarm +
// Protomux transport is generic hyperswarm plumbing (same pattern as the production AI Bridge) and
// is out of scope here — this locks the NEW logic: the frame contract and the index.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import {
  INDEX_TOPIC_STRING,
  indexTopic,
  encodeFrame,
  decodeFrame,
  listingFrame,
  FRAME,
} from '../../shared/listing-wire.mjs';
import { createIndex } from '../../app/tools/crawler-index.mjs';

let crypto, b4a;
async function loadDep(side, name) {
  const rq = createRequire(path.join(process.cwd(), side, 'package.json'));
  const m = await import(pathToFileURL(rq.resolve(name)).href);
  return m.default ?? m;
}
beforeAll(async () => {
  crypto = await loadDep('app', 'hypercore-crypto');
  b4a = await loadDep('app', 'b4a');
});

describe('INDEX_TOPIC', () => {
  it('is a deterministic 32-byte hash of the public constant', () => {
    const a = indexTopic(crypto, b4a);
    const bb = indexTopic(crypto, b4a);
    expect(a.length).toBe(32);
    expect(b4a.toString(a, 'hex')).toBe(b4a.toString(bb, 'hex'));
    expect(INDEX_TOPIC_STRING).toBe('walled.garden/index/v1');
  });
});

describe('LISTING frame codec', () => {
  it('round-trips a listing record', () => {
    const rec = {
      driveKey: 'a'.repeat(64),
      type: 'walled.garden/feed',
      title: 'Permaculture Weekly',
      description: 'raised beds & compost',
      topics: ['gardening'],
      keywords: ['compost'],
      seq: 3,
    };
    const decoded = decodeFrame(b4a, encodeFrame(b4a, listingFrame(rec)));
    expect(decoded.t).toBe(FRAME.LISTING);
    expect(decoded.driveKey).toBe(rec.driveKey);
    expect(decoded.topics).toEqual(['gardening']);
  });
  it('rejects malformed / wrong-version frames', () => {
    expect(decodeFrame(b4a, b4a.from('not json'))).toBeNull();
    expect(decodeFrame(b4a, b4a.from(JSON.stringify({ v: 999, t: 'listing' })))).toBeNull();
  });
});

describe('index ingest + query', () => {
  const feed = listingFrame({
    driveKey: 'a'.repeat(64),
    type: 'walled.garden/feed',
    title: 'Permaculture Weekly',
    description: 'notes on raised beds and composting',
    topics: ['gardening', 'permaculture'],
    keywords: ['raised beds'],
    seq: 1,
  });
  const app = listingFrame({
    driveKey: 'b'.repeat(64),
    type: 'application',
    title: 'Chess',
    description: 'play chess p2p',
    topics: ['games'],
    keywords: [],
    seq: 1,
  });

  it('indexes frames and matches on title/description/keywords', () => {
    const idx = createIndex(() => 1000);
    idx.ingest(feed);
    idx.ingest(app);
    expect(idx.stats()).toEqual({ drives: 2, topics: 3 });
    const r = idx.search('composting', ''); // exact-token match (no stemming in v1)
    expect(r).toHaveLength(1);
    expect(r[0].driveKey).toBe('a'.repeat(64));
    // keyword match
    expect(idx.search('raised', '').map((x) => x.title)).toContain('Permaculture Weekly');
  });

  it('scopes by exact topic facet and returns all in a topic for an empty query', () => {
    const idx = createIndex(() => 1000);
    idx.ingest(feed);
    idx.ingest(app);
    expect(idx.search('', 'games').map((x) => x.title)).toEqual(['Chess']);
    expect(idx.search('chess', 'gardening')).toEqual([]); // right query, wrong shelf
  });

  it('builds an emergent topic directory with counts', () => {
    const idx = createIndex(() => 1000);
    idx.ingest(feed);
    idx.ingest(app);
    const dir = idx.topics();
    expect(dir).toContainEqual({ topic: 'gardening', count: 1 });
    expect(dir.map((d) => d.topic).sort()).toEqual(['games', 'gardening', 'permaculture']);
  });

  it('defensively re-caps a hostile over-limit frame (trust nothing from the wire)', () => {
    const idx = createIndex(() => 1000);
    idx.ingest({
      t: FRAME.LISTING,
      driveKey: 'c'.repeat(64),
      topics: Array.from({ length: 20 }, (_, i) => `T${i}`), // 20 topics, mixed case
      keywords: Array.from({ length: 30 }, (_, i) => `k${i}`),
    });
    const r = idx.search('', 't0'); // lowercased on ingest
    expect(r).toHaveLength(1);
    expect(r[0].topics).toHaveLength(5);
    expect(r[0].keywords).toHaveLength(12);
    expect(r[0].topics.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it('updates in place on a re-listing, preserving firstSeen', () => {
    let t = 1000;
    const idx = createIndex(() => t);
    idx.ingest(feed);
    t = 2000;
    idx.ingest(listingFrame({ driveKey: 'a'.repeat(64), title: 'Renamed', topics: ['gardening'], seq: 2 }));
    expect(idx.stats().drives).toBe(1);
    const r = idx.search('renamed', '');
    expect(r[0].firstSeen).toBe(1000);
    expect(r[0].lastSeen).toBe(2000);
  });
});
