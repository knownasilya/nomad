// @ts-nocheck
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import { randomBytes } from 'crypto'
import * as logLib from '../logger'
import * as daemon from './daemon'
import * as archivesDb from '../dbs/archives'

const baseLogger = logLib.get()
const logger = baseLogger.child({ category: 'hyper', subcategory: 'autobases' })

// bootstrapKey (hex) → AutobaseSession
var sessions = {}

// bootstrapKey (hex) → in-flight load Promise (dedupes concurrent loads of the same
// drive — e.g. the document request plus its subresources — so we never open two
// Autobase instances on the same key and deadlock on the shared 'local' core).
var loadPromises = {}

// pending writer requests: bootstrapKey → [{ writerKey, profileUrl, requestedAt, token }]
var pendingRequests = {}

// pending invites: token → { bootstrapKey, multiUse, expiresAt }
var pendingInvites = {}

export async function createCollaborativeDrive(meta = {}) {
  const store = daemon.getCorestore()
  // Autobase.boot() uses store.get({ name: 'local' }) to create the writer core.
  // Without a unique namespace, concurrent creates conflict on the 'local' named
  // core (exclusive lock) and hang. Each drive gets its own namespace; loading
  // still works because Corestore finds private keys by public key across namespaces.
  const namespacedStore = store.namespace(randomBytes(32))
  const base = new Autobase(namespacedStore, null, {
    apply: _applyFn,
    open: _openFn,
    valueEncoding: 'json',
    ackInterval: 1000
  })
  await base.ready()

  const keyStr = b4a.toString(base.key, 'hex')
  const sess = _makeSession(keyStr, base, true)
  sessions[keyStr] = sess

  // Write index.json if metadata supplied
  if (meta && Object.keys(meta).length > 0) {
    await base.append({ op: 'put', path: '/index.json', data: JSON.stringify(meta, null, 2) })
    await base.update()
  }

  _joinSwarm(base)
  logger.info('Created collaborative drive', { key: keyStr })
  return sess
}

// How long to wait for a remote base's bootstrap to replicate before serving.
const LOAD_REPLICATION_TIMEOUT = 15000

export async function loadCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex')
  if (sessions[keyStr]) {
    sessions[keyStr]._lastUsed = Date.now()
    return sessions[keyStr]
  }
  if (loadPromises[keyStr]) return loadPromises[keyStr]

  const p = _loadCollaborativeDriveInner(keyStr)
  loadPromises[keyStr] = p
  const clear = () => { delete loadPromises[keyStr] }
  p.then(clear, clear)
  return p
}

async function _loadCollaborativeDriveInner(keyStr) {
  const store = daemon.getCorestore()
  const keyBuf = b4a.from(keyStr, 'hex')
  const base = new Autobase(store, keyBuf, {
    apply: _applyFn,
    open: _openFn,
    valueEncoding: 'json',
    ackInterval: 1000
  })
  await base.ready()

  // Join the swarm BEFORE updating. A remote collaborative drive must replicate its
  // bootstrap from peers, so a connection has to be in place first — createHyperdriveSession
  // joins during setup for the same reason.
  _joinSwarm(base)

  const sess = _makeSession(keyStr, base, base.writable)
  sessions[keyStr] = sess

  // base.update() returns immediately with an EMPTY view if no peer has delivered the
  // bootstrap yet — and a peer typically connects a beat after we join. So poll update()
  // until the view has content or the deadline passes (mirrors the hyperdrive warm-up).
  // A reachable drive serves as soon as it syncs; an unreachable one fails fast and stays
  // reloadable instead of hanging or returning a premature "not found".
  const deadline = Date.now() + LOAD_REPLICATION_TIMEOUT
  await base.update()
  while (_viewEmpty(base) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await base.update()
  }

  sess.writable = base.writable
  logger.info('Loaded collaborative drive', {
    key: keyStr,
    writable: base.writable,
    synced: !_viewEmpty(base)
  })
  return sess
}

