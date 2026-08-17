// @ts-nocheck
//
// Public-discovery announcer (ADR-0014 intake funnel, ADR-0016 listing switch). When the user opts
// a Drive into discovery (`indexable: true` via nomad.fs.configure), this module announces on the
// well-known INDEX_TOPIC and, over a `nomad/listing` Protomux channel layered on the same swarm
// connections used for replication, hands each connecting crawler the Drive's key plus its
// manifest-only index fields (title/description/topics/keywords). A Drive that is not listed is
// exactly as unfindable as before — opt-in is the whole privacy story (ADR-0014 §4).
//
// This is the exact channel pattern as the AI Bridge (app/bg/hyper/ai-bridge.js) and the writer
// -request control channel in autobases.js: pair() once per mux, open proactively, never throw into
// the swarm 'connection' emitter. See shared/listing-wire.mjs for the wire format.

import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import * as logLib from '../logger';
import * as daemon from './daemon';
import {
  LISTING_PROTOCOL,
  indexTopic,
  encodeFrame,
  decodeFrame,
  listingFrame,
} from '../../../shared/listing-wire.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'discovery' });

const INDEX_TOPIC = indexTopic(crypto, b4a);
const PAIRED_FLAG = '_nomadListingPaired';

// keyHex -> normalized listing record { driveKey, indexable, title, description, topics, keywords, type }
const listed = new Map();
// peerId (remotePublicKey hex) -> { channel, msg }
const peers = new Map();
// Bumped whenever the listed set changes so re-sent frames are ordered for the crawler.
let seq = 0;
let installed = false;
let joined = false;

// Public API
// =

// Called on daemon start so a Device announces its already-listed Drives as soon as it's online.
export function install() {
  ensureInstalled();
}

/**
 * Reconcile a Drive's listing state with its manifest. Idempotent: pass the record built from the
 * Drive's current index.json after every configure(). `indexable:false` (or absent) delists.
 * @param {Buffer|string} key   Drive public key
 * @param {{ indexable:boolean, title?:string, description?:string, topics?:string[], keywords?:string[], type?:string }} rec
 */
export async function setListed(key, rec) {
  const driveKey = Buffer.isBuffer(key) ? b4a.toString(key, 'hex') : String(key);
  const wasListed = listed.has(driveKey);

  if (!rec || !rec.indexable) {
    if (!wasListed) return; // nothing to do
    listed.delete(driveKey);
    logger.info('drive delisted', { driveKey });
  } else {
    listed.set(driveKey, {
      driveKey,
      type: rec.type,
      title: rec.title,
      description: rec.description,
      topics: Array.isArray(rec.topics) ? rec.topics : [],
      keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    });
    logger.info(wasListed ? 'drive listing updated' : 'drive listed', {
      driveKey,
      topics: rec.topics,
    });
  }

  seq++;
  await _syncSwarmMembership();
  ensureInstalled();
  _broadcast(); // push the new set to any crawler already connected
}

/** Debug/introspection: the drive keys currently announced. */
export function getListed() {
  return [...listed.values()];
}

// internal
// =

// Join INDEX_TOPIC (announce-only) while ≥1 Drive is listed; leave when the set empties. Reuses the
// daemon's discovery tracking so there's one owner of swarm membership per topic.
async function _syncSwarmMembership() {
  const swarm = daemon.getSwarm();
  if (!swarm) return; // daemon not up yet; install()'s ready handler will re-sync
  const want = listed.size > 0;
  if (want === joined) return;
  try {
    if (want) {
      await daemon.configureNetwork(INDEX_TOPIC, { announce: true, lookup: false });
      logger.info('joined INDEX_TOPIC (announcing listed drives)');
    } else {
      await daemon.configureNetwork(INDEX_TOPIC, { announce: false, lookup: false });
      logger.info('left INDEX_TOPIC (no listed drives)');
    }
    joined = want;
  } catch (err) {
    logger.warn('INDEX_TOPIC membership sync failed', { error: err?.toString() });
  }
}

function ensureInstalled() {
  const swarm = daemon.getSwarm();
  if (!swarm) {
    // Daemon not ready — re-run once it is, then re-sync membership for anything listed meanwhile.
    daemon.on('ready', () => {
      installed = false;
      ensureInstalled();
      _syncSwarmMembership();
    });
    return;
  }
  if (installed) return;
  installed = true;
  swarm.on('connection', (conn) => _openOnConn(conn));
  for (const conn of swarm.connections) _openOnConn(conn);
}

// MUST NOT throw: runs inside the swarm 'connection' emitter (shared with corestore replication).
function _openOnConn(conn) {
  try {
    const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null;
    if (!peerId) return;
    const mux = Protomux.from(conn);
    if (!mux[PAIRED_FLAG]) {
      mux[PAIRED_FLAG] = true;
      mux.pair({ protocol: LISTING_PROTOCOL }, () => _openChannel(mux, peerId));
    }
    _openChannel(mux, peerId);
  } catch (err) {
    logger.warn('listing openOnConn threw', { error: err?.toString() });
  }
}

function _openChannel(mux, peerId) {
  if (peers.has(peerId)) return;
  const channel = mux.createChannel({
    protocol: LISTING_PROTOCOL,
    messages: [{ encoding: c.buffer, onmessage: () => {} }], // announcer is send-only
    onopen() {
      _sendAll(peerId);
    },
    onclose() {
      peers.delete(peerId);
    },
  });
  if (!channel) return; // already exists on this mux
  const msg = channel.messages[0];
  peers.set(peerId, { channel, msg });
  channel.open();
}

// Send the full current listed set to one peer (on channel open).
function _sendAll(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  for (const rec of listed.values()) _send(peer, rec);
}

// Re-send the full set to every connected crawler (on any listing change).
function _broadcast() {
  for (const peerId of peers.keys()) _sendAll(peerId);
}

function _send(peer, rec) {
  try {
    peer.msg.send(encodeFrame(b4a, listingFrame({ ...rec, seq })));
  } catch (err) {
    logger.warn('listing send failed', { error: err?.toString() });
  }
}
