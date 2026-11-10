// Assets on desktop (nomad://assets, ADR-0044), on the internal nomad.vault API (vault.ts), and the
// AI's saveAsset (ai.ts). Rules and paths: shared/assets.mjs. The phone does the same in
// mobile/backend/lib/assets.mjs.
//
// Every Space has Assets. A shared Space's are in its Space Library (ADR-0029): every member sees
// them and every editor adds them. Any other Space's are the user's own, in the Vault, and move into
// the Space Library when the Space is shared (hyper/space-library.js share). The family album's
// photos (ADR-0043) are Assets: a Device that can write the Space Library moves them the first time
// it lists them, and until then they are read where they are.

import b4a from 'b4a';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, nativeImage } from 'electron';
import * as autobases from '../../hyper/autobases';
import * as spaceLibrary from '../../hyper/space-library';
import * as vault from '../../hyper/vault';
import * as vaultApps from './vault-apps';
import * as as from '../../../../shared/assets.mjs';
import { addOrigin } from '../../../../shared/ai-origin.mjs';
import { assetLink } from '../../../../shared/item-links.mjs';
import * as logLib from '../../logger';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'assets' });

type Place = {
  space: string;
  shared: boolean;
  sess: any; // the Space Library's or the Vault's session; null with no Vault yet
  root: string;
  writable: boolean;
  role: string | null;
  memberId: string | null;
};

// Where Space `space`'s Assets are. `write` makes the Vault when a Space that isn't shared has none.
export async function placeFor(space, { write = false } = {}): Promise<Place> {
  const lib = space ? await spaceLibrary.forSpace(space).catch(() => null) : null;
  if (lib) {
    return { space, shared: true, sess: lib.sess, root: as.LIB_ASSETS, writable: !!lib.sess.writable, role: lib.role || null, memberId: lib.memberId || null };
  }
  const sess = write ? await vault.ensureVault() : await vault.getVault();
  if (sess) await sess.base.update().catch(() => {});
  return { space, shared: false, sess, root: as.vaultRoot(space), writable: !!sess?.writable || !sess, role: null, memberId: null };
}

async function placeOf(ctx, opts = {}) {
  return placeFor(await vaultApps.spaceKey(ctx), opts);
}

async function me(place: Place) {
  if (!place.shared) return { memberId: null, name: '' };
  const list = await spaceLibrary.members(place.space).catch(() => []);
  return { memberId: place.memberId, name: list.find((m) => m.memberId === place.memberId)?.name || '' };
}

async function readJsonAt(sess, prefix) {
  const out = [];
  for (const { record } of await autobases.listRecords(sess, prefix)) {
    try {
      const buf = await autobases.resolveRecordContent(record);
      if (buf) out.push(JSON.parse(b4a.toString(buf)));
    } catch {}
  }
  return out;
}

// The family album's photos (ADR-0043) move to the Assets paths: the same blobs, new paths, then the
// old ones go. Two Devices doing it at once write the same records. Only a Space Library has them.
let _moving = new Map();
async function moveAlbum(place: Place) {
  if (!place.shared || !place.writable) return 0;
  const key = place.sess.keyStr || place.space;
  if (_moving.has(key)) return _moving.get(key);
  const run = (async () => {
    let moved = 0;
    for (const rec of await readJsonAt(place.sess, as.LEGACY_ITEMS)) {
      const plan = as.legacyMove(rec, place.root);
      if (!plan) continue;
      const ops = [];
      for (const f of plan.files) {
        const node = await autobases.readRecord(place.sess, f.from);
        if (node) ops.push({ op: 'put', path: f.to, metadata: node.metadata, blob: node.blob || null, value: node.value || null });
      }
      ops.push(await autobases.buildPutInlineOp(place.sess, as.pathsOf(place.root).item(rec.id), plan.asset));
      for (const f of plan.files) ops.push({ op: 'del', path: f.from });
      for (const p of plan.remove) ops.push({ op: 'del', path: p });
      for (const op of ops) await place.sess.base.append(op);
      moved++;
    }
    if (moved) {
      await place.sess.base.update();
      logger.info('Moved the album’s photos to Assets', { space: place.space, moved });
    }
    return moved;
  })().finally(() => _moving.delete(key));
  _moving.set(key, run);
  return run;
}

