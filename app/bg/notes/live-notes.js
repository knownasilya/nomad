// @ts-nocheck
//
// Live Notes on desktop (ADR-0041): the sessions of the Notes open on this Device (./live-note.mjs),
// the nomad://notes pages that edit them, the AI writing into them, and the link that joins them
// with the same Notes open on the user's other Devices (shared/note-live.mjs).
//
//   nomad://notes ── nomad.vault.openLiveNote / liveNoteSend ──┐
//   the AI's writeNote ── aiWrite ─────────────────────────────┤ LiveNote (Yjs) ── the Note record
//   another Device's session ── nomad/note-live channel ────────┘
//
// A session lives while a page has the Note open (and a few seconds after), or while the AI writes
// into a Note that is open somewhere. The record stays the Note everything else reads.

import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import { EventEmitter } from 'events';
import emitStream from 'emit-stream';
import * as logLib from '../logger';
import * as daemon from '../hyper/daemon';
import * as vault from '../hyper/vault';
import * as vaultApps from '../web-apis/bg/vault-apps';
import * as apps from '../../../shared/vault-apps.mjs';
import { createNoteLink, FRAME } from '../../../shared/note-live.mjs';
import { LiveNote, preferSession } from './live-note.mjs';

const logger = logLib.get().child({ category: 'notes', subcategory: 'live' });

// How long a session stays after its last page closed, so reopening the Note (or the next AI write)
// doesn't start over.
const IDLE_CLOSE_MS = 5000;
// How long a new session waits for the other Devices that have the Note open before it goes on.
const JOIN_WAIT_MS = 1500;

const hubs = new Map(); // note id -> { live, ready, pages: Map<connId, emitter>, holds, closeTimer }
const remoteOpen = new Map(); // deviceKey -> Set<note id>
export const events = new EventEmitter();
let link = null;
let watcher = null;
let ownKey = null;

const devPeer = (deviceKey) => 'dev:' + deviceKey;
const pagePeer = (connId) => 'page:' + connId;
const toB64 = (bytes) => b4a.toString(b4a.from(bytes), 'base64');
const fromB64 = (s) => new Uint8Array(b4a.from(String(s || ''), 'base64'));

async function deviceKey() {
  const sess = await vault.getVault();
  ownKey = sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
  return ownKey;
}

// --- The link to the user's other Devices ---

export function install() {
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  if (!link) {
    link = createNoteLink({
      swarm,
      Protomux,
      c,
      b4a,
      getVaultKey: () => vault.getVaultKey(),
      getDeviceKey: deviceKey,
      randomHex: () => b4a.toString(crypto.randomBytes(32), 'hex'),
      sign: async (message) => {
        const sess = await vault.getVault();
        const kp = sess?.base?.local?.keyPair;
        if (!kp?.secretKey) return '';
        return b4a.toString(crypto.sign(b4a.from(message), kp.secretKey), 'hex');
      },
      verify: verifyDevice,
      openIds: () => [...hubs.keys()],
      onPeer: (key, up) => {
        if (up) return;
        remoteOpen.delete(key);
        for (const hub of hubs.values()) hub.live.removePeer(devPeer(key));
      },
      onFrame: (key, f) =>
        onFrame(key, f).catch((err) =>
          logger.warn('note-live frame failed', { error: String(err) })
        ),
      log: (...args) => logger.info(args.join(' ')),
    });
    vault.events.on('changed', () => {
      link.reset();
      link.install();
    });
  }
  link.install();
}

// A Vault Device, and its signature over `message` by the signer of its Vault writer core.
async function verifyDevice(key, message, sigHex) {
  try {
    const devices = await vault.listDevices();
    if (!devices.some((d) => d.key === key)) return false;
    const store = daemon.getCorestore();
    if (!store) return false;
    const core = store.get({ key: b4a.from(key, 'hex') });
    await core.ready();
    const signer = core.manifest?.signers?.[0];
    const pub = signer?.publicKey || b4a.from(key, 'hex');
    const sig = b4a.from(sigHex, 'hex');
    return sig.length === 64 && crypto.verify(b4a.from(message), sig, pub);
  } catch (err) {
    logger.warn('note-live verify failed', { error: String(err) });
    return false;
  }
}

function announce() {
  if (link) link.broadcast({ t: FRAME.OPEN, ids: [...hubs.keys()] });
}

function sendJoin(key, hub, reply = false) {
  link?.send(key, { t: FRAME.JOIN, id: hub.live.id, ...hub.live.info(), reply });
}

// Join Device `key` into the session (again: a fresh sync).
function addDevice(hub, key) {
  const peer = devPeer(key);
  hub.live.addPeer(
    peer,
    (bytes) => link?.send(key, { t: FRAME.MSG, id: hub.live.id, m: toB64(bytes) }),
    { kind: 'device' }
  );
  hub.joined?.(key);
}

