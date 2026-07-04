// nomad.fs — a unified filesystem API over BOTH drive backends (ADR-0010 Phase 2).
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

import hyperdriveAPI from './hyperdrive';
import autobaseAPI from './autobase';
import * as filesystem from '../../filesystem/index';
import * as drives from '../../hyper/drives';
import * as drafts from '../../hyper/drafts';
import { parseDriveUrl } from '../../../lib/urls';
import { createFsRouter } from './fs-router';

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
    if (!ctx?.sender?.id) return null;
    const spaceId = filesystem.getSpaceIdForWebContents(ctx.sender.id);
    const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null;
    return spaceUrl ? drives.fromURLToKey(spaceUrl, true) : null;
  },
  parseDriveUrl,
});
const _dispatch = (ctx, url) => router.dispatch(ctx, url);
const _read = (ctx, method, url, rest) => router.read(ctx, method, url, rest);

// --- Draft Mode routing (ADR-0012) ------------------------------------------
// Writes to an Autobase Drive stage into the Vault-hosted Draft while that Drive's Draft Mode is on
// (or `{ draft:true }` is passed). Content reads merge the Draft over the base ONLY when `{ draft:true }`
// (preview) — default reads stay published, so the serve path and peers never see staged content.

const _opts = (opts) => (typeof opts === 'string' ? { encoding: opts } : opts || {});

// Encode merged bytes to match the backend's get() contract (autobase.get).
function _encode(buf, opts: any) {
  if (buf == null) return null;
  if (opts.encoding === 'binary') return buf;
  if (opts.encoding === 'base64') return buf.toString('base64');
  if (opts.encoding === 'hex') return buf.toString('hex');
  if (opts.encoding === 'json') {
    try {
      return JSON.parse(buf.toString());
    } catch {
      return null;
    }
  }
  return buf.toString();
}

// Mirror autobase's _toBuffer so staged bytes match what put() would have written.
function _toBuffer(data, opts: any) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') {
    if (opts.encoding === 'base64') return Buffer.from(data, 'base64');
    if (opts.encoding === 'hex') return Buffer.from(data, 'hex');
    if (opts.encoding === 'binary') return Buffer.from(data, 'binary');
    return Buffer.from(data, 'utf8');
  }
  if (data && typeof data === 'object') return Buffer.from(JSON.stringify(data), 'utf8');
  return Buffer.from(String(data), 'utf8');
}

// Canonicalise the url and split it into { baseKey, path } for the drafts module.
async function _baseInfo(ctx, url) {
  const { api, url: u, isAutobase } = await _dispatch(ctx, url);
  let baseKey = u;
  let path = '/';
  try {
    const p = parseDriveUrl(u);
    baseKey = p.hostname;
    path = p.pathname || '/';
  } catch {
    /* keep fallbacks */
  }
  return { api, url: u, isAutobase, baseKey, path };
}

// Stage a write instead of dispatching, when the Drive is in Draft Mode. Returns { staged } and, when
// not staged, the resolved { api, u } so the caller can dispatch without re-canonicalising.
async function _stageWrite(ctx, url, kind, data, opts) {
  const o = _opts(opts);
  const { api, url: u, isAutobase, baseKey, path } = await _baseInfo(ctx, url);
  const wantDraft =
    isAutobase && o.draft !== false && (o.draft === true || (await drafts.getMode(baseKey)));
  if (!wantDraft) return { staged: false, api, u };
  if (kind === 'del') await drafts.stageDel(baseKey, path);
  else await drafts.stagePut(baseKey, path, _toBuffer(data, o), { executable: o.executable });
  return { staged: true, api, u };
}

// Merge a content read over the base when `{ draft:true }` is passed OR the target Drive is being
// previewed (so a drive app rendered in a previewing tab reads its OWN merged content at runtime, not
// just the files the serve path hands it). `{ draft:false }` opts out explicitly — the editor/explorer
// pass it when their Draft Mode is off so a Drive's preview flag can't leak into their published view.
async function _readMerged(ctx, url, opts) {
  const o = _opts(opts);
  if (o.draft === false) return { handled: false, value: null };
  if (o.draft !== true && !drafts.anyPreview()) return { handled: false, value: null };
  const { isAutobase, baseKey, path } = await _baseInfo(ctx, url);
  if (!isAutobase) return { handled: false, value: null };
  if (o.draft !== true && !drafts.isPreview(baseKey)) return { handled: false, value: null };
  const buf = await drafts.readMerged(baseKey, path);
  return { handled: true, value: _encode(buf, o) };
}

