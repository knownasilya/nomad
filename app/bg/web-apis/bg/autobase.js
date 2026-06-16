// @ts-nocheck
import { parseDriveUrl } from '../../../lib/urls'
import b4a from 'b4a'
import * as autobases from '../../hyper/autobases'
import * as archivesDb from '../../dbs/archives'
import * as auditLog from '../../dbs/audit-log'
import * as filesystem from '../../filesystem/index'
import * as spacesDb from '../../dbs/spaces'
import { timer } from '../../../lib/time'
import {
  HYPERDRIVE_HASH_REGEX,
  DEFAULT_DRIVE_API_TIMEOUT,
  DRIVE_VALID_PATH_REGEX,
} from '../../../lib/const'
import {
  PermissionsError,
  ArchiveNotWritableError,
  InvalidURLError,
  InvalidPathError,
} from 'beaker-error-constants'

const to = (opts) =>
  opts && typeof opts.timeout !== 'undefined' ? opts.timeout : DEFAULT_DRIVE_API_TIMEOUT

// exported api
// =

const autobaseAPI = {
  // Drive lifecycle
  // =

  async createCollaborativeDrive({ title, description, type } = {}) {
    const meta = {}
    if (title) meta.title = title
    if (description) meta.description = description
    if (type) meta.type = type
    const sess = await autobases.createCollaborativeDrive(meta)
    // Use configAutobaseDrive instead of configDriveForSpace — the latter calls
    // getOrLoadDrive() which tries to open the URL as a Hyperdrive and hangs.
    await filesystem.configAutobaseDrive(sess.url, { tags: ['collaborative'] })
    // Store title in archivesDb so the library sidebar shows the correct name.
    const key = _keyFromUrl(sess.url)
    await archivesDb.setMeta(key, { title: meta.title || '', type: 'autobase', writable: true })
    return sess.url
  },

  async isCollaborativeDrive(url) {
    const key = _keyFromUrl(url)
    const cfg = filesystem.getDriveConfig(key)
    return !!(cfg && cfg.type === 'autobase')
  },

  async loadDrive(url) {
    if (!url || typeof url !== 'string') throw new InvalidURLError()
    const key = _keyFromUrl(url)
    await autobases.getOrLoadCollaborativeDrive(key)
    return true
  },

  async getInfo(url, opts = {}) {
    return timer(to(opts), async () => {
      const sess = await _lookup(url)
      const manifest = await _readIndexJson(sess)
      return {
        key: b4a.toString(sess.key, 'hex'),
        url: sess.url,
        writable: sess.writable,
        title: manifest.title || '',
        description: manifest.description || '',
        type: manifest.type || '',
        isCollaborative: true,
      }
    })
  },

  // Read methods (delegate to linearized Hyperbee view)
  // =

  async entry(url, opts = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      const node = await sess.drive.get(filepath)
      if (!node) return null
      return { key: node.key, value: { blob: { byteLength: node.value ? node.value.byteLength : 0 }, metadata: {} } }
    })
  },

  async get(url, opts = {}) {
    if (typeof opts === 'string') opts = { encoding: opts }
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      const node = await sess.drive.get(filepath)
      if (!node) return null
      const buf = node.value
      if (opts.encoding === 'binary') return buf
      if (opts.encoding === 'base64') return b4a.toString(buf, 'base64')
      if (opts.encoding === 'hex') return b4a.toString(buf, 'hex')
      return b4a.toString(buf)
    })
  },

  async list(url, opts = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      const prefix = _listPrefix(filepath)
      const results = []
      for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
        results.push({ key: node.key, value: {} })
      }
      return results
    })
  },

  async diff(url, other, opts = {}) {
    // Hyperbee diff is version-based; simplified to empty for now
    return []
  },

  async watch(url, pathPattern) {
    const { EventEmitter } = await import('events')
    const emitter = new EventEmitter()
    try {
      const { sess } = await _lookupWithPath(url)
      if (typeof sess.drive.watch === 'function') {
        const prefix = _listPrefix(pathPattern || '/')
        ;(async () => {
          for await (const _ of sess.drive.watch({ gte: prefix, lt: prefix + '\xff' })) {
            emitter.emit('changed', {})
          }
        })().catch(() => {})
      }
    } catch {}
    return emitter
  },

  // Write methods (go through autobase.append for linearization)
  // =

  async put(url, data, opts = {}) {
    if (typeof opts === 'string') opts = { encoding: opts }
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      assertWritable(sess)
      assertValidFilePath(filepath)

      const buf = _toBuffer(data, opts)
      await sess.base.append({
        op: 'put',
        path: filepath,
        data: b4a.toString(buf, 'base64'),
        encoding: 'base64',
      })
      await sess.base.update()
    })
  },

  async del(url, opts = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      assertWritable(sess)
      await sess.base.append({ op: 'del', path: filepath })
      await sess.base.update()
    })
  },

  async mkdir(url, opts = {}) {
    // directories are implicit in Hyperbee — no operation needed
    return timer(to(opts), async () => {
      const { sess } = await _lookupWithPath(url)
      assertWritable(sess)
    })
  },

  async rmdir(url, opts = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url)
      assertWritable(sess)
      const prefix = _listPrefix(filepath)
      const paths = []
      for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
        paths.push(node.key)
      }
      for (const p of paths) {
        await sess.base.append({ op: 'del', path: p })
      }
      await sess.base.update()
    })
  },

  async updateMetadata(url, metadata, opts = {}) {
    // Hyperbee-backed view does not store file metadata; no-op
    return timer(to(opts), async () => {
      const { sess } = await _lookupWithPath(url)
      assertWritable(sess)
    })
  },

  async configure(url, settings, opts = {}) {
    return timer(to(opts), async () => {
      const sess = await _lookup(url)
      assertWritable(sess)
      const existing = await _readIndexJson(sess)
      const allowed = ['title', 'description', 'type', 'thumb', 'links']
      const updates = {}
      for (const k of allowed) {
        if (k in settings) updates[k] = settings[k]
      }
      const updated = Object.assign({}, existing, updates)
      const buf = b4a.from(JSON.stringify(updated, null, 2))
      await sess.base.append({
        op: 'put',
        path: '/index.json',
        data: b4a.toString(buf, 'base64'),
        encoding: 'base64'
      })
      await sess.base.update()
    })
  },

  // v10 compat shims
  async readFile(url, opts) {
    if (typeof opts === 'string') opts = { encoding: opts }
    return autobaseAPI.get.call(this, url, opts || {})
  },
  async writeFile(url, data, opts) {
    if (typeof opts === 'string') opts = { encoding: opts }
    return autobaseAPI.put.call(this, url, data, opts || {})
  },
  async stat(url, opts) {
    const e = await autobaseAPI.entry.call(this, url, opts || {})
    if (e) {
      const isFile = true
      const size = e.value?.blob?.byteLength || 0
      return { mode: 32768, size, offset: 0, blocks: 0, downloaded: 0, mtime: 0, ctime: 0, metadata: {} }
    }
    const children = await autobaseAPI.list.call(this, url, { recursive: false })
    if (children.length > 0) {
      return { mode: 16384, size: 0, offset: 0, blocks: 0, downloaded: 0, mtime: 0, ctime: 0, metadata: {} }
    }
    return null
  },
  async readdir(url, opts = {}) {
    const { filepath } = await _lookupWithPath(url)
    const entries = await autobaseAPI.list.call(this, url, {})
    const normalizedPath = filepath === '/' ? '' : filepath.replace(/\/$/, '')
    // Build a map of shallow child name → isDirectory
    const childMap = new Map()
    for (const e of entries) {
      const suffix = e.key.slice(normalizedPath.length + 1)
      const slashIdx = suffix.indexOf('/')
      if (slashIdx === -1) {
        if (!childMap.has(suffix)) childMap.set(suffix, false)
      } else {
        const dirName = suffix.slice(0, slashIdx)
        childMap.set(dirName, true)
      }
    }
    if (opts.includeStats) {
      return Array.from(childMap.entries()).map(([name, isDir]) => ({
        name,
        stat: { mode: isDir ? 16384 : 32768, size: 0, offset: 0, blocks: 0, downloaded: 0, mtime: 0, ctime: 0, metadata: {} },
      }))
    }
    return Array.from(childMap.keys())
  },
  async unlink(url, opts) { return autobaseAPI.del.call(this, url, opts || {}) },
  async symlink() {},
  async mount() {},
  async unmount() {},

  // Writer management
  // =

  async createInvite(url, { multiUse = false } = {}) {
    const sess = await _lookup(url)
    assertOwner(sess)
    const token = autobases.createInvite(sess.keyStr, { multiUse })
    return `${sess.url}?invite=${token}`
  },

  async claimInvite(inviteUrl, { profileUrl } = {}) {
    const urlp = new URL(inviteUrl)
    const token = urlp.searchParams.get('invite')
    if (!token) throw new Error('Invalid invite URL: missing invite token')

    const key = urlp.hostname
    const sess = await autobases.getOrLoadCollaborativeDrive(key)
    if (!sess) throw new Error('Could not connect to collaborative drive')

    const invite = autobases.getInvite(token)
    if (!invite) throw new Error('Invite token not found or already used')

    const writerKey = b4a.toString(sess.base.local.key, 'hex')
    autobases.addPendingRequest(key, { writerKey, profileUrl })
    autobases.consumeInvite(token)
    return { writerKey }
  },

  async requestAccess(url, { profileUrl } = {}) {
    const key = _keyFromUrl(url)
    const sess = await autobases.getOrLoadCollaborativeDrive(key)
    if (!sess) throw new Error('Could not connect to collaborative drive')
    const writerKey = b4a.toString(sess.base.local.key, 'hex')
    autobases.addPendingRequest(key, { writerKey, profileUrl })
    return { writerKey }
  },

  async listRequests(url) {
    const key = _keyFromUrl(url)
    return autobases.listPendingRequests(key)
  },

  async approveRequest(url, writerKey, { profileUrl } = {}) {
    const sess = await _lookup(url)
    assertOwner(sess)
    if (!profileUrl) {
      const req = autobases.listPendingRequests(sess.keyStr).find(r => r.writerKey === writerKey)
      profileUrl = req?.profileUrl || null
    }
    await sess.base.append({ addWriter: writerKey, profileUrl })
    await sess.base.update()
    autobases.removePendingRequest(sess.keyStr, writerKey)
  },

  async denyRequest(url, writerKey) {
    const sess = await _lookup(url)
    assertOwner(sess)
    autobases.removePendingRequest(sess.keyStr, writerKey)
  },

  async removeWriter(url, writerKey) {
    const sess = await _lookup(url)
    assertOwner(sess)
    await sess.base.append({ removeWriter: writerKey })
    await sess.base.update()
  },

  async listWriters(url) {
    const sess = await _lookup(url)
    await sess.base.update()
    const results = []
    const prefix = '/.data/walled.garden/writers/'
    for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
      try {
        results.push(JSON.parse(b4a.toString(node.value)))
      } catch {}
    }
    return results
  },
}

