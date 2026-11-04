// One Note open for live editing on this Device (ADR-0041): a Yjs document that every editor of the
// Note joins, here and on the user's other Devices, so their edits merge as they type and each
// sees the others' cursors. The AI writes into it too, as a collaborator with its own cursor.
//
// The Note record in the Vault stays what everything else reads (the list, search, the phone, the
// AI's readNote). The session is seeded from it and writes it back a moment after edits settle.
// Only one Device in a session writes the record, the leader, so the record has one writer while
// people type, and that Device is the one that folds a change from outside the session (the phone,
// an older app, another person in a shared Space) into the document.
//
// Peers are anything that speaks the y-protocols sync and awareness messages: a Notes page on this
// Device, or another Device's session over shared/note-live.mjs. This module has no I/O of its
// own; app/bg/notes/live-notes.js gives it the store and the transport. Tested in
// tests/unit/note-live-session.test.js.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { diffEdits, rebaseEdits } from '../../../shared/note-diff.mjs';

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
// Sent to a page when the session replaced its document (it joined another Device's session that
// was there first): the page drops its copy and connects again.
export const MSG_RESET = 2;

export const SAVE_DELAY = 700;
// The AI's cursor stays this long after its last edit, so the user sees where it stopped.
export const AI_LINGER_MS = 1500;
export const AI_USER = { name: 'AI', color: '#7c5cff', colorLight: '#7c5cff33', ai: true };

// Transaction origins that aren't a peer.
const FROM_SEED = 'note-live:seed';
const FROM_RESET = 'note-live:reset';
export const FROM_OUTSIDE = 'note-live:outside';
export const FROM_AI = 'note-live:ai';