async function onFrame(key, f) {
  if (f.t === FRAME.OPEN) {
    const ids = new Set(f.ids);
    remoteOpen.set(key, ids);
    for (const [id, hub] of hubs) {
      if (ids.has(id) && !hub.live.hasPeer(devPeer(key))) sendJoin(key, hub);
      else if (!ids.has(id)) hub.live.removePeer(devPeer(key));
    }
    return;
  }
  const hub = hubs.get(f.id);
  if (!hub) return;
  const live = hub.live;
  switch (f.t) {
    case FRAME.JOIN: {
      const theirs = { seed: f.seed || null, edited: !!f.edited, deviceKey: key };
      if ((theirs.seed || null) === (live.seed || null)) {
        // The reply goes first, so it has added us before our first sync message arrives.
        if (!f.reply) sendJoin(key, hub, true);
        addDevice(hub, key);
      } else if (preferSession(live.info(), theirs)) {
        if (!f.reply) sendJoin(key, hub, true); // it joins ours: it will ask for our document
      } else {
        link.send(key, { t: FRAME.WANT, id: f.id });
      }
      return;
    }
    case FRAME.WANT:
      link.send(key, { t: FRAME.STATE, id: f.id, update: toB64(live.state()), ...live.info() });
      return;
    case FRAME.STATE: {
      if ((f.seed || null) === (live.seed || null)) return;
      logger.info('Joining another Device’s live note', { id: f.id, from: key.slice(0, 8) });
      live.reset(fromB64(f.update), { seed: f.seed || null, edited: !!f.edited });
      for (const [k, ids] of remoteOpen) if (ids.has(f.id)) sendJoin(k, hub);
      return;
    }
    case FRAME.MSG:
      live.receive(devPeer(key), fromB64(f.m));
      return;
    case FRAME.LEAVE:
      live.removePeer(devPeer(key));
      remoteOpen.get(key)?.delete(f.id);
      return;
  }
}

// --- Sessions ---

function leaderOf(live) {
  const keys = [ownKey || ''];
  for (const [peerId, p] of live.peers) if (p.kind === 'device') keys.push(peerId.slice(4));
  return keys.sort()[0] === (ownKey || '');
}

function storeFor(id) {
  return {
    async save(body, known) {
      const { space, prev } = await vaultApps.locateNote(id);
      if (!prev) throw new Error('This note was deleted');
      if (prev.body === body) return { note: prev };
      if (known.updatedAt && prev.updatedAt !== known.updatedAt) return { stale: prev };
      const note = apps.makeNote({ id, body }, prev);
      await vaultApps.putNote(space, note);
      return { note };
    },
    async conflict(body) {
      const { space } = await vaultApps.locateNote(id);
      const copy = apps.makeNote({
        id: apps.newNoteId(),
        body: apps.conflictBody(body),
        conflictOf: id,
      });
      await vaultApps.putNote(space, copy);
    },
  };
}

function notifyPages(hub) {
  const status = hub.live.status();
  for (const emitter of hub.pages.values()) emitter.emit('status', status);
  events.emit('status', { id: hub.live.id, ...status });
}

const starting = new Map(); // note id -> Promise<hub>, while its record loads

// The session for Note `id`, started (and joined to the other Devices that have it open) if needed.
async function getHub(id) {
  const hub = hubs.get(id);
  if (hub) {
    clearTimeout(hub.closeTimer);
    hub.closeTimer = null;
    await hub.ready;
    return hub;
  }
  if (!starting.has(id))
    starting.set(
      id,
      startHub(id).finally(() => starting.delete(id))
    );
  return starting.get(id);
}

async function startHub(id) {
  let hub;
  const { prev } = await vaultApps.locateNote(id);
  if (!prev) throw new Error('No note with that id');
  await deviceKey();
  hub = { pages: new Map(), holds: 0, closeTimer: null, live: null, ready: null, joined: null };
  hub.live = new LiveNote({
    id,
    record: prev,
    deviceKey: ownKey,
    store: storeFor(id),
    isLeader: () => leaderOf(hub.live),
    onChange: () => notifyPages(hub),
    log: (...args) => logger.info(args.join(' ')),
  });
  hubs.set(id, hub);
  announce();
  ensureWatching();
  // Wait (briefly) for the Devices that have it open, so we start from their document.
  const waiting = [...remoteOpen].filter(([, ids]) => ids.has(id)).map(([k]) => k);
  hub.ready = waiting.length
    ? new Promise((resolve) => {
        const left = new Set(waiting);
        const timer = setTimeout(resolve, JOIN_WAIT_MS);
        hub.joined = (k) => {
          left.delete(k);
          if (!left.size) {
            clearTimeout(timer);
            resolve();
          }
        };
        for (const k of waiting) sendJoin(k, hub);
      })
    : Promise.resolve();
  await hub.ready;
  return hub;
}