export default autobaseAPI

// internal helpers
// =

async function _lookup(url) {
  const key = _keyFromUrl(url)
  const sess = await autobases.getOrLoadCollaborativeDrive(key)
  if (!sess) throw new InvalidURLError('Could not load collaborative drive')
  sess._lastUsed = Date.now()
  return sess
}

async function _lookupWithPath(url) {
  const urlp = parseDriveUrl(url)
  const filepath = _normalizeFilepath(urlp.pathname || '/')
  const sess = await _lookup(url)
  return { sess, filepath }
}

function _keyFromUrl(url) {
  if (HYPERDRIVE_HASH_REGEX.test(url)) return url
  const urlp = parseDriveUrl(url)
  return urlp.hostname
}

function _normalizeFilepath(str) {
  str = decodeURIComponent(str)
  if (!str.startsWith('/')) str = '/' + str
  return str
}

function _listPrefix(filepath) {
  if (filepath === '/') return '/'
  return filepath.endsWith('/') ? filepath : filepath + '/'
}

function assertWritable(sess) {
  if (!sess.writable) throw new ArchiveNotWritableError('Not a writer for this collaborative drive')
}

function assertOwner(sess) {
  if (!sess.writable) throw new PermissionsError('Only a writer can manage this collaborative drive')
}

function _toBuffer(data, opts = {}) {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === 'string') {
    if (opts.encoding === 'base64') return Buffer.from(data, 'base64')
    if (opts.encoding === 'hex') return Buffer.from(data, 'hex')
    if (opts.encoding === 'binary') return Buffer.from(data, 'binary')
    return Buffer.from(data, 'utf8')
  }
  if (typeof data === 'object') return Buffer.from(JSON.stringify(data), 'utf8')
  return Buffer.from(String(data), 'utf8')
}

function assertValidFilePath(filepath) {
  if (filepath.slice(-1) === '/') throw new InvalidPathError('Files cannot have a trailing slash')
  if (!DRIVE_VALID_PATH_REGEX.test(filepath)) throw new InvalidPathError('Path contains invalid characters')
}

async function _readIndexJson(sess) {
  const node = await sess.drive.get('/index.json')
  if (!node) return {}
  try {
    return JSON.parse(b4a.toString(node.value))
  } catch {
    return {}
  }
}
