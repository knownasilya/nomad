// @ts-nocheck
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import Hyperblobs from 'hyperblobs';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import {
  createFsCore,
  createBlobStore,
  createContentReader,
  makeMetadata,
  AUTOBASE_OPTS,
  BLOBS_CORE_NAME,
  viewDirHasChildren,
} from '../../../shared/fs-core.mjs';
import * as logLib from '../logger';
import * as daemon from './daemon';
import * as archivesDb from '../dbs/archives';

// The canonical view-open + pure reducer + blob helpers, shared byte-for-byte with the mobile
// backend (see nomad/shared/fs-core.mjs). Deps are injected because the shared module has no
// bare P2P imports (root node_modules is empty; see that file's header).
const { open: _openFn, apply: _applyFn } = createFsCore({ Hyperbee, b4a });
const _blobStore = createBlobStore({ Hyperblobs, b4a });
const _content = createContentReader({ Hyperblobs, b4a });

const baseLogger = logLib.get();
const logger = baseLogger.child({ category: 'hyper', subcategory: 'autobases' });

// Module events. 'request' fires when a writer-access request arrives over the network for
// a drive we have loaded — { key, writerKey, profileUrl } — so the UI can refresh live.
export const events = new EventEmitter();

// bootstrapKey (hex) → AutobaseSession
var sessions = {};

// bootstrapKey (hex) → in-flight load Promise (dedupes concurrent loads of the same
// drive — e.g. the document request plus its subresources — so we never open two
// Autobase instances on the same key and deadlock on the shared 'local' core).
var loadPromises = {};

// pending writer requests: bootstrapKey → [{ writerKey, profileUrl, requestedAt, token }]
var pendingRequests = {};

// pending invites: token → { bootstrapKey, multiUse, expiresAt }
var pendingInvites = {};

export async function createCollaborativeDrive(meta = {}) {
  const store = daemon.getCorestore();
  // Autobase.boot() uses store.get({ name: 'local' }) to create the writer core.
  // Without a unique namespace, concurrent creates conflict on the 'local' named
  // core (exclusive lock) and hang. Each drive gets its own namespace; loading
  // still works because Corestore finds private keys by public key across namespaces.
  const namespacedStore = store.namespace(randomBytes(32));
  const base = new Autobase(namespacedStore, null, {
    apply: _applyFn,
    open: _openFn,
    ...AUTOBASE_OPTS,
  });
  await base.ready();

  const keyStr = b4a.toString(base.key, 'hex');
  const sess = _makeSession(keyStr, base, true);
  // Whether this drive accepts writer-access requests (locked by default). Persisted in index.json.
  sess.collaborative = !!meta.collaborative;
  sessions[keyStr] = sess;

  // Write index.json if metadata supplied — an inline control record (small JSON, kept in the
  // view so a peer can read the manifest without resolving a blob core).
  if (meta && Object.keys(meta).length > 0) {
    await putInline(sess, '/index.json', JSON.stringify(meta, null, 2));
  }

  _joinSwarm(base); // opens the writer-request channel only if sess.collaborative (see _openControlChannel)
  logger.info('Created collaborative drive', { key: keyStr });
  return sess;
}

// How long to wait for a remote base's bootstrap to replicate before serving.
const LOAD_REPLICATION_TIMEOUT = 15000;

export async function loadCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex');
  if (sessions[keyStr]) {
    sessions[keyStr]._lastUsed = Date.now();
    return sessions[keyStr];
  }
  if (loadPromises[keyStr]) return loadPromises[keyStr];

  const p = _loadCollaborativeDriveInner(keyStr);
  loadPromises[keyStr] = p;
  const clear = () => {
    delete loadPromises[keyStr];
  };
  p.then(clear, clear);
  return p;
}