// A Yjs client id from the record a session starts from. Two Devices that seed from the same
// record make the same items with the same ids, so their documents merge without doubling the text.
export function seedClientId(id, updatedAt, body) {
  const s = `${id}\n${updatedAt || ''}\n${body || ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  // Keep it apart from the random ids Yjs gives live editors (they span the whole range, so a clash
  // is as unlikely as between two editors).
  return h || 1;
}

export function seedUpdate(id, updatedAt, body) {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(id, updatedAt, body);
  if (body) doc.getText('text').insert(0, body);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

// Which of two sessions of the same Note the other one joins: one with edits since it started,
// then the newer start, then the lower Device key. { seed, edited, deviceKey }.
export function preferSession(a, b) {
  if (!!a.edited !== !!b.edited) return !!a.edited;
  if ((a.seed || '') !== (b.seed || '')) return (a.seed || '') > (b.seed || '');
  return String(a.deviceKey) < String(b.deviceKey);
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * id        the Note's id
 * record    the stored Note: { body, updatedAt }
 * deviceKey this Device's Vault writer key
 * store     { save(body, known) -> { note } | { stale: record } }: write the record unless it
 *           changed since `known` (then return the current one); and conflict(body): keep `body`
 *           as a conflict copy beside the Note.
 * isLeader  () -> whether this Device writes the record now
 * onChange  called when the status (saving, peers, the AI) changes
 */
export class LiveNote {
  constructor({
    id,
    record,
    deviceKey,
    store,
    isLeader = () => true,
    onChange = () => {},
    log = (..._args) => {},
    saveDelay = SAVE_DELAY,
  }) {
    this.id = id;
    this.deviceKey = deviceKey;
    this.store = store;
    this.isLeader = isLeader;
    this.onChange = onChange;
    this.log = log;
    this.saveDelay = saveDelay;
    this.peers = new Map(); // peerId -> { send, kind, clients: Set<awareness clientId> }
    this.known = { body: record.body || '', updatedAt: record.updatedAt || null };
    this.seed = record.updatedAt || null; // the record version this session started from
    this.seedBody = this.known.body;
    this.edited = false; // anything changed since the seed
    this.saving = null;
    this.savingBody = null;
    this.saveTimer = null;
    this.error = null;
    this.aiBusy = 0;
    this.closed = false;
    this._waiters = new Set();
    this._makeDoc(seedUpdate(id, this.seed, this.seedBody));
  }

  _makeDoc(update) {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('text');
    if (update) Y.applyUpdate(ydoc, update, FROM_SEED);
    const awareness = new awarenessProtocol.Awareness(ydoc);
    awareness.setLocalState(null); // only the AI shows up as this session itself
    ydoc.on('update', (u, origin) => this._onUpdate(u, origin));
    awareness.on('update', (change, origin) => this._onAwareness(change, origin));
    this.ydoc = ydoc;
    this.ytext = ytext;
    this.awareness = awareness;
  }

  text() {
    return this.ytext.toString();
  }

  info() {
    return { seed: this.seed, edited: this.edited, deviceKey: this.deviceKey };
  }

  status() {
    const devices = [...this.peers.values()].filter((p) => p.kind === 'device').length;
    return {
      saving: !!this.saving,
      unsaved: this.text() !== this.known.body,
      error: this.error,
      devices,
      leader: this.isLeader(),
      ai: this.aiBusy > 0,
      updatedAt: this.known.updatedAt,
    };
  }

  // --- Peers ---

  addPeer(peerId, send, { kind = 'page' } = {}) {
    if (this.peers.has(peerId)) return this.resync(peerId);
    this.peers.set(peerId, { send, kind, clients: new Set() });
    this.resync(peerId);
    this.onChange();
  }

  // Ask a peer for what we lack, and tell it who's here.
  resync(peerId) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.ydoc);
    this._send(peerId, encoding.toUint8Array(enc));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) this._send(peerId, this._awarenessMsg(states));
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.clients.size)
      awarenessProtocol.removeAwarenessStates(this.awareness, [...peer.clients], 'peer left');
    this.onChange();
  }

  hasPeer(peerId) {
    return this.peers.has(peerId);
  }

  pageCount() {
    return [...this.peers.values()].filter((p) => p.kind === 'page').length;
  }

  receive(peerId, message) {
    if (!this.peers.has(peerId)) return;
    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
    try {
      const dec = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, enc, this.ydoc, peerId);
        if (encoding.length(enc) > 1) this._send(peerId, encoding.toUint8Array(enc));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(dec),
          peerId
        );
      }
    } catch (err) {
      this.log('bad message from a peer', err && err.message);
    }
  }

  _send(peerId, bytes) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    try {
      peer.send(bytes);
    } catch {}
  }

  _toAll(bytes, except = null) {
    for (const peerId of this.peers.keys()) if (peerId !== except) this._send(peerId, bytes);
  }

  _awarenessMsg(clients) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients)
    );
    return encoding.toUint8Array(enc);
  }

  _onUpdate(update, origin) {
    if (origin === FROM_SEED || origin === FROM_RESET) return;
    this.edited = true;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this._toAll(
      encoding.toUint8Array(enc),
      typeof origin === 'string' && this.peers.has(origin) ? origin : null
    );
    this.scheduleSave();
    this.onChange();
  }

  _onAwareness({ added, updated, removed }, origin) {
    const peer = typeof origin === 'string' ? this.peers.get(origin) : null;
    if (peer) for (const c of [...added, ...updated]) peer.clients.add(c);
    for (const c of removed) for (const p of this.peers.values()) p.clients.delete(c);
    const changed = [...added, ...updated, ...removed];
    if (changed.length) this._toAll(this._awarenessMsg(changed), peer ? origin : null);
  }

  // Replace the document with another session's (`update` is its whole state, `info` its seed).
  // Pages are told to connect again. Edits made here since the seed are put back on top.
  reset(update, info) {
    const mine = this.edited ? { base: this.seedBody, text: this.text() } : null;
    const pages = [...this.peers.entries()].filter(([, p]) => p.kind === 'page');
    for (const [peerId] of this.peers) this.removePeer(peerId);
    this.awareness.destroy();
    this.ydoc.destroy();
    this._makeDoc(null);
    Y.applyUpdate(this.ydoc, update, FROM_RESET);
    this.seed = info.seed;
    this.seedBody = this.text();
    this.edited = !!info.edited;
    for (const [, p] of pages) {
      try {
        p.send(Uint8Array.of(MSG_RESET));
      } catch {}
    }
    if (mine && mine.text !== mine.base) this.applyText(mine.base, mine.text, FROM_OUTSIDE);
    this.onChange();
  }

  state() {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  // --- Changes from outside the session ---

  // Put the change from `base` to `next` into the document as edits. False when it touches text
  // that changed meanwhile.
  applyText(base, next, origin = FROM_OUTSIDE) {
    const edits = rebaseEdits(base, diffEdits(base, next), this.text());
    if (!edits) return false;
    if (!edits.length) return true;
    this.ydoc.transact(() => {
      for (let k = edits.length - 1; k >= 0; k--) {
        const e = edits[k];
        if (e.to > e.from) this.ytext.delete(e.from, e.to - e.from);
        if (e.insert) this.ytext.insert(e.from, e.insert);
      }
    }, origin);
    return true;
  }

  // The stored record, read after the Vault changed. The leader folds a change it didn't make into
  // the document; a change that can't merge is kept as a conflict copy, as Notes always did.
  async checkRecord(rec) {
    if (this.closed || !rec) return;
    if (rec.updatedAt === this.known.updatedAt) return;
    const prev = this.known;
    // Our own save, seen before the write returned.
    if (this.savingBody !== null && rec.body === this.savingBody) {
      this.known = { body: rec.body, updatedAt: rec.updatedAt };
      this._wake();
      return;
    }
    this.known = { body: rec.body, updatedAt: rec.updatedAt };
    this._wake();
    if (rec.body === this.text() || !this.isLeader()) return;
    if (!this.applyText(prev.body, rec.body)) {
      this.log('outside edit conflicts with the live note', this.id);
      await this.store.conflict(rec.body);
    }
  }

  // --- Saving ---

  scheduleSave() {
    if (this.closed) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush().catch(() => {}), this.saveDelay);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.saving) {
      await this.saving.catch(() => {});
      return this.flush();
    }
    if (!this.isLeader() || this.text() === this.known.body) return;
    this.saving = (async () => {
      for (let tries = 0; tries < 3; tries++) {
        const body = this.text();
        this.savingBody = body;
        const res = await this.store.save(body, this.known);
        if (res && res.stale) {
          await this.checkRecord(res.stale); // someone outside saved first: merge it, then save
          continue;
        }
        if (res && res.note) this.known = { body: res.note.body, updatedAt: res.note.updatedAt };
        return;
      }
    })();
    this.onChange();
    try {
      await this.saving;
      this.error = null;
    } catch (err) {
      this.error = String((err && err.message) || err);
    } finally {
      this.saving = null;
      this.savingBody = null;
      this._wake();
      this.onChange();
    }
    if (this.text() !== this.known.body && !this.error) this.scheduleSave();
  }

  // Resolves once the stored record holds the session's text (another Device may be the one that
  // writes it), or after `ms`.
  whenStored(ms = 3000) {
    if (this.text() === this.known.body) return Promise.resolve(true);
    return new Promise((resolve) => {
      const w = () => {
        if (this.text() !== this.known.body) return;
        this._waiters.delete(w);
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this._waiters.delete(w);
        resolve(false);
      }, ms);
      this._waiters.add(w);
    });
  }

  _wake() {
    for (const w of this._waiters) w(); // a waiter removes itself: safe on a Set
  }

  // --- The AI as a collaborator ---

  // Make the AI's change from `base` (the text it read) to `next`, a few characters at a time, with
  // its cursor where it types. `pace` is ms per step (0 in tests). Returns false when the change
  // touches text someone else changed since the AI read it.
  async aiEdit(base, next, { pace = 30, user = AI_USER } = {}) {
    const edits = rebaseEdits(base, diffEdits(base, next), this.text());
    if (!edits) return false;
    if (!edits.length) return true;
    this.aiBusy++;
    this.onChange();
    const ytext = this.ytext;
    const rel = (i, assoc = 0) => Y.createRelativePositionFromTypeIndex(ytext, i, assoc);
    const abs = (r) => {
      const p = Y.createAbsolutePositionFromRelativePosition(r, this.ydoc);
      return p ? p.index : null;
    };
    const cursor = (a, h = a) =>
      this.awareness.setLocalState({ user, cursor: { anchor: rel(a), head: rel(h) } });
    // Anchored to the text, so the user typing elsewhere meanwhile doesn't move them.
    const marks = edits.map((e) => ({ from: rel(e.from), to: rel(e.to, -1), insert: e.insert }));
    const total = edits.reduce((n, e) => n + e.insert.length, 0);
    const steps = pace
      ? Math.max(1, Math.min(100, Math.round(Math.min(3000, Math.max(300, total * 12)) / pace)))
      : 1;
    const chunk = Math.max(1, Math.ceil(total / steps));
    try {
      for (const m of marks) {
        const from = abs(m.from);
        const to = abs(m.to);
        if (from == null) continue;
        let at = from;
        if (to != null && to > from) {
          cursor(from, to); // show what goes, then remove it
          await sleep(pace * 5);
          this.ydoc.transact(() => ytext.delete(from, to - from), FROM_AI);
        }
        cursor(at);
        let rest = m.insert;
        let after = rel(at);
        while (rest) {
          // Whole words where it can: up to `chunk` characters, ending after a space if there's one.
          let n = Math.min(rest.length, chunk);
          if (n < rest.length) {
            const sp = rest.lastIndexOf(' ', n);
            if (sp > n / 2) n = sp + 1;
          }
          const piece = rest.slice(0, n);
          rest = rest.slice(n);
          at = abs(after) ?? at;
          this.ydoc.transact(() => ytext.insert(at, piece), FROM_AI);
          at += piece.length;
          after = rel(at, -1);
          // A finished line keeps the cursor at its end, not at the start of the next one.
          cursor(!rest && piece.endsWith('\n') ? at - 1 : at);
          if (rest) await sleep(pace);
        }
        await sleep(pace * 3);
      }
    } finally {
      this.aiBusy--;
      const done = () => {
        if (!this.aiBusy && !this.closed) this.awareness.setLocalState(null);
        this.onChange();
      };
      if (pace) setTimeout(done, AI_LINGER_MS);
      else done();
    }
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.saveTimer);
    for (const peerId of this.peers.keys()) this.removePeer(peerId);
    this._wake();
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