async function items(place: Place) {
  if (!place.sess) return [];
  await moveAlbum(place).catch((err) => logger.warn('Couldn’t move the album', { err: err?.message }));
  const out = new Map();
  // A viewer's Device can't move them: it reads the album where it is.
  if (place.shared) {
    for (const rec of await readJsonAt(place.sess, as.LEGACY_ITEMS)) {
      const a = as.fromPhoto(rec);
      if (a) out.set(a.id, { ...a, legacy: true });
    }
  }
  for (const rec of await readJsonAt(place.sess, as.pathsOf(place.root).items)) {
    if (as.isAsset(rec)) out.set(rec.id, rec);
  }
  return as.sortAssets([...out.values()]);
}

const who = (place: Place) => ({ shared: place.shared, memberId: place.memberId, role: place.role, writable: place.writable });
const forPage = (place: Place) => (a) => {
  const { legacy, ...rest } = a;
  // The kind as the rules read it now (an EPUB added before books were a kind is a book).
  return { ...rest, kind: as.kindOf(a.mime, a.name), canDelete: as.canDelete(a, who(place)) };
};

// The folder records (shared/assets.mjs makeFolder): folders kept while nothing is in them.
async function keptFolders(place: Place) {
  if (!place.sess) return [];
  return (await readJsonAt(place.sess, as.pathsOf(place.root).folders)).filter(as.isFolder);
}

// { space, spaceName, shared, canAdd, role, assets: [...record, canDelete], folders: [path] }
export async function listAssets(ctx) {
  const place = await placeOf(ctx);
  const list = await items(place);
  return {
    space: place.space,
    spaceName: vaultApps.spaceNameOf(place.space),
    shared: place.shared,
    canAdd: place.writable,
    role: place.role,
    maxBytes: as.MAX_BYTES,
    assets: list.map(forPage(place)),
    folders: as.allFolders(list, await keptFolders(place)),
  };
}

// Where an Asset's file (or thumbnail) is: its path, or an album photo's not moved yet.
async function fileNode(place: Place, id, thumb) {
  if (!place.sess || !as.isAssetId(id)) return null;
  const p = as.pathsOf(place.root);
  const at = thumb ? p.thumb(id) : p.file(id);
  const node = await autobases.readRecord(place.sess, at).catch(() => null);
  if (node || !place.shared) return node ? { path: at, node } : null;
  const old = as.legacyPaths(id);
  const legacy = thumb ? old.thumb : old.file;
  const oldNode = await autobases.readRecord(place.sess, legacy).catch(() => null);
  return oldNode ? { path: legacy, node: oldNode } : null;
}

async function readBytes(place: Place, id, thumb, range = undefined) {
  const at = await fileNode(place, id, thumb);
  if (!at) return null;
  return autobases.readContent(place.sess, at.path, range).catch(() => null);
}

// An Asset's thumbnail (or a small file) as a data: URL, or null while it hasn't replicated yet.
// A whole file comes in pieces, assetChunk: a data: URL of a movie would never fit.
export async function assetData(ctx, id, { thumb = false } = {}) {
  const place = await placeOf(ctx);
  if (!thumb) {
    const at = await fileNode(place, id, false);
    if (at && autobases.recordByteLength(at.node) > as.MAX_DATA_URL_BYTES) throw new Error('That file is too big to read at once');
  }
  const buf = await readBytes(place, id, thumb);
  if (!buf) return null;
  let mime = 'image/jpeg';
  if (!thumb) {
    const rec = await autobases.readJson(place.sess, as.pathsOf(place.root).item(id)).catch(() => null);
    // An album photo not moved yet is a JPEG.
    mime = as.isAsset(rec) ? rec.mime : place.shared ? 'image/jpeg' : 'application/octet-stream';
  }
  return `data:${mime};base64,` + b4a.toString(buf, 'base64');
}

// One piece of an Asset's file: { size, data } with `data` the bytes from `start`, at most
// CHUNK_BYTES, or null while the file hasn't replicated here yet. The page asks for the next piece
// until it has `size` bytes.
export async function assetChunk(ctx, id, { start = 0, length = as.CHUNK_BYTES, thumb = false } = {}) {
  const place = await placeOf(ctx);
  const at = await fileNode(place, id, thumb);
  if (!at) return null;
  const size = autobases.recordByteLength(at.node);
  const from = Math.max(0, Math.floor(Number(start) || 0));
  const len = Math.min(as.CHUNK_BYTES, Math.max(0, Math.floor(Number(length) || 0)), size - from);
  if (len <= 0) return { size, data: b4a.alloc(0) };
  const data = await autobases.readContent(place.sess, at.path, { start: from, length: len }).catch(() => null);
  return data ? { size, data } : null;
}

