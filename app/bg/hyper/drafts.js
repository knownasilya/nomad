// Drive Draft Mode (ADR-0012) — device-private staging hosted in the Vault.
//
// A Draft is a user's unpublished changes to a Drive. Because every one of a user's Devices is
// already a Writer of the Vault, hosting Drafts INSIDE the Vault gives cross-Device sync for free —
// no per-drive device writer key (multi-device-protocol §3), no FS_FORMAT_VERSION bump. The base
// Drive's replicated oplog is untouched until Publish, so followers see nothing.
//
// Layout — all inside the Vault's Hyperbee view:
//   /.drafts/<baseKey>/mode.json      { on: boolean }         — per-Drive toggle (syncs across Devices)
//   /.drafts/<baseKey>/files/<path>   <StagedEntry, inline>   — one per staged path
//
// A StagedEntry is the inline JSON `value` of an ordinary Vault control record:
//   { op:'put', contentB64, executable?, base, stagedAt }   — staged write
//   { op:'del', base, stagedAt }                            — staged delete (tombstone)
// `base` is the base Drive's record ({metadata,blob,value}|null) observed at stage time; comparing it
// to the base's CURRENT record at Publish is how we detect "the base changed under me" (ADR-0012 §8).
//
// STATUS: SKELETON (ADR-0012 Phase 0). The control flow + Vault wiring are real and call the actual
// autobases/vault APIs; the TODOs mark what still needs finishing.

import { EventEmitter } from 'events';
import b4a from 'b4a';
import * as autobases from './autobases';
import * as vault from './vault';

const DRAFTS_ROOT = '/.drafts';

// Emits `('changed', { baseKey })` whenever a Draft mutates (stage/publish/discard/mode toggle), so
// the editor/explorer badge can update live instead of polling. bg/web-apis/bg/fs.ts.watchDraft
// bridges this to a per-Drive RPC stream.
export const events = new EventEmitter();
const emitChanged = (baseKey) => events.emit('changed', { baseKey });

const modePath = (baseKey) => `${DRAFTS_ROOT}/${baseKey}/mode.json`;
const filesPrefix = (baseKey) => `${DRAFTS_ROOT}/${baseKey}/files`;
const filePath = (baseKey, path) =>
  `${filesPrefix(baseKey)}${path.startsWith('/') ? path : `/${path}`}`;
const toOriginalPath = (baseKey, draftPath) =>
  draftPath.slice(filesPrefix(baseKey).length) || '/';

// --- Sessions ---------------------------------------------------------------

// The writable Vault session that hosts this user's Drafts.
async function vaultSess() {
  const sess = await vault.getVault();
  if (!sess) throw new Error('No Vault on this Device — cannot hold Drafts');
  if (!sess.writable) throw new Error('Vault is not yet writable on this Device');
  return sess;
}

const baseSess = (baseKey) => autobases.getOrLoadCollaborativeDrive(baseKey);

async function baseRecord(baseKey, path) {
  try {
    return await autobases.readRecord(await baseSess(baseKey), path);
  } catch {
    return null;
  }
}

// --- Mode toggle ------------------------------------------------------------

export async function getMode(baseKey) {
  const v = await vault.getVault();
  if (!v) return false;
  const rec = await autobases.readJson(v, modePath(baseKey));
  return !!(rec && rec.on);
}

export async function setMode(baseKey, on) {
  const v = await vaultSess();
  await autobases.putInline(v, modePath(baseKey), { on: !!on });
  emitChanged(baseKey);
  return { on: !!on };
}

export const beginDraft = (baseKey) => setMode(baseKey, true);
export const endDraft = (baseKey) => setMode(baseKey, false);

// --- Staging ----------------------------------------------------------------

// Stage a write. `bytes` is a Buffer/Uint8Array of the NEW content.
// TODO(blobs): large binaries currently go inline (base64) into the Vault view — fine for text /
// blog posts, but it bloats the oplog for media. Route bytes over a cap into a dedicated, PURGEABLE
// `draft-blobs` Hyperblobs core in the Vault namespace (ADR-0012 consequence) and store a pointer
// in the entry instead of contentB64.
export async function stagePut(baseKey, path, bytes, { executable = false } = {}) {
  const v = await vaultSess();
  const buf = b4a.isBuffer(bytes) ? bytes : b4a.from(bytes);
  await autobases.putInline(v, filePath(baseKey, path), {
    op: 'put',
    contentB64: b4a.toString(buf, 'base64'),
    executable: executable || undefined,
    base: await baseRecord(baseKey, path),
    stagedAt: Date.now(),
  });
  emitChanged(baseKey);
}

// Stage a delete (a tombstone — reads as absent in the merged view; base is untouched until Publish).
export async function stageDel(baseKey, path) {
  const v = await vaultSess();
  await autobases.putInline(v, filePath(baseKey, path), {
    op: 'del',
    base: await baseRecord(baseKey, path),
    stagedAt: Date.now(),
  });
  emitChanged(baseKey);
}

