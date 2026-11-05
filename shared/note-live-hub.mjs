// nomad/shared/note-live-hub.mjs
//
// The live Note sessions on one Device (ADR-0041): which Notes are open here, the pages that edit
// them, the AI typing into them, and the frames of shared/note-live.mjs that join them with the same
// Notes open on the user's other Devices. Desktop (app/bg/notes/live-notes.js) and the phone's
// backend (mobile/backend/lib/live-notes.mjs) both run it, so a session started on either joins the
// other's the same way.
//
//   a Notes page ── openPage / pageReceive ──┐
//   the AI's writeNote ── aiWrite ───────────┤ LiveNote (shared/note-live-session.mjs) ── the record
//   another Device ── the nomad/note-live link ┘
//
// A session lives while a page has the Note open (and a few seconds after), or while the AI writes
// into a Note that is open somewhere. Like the other shared modules it has no bare imports: the
// runtime passes in its LiveNote class, b4a, the record store and the link. Tested in
// tests/unit/note-live-hub.test.js.

import { FRAME } from './note-live.mjs';
import { preferSession } from './note-live-session.mjs';

// How long a session stays after its last page closed, so reopening the Note (or the next AI write)
// doesn't start over.
export const IDLE_CLOSE_MS = 5000;
// How long a new session waits for the other Devices that have the Note open before it goes on.
export const JOIN_WAIT_MS = 1500;

const devPeer = (deviceKey) => 'dev:' + deviceKey;
const pagePeer = (connId) => 'page:' + connId;
function noop(..._args) {}

/**
 * LiveNote       the session class (makeLiveNote(...).LiveNote)
 * b4a            the runtime's
 * locate(id, ctx)    -> the stored Note { body, updatedAt, ... } or null
 * storeFor(id, ctx)  -> { save(body, known), conflict(body) } for LiveNote
 * getDeviceKey()     -> this Device's Vault writer key (hex), may be async
 * canSave()          whether this Device can write the record now (a phone not yet a Vault writer
 *                    can't, so it never leads)
 * onStatus(id, status)  a session's status changed (after its pages were told)
 * onSessions(count)     the number of open sessions changed (start or stop watching the Vault)
 * `ctx` is whatever the page passed when it opened the Note (the phone's active Space).
 */