async function _loadCollaborativeDriveInner(keyStr) {
  const store = daemon.getCorestore();
  const keyBuf = b4a.from(keyStr, 'hex');
  const base = new Autobase(store, keyBuf, {
    apply: _applyFn,
    open: _openFn,
    ...AUTOBASE_OPTS,
  });
  await base.ready();

  // Join the swarm BEFORE updating. A remote collaborative drive must replicate its
  // bootstrap from peers, so a connection has to be in place first — createHyperdriveSession
  // joins during setup for the same reason.
  _joinSwarm(base);

  const sess = _makeSession(keyStr, base, base.writable);
  sessions[keyStr] = sess;

  // base.update() returns immediately with an EMPTY view if no peer has delivered the
  // bootstrap yet — and a peer typically connects a beat after we join. So poll update()
  // until the view has content or the deadline passes (mirrors the hyperdrive warm-up).
  // A reachable drive serves as soon as it syncs; an unreachable one fails fast and stays
  // reloadable instead of hanging or returning a premature "not found".
  const deadline = Date.now() + LOAD_REPLICATION_TIMEOUT;
  await base.update();
  while (_viewEmpty(base) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await base.update();
  }

  sess.writable = base.writable;
  // Read the accepts-writers flag from index.json now the view has synced. If collaborative, open
  // the writer-request channels (they were skipped during _joinSwarm since the flag wasn't known yet).
  sess.collaborative = await _readCollaborativeFlag(sess);
  if (sess.collaborative) _enableWriterRequests(keyStr);
  logger.info('Loaded collaborative drive', {
    key: keyStr,
    writable: base.writable,
    synced: !_viewEmpty(base),
    collaborative: sess.collaborative,
  });
  return sess;
}

// True until the linearised view has at least one block (i.e. some content replicated).
// Hyperbee.version is Math.max(1, length) so it can't be used here — read the core length.
function _viewEmpty(base) {
  try {
    return !base.view || !base.view.core || base.view.core.length === 0;
  } catch {
    return true;
  }
}

export function getCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex');
  return sessions[keyStr];
}

export async function getOrLoadCollaborativeDrive(key) {
  const sess = getCollaborativeDrive(key);
  if (sess) return sess;
  return loadCollaborativeDrive(key);
}

export function unloadCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex');
  if (!sessions[keyStr]) return;
  sessions[keyStr].base.close().catch(() => {});
  delete sessions[keyStr];
  logger.debug('Unloaded collaborative drive', { key: keyStr });
}

// File content read/write (FS_FORMAT_VERSION 1 — hybrid {metadata, blob, value} records)
// =
// These centralise the wire format so every consumer (nomad.autobase, nomad.fs, the vault,
// the protocol serve path) reads/writes it identically. File BYTES go into this device's own
// Hyperblobs core OUTSIDE apply (only a pointer travels through the oplog); small control
// records go inline. See shared/fs-core.mjs.

// This device's writable blobs core for a drive. Namespaced by the base's local writer key so
// it reopens to the SAME core key across restarts (the pointer we stamp must stay resolvable).
function _blobsFor(sess) {
  if (!sess.blobs) {
    const store = daemon.getCorestore();
    const nsName = b4a.toString(sess.base.local.key, 'hex');
    sess.blobs = new Hyperblobs(store.namespace(nsName).get({ name: BLOBS_CORE_NAME }));
  }
  return sess.blobs;
}

// Build metadata for a write: mtime=now, ctime preserved from any existing entry (real ctime
// ordering — the capability Phase 1 restores). Runs OUTSIDE apply, so a clock is fine here.
async function _writeMeta(sess, path, { executable = false } = {}) {
  const now = Date.now();
  let ctime = now;
  try {
    const cur = await sess.drive.get(path);
    if (cur && cur.value && cur.value.metadata && cur.value.metadata.ctime)
      ctime = cur.value.metadata.ctime;
  } catch {}
  return makeMetadata({ mtime: now, ctime, executable });
}

