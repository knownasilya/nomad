// @ts-nocheck
// beaker.fs — a unified filesystem API over BOTH drive backends (ADR-0010 Phase 2).
//
// This is a FACADE: it detects whether a hyper:// URL resolves to a single-writer Hyperdrive or
// a multi-writer Autobase collaborative drive, and delegates to the matching implementation
// (bg/hyperdrive.js or bg/autobase.js). Userland finally gets ONE backend-agnostic file API —
// the thing that used to break (a helper that assumed one backend) now just works.
//
// Delegations use `.call(this, ...)` so the sender/permission context is preserved. Reads use a
// try-both fallback for drives whose backend can't be detected locally (a remote drive never
// loaded) — the exact "try Hyperdrive, fall back to Autobase" dance this API exists to remove
// from userland (reader/explorer/editor/webterm).
//
// Collapsing to Autobase-only (deleting the dispatch entirely) is ADR-0010 Phase 3.

import hyperdriveAPI from './hyperdrive'
import autobaseAPI from './autobase'
import * as filesystem from '../../filesystem/index'
import * as drives from '../../hyper/drives'
import { parseDriveUrl } from '../../../lib/urls'

const HEX_KEY = /^[0-9a-f]{64}$/i

function _keyFromUrl(url) {
  try { return parseDriveUrl(url).hostname } catch { return url }
}

// Resolve a hyper:// URL's hostname to its canonical hex-key URL BEFORE we detect/dispatch. This is
// load-bearing for `hyper://private/`: after the Vault migration the root/space drives are
// Autobases, but detection on the literal host 'private' matches no autobase and mis-routes the read
// to the Hyperdrive backend, which then hangs opening the autobase key as a Hyperdrive (~60s timeout
// — the blog boot() + explorer "reading directory / Timed out" symptom). Resolving the alias to the
// real key lets both detection AND the backend impl operate on the loaded collaborative session.
// Mirrors the per-space `private` resolution in the protocol handler (bg/protocols/hyper.js).
async function _resolveKey(ctx, url) {
  if (_keyFromUrl(url) === 'private' && ctx?.sender?.id) {
    const spaceId = filesystem.getSpaceIdForWebContents(ctx.sender.id)
    const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null
    if (spaceUrl) return drives.fromURLToKey(spaceUrl, true)
  }
  return drives.fromURLToKey(url, true)
}
async function _canonical(ctx, url) {
  try {
    const key = await _resolveKey(ctx, url)
    if (key && HEX_KEY.test(key)) {
      const urlp = parseDriveUrl(url)
      const version = urlp.version ? `+${urlp.version}` : ''
      return `hyper://${key}${version}${urlp.pathname || '/'}${urlp.search || ''}`
    }
  } catch {}
  return url
}

// Detection is reliable for locally-known/loaded drives (registry, loaded session, or persisted
// meta). isCollaborativeDrive needs no sender context, so a plain call is safe. Callers pass an
// already-canonicalised (hex-key) URL so the `private`/named aliases resolve correctly.
async function _isAutobase(url) {
  try { return await autobaseAPI.isCollaborativeDrive(url) } catch { return false }
}
// Canonicalise + pick the backend in one step. Returns the resolved URL alongside the api so the
// backend impl sees the real key too.
async function _dispatch(ctx, url) {
  const u = await _canonical(ctx, url)
  const isAutobase = await _isAutobase(u)
  return { api: isAutobase ? autobaseAPI : hyperdriveAPI, url: u, isAutobase }
}
function _other(api) {
  return api === autobaseAPI ? hyperdriveAPI : autobaseAPI
}

// True when the drive's backend is known locally, so a "not here" result is AUTHORITATIVE and we
// must NOT retry under the other backend. Opening a Hyperdrive key as an Autobase (or vice-versa)
// blocks for minutes on ready()/update. A genuinely-unknown remote drive (never registered, no
// session) still gets the try-both fallback. `url` here is already canonical (hex key).
function _backendKnown(url, isAutobase) {
  if (isAutobase) return true // known Autobase: session, registry, or persisted meta
  try {
    if (filesystem.isRootUrl(url)) return true // a root/space drive is always local — miss is real
    if (filesystem.getDriveConfig(_keyFromUrl(url))) return true // locally-registered → type known
  } catch {}
  return false
}

// Read with a single fallback to the other backend when the detected one returns nothing (covers
// remote drives whose type isn't known locally yet). Treats null / empty-array as "not here".
// The fallback is SKIPPED for drives whose backend is known (see _backendKnown) — otherwise a
// missing file would trigger a multi-minute hang opening the drive under the wrong backend.
async function _read(ctx, method, url, rest) {
  const { api: primary, url: u, isAutobase } = await _dispatch(ctx, url)
  const other = _other(primary)
  const known = _backendKnown(u, isAutobase)
  const empty = (r) => r == null || (Array.isArray(r) && r.length === 0)
  try {
    const res = await primary[method].call(ctx, u, ...rest)
    if (known || !empty(res)) return res
    try { const alt = await other[method].call(ctx, u, ...rest); if (!empty(alt)) return alt } catch {}
    return res
  } catch (e) {
    if (known) throw e
    try { return await other[method].call(ctx, u, ...rest) } catch {}
    throw e
  }
}

