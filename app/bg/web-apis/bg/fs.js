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

// Detection is reliable for locally-known/loaded drives (registry, loaded session, or persisted
// meta). isCollaborativeDrive needs no sender context, so a plain call is safe.
async function _isAutobase(url) {
  try { return await autobaseAPI.isCollaborativeDrive(url) } catch { return false }
}
async function _pick(url) {
  return (await _isAutobase(url)) ? autobaseAPI : hyperdriveAPI
}
function _other(api) {
  return api === autobaseAPI ? hyperdriveAPI : autobaseAPI
}

// Read with a single fallback to the other backend when the detected one returns nothing (covers
// remote drives whose type isn't known locally yet). Treats null / empty-array as "not here".
async function _read(ctx, method, url, rest) {
  const primary = await _pick(url)
  const other = _other(primary)
  const empty = (r) => r == null || (Array.isArray(r) && r.length === 0)
  try {
    const res = await primary[method].call(ctx, url, ...rest)
    if (!empty(res)) return res
    try { const alt = await other[method].call(ctx, url, ...rest); if (!empty(alt)) return alt } catch {}
    return res
  } catch (e) {
    try { return await other[method].call(ctx, url, ...rest) } catch {}
    throw e
  }
}

const fsAPI = {
  async getInfo(url, opts = {}) { return (await _pick(url)).getInfo.call(this, url, opts) },

  // --- Read ---
  async entry(url, opts = {}) { return _read(this, 'entry', url, [opts]) },
  async stat(url, opts = {}) { return _read(this, 'stat', url, [opts]) },
  async get(url, opts = {}) { return _read(this, 'get', url, [opts]) },
  async readFile(url, opts = {}) { return _read(this, 'readFile', url, [opts]) },
  async list(url, opts = {}) { return _read(this, 'list', url, [opts]) },
  async readdir(url, opts = {}) { return _read(this, 'readdir', url, [opts]) },
  async diff(url, other, opts = {}) { return (await _pick(url)).diff.call(this, url, other, opts) },

  // Uniform, backend-agnostic listing under a drive/prefix (the ADR goal: a query() that spans
  // Autobase too, not just Hyperdrive). Returns the backend's entry list; pass a path in the URL
  // to scope it. For richer per-entry stats use readdir({ includeStats: true }).
  async query(url, opts = {}) { return _read(this, 'list', url, [opts]) },

  // --- Write (require a writable drive; no fallback — the backend is known) ---
  async put(url, data, opts = {}) { return (await _pick(url)).put.call(this, url, data, opts) },
  async writeFile(url, data, opts = {}) { return (await _pick(url)).writeFile.call(this, url, data, opts) },
  async del(url, opts = {}) { return (await _pick(url)).del.call(this, url, opts) },
  async unlink(url, opts = {}) { return (await _pick(url)).unlink.call(this, url, opts) },
  async mkdir(url, opts = {}) { return (await _pick(url)).mkdir.call(this, url, opts) },
  async rmdir(url, opts = {}) { return (await _pick(url)).rmdir.call(this, url, opts) },
  async updateMetadata(url, metadata, opts = {}) { return (await _pick(url)).updateMetadata.call(this, url, metadata, opts) },
  async deleteMetadata(url, keys, opts = {}) { return (await _pick(url)).deleteMetadata.call(this, url, keys, opts) },
  async mount(url, key, opts = {}) { return (await _pick(url)).mount.call(this, url, key, opts) },
  async unmount(url, opts = {}) { return (await _pick(url)).unmount.call(this, url, opts) },
  async symlink(url, target, opts = {}) { return (await _pick(url)).symlink.call(this, url, target, opts) },

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
  async watch(url, pathPattern) { return (await _pick(url)).watch.call(this, url, pathPattern) },

  // --- Drive lifecycle ---
  // New drives are Autobase-from-birth (ADR-0010): a drive can gain writers without changing URL.
  async createDrive(opts = {}) { return autobaseAPI.createCollaborativeDrive.call(this, opts) },
  async createCollaborativeDrive(opts = {}) { return autobaseAPI.createCollaborativeDrive.call(this, opts) },
  async forkDrive(url, opts = {}) { return (await _pick(url)).forkDrive.call(this, url, opts) },
  async loadDrive(url) { return autobaseAPI.loadDrive.call(this, url) },
  async configure(url, settings, opts = {}) { return (await _pick(url)).configure.call(this, url, settings, opts) },
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
