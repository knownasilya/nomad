// @ts-nocheck
//
// Live Notes on desktop (ADR-0041): the sessions of the Notes open on this Device, the
// nomad://notes pages that edit them, the AI writing into them, and the link that joins them with
// the same Notes open on the user's other Devices. The sessions and their frames are
// shared/note-live-hub.mjs, which the phone's backend runs too; this file wires it to desktop's
// Vault, swarm and RPC.
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
import { createNoteLink } from '../../../shared/note-live.mjs';
import { createLiveNotes } from '../../../shared/note-live-hub.mjs';
import { LiveNote } from './live-note.mjs';

const logger = logLib.get().child({ category: 'notes', subcategory: 'live' });

export const events = new EventEmitter();
let link = null;
let watcher = null;

const toB64 = (bytes) => b4a.toString(b4a.from(bytes), 'base64');
const fromB64 = (s) => new Uint8Array(b4a.from(String(s || ''), 'base64'));

async function deviceKey() {
  const sess = await vault.getVault();
  return sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
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

const notes = createLiveNotes({
  LiveNote,
  b4a,
  locate: async (id) => (await vaultApps.locateNote(id)).prev || null,
  storeFor,
  getDeviceKey: deviceKey,
  onStatus: (id, status) => events.emit('status', { id, ...status }),
  // The leader folds an outside change (an older app, a shared Space's other members) into the
  // session, so the Vault is watched while any session is open.
  onSessions: (count) => {
    if (count && !watcher) {
      watcher = vaultApps.watch();
      watcher.on('changed', () => notes.recordsChanged());
    } else if (!count && watcher) {
      watcher.close();
      watcher = null;
    }
  },
  log: (...args) => logger.info(args.join(' ')),
});

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
      openIds: () => notes.openIds(),
      onPeer: (key, up) => notes.onPeer(key, up),
      onFrame: (key, f) =>
        notes.onFrame(key, f).catch((err) =>
          logger.warn('note-live frame failed', { error: String(err) })
        ),
      log: (...args) => logger.info(args.join(' ')),
    });
    notes.useLink(link);
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
  let closed = false;
  let joined = false;
  stream.on('close', () => {
    closed = true;
    if (joined) notes.closePage(id, connId).catch(() => {});
  });
  notes
    .openPage(id, connId, {
      send: (bytes) => emitter.emit('message', { data: toB64(bytes) }),
      onStatus: (status) => emitter.emit('status', status),
      isClosed: () => closed,
    })
    .then((status) => {
      joined = !!status;
    })
    .catch((err) => emitter.emit('failed', { message: String(err?.message || err) }));
  return stream;
}

export function pageSend(id, connId, data) {
  return notes.pageReceive(id, connId, fromB64(data));
}

// --- The AI ---

// Is Note `id` open for live editing, here or on another of the user's Devices?
export function isOpen(id) {
  return notes.isOpen(id);
}

// The AI changes Note `id` from `base` (the text it read) to `body`, typing into the open session
// with its own cursor. Returns the stored Note once saved, null when the Note isn't open anywhere
// (the caller saves it as before), or { conflict: true } when the change touches text someone
// changed since the AI read it.
export function aiWrite(id, base, body) {
  return notes.aiWrite(id, base, body);
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