// True until the linearised view has at least one block (i.e. some content replicated).
// Hyperbee.version is Math.max(1, length) so it can't be used here — read the core length.
function _viewEmpty(base) {
  try {
    return !base.view || !base.view.core || base.view.core.length === 0
  } catch {
    return true
  }
}

export function getCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex')
  return sessions[keyStr]
}

export async function getOrLoadCollaborativeDrive(key) {
  const sess = getCollaborativeDrive(key)
  if (sess) return sess
  return loadCollaborativeDrive(key)
}

export function unloadCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex')
  if (!sessions[keyStr]) return
  sessions[keyStr].base.close().catch(() => {})
  delete sessions[keyStr]
  logger.debug('Unloaded collaborative drive', { key: keyStr })
}

// Invite management
// =

export function createInvite(bootstrapKey, { multiUse = false } = {}) {
  const token = randomBytes(16).toString('hex')
  pendingInvites[token] = { bootstrapKey, multiUse, createdAt: Date.now() }
  return token
}

export function getInvite(token) {
  return pendingInvites[token] || null
}

export function consumeInvite(token) {
  const invite = pendingInvites[token]
  if (!invite) return null
  if (!invite.multiUse) delete pendingInvites[token]
  return invite
}

// Request management
// =

export function addPendingRequest(bootstrapKey, { writerKey, profileUrl }) {
  if (!pendingRequests[bootstrapKey]) pendingRequests[bootstrapKey] = []
  const existing = pendingRequests[bootstrapKey].find(r => r.writerKey === writerKey)
  if (existing) return
  pendingRequests[bootstrapKey].push({ writerKey, profileUrl, requestedAt: new Date().toISOString() })
  logger.debug('Pending writer request', { bootstrapKey, writerKey })
}

export function listPendingRequests(bootstrapKey) {
  return pendingRequests[bootstrapKey] || []
}

export function removePendingRequest(bootstrapKey, writerKey) {
  if (!pendingRequests[bootstrapKey]) return
  pendingRequests[bootstrapKey] = pendingRequests[bootstrapKey].filter(r => r.writerKey !== writerKey)
}

// Send a writer-access request to the drive's peers (owner + existing writers) over the
// swarm. pendingRequests is per-process, so without this the owner never learns a remote
// peer wants access. The request is remembered and re-sent to any peer that connects until
// we actually become a writer, so it survives a not-yet-connected owner.
export function requestWriterAccess(bootstrapKey, { writerKey, profileUrl }) {
  outgoingRequests[bootstrapKey] = { writerKey, profileUrl: profileUrl || null }
  const peers = controlChannels[bootstrapKey]
  if (peers) for (const peerId of peers.keys()) _sendOutgoingTo(bootstrapKey, peerId)
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
    _lastUsed: Date.now(),

    get drive() { return base.view }
  }
}

function _openFn(store) {
  // Use Hyperbee (not Hyperdrive) — AutoStore only supports named-core access
  // and Hyperdrive would request the blobs core by key (name: null), which throws.
  // For text-based collaborative drives the Hyperbee is sufficient.
  const core = store.get({ name: 'db' })
  return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
}

async function _applyFn(nodes, view, host) {
  for (const { value } of nodes) {
    if (!value) continue

    if (value.addWriter) {
      const keyBuf = b4a.from(value.addWriter, 'hex')
      await host.addWriter(keyBuf, { indexer: true })
      const writerRecord = JSON.stringify({ writerKey: value.addWriter, profileUrl: value.profileUrl || null })
      await view.put(`/.data/walled.garden/writers/${value.addWriter}.json`, b4a.from(writerRecord))
      continue
    }

    if (value.removeWriter) {
      try {
        await host.removeWriter(b4a.from(value.removeWriter, 'hex'))
        await view.del(`/.data/walled.garden/writers/${value.removeWriter}.json`)
      } catch {}
      continue
    }

    if (value.op === 'put') {
      const data = value.encoding === 'base64'
        ? b4a.from(value.data, 'base64')
        : b4a.from(value.data)
      await view.put(value.path, data)
    } else if (value.op === 'del') {
      await view.del(value.path)
    }
    // 'mkdir' is a no-op (keys are paths, directories are implicit)
    // 'updateMetadata' is a no-op (Hyperbee does not store file metadata)
  }
}