// --- Merged reads (draft-over-base, tombstone-aware) ------------------------

// Content bytes for a path in the merged (Draft) view, or null if absent/tombstoned. `range` =
// { start, length } for partial reads.
export async function readMerged(baseKey, path, range) {
  const entry = await stagedEntry(baseKey, path);
  if (entry) {
    if (entry.op === 'del') return null;
    return sliceRange(b4a.from(entry.contentB64, 'base64'), range);
  }
  return autobases.readContent(await baseSess(baseKey), path, range);
}

async function stagedEntry(baseKey, path) {
  const v = await vault.getVault();
  if (!v) return null;
  return autobases.readJson(v, filePath(baseKey, path));
}

function sliceRange(buf, range) {
  if (!range) return buf;
  const start = range.start || 0;
  const end = range.length != null ? start + range.length : buf.length;
  return buf.subarray(start, end);
}

// --- Status / listing -------------------------------------------------------

// One row per staged change: { path, op, conflict }. conflict=true when the base record moved under
// this entry since it was staged (ADR-0012 §8) — the signal the Publish UI warns on.
export async function listDraft(baseKey) {
  const v = await vault.getVault();
  if (!v) return [];
  const rows = await autobases.listRecords(v, filesPrefix(baseKey));
  const out = [];
  for (const { path: draftPath, record } of rows) {
    const entry = decodeInline(record);
    if (!entry) continue;
    const path = toOriginalPath(baseKey, draftPath);
    // `created` = a staged put for a path that had no published entry (base observed as null) — a
    // brand-new file, vs. an edit to an existing one. (A missing baseline, e.g. mobile, reads as edit.)
    const created = entry.op === 'put' && 'base' in entry && entry.base === null;
    out.push({ path, op: entry.op, created, conflict: await isConflict(baseKey, path, entry) });
  }
  return out;
}

export async function hasDraft(baseKey) {
  return (await listDraft(baseKey)).length > 0;
}

// A staged entry is stored via putInline → record.value is base64 of the JSON envelope.
function decodeInline(record) {
  try {
    if (!record || record.value == null) return null;
    return JSON.parse(b4a.toString(b4a.from(record.value, 'base64')));
  } catch {
    return null;
  }
}

async function isConflict(baseKey, path, entry) {
  // No baseline recorded (e.g. a mobile-staged entry) → can't detect a conflict, so don't warn.
  if (!('base' in entry) || entry.base === undefined) return false;
  const cur = await baseRecord(baseKey, path);
  return JSON.stringify(cur) !== JSON.stringify(entry.base);
}

// --- Publish ----------------------------------------------------------------

// Fold staged changes onto the base Drive. `paths` (optional) restricts to a subset/subtree. Returns
// { published, conflicts }. When conflicts exist and !force, the conflicting paths are left staged
// (the caller resolves them via the proceed/skip/cancel UI, ADR-0012 §8) and everything else applies.
export async function publish(baseKey, { paths = null, force = false } = {}) {
  const base = await baseSess(baseKey);
  if (!base.writable) {
    throw new Error('Drive is not writable on this Device — Publish from the owning Device');
  }
  const v = await vaultSess();

  const rows = (await listDraft(baseKey)).filter((r) => selected(r.path, paths));
  const conflicts = rows.filter((r) => r.conflict).map((r) => r.path);
  const toApply = force ? rows : rows.filter((r) => !r.conflict);

  const publishedPaths = [];
  for (const row of toApply) {
    const entry = await stagedEntry(baseKey, row.path);
    if (!entry) continue;
    if (entry.op === 'del') {
      await base.base.append({ op: 'del', path: row.path });
    } else {
      // buildPutBlobOp writes the bytes into the BASE writer's own Hyperblobs core — the blob
      // re-home (ADR-0012); only the pointer enters the base oplog. A follower can then resolve it.
      const bytes = b4a.from(entry.contentB64, 'base64');
      await base.base.append(
        await autobases.buildPutBlobOp(base, row.path, bytes, { executable: entry.executable })
      );
    }
    publishedPaths.push(row.path);
  }
  if (publishedPaths.length) await base.base.update(); // one linearisation for the whole batch

  for (const p of publishedPaths) await autobases.deletePath(v, filePath(baseKey, p));
  // TODO(blobs): purge the corresponding bytes from the dedicated draft-blobs core here.

  emitChanged(baseKey);
  return { published: publishedPaths, conflicts: force ? [] : conflicts };
}

// --- Discard ----------------------------------------------------------------

export async function discard(baseKey, { paths = null } = {}) {
  const v = await vaultSess();
  const rows = (await listDraft(baseKey)).filter((r) => selected(r.path, paths));
  for (const row of rows) await autobases.deletePath(v, filePath(baseKey, row.path));
  // TODO(blobs): purge draft-blobs for these paths.
  emitChanged(baseKey);
  return { discarded: rows.map((r) => r.path) };
}