// Adding a big file in pieces
// =
// The page sends a file in CHUNK_BYTES pieces, which land in a temporary file on this computer;
// the last one moves it into the Space's blob core in one go (so the core is never held while
// pieces cross over IPC). An upload belongs to the page that began it and is dropped after
// UPLOAD_IDLE_MS without a piece.

type Upload = { owner: number | null; space: string; file: string; handle: fs.promises.FileHandle; got: number; size: number; timer: any };
const uploads = new Map<string, Upload>();
const UPLOAD_IDLE_MS = 10 * 60 * 1000;
let _uploadsDir: string | null = null;

async function uploadsDir() {
  if (!_uploadsDir) {
    const dir = path.join(app.getPath('temp'), 'nomad-asset-uploads');
    // Anything here is left from an earlier run.
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.mkdir(dir, { recursive: true });
    _uploadsDir = dir;
  }
  return _uploadsDir;
}

async function dropUpload(id) {
  const u = uploads.get(id);
  if (!u) return;
  uploads.delete(id);
  clearTimeout(u.timer);
  await u.handle.close().catch(() => {});
  await fs.promises.rm(u.file, { force: true }).catch(() => {});
}

function uploadOf(ctx, id) {
  const u = typeof id === 'string' ? uploads.get(id) : null;
  if (!u || u.owner !== (ctx?.sender?.id ?? null)) throw new Error('That upload was stopped. Add the file again.');
  clearTimeout(u.timer);
  u.timer = setTimeout(() => dropUpload(id), UPLOAD_IDLE_MS);
  return u;
}

// -> an upload id, once the file's size is one Assets keeps and the caller's Space can take it.
export async function beginAssetUpload(ctx, { size }: any = {}) {
  const place = await placeOf(ctx);
  if (!place.writable) throw new Error('You can view this Space, but not add to it');
  const err = as.sizeError({ bytes: Number(size) || 0 });
  if (err) throw new Error(err);
  const id = crypto.randomBytes(12).toString('hex');
  const file = path.join(await uploadsDir(), id);
  const handle = await fs.promises.open(file, 'w');
  uploads.set(id, { owner: ctx?.sender?.id ?? null, space: place.space, file, handle, got: 0, size: Number(size), timer: null });
  uploadOf(ctx, id);
  return id;
}

// The next piece, from `start` (the bytes so far). -> the bytes so far.
export async function assetUploadChunk(ctx, id, { start, data }: any = {}) {
  const u = uploadOf(ctx, id);
  const buf = b4a.isBuffer(data) ? data : b4a.from(data || []);
  if (Number(start) !== u.got) throw new Error('A piece of the file went missing. Add it again.');
  if (buf.length > as.CHUNK_BYTES || u.got + buf.length > u.size) {
    await dropUpload(id);
    throw new Error('That file changed while it was being added');
  }
  await u.handle.write(buf, 0, buf.length, u.got);
  u.got += buf.length;
  return u.got;
}

// The last step: the record, with the file from the upload (`fields` as addAsset's, without `data`).
export async function finishAssetUpload(ctx, id, fields: any = {}) {
  const u = uploadOf(ctx, id);
  try {
    await u.handle.close();
    if (u.got !== u.size) throw new Error('Part of the file didn’t arrive. Add it again.');
    const place = await placeFor(u.space, { write: true });
    const { data, file, thumbFile, source, sourceUrl, ...rest } = fields || {};
    return await addTo(place, { ...rest, stored: { file: u.file, bytes: u.got } });
  } finally {
    await dropUpload(id);
  }
}

export async function abortAssetUpload(ctx, id) {
  if (uploads.get(id)?.owner === (ctx?.sender?.id ?? null)) await dropUpload(id);
  return true;
}