function _joinSwarm(base) {
  const swarm = daemon.getSwarm()
  if (!swarm) return
  const discKeyStr = b4a.toString(base.discoveryKey, 'hex')
  // Use store-level replication — swarm connection handler in daemon.js already calls store.replicate(conn)
  // so just join the discovery key for the autobase
  swarm.join(base.discoveryKey)

  // Open the writer-request control channel on this base's peers (existing + future).
  const keyStr = b4a.toString(base.key, 'hex')
  _ensureControlSwarmListener()
  for (const conn of swarm.connections) _openControlChannel(conn, keyStr)

  logger.debug('Joined swarm for collaborative drive', { discoveryKey: discKeyStr })
}

// Writer-request control channel
// =
// A lightweight Protomux channel layered onto the same swarm connections used for
// replication (the corestore replication mux — same pattern as peersockets). It carries
// out-of-band control messages that can't go through the autobase oplog because the
// requester isn't a writer yet. Today: 'writer-request'. Approval flows back through the
// oplog (addWriter) and replicates normally, so only the request direction needs this.

const CONTROL_PROTOCOL = 'nomad/autobase-control'

// bootstrapKey (hex) -> Map(peerId hex -> { channel, msg })
const controlChannels = {}
// bootstrapKey (hex) -> outgoing writer request to (re)send until we become a writer
const outgoingRequests = {}
let controlSwarmListenerInstalled = false

function _ensureControlSwarmListener() {
  if (controlSwarmListenerInstalled) return
  const swarm = daemon.getSwarm()
  if (!swarm) return
  controlSwarmListenerInstalled = true
  swarm.on('connection', (conn) => {
    // Open a control channel for every collaborative drive we currently have loaded.
    for (const keyStr of Object.keys(sessions)) _openControlChannel(conn, keyStr)
  })
}

function _openControlChannel(conn, keyStr) {
  const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null
  if (!peerId) return
  if (!controlChannels[keyStr]) controlChannels[keyStr] = new Map()
  if (controlChannels[keyStr].has(peerId)) return

  let mux
  try { mux = Protomux.from(conn) } catch { return }

  const channel = mux.createChannel({
    protocol: CONTROL_PROTOCOL,
    id: b4a.from(keyStr, 'hex'),
    messages: [
      {
        encoding: c.buffer,
        onmessage(data) {
          let msg
          try { msg = JSON.parse(b4a.toString(data)) } catch { return }
          if (msg && msg.type === 'writer-request' && msg.writerKey) {
            addPendingRequest(keyStr, { writerKey: msg.writerKey, profileUrl: msg.profileUrl || null })
            logger.info('Received writer request over network', { key: keyStr, writerKey: msg.writerKey })
          }
        },
      },
    ],
    onopen() {
      _sendOutgoingTo(keyStr, peerId)
    },
    onclose() {
      const peers = controlChannels[keyStr]
      if (peers) peers.delete(peerId)
    },
  })
  if (!channel) return // a channel for this {protocol,id} already exists on the mux

  controlChannels[keyStr].set(peerId, { channel, msg: channel.messages[0] })
  channel.open()
}

function _sendOutgoingTo(keyStr, peerId) {
  // Stop pestering peers once we're an actual writer (the approval already replicated).
  const sess = sessions[keyStr]
  if (sess?.base?.writable) { delete outgoingRequests[keyStr]; return }

  const req = outgoingRequests[keyStr]
  const entry = controlChannels[keyStr]?.get(peerId)
  if (!req || !entry?.msg) return
  try {
    entry.msg.send(b4a.from(JSON.stringify({
      type: 'writer-request',
      writerKey: req.writerKey,
      profileUrl: req.profileUrl || null,
    })))
  } catch {}
}