// paths=null → everything. Otherwise match an exact file or any path under a selected subtree.
function selected(path, paths) {
  if (!paths) return true;
  return paths.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}

// --- Preview registry + serve overlay (ADR-0012 Phase 2) --------------------
// Rendering the merged Draft is toggled per **Drive** (keyed by hex Drive key): while a Drive is being
// previewed, any of THIS Device's tabs showing it render Draft-over-base, and its own runtime nomad.fs
// reads merge too. Purely local — the serve path (bg/protocols/hyper.js) never runs for peers and the
// Draft never replicates, so the published view is unaffected. Keyed by Drive (not webContents)
// because the stream-protocol request doesn't reliably carry a webContentsId. previewNode() returns
// the base record for any path with no staged entry, so previewing a Drive with no Draft is a no-op.
const _preview = new Set(); // hex Drive keys currently previewed

export function setPreview(driveKey, on) {
  if (!driveKey) return;
  if (on) _preview.add(driveKey);
  else _preview.delete(driveKey);
}

export function isPreview(driveKey) {
  return !!driveKey && _preview.has(driveKey);
}

// Cheap gate so reads can skip the canonicalisation cost when nothing is being previewed.
export function anyPreview() {
  return _preview.size > 0;
}

// A v1-shaped node { key, value } for the MERGED view at `path`, or null (missing/tombstoned).
// Staged content is returned as an INLINE record so the serve path's resolveRecordContent /
// recordByteLength / .goto / .md handling all work unchanged. Used only by the preview serve.
export async function previewNode(baseKey, path) {
  const entry = await stagedEntry(baseKey, path);
  if (entry) {
    if (entry.op === 'del') return null; // tombstone — reads as absent in the preview
    return { key: path, value: { metadata: { mtime: 0, ctime: 0 }, blob: null, value: entry.contentB64 } };
  }
  const rec = await baseRecord(baseKey, path);
  return rec ? { key: path, value: rec } : null;
}

// --- Directory-listing overlay (draft-aware readdir / list) -----------------
// So a draft-aware readdir/list shows staged-new files and hides tombstoned ones. Stats match the
// backend shape (autobase _statFromRecord/_dirStat) so the fg createStat wrapper works unchanged.
const FILE_MODE = 32768; // 0100644
const DIR_MODE = 16384; // 040000

// Immediate children of `dirPath` that the Draft adds/removes: { removed:Set<name>, put:Map<name,{stat}> }.
export async function dirOverlay(baseKey, dirPath) {
  const prefix = dirPath === '/' ? '/' : dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const removed = new Set();
  const put = new Map();
  for (const { path, op } of await listDraft(baseKey)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (slash !== -1) {
      // a staged file inside a subdirectory → the subdirectory shows as a child
      if (op !== 'del' && !put.has(name)) {
        put.set(name, { stat: _stat(DIR_MODE, 0, 0) });
      }
      continue;
    }
    if (op === 'del') {
      removed.add(name);
      continue;
    }
    const e = await stagedEntry(baseKey, path);
    const size = e && e.contentB64 ? b4a.from(e.contentB64, 'base64').length : 0;
    put.set(name, { stat: _stat(FILE_MODE, size, (e && e.stagedAt) || 0) });
  }
  return { removed, put };
}

function _stat(mode, size, mtime) {
  return {
    mode,
    size,
    offset: 0,
    blocks: 0,
    downloaded: size,
    mtime,
    ctime: mtime,
    metadata: {},
  };
}

// Merge staged puts/dels into a recursive `list()` result ([{ key, value }]) under `dirPath`.
export async function mergeList(baseKey, dirPath, baseList) {
  const prefix = dirPath === '/' ? '/' : dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const dels = new Set();
  const puts = [];
  for (const { path, op } of await listDraft(baseKey)) {
    if (!path.startsWith(prefix)) continue;
    if (op === 'del') dels.add(path);
    else puts.push(path);
  }
  if (!dels.size && !puts.length) return baseList;
  const keyOf = (e) => (typeof e.key === 'string' ? e.key : b4a.toString(e.key));
  const seen = new Set();
  const out = [];
  for (const e of baseList) {
    const k = keyOf(e);
    if (dels.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  for (const p of puts) if (!seen.has(p)) out.push({ key: p, value: {} });
  return out;
}

// TODO(watch): expose a change stream (watchDraft) so the editor/explorer badge updates live off
//   Vault writes rather than polling listDraft.
// TODO(mobile): mirror stage/readMerged/list/discard in mobile/backend against the mobile Vault;
//   publish() rejects on paired-into drives (§3) via the base.writable guard above — same as other
//   mobile writes.