// Build a put op storing CONTENT as a blob (bytes kept out of the oplog). Writes the blob as a
// side effect and returns the op so callers can batch multiple appends before one update().
export async function buildPutBlobOp(sess, path, buf, opts = {}) {
  const bytes = b4a.isBuffer(buf) ? buf : b4a.from(buf);
  const blob = bytes.length ? await _blobStore.putBlob(_blobsFor(sess), bytes) : null;
  return { op: 'put', path, metadata: await _writeMeta(sess, path, opts), blob };
}

// Build a put op storing small CONTENT inline (value) — control records (index.json, /.vault/*,
// bookmarks, drives.json). data may be a string, Buffer, or JSON-serialisable object.
export async function buildPutInlineOp(sess, path, data, opts = {}) {
  const bytes = b4a.isBuffer(data)
    ? data
    : b4a.from(typeof data === 'string' ? data : JSON.stringify(data));
  return {
    op: 'put',
    path,
    metadata: await _writeMeta(sess, path, opts),
    value: b4a.toString(bytes, 'base64'),
  };
}

// Convenience write+flush helpers.
export async function writeFile(sess, path, buf, opts = {}) {
  await sess.base.append(await buildPutBlobOp(sess, path, buf, opts));
  await sess.base.update();
}
export async function putInline(sess, path, data, opts = {}) {
  await sess.base.append(await buildPutInlineOp(sess, path, data, opts));
  await sess.base.update();
}
export async function deletePath(sess, path) {
  await sess.base.append({ op: 'del', path });
  await sess.base.update();
}

// Read a path's raw content bytes (resolves inline value OR blob pointer). null if missing.
// `range` = { start, length } for partial reads (e.g. HTTP Range).
export async function readContent(sess, path, range) {
  const node = await sess.drive.get(path);
  if (!node || !node.value) return null;
  return _content.readContent(node.value, { store: daemon.getCorestore(), range });
}

// Read + JSON.parse a control record. null if missing/invalid.
export async function readJson(sess, path) {
  const buf = await readContent(sess, path);
  if (!buf) return null;
  try {
    return JSON.parse(b4a.toString(buf));
  } catch {
    return null;
  }
}

// List records whose key is under `prefix` (recursive key-range scan of the Hyperbee view).
// Returns [{ path, record }] — resolve each record's bytes with resolveRecordContent(record).
export async function listRecords(sess, prefix) {
  const out = [];
  const opts = prefix === '/' ? {} : { gte: prefix, lt: prefix + '\xff' };
  for await (const node of sess.drive.createReadStream(opts)) {
    out.push({
      path: typeof node.key === 'string' ? node.key : b4a.toString(node.key),
      record: node.value,
    });
  }
  return out;
}

// The raw view record ({metadata, blob, value}) for stat/entry. null if missing.
export async function readRecord(sess, path) {
  const node = await sess.drive.get(path);
  return node ? node.value : null;
}

// On-disk byte length of a record's content without fetching blob bytes.
export function recordByteLength(record) {
  return _content.contentLength(record);
}

// True when the session's linearised view has no content yet (core length 0). Used to detect a
// stale/incompatible root drive (e.g. a pre-re-home Hyperdrive key opened as an Autobase).
export function viewEmpty(sess) {
  try {
    return (
      !sess ||
      !sess.base ||
      !sess.base.view ||
      !sess.base.view.core ||
      sess.base.view.core.length === 0
    );
  } catch {
    return true;
  }
}

// Resolve a record's content bytes (used when you already hold the record). `range` optional.
export function resolveRecordContent(record, range) {
  return _content.readContent(record, { store: daemon.getCorestore(), range });
}

// True when `dirPath` has children in the linearized view (i.e. it is a directory). See fs-core.
export function dirHasChildren(sess, dirPath) {
  return viewDirHasChildren(sess.drive, dirPath);
}

// Invite management
// =

export function createInvite(bootstrapKey, { multiUse = false } = {}) {
  const token = randomBytes(16).toString('hex');
  pendingInvites[token] = { bootstrapKey, multiUse, createdAt: Date.now() };
  return token;
}

export function getInvite(token) {
  return pendingInvites[token] || null;
}