function releaseLater(hub) {
  if (hub.pages.size || hub.holds || hub.closeTimer) return;
  hub.closeTimer = setTimeout(() => closeHub(hub).catch(() => {}), IDLE_CLOSE_MS);
}

async function closeHub(hub) {
  hub.closeTimer = null;
  if (hub.pages.size || hub.holds) return;
  await hub.live.flush().catch(() => {});
  if (hub.pages.size || hub.holds) return;
  for (const [peerId, p] of hub.live.peers) {
    if (p.kind === 'device') link?.send(peerId.slice(4), { t: FRAME.LEAVE, id: hub.live.id });
  }
  hub.live.close();
  hubs.delete(hub.live.id);
  announce();
  if (!hubs.size && watcher) {
    watcher.close();
    watcher = null;
  }
}

// The leader folds an outside change (the phone, an older app, a shared Space's other members)
// into the session; everyone notes the record's version.
function ensureWatching() {
  if (watcher) return;
  watcher = vaultApps.watch();
  watcher.on('changed', async () => {
    for (const hub of hubs.values()) {
      try {
        const { prev } = await vaultApps.locateNote(hub.live.id);
        if (prev) await hub.live.checkRecord(prev);
      } catch {}
    }
  });
}

// --- nomad://notes ---

// A page opened Note `id` for live editing. Returns the RPC stream: 'message' events carry
// y-protocols messages ({ data: base64 }), 'status' the session's status. The page sends its own
// with send(); closing the stream leaves.
export function openPage(id, connId) {
  if (!apps.isNoteId(id)) throw new Error('Not a note id: ' + id);
  if (typeof connId !== 'string' || !/^[a-z0-9-]{4,64}$/i.test(connId))
    throw new Error('Bad connection id');
  const emitter = new EventEmitter();
  emitter.on('error', () => {});
  const stream = emitStream(emitter);
  let hub = null;
  let closed = false;
  stream.on('close', () => {
    closed = true;
    if (!hub) return;
    hub.pages.delete(connId);
    hub.live.removePeer(pagePeer(connId));
    releaseLater(hub);
  });
  getHub(id)
    .then((h) => {
      if (closed) return releaseLater(h);
      hub = h;
      hub.pages.set(connId, emitter);
      hub.live.addPeer(
        pagePeer(connId),
        (bytes) => emitter.emit('message', { data: toB64(bytes) }),
        { kind: 'page' }
      );
      emitter.emit('status', hub.live.status());
    })
    .catch((err) => emitter.emit('failed', { message: String(err?.message || err) }));
  return stream;
}

export function pageSend(id, connId, data) {
  const hub = hubs.get(id);
  if (!hub || !hub.pages.has(connId)) return false;
  hub.live.receive(pagePeer(connId), fromB64(data));
  return true;
}

// --- The AI ---

// Is Note `id` open for live editing, here or on another of the user's Devices?
export function isOpen(id) {
  if (hubs.has(id)) return true;
  for (const ids of remoteOpen.values()) if (ids.has(id)) return true;
  return false;
}

// The AI changes Note `id` from `base` (the text it read) to `body`, typing into the open session
// with its own cursor. Returns the stored Note once saved, null when the Note isn't open anywhere
// (the caller saves it as before), or { conflict: true } when the change touches text someone
// changed since the AI read it.
export async function aiWrite(id, base, body) {
  if (!isOpen(id)) return null;
  const hub = await getHub(id);
  hub.holds++;
  try {
    const ok = await hub.live.aiEdit(base, body);
    if (!ok) return { conflict: true };
    await hub.live.flush();
    await hub.live.whenStored();
    const { prev } = await vaultApps.locateNote(id);
    return { note: prev };
  } finally {
    hub.holds--;
    releaseLater(hub);
  }
}

// The text of each version of a Note the AI read, by updatedAt, so a later writeNote can be put in
// as the edits the AI made rather than over what the user typed since.
const readVersions = new Map(); // `${id}@${updatedAt}` -> body
const MAX_VERSIONS = 200;

export function rememberRead(note) {
  if (!note || !note.id || !note.updatedAt) return;
  const k = `${note.id}@${note.updatedAt}`;
  readVersions.delete(k);
  readVersions.set(k, note.body);
  while (readVersions.size > MAX_VERSIONS) readVersions.delete(readVersions.keys().next().value);
}

export function readVersion(id, updatedAt) {
  return readVersions.get(`${id}@${updatedAt}`);
}
