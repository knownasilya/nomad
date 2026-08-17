// nomad/shared/listing-wire.mjs
//
// The wire protocol for the public-discovery intake funnel (ADR-0014 handshake, ADR-0016). Shared
// by the announcing side (the Nomad app, app/bg/hyper/discovery.js) and any crawler/indexer that
// joins INDEX_TOPIC. Like ai-bridge.mjs it has NO bare imports — each side injects its own already
// resolved deps (`b4a`, and a hypercore-crypto-shaped `crypto` exposing `hash`).
//
// INDEX_TOPIC is derived from a public constant, so anyone can compute it without holding any Drive
// key — a shared, ownerless rendezvous (ADR-0014 §2). A listed Drive announces on it (server); a
// crawler looks it up (client). The topic conveys no content: on connect the announcer opens a
// `nomad/listing` Protomux channel and sends one LISTING frame per listed Drive. The frame carries
// the Drive key AND the manifest-only index fields (title/description/topics/keywords) so a
// manifest-only indexer (ADR-0016 §4) can index without opening the Drive — while still keeping the
// key so it can open and re-verify the signed manifest when it wants to.
//
// ── Lifecycle over one channel ────────────────────────────────────────────────
//   Announcer → LISTING { driveKey, type, title, description, topics[], keywords[], seq }  (0..n)
//   Announcer → LISTING ...                        (re-sent when the announcer's listed set changes)
//   Crawler   → (reads only; MAY drop the connection after intake — the Drive's own discovery key
//               carries content thereafter)
// ──────────────────────────────────────────────────────────────────────────────

export const LISTING_PROTOCOL = 'nomad/listing';
export const LISTING_VERSION = 1;

// The public rendezvous topic. Versioned so the handshake can migrate (v2) without disturbing any
// Drive's own discovery key. Same 32 bytes for everyone, forever.
export const INDEX_TOPIC_STRING = 'walled.garden/index/v1';

/**
 * Compute the 32-byte INDEX_TOPIC from the public constant. Uses hypercore-crypto's `data()`
 * (blake2b) — the same generic-hash primitive available on both runtimes' injected crypto.
 * @param {{ data: (buf: Uint8Array) => Uint8Array }} crypto  hypercore-crypto-shaped
 * @param {{ from: (s: string, enc?: string) => Uint8Array }} b4a
 * @returns {Uint8Array}
 */
export function indexTopic(crypto, b4a) {
  return crypto.data(b4a.from(INDEX_TOPIC_STRING));
}

export const FRAME = Object.freeze({
  LISTING: 'listing',
});

/**
 * Encode a frame to a Buffer (JSON, prefixed with the protocol version).
 * @param {{ from: (s: string) => Uint8Array }} b4a
 * @param {object} frame
 * @returns {Uint8Array}
 */
export function encodeFrame(b4a, frame) {
  return b4a.from(JSON.stringify({ v: LISTING_VERSION, ...frame }));
}

/**
 * Decode a frame Buffer. Returns null on malformed input or version mismatch — a well-behaved peer
 * never throws the emitter's way.
 * @param {{ toString: (buf: Uint8Array, enc?: string) => string }} b4a
 * @param {Uint8Array} data
 * @returns {object|null}
 */
export function decodeFrame(b4a, data) {
  try {
    const f = JSON.parse(b4a.toString(data));
    if (!f || f.v !== LISTING_VERSION || typeof f.t !== 'string') return null;
    return f;
  } catch {
    return null;
  }
}

/**
 * Build a LISTING frame from a normalized listing record. Keeps the payload to the manifest-only
 * index fields (ADR-0016 §4) plus the key.
 * @param {{ driveKey: string, type?: string, title?: string, description?: string, topics?: string[], keywords?: string[], seq?: number }} rec
 * @returns {object}
 */
export function listingFrame(rec) {
  return {
    t: FRAME.LISTING,
    driveKey: rec.driveKey,
    type: rec.type || null,
    title: rec.title || null,
    description: rec.description || null,
    topics: Array.isArray(rec.topics) ? rec.topics : [],
    keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    seq: rec.seq || 0,
  };
}