export function consumeInvite(token) {
  const invite = pendingInvites[token];
  if (!invite) return null;
  if (!invite.multiUse) delete pendingInvites[token];
  return invite;
}

// Request management
// =

export function addPendingRequest(bootstrapKey, { writerKey, profileUrl }) {
  if (!pendingRequests[bootstrapKey]) pendingRequests[bootstrapKey] = [];
  const existing = pendingRequests[bootstrapKey].find((r) => r.writerKey === writerKey);
  if (existing) return;
  pendingRequests[bootstrapKey].push({
    writerKey,
    profileUrl,
    requestedAt: new Date().toISOString(),
  });
  logger.debug('Pending writer request', { bootstrapKey, writerKey });
}

export function listPendingRequests(bootstrapKey) {
  return pendingRequests[bootstrapKey] || [];
}

export function removePendingRequest(bootstrapKey, writerKey) {
  if (!pendingRequests[bootstrapKey]) return;
  pendingRequests[bootstrapKey] = pendingRequests[bootstrapKey].filter(
    (r) => r.writerKey !== writerKey
  );
}

// Send a writer-access request to the drive's peers (owner + existing writers) over the
// swarm. pendingRequests is per-process, so without this the owner never learns a remote
// peer wants access. The request is remembered and re-sent to any peer that connects until
// we actually become a writer, so it survives a not-yet-connected owner.
export function requestWriterAccess(bootstrapKey, { writerKey, profileUrl }) {
  outgoingRequests[bootstrapKey] = { writerKey, profileUrl: profileUrl || null };
  const peers = controlChannels[bootstrapKey];
  if (peers) for (const peerId of peers.keys()) _sendOutgoingTo(bootstrapKey, peerId);
}

// internal
// =

function _makeSession(keyStr, base, writable) {
  return {
    key: base.key,
    keyStr,
    discoveryKey: base.discoveryKey,
    url: `hyper://${keyStr}/`,
    writable,
    base,
    // Locked by default: a drive does NOT accept writer-access requests unless `collaborative`
    // is true (from its index.json). A drive can be unlocked later without changing its URL —
    // the ADR-0010 property. This is a POLICY lock (the owner is always the gate on addWriter),
    // not a cryptographic one. Set on create/load; toggled via setCollaborative().
    collaborative: false,
    _lastUsed: Date.now(),

    get drive() {
      return base.view;
    },
  };
}

function _joinSwarm(base) {
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  const discKeyStr = b4a.toString(base.discoveryKey, 'hex');
  // Use store-level replication — swarm connection handler in daemon.js already calls store.replicate(conn)
  // so just join the discovery key for the autobase
  swarm.join(base.discoveryKey);

  // Open the writer-request control channel on this base's peers (existing + future).
  const keyStr = b4a.toString(base.key, 'hex');
  _ensureControlSwarmListener();
  for (const conn of swarm.connections) _openControlChannel(conn, keyStr);

  logger.debug('Joined swarm for collaborative drive', { discoveryKey: discKeyStr });
}

// Start receiving writer-requests for a (now-collaborative) drive: open the control channel on
// existing connections. Future connections are handled by the swarm 'connection' listener, which
// re-checks sess.collaborative via _openControlChannel's guard.
function _enableWriterRequests(keyStr) {
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  _ensureControlSwarmListener();
  for (const conn of swarm.connections) _openControlChannel(conn, keyStr);
}

// The accepts-writers flag from a drive's index.json (default false = locked / single-writer).
async function _readCollaborativeFlag(sess) {
  const manifest = await readJson(sess, '/index.json');
  return !!(manifest && manifest.collaborative);
}