const fsAPI = {
  async getInfo(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.getInfo.call(this, u, opts) },

  // --- Read ---
  async entry(url, opts = {}) { return _read(this, 'entry', url, [opts]) },
  async stat(url, opts = {}) { return _read(this, 'stat', url, [opts]) },
  async get(url, opts = {}) { return _read(this, 'get', url, [opts]) },
  async readFile(url, opts = {}) { return _read(this, 'readFile', url, [opts]) },
  async list(url, opts = {}) { return _read(this, 'list', url, [opts]) },
  async readdir(url, opts = {}) { return _read(this, 'readdir', url, [opts]) },
  async diff(url, other, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.diff.call(this, u, other, opts) },

  // Uniform, backend-agnostic listing under a drive/prefix (the ADR goal: a query() that spans
  // Autobase too, not just Hyperdrive). Returns the backend's entry list; pass a path in the URL
  // to scope it. For richer per-entry stats use readdir({ includeStats: true }).
  async query(url, opts = {}) { return _read(this, 'list', url, [opts]) },

  // --- Write (require a writable drive; no fallback — the backend is known) ---
  async put(url, data, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.put.call(this, u, data, opts) },
  async writeFile(url, data, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.writeFile.call(this, u, data, opts) },
  async del(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.del.call(this, u, opts) },
  async unlink(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.unlink.call(this, u, opts) },
  async mkdir(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.mkdir.call(this, u, opts) },
  async rmdir(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.rmdir.call(this, u, opts) },
  async updateMetadata(url, metadata, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.updateMetadata.call(this, u, metadata, opts) },
  async deleteMetadata(url, keys, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.deleteMetadata.call(this, u, keys, opts) },
  async mount(url, key, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.mount.call(this, u, key, opts) },
  async unmount(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.unmount.call(this, u, opts) },
  async symlink(url, target, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.symlink.call(this, u, target, opts) },

  // Bulk filesystem import/export. (Delegates to the Hyperdrive impl; Autobase-target import is a
  // known gap tracked for the backend-unification pass.)
  async importFromFilesystem(opts) { return hyperdriveAPI.importFromFilesystem.call(this, opts) },
  async exportToFilesystem(opts) { return hyperdriveAPI.exportToFilesystem.call(this, opts) },
  async exportToDrive(opts) { return hyperdriveAPI.exportToDrive.call(this, opts) },

  // copy/rename are implemented backend-agnostically (read + write) so they work within and
  // ACROSS backends and don't depend on each backend's differing copy() signature.
  async copy(srcUrl, dstUrl, opts = {}) {
    const buf = await fsAPI.get.call(this, srcUrl, { encoding: 'binary' })
    if (buf == null) throw new Error('Source not found: ' + srcUrl)
    return fsAPI.put.call(this, dstUrl, buf, { encoding: 'binary' })
  },
  async rename(srcUrl, dstUrl, opts = {}) {
    await fsAPI.copy.call(this, srcUrl, dstUrl, opts)
    return fsAPI.del.call(this, srcUrl, opts)
  },

  // --- Change notifications ('readable' — return the backend's emitter) ---
  async watch(url, pathPattern) { const { api, url: u } = await _dispatch(this, url); return api.watch.call(this, u, pathPattern) },

  // --- Drive lifecycle ---
  // New drives are Autobase-from-birth (ADR-0010): a drive can gain writers without changing URL.
  async createDrive(opts = {}) { return autobaseAPI.createCollaborativeDrive.call(this, opts) },
  async createCollaborativeDrive(opts = {}) { return autobaseAPI.createCollaborativeDrive.call(this, opts) },
  async forkDrive(url, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.forkDrive.call(this, u, opts) },
  async loadDrive(url) { return autobaseAPI.loadDrive.call(this, url) },
  async configure(url, settings, opts = {}) { const { api, url: u } = await _dispatch(this, url); return api.configure.call(this, u, settings, opts) },
  async isCollaborativeDrive(url) { return autobaseAPI.isCollaborativeDrive.call(this, url) },

  // query accepts either a url-first form fs.query(url, opts) or the legacy hyperdrive object
  // form fs.query({ drive, path, ... }) so migrated call sites keep working.
  async query(urlOrOpts, opts = {}) {
    if (urlOrOpts && typeof urlOrOpts === 'object') return hyperdriveAPI.query.call(this, urlOrOpts)
    return _read(this, 'list', urlOrOpts, [opts])
  },

  // --- Collaborative-drive writer management (Autobase only) ---
  async createInvite(url, opts = {}) { return autobaseAPI.createInvite.call(this, url, opts) },
  async claimInvite(inviteUrl, opts = {}) { return autobaseAPI.claimInvite.call(this, inviteUrl, opts) },
  async requestAccess(url, opts = {}) { return autobaseAPI.requestAccess.call(this, url, opts) },
  async listRequests(url) { return autobaseAPI.listRequests.call(this, url) },
  async watchRequests(url) { return autobaseAPI.watchRequests.call(this, url) },
  async approveRequest(url, writerKey, opts = {}) { return autobaseAPI.approveRequest.call(this, url, writerKey, opts) },
  async denyRequest(url, writerKey) { return autobaseAPI.denyRequest.call(this, url, writerKey) },
  async removeWriter(url, writerKey) { return autobaseAPI.removeWriter.call(this, url, writerKey) },
  async listWriters(url) { return autobaseAPI.listWriters.call(this, url) },
}

export default fsAPI