// Put a file (and a thumbnail) in, then its record, in one update.
export async function addTo(place: Place, f: any) {
  if (!place.writable) throw new Error('You can view this Space, but not add to it');
  // `stored`: a file on this computer (an upload in pieces), moved in without being read whole.
  const stored = f.stored || null;
  const file = stored ? null : b4a.isBuffer(f.file) ? f.file : b4a.from(String(f.data || ''), 'base64');
  const bytes = stored ? stored.bytes : file.length;
  const small = f.thumbFile ? f.thumbFile : f.thumb ? b4a.from(String(f.thumb), 'base64') : null;
  const err = as.sizeError({ bytes, thumbBytes: small ? small.length : 0 });
  if (err) throw new Error(err);
  if (!place.sess) place = await placeFor(place.space, { write: true });
  if (!place.sess?.writable) throw new Error('This device can’t write to your Vault yet. Keep your other device online until it syncs, then try again.');
  const m = await me(place);
  const id = as.newAssetId();
  const p = as.pathsOf(place.root);
  const rec = as.makeAsset({
    id,
    name: f.name,
    mime: f.mime,
    bytes,
    width: f.width,
    height: f.height,
    duration: f.duration,
    takenAt: f.takenAt,
    by: m.name,
    memberId: m.memberId,
    caption: f.caption,
    thumb: !!small?.length,
    source: f.source,
    sourceUrl: f.sourceUrl,
    tags: f.tags,
    folder: f.folder,
    ai: f.ai,
  });
  const ops: any[] = [
    stored
      ? await autobases.buildPutBlobOpFrom(place.sess, p.file(id), fs.createReadStream(stored.file, { highWaterMark: 1024 * 1024 }))
      : await autobases.buildPutBlobOp(place.sess, p.file(id), file),
  ];
  if (small?.length) ops.push(await autobases.buildPutBlobOp(place.sess, p.thumb(id), small));
  ops.push(await autobases.buildPutInlineOp(place.sess, p.item(id), rec));
  for (const op of ops) await place.sess.base.append(op);
  await place.sess.base.update();
  return { ...rec, canDelete: true };
}

// From nomad://assets: `data` (and `thumb`) base64; the page scaled a camera photo and made the thumbnail.
export async function addAsset(ctx, f: any = {}) {
  return addTo(await placeOf(ctx), f);
}

async function writable(ctx) {
  const place = await placeOf(ctx);
  if (!place.writable || !place.sess) throw new Error('You can view this Space, but not change it');
  return place;
}