// Lock/unlock a drive for collaboration (persists `collaborative` into index.json). Unlocking
// starts accepting writer-requests immediately; the URL never changes (ADR-0010). Requires a
// writable session. Returns the new flag.
export async function setCollaborative(sess, collaborative) {
  collaborative = !!collaborative;
  sess.collaborative = collaborative;
  const manifest = (await readJson(sess, '/index.json')) || {};
  if (!!manifest.collaborative !== collaborative) {
    manifest.collaborative = collaborative;
    await putInline(sess, '/index.json', JSON.stringify(manifest, null, 2));
  }
  if (collaborative) _enableWriterRequests(sess.keyStr);
  logger.info('Set drive collaborative flag', { key: sess.keyStr, collaborative });
  return collaborative;
}

// Writer-request control channel
// =
// A lightweight Protomux channel layered onto the same swarm connections used for
// replication (the corestore replication mux — same pattern as peersockets). It carries
// out-of-band control messages that can't go through the autobase oplog because the
// requester isn't a writer yet. Today: 'writer-request'. Approval flows back through the
// oplog (addWriter) and replicates normally, so only the request direction needs this.

const CONTROL_PROTOCOL = 'nomad/autobase-control';

// bootstrapKey (hex) -> Map(peerId hex -> { channel, msg })
const controlChannels = {};
// bootstrapKey (hex) -> outgoing writer request to (re)send until we become a writer
const outgoingRequests = {};
let controlSwarmListenerInstalled = false;

function _ensureControlSwarmListener() {
  if (controlSwarmListenerInstalled) return;
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  controlSwarmListenerInstalled = true;
  swarm.on('connection', (conn) => {
    // Open a control channel for every collaborative drive we currently have loaded.
    for (const keyStr of Object.keys(sessions)) _openControlChannel(conn, keyStr);
  });
}

function _openControlChannel(conn, keyStr) {
  // A locked (non-collaborative) drive never opens the writer-request channel, so it neither
  // receives nor surfaces "request access" from peers. Gating here covers both call paths
  // (the per-drive join loop and the swarm 'connection' handler).
  if (!sessions[keyStr] || !sessions[keyStr].collaborative) return;
  const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null;
  if (!peerId) return;
  if (!controlChannels[keyStr]) controlChannels[keyStr] = new Map();
  if (controlChannels[keyStr].has(peerId)) return;

  let mux;
  try {
    mux = Protomux.from(conn);
  } catch {
    return;
  }

  const channel = mux.createChannel({
    protocol: CONTROL_PROTOCOL,
    id: b4a.from(keyStr, 'hex'),
    messages: [
      {
        encoding: c.buffer,
        onmessage(data) {
          let msg;
          try {
            msg = JSON.parse(b4a.toString(data));
          } catch {
            return;
          }
          if (msg && msg.type === 'writer-request' && msg.writerKey) {
            addPendingRequest(keyStr, {
              writerKey: msg.writerKey,
              profileUrl: msg.profileUrl || null,
            });
            logger.info('Received writer request over network', {
              key: keyStr,
              writerKey: msg.writerKey,
            });
            events.emit('request', {
              key: keyStr,
              writerKey: msg.writerKey,
              profileUrl: msg.profileUrl || null,
            });
          }
        },
      },
    ],
    onopen() {
      _sendOutgoingTo(keyStr, peerId);
    },
    onclose() {
      const peers = controlChannels[keyStr];
      if (peers) peers.delete(peerId);
    },
  });
  if (!channel) return; // a channel for this {protocol,id} already exists on the mux

  controlChannels[keyStr].set(peerId, { channel, msg: channel.messages[0] });
  channel.open();
}

function _sendOutgoingTo(keyStr, peerId) {
  // Stop pestering peers once we're an actual writer (the approval already replicated).
  const sess = sessions[keyStr];
  if (sess?.base?.writable) {
    delete outgoingRequests[keyStr];
    return;
  }

  const req = outgoingRequests[keyStr];
  const entry = controlChannels[keyStr]?.get(peerId);
  if (!req || !entry?.msg) return;
  try {
    entry.msg.send(
      b4a.from(
        JSON.stringify({
          type: 'writer-request',
          writerKey: req.writerKey,
          profileUrl: req.profileUrl || null,
        })
      )
    );
  } catch {}
}