const fsAPI = {
  async getInfo(url, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.getInfo.call(this, u, opts);
  },

  // --- Read ---
  async entry(url, opts = {}) {
    return _read(this, 'entry', url, [opts]);
  },
  async stat(url, opts = {}) {
    return _read(this, 'stat', url, [opts]);
  },
  async get(url, opts = {}) {
    const m = await _readMerged(this, url, opts);
    if (m.handled) return m.value;
    return _read(this, 'get', url, [opts]);
  },
  async readFile(url, opts = {}) {
    const m = await _readMerged(this, url, opts);
    if (m.handled) return m.value;
    return _read(this, 'readFile', url, [opts]);
  },
  async list(url, opts = {}) {
    const base = await _read(this, 'list', url, [opts]);
    const o = _opts(opts);
    if (o.draft === false || (o.draft !== true && !drafts.anyPreview())) return base;
    const { isAutobase, baseKey, path } = await _baseInfo(this, url);
    if (!isAutobase || (o.draft !== true && !drafts.isPreview(baseKey))) return base;
    return drafts.mergeList(baseKey, path, base);
  },
  async readdir(url, opts = {}) {
    const base = await _read(this, 'readdir', url, [opts]);
    const o = _opts(opts);
    if (o.draft === false || (o.draft !== true && !drafts.anyPreview())) return base;
    const { isAutobase, baseKey, path } = await _baseInfo(this, url);
    if (!isAutobase || (o.draft !== true && !drafts.isPreview(baseKey))) return base;
    const { removed, put } = await drafts.dirOverlay(baseKey, path);
    if (!removed.size && !put.size) return base;
    const includeStats = !!o.includeStats;
    const seen = new Set();
    const out: any[] = [];
    for (const item of base) {
      const name = includeStats ? item.name : item;
      if (removed.has(name)) continue;
      seen.add(name);
      out.push(item);
    }
    for (const [name, meta] of put) {
      if (seen.has(name)) continue;
      out.push(includeStats ? { name, stat: (meta as any).stat } : name);
    }
    return out;
  },
  async diff(url, other, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.diff.call(this, u, other, opts);
  },

  // --- Write (require a writable drive; no fallback — the backend is known) ---
  // In Draft Mode these stage into the Vault-hosted Draft instead of appending to the base Drive.
  async put(url, data, opts = {}) {
    const s = await _stageWrite(this, url, 'put', data, opts);
    if (s.staged) return undefined;
    return s.api.put.call(this, s.u, data, opts);
  },
  async writeFile(url, data, opts = {}) {
    const s = await _stageWrite(this, url, 'put', data, opts);
    if (s.staged) return undefined;
    return s.api.writeFile.call(this, s.u, data, opts);
  },
  async del(url, opts = {}) {
    const s = await _stageWrite(this, url, 'del', null, opts);
    if (s.staged) return undefined;
    return s.api.del.call(this, s.u, opts);
  },
  async unlink(url, opts = {}) {
    const s = await _stageWrite(this, url, 'del', null, opts);
    if (s.staged) return undefined;
    return s.api.unlink.call(this, s.u, opts);
  },
  async mkdir(url, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.mkdir.call(this, u, opts);
  },
  async rmdir(url, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.rmdir.call(this, u, opts);
  },
  async updateMetadata(url, metadata, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.updateMetadata.call(this, u, metadata, opts);
  },
  async deleteMetadata(url, keys, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.deleteMetadata.call(this, u, keys, opts);
  },
  async mount(url, key, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.mount.call(this, u, key, opts);
  },
  async unmount(url, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.unmount.call(this, u, opts);
  },
  async symlink(url, target, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.symlink.call(this, u, target, opts);
  },

  // Bulk filesystem import/export. (Delegates to the Hyperdrive impl; Autobase-target import is a
  // known gap tracked for the backend-unification pass.)
  async importFromFilesystem(opts) {
    return hyperdriveAPI.importFromFilesystem.call(this, opts);
  },
  async exportToFilesystem(opts) {
    return hyperdriveAPI.exportToFilesystem.call(this, opts);
  },
  async exportToDrive(opts) {
    return hyperdriveAPI.exportToDrive.call(this, opts);
  },

  // copy/rename are implemented backend-agnostically (read + write) so they work within and
  // ACROSS backends and don't depend on each backend's differing copy() signature.
  async copy(srcUrl, dstUrl, opts = {}) {
    const buf = await fsAPI.get.call(this, srcUrl, { encoding: 'binary' });
    if (buf == null) throw new Error('Source not found: ' + srcUrl);
    return fsAPI.put.call(this, dstUrl, buf, { encoding: 'binary' });
  },
  async rename(srcUrl, dstUrl, opts = {}) {
    await fsAPI.copy.call(this, srcUrl, dstUrl, opts);
    return fsAPI.del.call(this, srcUrl, opts);
  },

  // --- Change notifications ('readable' — return the backend's emitter) ---
  async watch(url, pathPattern) {
    const { api, url: u } = await _dispatch(this, url);
    return api.watch.call(this, u, pathPattern);
  },

  // --- Drive lifecycle ---
  // New drives are Autobase-from-birth (ADR-0010): a drive can gain writers without changing URL.
  async createDrive(opts = {}) {
    return autobaseAPI.createCollaborativeDrive.call(this, opts);
  },
  async createCollaborativeDrive(opts = {}) {
    return autobaseAPI.createCollaborativeDrive.call(this, opts);
  },
  async forkDrive(url, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.forkDrive.call(this, u, opts);
  },
  async loadDrive(url) {
    return autobaseAPI.loadDrive.call(this, url);
  },
  async configure(url, settings, opts = {}) {
    const { api, url: u } = await _dispatch(this, url);
    return api.configure.call(this, u, settings, opts);
  },
  async isCollaborativeDrive(url) {
    return autobaseAPI.isCollaborativeDrive.call(this, url);
  },

  // query accepts either a url-first form fs.query(url, opts) or the legacy hyperdrive object
  // form fs.query({ drive, path, ... }) so migrated call sites keep working.
  async query(urlOrOpts, opts = {}) {
    if (urlOrOpts && typeof urlOrOpts === 'object')
      return hyperdriveAPI.query.call(this, urlOrOpts);
    return _read(this, 'list', urlOrOpts, [opts]);
  },

  // --- Collaborative-drive writer management (Autobase only) ---
  async createInvite(url, opts = {}) {
    return autobaseAPI.createInvite.call(this, url, opts);
  },
  async claimInvite(inviteUrl, opts = {}) {
    return autobaseAPI.claimInvite.call(this, inviteUrl, opts);
  },
  async requestAccess(url, opts = {}) {
    return autobaseAPI.requestAccess.call(this, url, opts);
  },
  async listRequests(url) {
    return autobaseAPI.listRequests.call(this, url);
  },
  async watchRequests(url) {
    return autobaseAPI.watchRequests.call(this, url);
  },
  async approveRequest(url, writerKey, opts = {}) {
    return autobaseAPI.approveRequest.call(this, url, writerKey, opts);
  },
  async denyRequest(url, writerKey) {
    return autobaseAPI.denyRequest.call(this, url, writerKey);
  },
  async removeWriter(url, writerKey) {
    return autobaseAPI.removeWriter.call(this, url, writerKey);
  },
  async listWriters(url) {
    return autobaseAPI.listWriters.call(this, url);
  },

  // --- Draft Mode (ADR-0012) — device-private staging hosted in the Vault ---
  async beginDraft(url) {
    const { baseKey } = await _baseInfo(this, url);
    return drafts.beginDraft(baseKey);
  },
  async endDraft(url) {
    const { baseKey } = await _baseInfo(this, url);
    return drafts.endDraft(baseKey);
  },
  // { mode, changes: [{ path, op, conflict }] } — drives the toggle state + "N unpublished" badge.
  async draftStatus(url) {
    const { baseKey, isAutobase } = await _baseInfo(this, url);
    if (!isAutobase) return { mode: false, changes: [] };
    const [mode, changes] = await Promise.all([
      drafts.getMode(baseKey),
      drafts.listDraft(baseKey),
    ]);
    return { mode, changes };
  },
  // opts: { paths?: string[], force?: boolean } → { published, conflicts }.
  async publishDraft(url, opts = {}) {
    const { baseKey } = await _baseInfo(this, url);
    return drafts.publish(baseKey, opts);
  },
  // opts: { paths?: string[] } → { discarded }.
  async discardDraft(url, opts = {}) {
    const { baseKey } = await _baseInfo(this, url);
    return drafts.discard(baseKey, opts);
  },
  // Toggle rendering the merged Draft for a Drive (local preview only — never replicated). Keyed by
  // Drive key; the browser-chrome toggle goes through bg/ui/tabs, this is the url-first entry point.
  async setDraftPreview(url, on) {
    const { baseKey } = await _baseInfo(this, url);
    drafts.setPreview(baseKey, !!on);
    return { on: !!on };
  },
  // 'readable' — emits 'changed' when this Drive's Draft mutates (stage/publish/discard/mode).
  async watchDraft(url) {
    const { EventEmitter } = await import('events');
    const emitter: any = new EventEmitter();
    const { baseKey } = await _baseInfo(this, url);
    const onChanged = (e) => {
      if (e && e.baseKey === baseKey) emitter.emit('changed', {});
    };
    drafts.events.on('changed', onChanged);
    // pauls-electron-rpc calls close() when the renderer tears down the stream
    emitter.close = () => drafts.events.removeListener('changed', onChanged);
    return emitter;
  },
};

export default fsAPI;
