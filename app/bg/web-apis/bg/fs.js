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
import { createFsRouter } from './fs-router'

// The backend-routing decisions (alias canonicalisation, autobase-vs-hyperdrive detection, the
// no-wrong-backend-fallback gate) live in a pure, testable module. Here we just wire in the real
// Electron-coupled collaborators. See fs-router.js + tests/unit/fs-router.test.js.
const router = createFsRouter({
  hyperdriveAPI,
  autobaseAPI,
  isCollaborativeDrive: (url) => autobaseAPI.isCollaborativeDrive(url),
  isRootUrl: filesystem.isRootUrl,
  getDriveConfig: filesystem.getDriveConfig,
  fromURLToKey: drives.fromURLToKey,
  // Per-space `private` resolution, mirroring the protocol handler (bg/protocols/hyper.js).
  spaceRootKeyForSender: async (ctx) => {
    if (!ctx?.sender?.id) return null
    const spaceId = filesystem.getSpaceIdForWebContents(ctx.sender.id)
    const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null
    return spaceUrl ? drives.fromURLToKey(spaceUrl, true) : null
  },
  parseDriveUrl,
})
const _dispatch = (ctx, url) => router.dispatch(ctx, url)
const _read = (ctx, method, url, rest) => router.read(ctx, method, url, rest)

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
