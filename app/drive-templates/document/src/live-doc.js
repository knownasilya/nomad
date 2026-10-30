// A Live Doc (ADR-0025): a Yjs document kept in a Drive as update files, one folder per Writer, and
// shared live between open copies over a peersockets room.
//
//   <doc>/updates/<writerKey>/<ms>-<rand>.yupdate   this Writer's batched edits (inline files)
//   <doc>/snapshots/<writerKey>-<ms>.ystate          a compaction of the files it replaced
//   <doc>/content.md                                 the text, for readers that don't run Yjs
//
// The files are the source of truth. The room only makes keystrokes and cursors arrive sooner: each
// Writer saves the edits it made itself, never ones it received, and compaction reads only files.
// A document update from the room is applied only when bg proved the peer is a current Writer.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const FLUSH_IDLE_MS = 2000; // save after this long without an edit
export const FLUSH_MAX_MS = 10000; // and at least this often while typing goes on
export const EXPORT_MS = 4000; // rewrite content.md this long after edits settle
export const COMPACT_AT = 256; // update files before the next Writer compacts

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// Origins of transactions that must not be saved again: they came from files or another peer.
export const FROM_FILES = 'live-doc:files';
export const FROM_PEER = 'live-doc:peer';

const b64 = {
  encode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
export { b64 };

// Merge many updates in a tree of 64. Files come back in path order, not causal order: applying them
// one by one parks most in Yjs's pending queue (quadratic), and one mergeUpdates over thousands is
// superlinear. The tree is fast in any order.
export function treeMerge(updates, n = 64) {
  if (!updates.length) return null;
  while (updates.length > 1) {
    const next = [];
    for (let i = 0; i < updates.length; i += n) next.push(Y.mergeUpdates(updates.slice(i, i + n)));
    updates = next;
  }
  return updates[0];
}

const rand = () => Math.random().toString(36).slice(2, 8);
export const updatePath = (doc, writerKey, now = Date.now()) =>
  `${doc}/updates/${writerKey}/${now}-${rand()}.yupdate`;
export const snapshotPath = (doc, writerKey, now = Date.now()) =>
  `${doc}/snapshots/${writerKey}-${now}.ystate`;
export const isUpdateFile = (key) => /\/updates\/[0-9a-f]{64}\/[^/]+\.yupdate$/.test(key);
export const isSnapshotFile = (key) => /\/snapshots\/[0-9a-f]{64}-[^/]+\.ystate$/.test(key);

// When to save: FLUSH_IDLE_MS after the last edit, but no later than FLUSH_MAX_MS after the first
// unsaved one. Returns the delay from `now`.
export function flushDelay({ firstUnsavedAt, lastEditAt, now }) {
  const idle = lastEditAt + FLUSH_IDLE_MS - now;
  const cap = firstUnsavedAt + FLUSH_MAX_MS - now;
  return Math.max(0, Math.min(idle, cap));
}

/**
 * Open a Live Doc.
 *  drive     a nomad.fs scoped handle
 *  path      the doc folder, e.g. '/doc'
 *  writerKey this Device's writer key (getInfo().writerKey), or null
 *  writable  whether this Device can write the Drive
 *  sockets   nomad.peersockets, or null (the phone has none: files only)
 *  user      { name, color } for presence
 *  onStatus  called with { saving, unsaved, peers, writers, error }
 */
export function openLiveDoc({
  drive,
  path,
  writerKey,
  writable,
  sockets,
  user,
  onStatus = () => {},
}) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('text');
  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.setLocalStateField('user', { ...user, writer: !!writable });

  const seen = new Set(); // file keys already applied
  let pending = []; // local updates not yet saved
  let firstUnsavedAt = 0;
  let lastEditAt = 0;
  let flushTimer = null;
  let exportTimer = null;
  let saving = false;
  let compacting = false;
  let destroyed = false;
  let lastError = null;
  const peers = new Map(); // peerId -> { writerKey }

  const status = () => {
    if (destroyed) return;
    onStatus({
      saving,
      unsaved: pending.length > 0,
      peers: peers.size,
      writers: [...peers.values()].filter((p) => p.writerKey).length,
      error: lastError,
    });
  };

  // --- Files (the durable path) ---

  // [{ key, bytes }] for the files that could be read. One that's gone was deleted by a compaction
  // between list and read, and that compaction's snapshot carries it.
  async function readFiles(keys) {
    const parts = await Promise.all(
      keys.map(async (key) => {
        try {
          const s = await drive.readFile(key, { encoding: 'base64' });
          return s ? { key, bytes: b64.decode(s) } : null;
        } catch {
          return null;
        }
      })
    );
    return parts.filter(Boolean);
  }

  async function listFiles() {
    const entries = await drive.list(path + '/');
    return entries.map((e) => e.key).filter((k) => isUpdateFile(k) || isSnapshotFile(k));
  }

  async function pull() {
    const keys = await listFiles();
    const fresh = keys.filter((k) => !seen.has(k));
    if (fresh.length) {
      const files = await readFiles(fresh);
      const merged = treeMerge(files.map((f) => f.bytes));
      if (merged) Y.applyUpdate(ydoc, merged, FROM_FILES);
      for (const f of files) seen.add(f.key);
    }
    return keys;
  }

  async function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!writable || !writerKey || !pending.length || saving) return;
    saving = true;
    const batch = pending;
    pending = [];
    firstUnsavedAt = 0;
    status();
    try {
      const update = Y.mergeUpdates(batch);
      const key = updatePath(path, writerKey);
      // { draft: false }: a Live Doc's edits are the document; Draft Mode doesn't stage them.
      await drive.writeFile(key, b64.encode(update), {
        encoding: 'base64',
        inline: true,
        draft: false,
      });
      seen.add(key);
      lastError = null;
    } catch (err) {
      pending = batch.concat(pending); // keep them for the next try
      firstUnsavedAt = firstUnsavedAt || Date.now();
      lastError = String((err && err.message) || err);
    } finally {
      saving = false;
      status();
      if (pending.length) schedule();
    }
  }

  function schedule() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, flushDelay({ firstUnsavedAt, lastEditAt, now: Date.now() }));
  }

  async function exportText() {
    exportTimer = null;
    if (!writable) return;
    try {
      await drive.writeFile(path + '/content.md', ytext.toString(), { draft: false });
    } catch {}
  }

  // Fold the update files into one snapshot: the snapshot first, then the deletes of exactly the
  // files it read, so a reader never sees the deletes without it. Built from files only.
  async function compact(keys) {
    if (compacting || !writable || !writerKey) return;
    const updates = keys.filter(isUpdateFile);
    if (updates.length < COMPACT_AT) return;
    compacting = true;
    try {
      const files = await readFiles(keys);
      const doc = new Y.Doc();
      const merged = treeMerge(files.map((f) => f.bytes));
      if (merged) Y.applyUpdate(doc, merged);
      const key = snapshotPath(path, writerKey);
      await drive.writeFile(key, b64.encode(Y.encodeStateAsUpdate(doc)), {
        encoding: 'base64',
        draft: false,
      });
      seen.add(key);
      // Delete only what went into the snapshot: a file that couldn't be read stays.
      for (const f of files) {
        await drive.unlink(f.key, { draft: false }).catch(() => {});
      }
    } finally {
      compacting = false;
    }
  }

  ydoc.on('update', (update, origin) => {
    if (origin === FROM_FILES || origin === FROM_PEER) return;
    // This Device's own edit: save it, and send it to the room now.
    pending.push(update);
    const now = Date.now();
    lastEditAt = now;
    if (!firstUnsavedAt) firstUnsavedAt = now;
    schedule();
    clearTimeout(exportTimer);
    exportTimer = setTimeout(exportText, EXPORT_MS);
    broadcastUpdate(update);
    status();
  });

  // --- The room (the live path) ---

  let topic = null;
  const send = (peerId, bytes) => {
    try {
      topic.send(peerId, bytes);
    } catch {}
  };
  const toAll = (bytes) => {
    for (const peerId of peers.keys()) send(peerId, bytes);
  };

  // Only this Device's own edits go to the room, and only as a Writer (anyone else's are dropped).
  // What came from a peer, the others have; what came from files, they read too.
  function broadcastUpdate(update) {
    if (!topic || !writable) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    toAll(encoding.toUint8Array(enc));
  }

  function sendHello(peerId) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, ydoc);
    send(peerId, encoding.toUint8Array(enc));
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      aw,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID])
    );
    send(peerId, encoding.toUint8Array(aw));
  }

  function onMessage({ peerId, message, writerKey: fromWriter }) {
    if (!peers.has(peerId)) peers.set(peerId, { writerKey: fromWriter || null });
    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
    try {
      const dec = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const kind = decoding.readVarUint(dec);
        if (kind === syncProtocol.messageYjsSyncStep1) {
          // Anyone may ask for the state; it's what they could read from the files anyway.
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.writeSyncStep2(enc, ydoc, decoding.readVarUint8Array(dec));
          send(peerId, encoding.toUint8Array(enc));
        } else if (fromWriter) {
          // Step 2 or an update: document content, accepted only from a proven Writer.
          Y.applyUpdate(ydoc, decoding.readVarUint8Array(dec), FROM_PEER);
        }
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), peerId);
      }
    } catch {
      // A malformed message from one peer never breaks the doc.
    }
  }

  function joinRoom() {
    if (!sockets) return;
    topic = sockets.join('live-doc:' + path);
    topic.addEventListener('join', (e) => {
      peers.set(e.peerId, { writerKey: null });
      sendHello(e.peerId);
      status();
    });
    topic.addEventListener('writer', (e) => {
      peers.set(e.peerId, { writerKey: e.writerKey });
      // Now that it's proven, ask again: its first answer may have been dropped.
      sendHello(e.peerId);
      status();
    });
    topic.addEventListener('leave', (e) => {
      peers.delete(e.peerId);
      awarenessProtocol.removeAwarenessStates(
        awareness,
        [...awareness.getStates().keys()].filter((id) => awarenessPeers.get(id) === e.peerId),
        'peer left'
      );
      status();
    });
    topic.addEventListener('message', (e) => onMessage(e));
  }

  // Which peer sent which awareness client, so a peer's cursor goes when it leaves.
  const awarenessPeers = new Map();
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (typeof origin === 'string' && origin !== 'local' && origin !== 'peer left') {
      for (const id of [...added, ...updated]) awarenessPeers.set(id, origin);
    }
    for (const id of removed) awarenessPeers.delete(id);
    if (origin === 'local' && topic) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])
      );
      toAll(encoding.toUint8Array(enc));
    }
  });

  // --- Lifecycle ---

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const onPageHide = () => flush();
  let unwatch = null;

  const whenLoaded = (async () => {
    const keys = await pull();
    status();
    joinRoom();
    const evts = drive.watch(path + '/', () => {
      pull()
        .then(() => status())
        .catch(() => {});
    });
    unwatch = () => evts && evts.close && evts.close();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    // Compaction runs in the background once the doc is open.
    compact(keys).catch(() => {});
  })();

  return {
    ydoc,
    ytext,
    awareness,
    whenLoaded,
    flush,
    async destroy() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      await flush();
      destroyed = true;
      if (unwatch) unwatch();
      awarenessProtocol.removeAwarenessStates(awareness, [ydoc.clientID], 'local');
      clearTimeout(exportTimer);
    },
  };
}
