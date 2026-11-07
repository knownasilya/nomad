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
import { nativeImage } from 'electron';
import * as autobases from '../../hyper/autobases';
import * as spaceLibrary from '../../hyper/space-library';
import * as vault from '../../hyper/vault';
import * as vaultApps from './vault-apps';
import * as as from '../../../../shared/assets.mjs';
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
  return { ...rest, canDelete: as.canDelete(a, who(place)) };
};

// { space, spaceName, shared, canAdd, role, assets: [...record, canDelete] }
export async function listAssets(ctx) {
  const place = await placeOf(ctx);
  return {
    space: place.space,
    spaceName: vaultApps.spaceNameOf(place.space),
    shared: place.shared,
    canAdd: place.writable,
    role: place.role,
    maxBytes: as.MAX_BYTES,
    assets: (await items(place)).map(forPage(place)),
  };
}

async function readBytes(place: Place, id, thumb) {
  if (!place.sess || !as.isAssetId(id)) return null;
  const p = as.pathsOf(place.root);
  const buf = await autobases.readContent(place.sess, thumb ? p.thumb(id) : p.file(id)).catch(() => null);
  if (buf || !place.shared) return buf;
  const old = as.legacyPaths(id);
  return autobases.readContent(place.sess, thumb ? old.thumb : old.file).catch(() => null);
}

// An Asset's file (or its thumbnail) as a data: URL, or null while it hasn't replicated yet.
export async function assetData(ctx, id, { thumb = false } = {}) {
  const place = await placeOf(ctx);
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

// Put a file (and a thumbnail) in, then its record, in one update.
export async function addTo(place: Place, f: any) {
  if (!place.writable) throw new Error('You can view this Space, but not add to it');
  const file = b4a.isBuffer(f.file) ? f.file : b4a.from(String(f.data || ''), 'base64');
  const small = f.thumbFile ? f.thumbFile : f.thumb ? b4a.from(String(f.thumb), 'base64') : null;
  const err = as.sizeError({ bytes: file.length, thumbBytes: small ? small.length : 0 });
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
    bytes: file.length,
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
  });
  const ops: any[] = [await autobases.buildPutBlobOp(place.sess, p.file(id), file)];
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

// A new name or caption.
export async function updateAsset(ctx, { id, name, caption }: any = {}) {
  const place = await placeOf(ctx);
  if (!place.writable || !place.sess) throw new Error('You can view this Space, but not change it');
  const path = as.pathsOf(place.root).item(id);
  const prev = await autobases.readJson(place.sess, path);
  if (!as.isAsset(prev)) throw new Error('That file was removed');
  const rec = as.makeAsset({ id, ...(name !== undefined ? { name } : {}), ...(caption !== undefined ? { caption } : {}) }, prev);
  await autobases.putInline(place.sess, path, rec);
  return rec;
}

export async function deleteAsset(ctx, id) {
  const place = await placeOf(ctx);
  if (!place.sess || !as.isAssetId(id)) return false;
  const p = as.pathsOf(place.root);
  const prev = await autobases.readJson(place.sess, p.item(id));
  if (!as.isAsset(prev)) return false;
  if (!as.canDelete(prev, who(place))) {
    throw new Error('Only the person who added a file, or the Space’s owner, can remove it');
  }
  for (const path of [p.item(id), p.file(id), p.thumb(id)]) await place.sess.base.append({ op: 'del', path });
  await place.sess.base.update();
  return true;
}

// The AI's saveAsset (ai.ts): bytes it wrote, fetched or read, into Space `space`'s Assets. A
// picture gets a thumbnail here (nativeImage reads PNG and JPEG). Returns what the model is told.
export async function saveForAi(space, { name, mime, bytes, caption, sourceUrl }) {
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
  const rec = await addTo(place, { file: bytes, thumbFile, name, mime: type, width, height, caption, source: 'ai', sourceUrl });
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
