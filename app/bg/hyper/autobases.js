// @ts-nocheck
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import b4a from 'b4a'
import { randomBytes } from 'crypto'
import * as logLib from '../logger'
import * as daemon from './daemon'
import * as archivesDb from '../dbs/archives'

const baseLogger = logLib.get()
const logger = baseLogger.child({ category: 'hyper', subcategory: 'autobases' })

// bootstrapKey (hex) → AutobaseSession
var sessions = {}

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

export async function loadCollaborativeDrive(key) {
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex')
  if (sessions[keyStr]) {
    sessions[keyStr]._lastUsed = Date.now()
    return sessions[keyStr]
  }

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
  // joins during setup for the same reason. Without this, base.update() runs with no peers
  // and waits for data that can never arrive, so the page spins forever. Bound the update so
  // a drive with no reachable peers fails fast and can be retried with a reload.
  _joinSwarm(base)
  await Promise.race([
    base.update(),
    new Promise((resolve) => setTimeout(resolve, 7000)),
  ])

  const writable = base.writable
  const sess = _makeSession(keyStr, base, writable)
  sessions[keyStr] = sess

  logger.info('Loaded collaborative drive', { key: keyStr, writable })
  return sess
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
  logger.debug('Joined swarm for collaborative drive', { discoveryKey: discKeyStr })
}