// The fields of a change the user may make: a name, a caption, tags, a folder.
function editOf({ name, caption, tags, folder }: any) {
  return {
    ...(name !== undefined ? { name } : {}),
    ...(caption !== undefined ? { caption } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(folder !== undefined ? { folder } : {}),
  };
}

// A new name, caption, tags or folder.
export async function updateAsset(ctx, change: any = {}) {
  const place = await writable(ctx);
  const { id } = change;
  const path = as.pathsOf(place.root).item(id);
  const prev = await autobases.readJson(place.sess, path);
  if (!as.isAsset(prev)) throw new Error('That file was removed');
  const rec = as.makeAsset({ id, ...editOf(change) }, prev);
  await autobases.putInline(place.sess, path, rec);
  return rec;
}

// Many at once (select, then Move or Tag): `folder` moves them, `addTags`/`removeTags` change their
// tags. Returns how many changed.
export async function updateAssets(ctx, { ids = [], folder, addTags = [], removeTags = [] }: any = {}) {
  const place = await writable(ctx);
  const p = as.pathsOf(place.root);
  let changed = 0;
  for (const id of (Array.isArray(ids) ? ids : []).filter(as.isAssetId)) {
    const prev = await autobases.readJson(place.sess, p.item(id)).catch(() => null);
    if (!as.isAsset(prev)) continue;
    const tags = as.changeTags(prev.tags, { add: addTags, remove: removeTags });
    const rec = as.makeAsset({ id, tags, ...(folder !== undefined ? { folder } : {}) }, prev);
    await place.sess.base.append(await autobases.buildPutInlineOp(place.sess, p.item(id), rec));
    changed++;
  }
  if (changed) await place.sess.base.update();
  return { changed };
}

async function removeFrom(place: Place, id) {
  const p = as.pathsOf(place.root);
  const prev = await autobases.readJson(place.sess, p.item(id)).catch(() => null);
  if (!as.isAsset(prev)) return 'gone';
  if (!as.canDelete(prev, who(place))) return 'refused';
  for (const path of [p.item(id), p.file(id), p.thumb(id)]) await place.sess.base.append({ op: 'del', path });
  return 'removed';
}

export async function deleteAsset(ctx, id) {
  const place = await placeOf(ctx);
  if (!place.sess || !as.isAssetId(id)) return false;
  const res = await removeFrom(place, id);
  if (res === 'refused') throw new Error('Only the person who added a file, or the Space’s owner, can remove it');
  if (res === 'removed') await place.sess.base.update();
  return res === 'removed';
}

// Many at once. Files someone else added in a shared Space stay (`refused`).
export async function deleteAssets(ctx, ids = []) {
  const place = await placeOf(ctx);
  let removed = 0;
  let refused = 0;
  if (!place.sess) return { removed, refused };
  for (const id of (Array.isArray(ids) ? ids : []).filter(as.isAssetId)) {
    const res = await removeFrom(place, id);
    if (res === 'removed') removed++;
    else if (res === 'refused') refused++;
  }
  if (removed) await place.sess.base.update();
  return { removed, refused };
}

// Folders (shared/assets.mjs): a new one is kept by its record until it is removed.
export async function addFolder(ctx, path) {
  const place = await writable(ctx);
  const rec = as.makeFolder(path);
  await autobases.putInline(place.sess, as.pathsOf(place.root).folder(rec.path), rec);
  return rec.path;
}

// Rename or move folder `from` to `to` (a whole path), with everything in it.
export async function moveFolder(ctx, { from, to }: any = {}) {
  const place = await writable(ctx);
  const p = as.pathsOf(place.root);
  const list = (await items(place)).filter((a) => !a.legacy);
  const kept = await keptFolders(place);
  const plan = as.moveFolderPlan(list, kept, from, to);
  for (const { id, folder } of plan.assets) {
    const prev = list.find((a) => a.id === id);
    await place.sess.base.append(await autobases.buildPutInlineOp(place.sess, p.item(id), as.makeAsset({ id, folder }, prev)));
  }
  for (const path of plan.remove) await place.sess.base.append({ op: 'del', path: p.folder(path) });
  for (const path of plan.keep) await place.sess.base.append(await autobases.buildPutInlineOp(place.sess, p.folder(path), as.makeFolder(path)));
  await place.sess.base.update();
  return { path: as.cleanFolder(to), moved: plan.assets.length };
}

// Remove folder `path` and everything in it. Refused, with nothing removed, when it holds a file this
// user can't remove (someone else's, in a shared Space).
export async function deleteFolder(ctx, path) {
  const place = await writable(ctx);
  const p = as.pathsOf(place.root);
  const list = (await items(place)).filter((a) => !a.legacy);
  const plan = as.deleteFolderPlan(list, await keptFolders(place), path);
  const w = who(place);
  const theirs = plan.assets.filter((id) => !as.canDelete(list.find((a) => a.id === id), w)).length;
  if (theirs) throw new Error(`This folder has ${theirs} file${theirs === 1 ? '' : 's'} someone else added. Only they, or the Space’s owner, can remove ${theirs === 1 ? 'it' : 'them'}.`);
  for (const id of plan.assets) for (const f of [p.item(id), p.file(id), p.thumb(id)]) await place.sess.base.append({ op: 'del', path: f });
  for (const f of plan.remove) await place.sess.base.append({ op: 'del', path: p.folder(f) });
  await place.sess.base.update();
  return { removed: plan.assets.length };
}

// The AI's saveAsset (ai.ts): bytes it wrote, fetched or read, into Space `space`'s Assets. A
// picture gets a thumbnail here (nativeImage reads PNG and JPEG). Returns what the model is told.
// `origin`: the chat that saved it (shared/ai-origin.mjs); the file links back to it (ADR-0047).
export async function saveForAi(space, { name, mime, bytes, caption, sourceUrl, origin = null }) {
  const place = await placeFor(space, { write: true });
  const type = as.mimeOf(name, mime);
  let thumbFile = null;
  let width = 0;
  let height = 0;
  if (type === 'image/png' || type === 'image/jpeg') {
    try {
      const img = nativeImage.createFromBuffer(bytes);
      if (!img.isEmpty()) {
        ({ width, height } = img.getSize());
        const k = Math.min(1, as.THUMB_SIDE / Math.max(width, height));
        thumbFile = img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' }).toJPEG(75);
      }
    } catch {}
  }
  const ai = origin ? addOrigin([], origin, { made: true }) : [];
  const rec = await addTo(place, { file: bytes, thumbFile, name, mime: type, width, height, caption, source: 'ai', sourceUrl, ai });
  return {
    id: rec.id,
    name: rec.name,
    kind: rec.kind,
    bytes: rec.bytes,
    space: vaultApps.spaceNameOf(space) || null,
    shared: place.shared,
    url: assetLink(rec.id),
  };
}