export function createLiveNotes({
  LiveNote,
  b4a,
  locate,
  storeFor,
  getDeviceKey,
  canSave = () => true,
  onStatus = noop,
  onSessions = noop,
  log = noop,
  idleCloseMs = IDLE_CLOSE_MS,
  joinWaitMs = JOIN_WAIT_MS,
}) {
  const hubs = new Map(); // note id -> { live, ready, pages: Map<connId, page>, holds, closeTimer, ctx }
  const remoteOpen = new Map(); // deviceKey -> Set<note id>
  const remoteSaves = new Map(); // deviceKey -> whether it can write the record (its JOIN said)
  const starting = new Map(); // note id -> Promise<hub>, while its record loads
  let link = null;
  let ownKey = null;

  const toB64 = (bytes) => b4a.toString(b4a.from(bytes), 'base64');
  const fromB64 = (s) => new Uint8Array(b4a.from(String(s || ''), 'base64'));

  async function deviceKey() {
    ownKey = (await getDeviceKey()) || null;
    return ownKey;
  }

  function saves() {
    try {
      return !!canSave();
    } catch {
      return false;
    }
  }

  // --- The link to the user's other Devices ---

  // `l` is a createNoteLink(...) result: { send(deviceKey, frame), broadcast(frame) }.
  function useLink(l) {
    link = l;
  }

  function openIds() {
    return [...hubs.keys()];
  }

  function announce() {
    if (link) link.broadcast({ t: FRAME.OPEN, ids: openIds() });
  }

  function sendJoin(key, hub, reply = false) {
    link?.send(key, { t: FRAME.JOIN, id: hub.live.id, ...hub.live.info(), saves: saves(), reply });
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

  function onPeer(key, up) {
    if (up) return;
    remoteOpen.delete(key);
    remoteSaves.delete(key);
    for (const hub of hubs.values()) hub.live.removePeer(devPeer(key));
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
        // An older Device doesn't say: it always saves.
        remoteSaves.set(key, f.saves !== false);
        const theirs = { seed: f.seed || null, edited: !!f.edited, deviceKey: key };
        if ((theirs.seed || null) === (live.seed || null)) {
          // The reply goes first, so it has added us before our first sync message arrives.
          if (!f.reply) sendJoin(key, hub, true);
          addDevice(hub, key);
        } else if (preferSession(live.info(), theirs)) {
          if (!f.reply) sendJoin(key, hub, true); // it joins ours: it will ask for our document
        } else {
          link?.send(key, { t: FRAME.WANT, id: f.id });
        }
        return;
      }
      case FRAME.WANT:
        link?.send(key, { t: FRAME.STATE, id: f.id, update: toB64(live.state()), ...live.info() });
        return;
      case FRAME.STATE: {
        if ((f.seed || null) === (live.seed || null)) return;
        log('Joining another Device’s live note', f.id, key.slice(0, 8));
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

  // The Device that writes the record: the lowest key among those in the session that can.
  function leaderOf(live) {
    const keys = saves() ? [ownKey || ''] : [];
    for (const [peerId, p] of live.peers) {
      if (p.kind !== 'device') continue;
      const k = peerId.slice(4);
      if (remoteSaves.get(k) !== false) keys.push(k);
    }
    return keys.length > 0 && keys.sort()[0] === (ownKey || '');
  }

  function notifyPages(hub) {
    const status = hub.live.status();
    for (const page of hub.pages.values()) {
      try {
        page.onStatus(status);
      } catch {}
    }
    onStatus(hub.live.id, status);
  }

  // The session for Note `id`, started (and joined to the other Devices that have it open) if needed.
  async function getHub(id, ctx) {
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
        startHub(id, ctx).finally(() => starting.delete(id))
      );
    return starting.get(id);
  }

  async function startHub(id, ctx) {
    const prev = await locate(id, ctx);
    if (!prev) throw new Error('No note with that id');
    await deviceKey();
    const hub = { pages: new Map(), holds: 0, closeTimer: null, live: null, ready: null, joined: null, ctx };
    hub.live = new LiveNote({
      id,
      record: prev,
      deviceKey: ownKey,
      store: storeFor(id, ctx),
      isLeader: () => leaderOf(hub.live),
      onChange: () => notifyPages(hub),
      log,
    });
    hubs.set(id, hub);
    announce();
    onSessions(hubs.size);
    // Wait (briefly) for the Devices that have it open, so we start from their document.
    const waiting = [...remoteOpen].filter(([, ids]) => ids.has(id)).map(([k]) => k);
    hub.ready = waiting.length
      ? new Promise((resolve) => {
          const left = new Set(waiting);
          const timer = setTimeout(resolve, joinWaitMs);
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
    if (hub.pages.size || hub.holds || hub.closeTimer || hub.live.closed) return;
    hub.closeTimer = setTimeout(() => closeHub(hub).catch(() => {}), idleCloseMs);
  }

  async function closeHub(hub) {
    hub.closeTimer = null;
    if (hub.pages.size || hub.holds) return;
    await hub.live.flush().catch(() => {});
    if (hub.pages.size || hub.holds || hub.live.closed) return;
    for (const [peerId, p] of hub.live.peers) {
      if (p.kind === 'device') link?.send(peerId.slice(4), { t: FRAME.LEAVE, id: hub.live.id });
    }
    hub.live.close();
    hubs.delete(hub.live.id);
    announce();
    onSessions(hubs.size);
  }

  // The record of an open Note may have changed (the Vault, or a Space Library, updated). The
  // leader folds an outside change into the session; everyone notes the record's version.
  async function recordsChanged() {
    for (const hub of [...hubs.values()]) {
      try {
        const prev = await locate(hub.live.id, hub.ctx);
        if (prev) await hub.live.checkRecord(prev);
      } catch {}
    }
  }

  // --- Pages ---

  // A page opened Note `id` for live editing as `connId`. `send(bytes)` gets the session's
  // y-protocols messages for it; `onStatus(status)` the session's status. Resolves once it has
  // joined (with the status), or rejects (no such Note). `isClosed()` lets a page that went away
  // while the session started leave at once.
  async function openPage(id, connId, { send, onStatus: pageStatus = noop, ctx = null, isClosed = () => false }) {
    const hub = await getHub(id, ctx);
    if (isClosed()) {
      releaseLater(hub);
      return null;
    }
    hub.pages.set(connId, { send, onStatus: pageStatus });
    hub.live.addPeer(pagePeer(connId), send, { kind: 'page' });
    const status = hub.live.status();
    pageStatus(status);
    return status;
  }

  function pageReceive(id, connId, bytes) {
    const hub = hubs.get(id);
    if (!hub || !hub.pages.has(connId)) return false;
    hub.live.receive(pagePeer(connId), bytes);
    return true;
  }

  // The page left. Saves what it typed now (when this Device leads), then lets the session go a
  // few seconds later unless the Note is opened again.
  async function closePage(id, connId) {
    const hub = hubs.get(id);
    if (!hub || !hub.pages.has(connId)) return;
    hub.pages.delete(connId);
    hub.live.removePeer(pagePeer(connId));
    if (!hub.pages.size) await hub.live.flush().catch(() => {});
    releaseLater(hub);
  }

  // --- The AI ---

  // Is Note `id` open for live editing, here or on another of the user's Devices?
  function isOpen(id) {
    if (hubs.has(id)) return true;
    for (const ids of remoteOpen.values()) if (ids.has(id)) return true;
    return false;
  }

  // The AI changes Note `id` from `base` (the text it read) to `body`, typing into the open session
  // with its own cursor. Returns { note } once saved, null when the Note isn't open anywhere (the
  // caller saves it as before), or { conflict: true } when the change touches text someone changed
  // since the AI read it.
  async function aiWrite(id, base, body, { ctx = null, pace } = {}) {
    if (!isOpen(id)) return null;
    const hub = await getHub(id, ctx);
    hub.holds++;
    try {
      const ok = await hub.live.aiEdit(base, body, pace === undefined ? {} : { pace });
      if (!ok) return { conflict: true };
      await hub.live.flush();
      await hub.live.whenStored();
      return { note: await locate(id, hub.ctx) };
    } finally {
      hub.holds--;
      releaseLater(hub);
    }
  }

  // Close every session now (the Vault went away). Nothing is saved.
  function closeAll() {
    for (const hub of hubs.values()) {
      clearTimeout(hub.closeTimer);
      hub.live.close();
    }
    hubs.clear();
    remoteOpen.clear();
    remoteSaves.clear();
    onSessions(0);
  }

  return {
    useLink,
    openIds,
    onPeer,
    onFrame,
    openPage,
    pageReceive,
    closePage,
    isOpen,
    aiWrite,
    recordsChanged,
    closeAll,
    // For tests and status pages.
    session: (id) => hubs.get(id)?.live || null,
    sessions: () => hubs.size,
  };
}
