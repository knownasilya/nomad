// The family album on desktop (nomad://photos, ADR-0043), on the internal nomad.vault API (vault.ts).
// Photos live in the page's Space's Library (ADR-0029), so they exist only for a shared Space: every
// member sees them and every editor adds them. Rules and paths: shared/photos.mjs. The phone does
// the same in mobile/backend/lib/photos.mjs.

import b4a from 'b4a';
import * as autobases from '../../hyper/autobases';
import * as spaceLibrary from '../../hyper/space-library';
import * as vaultApps from './vault-apps';
import * as ph from '../../../../shared/photos.mjs';

async function albumOf(ctx) {
  const space = await vaultApps.spaceKey(ctx).catch(() => null);
  const lib = space ? await spaceLibrary.forSpace(space).catch(() => null) : null;
  return { space, lib };
}

async function me(space, lib) {
  if (!lib) return { memberId: null, name: '' };
  const list = await spaceLibrary.members(space).catch(() => []);
  return { memberId: lib.memberId || null, name: list.find((m) => m.memberId === lib.memberId)?.name || '' };
}

async function items(lib) {
  const out = [];
  for (const { record } of await autobases.listRecords(lib.sess, ph.ITEMS)) {
    try {
      const buf = await autobases.resolveRecordContent(record);
      const rec = buf ? JSON.parse(b4a.toString(buf)) : null;
      if (ph.isPhoto(rec)) out.push(rec);
    } catch {}
  }
  return ph.sortPhotos(out);
}

// { space, spaceName, shared, canAdd, role, photos: [...record, canDelete] }
export async function listPhotos(ctx) {
  const { space, lib } = await albumOf(ctx);
  const base = { space, spaceName: vaultApps.spaceNameOf(space), shared: !!lib, canAdd: false, role: lib?.role || null, photos: [] };
  if (!lib) return base;
  const who = { memberId: lib.memberId || null, role: lib.role, writable: !!lib.sess.writable };
  const photos = (await items(lib)).map((p) => ({ ...p, canDelete: ph.canDelete(p, who) }));
  return { ...base, canAdd: who.writable, photos };
}

// A photo's file (or its thumbnail) as a data: URL, or null while it hasn't replicated yet.
export async function photoData(ctx, id, { thumb = false } = {}) {
  const { lib } = await albumOf(ctx);
  if (!lib || !ph.isPhotoId(id)) return null;
  const buf = await autobases.readContent(lib.sess, thumb ? ph.thumbPath(id) : ph.filePath(id)).catch(() => null);
  return buf ? 'data:image/jpeg;base64,' + b4a.toString(buf, 'base64') : null;
}

// Add a photo the page scaled (shared/photos.mjs MAX_SIDE, THUMB_SIDE): `photo` and `thumb` are
// base64 JPEG. Both files go in as blobs, then the record, in one update.
export async function addPhoto(ctx, { photo, thumb, width, height, takenAt, caption }: any = {}) {
  const { space, lib } = await albumOf(ctx);
  if (!lib) throw new Error('Share this Space to keep a family album in it');
  if (!lib.sess.writable) throw new Error('You can view this Space, but not add to it');
  const file = b4a.from(String(photo || ''), 'base64');
  const small = b4a.from(String(thumb || ''), 'base64');
  const err = ph.sizeError({ bytes: file.length, thumbBytes: small.length });
  if (err) throw new Error(err);
  const who = await me(space, lib);
  const id = ph.newPhotoId();
  const rec = ph.makePhoto({ id, by: who.name, memberId: who.memberId, takenAt, width, height, bytes: file.length, caption });
  const ops = [
    await autobases.buildPutBlobOp(lib.sess, ph.filePath(id), file),
    await autobases.buildPutBlobOp(lib.sess, ph.thumbPath(id), small),
    await autobases.buildPutInlineOp(lib.sess, ph.itemPath(id), rec),
  ];
  for (const op of ops) await lib.sess.base.append(op);
  await lib.sess.base.update();
  return { ...rec, canDelete: true };
}

export async function setPhotoCaption(ctx, { id, caption }: any = {}) {
  const { lib } = await albumOf(ctx);
  if (!lib || !lib.sess.writable) throw new Error('You can view this Space, but not change it');
  const prev = await autobases.readJson(lib.sess, ph.itemPath(id));
  if (!ph.isPhoto(prev)) throw new Error('That photo was removed');
  const rec = ph.makePhoto({ id, caption: String(caption ?? '') }, prev);
  await autobases.putInline(lib.sess, ph.itemPath(id), rec);
  return rec;
}

export async function deletePhoto(ctx, id) {
  const { lib } = await albumOf(ctx);
  if (!lib || !ph.isPhotoId(id)) return false;
  const prev = await autobases.readJson(lib.sess, ph.itemPath(id));
  if (!ph.isPhoto(prev)) return false;
  if (!ph.canDelete(prev, { memberId: lib.memberId || null, role: lib.role, writable: !!lib.sess.writable })) {
    throw new Error('Only the person who added a photo, or the Space’s owner, can remove it');
  }
  for (const p of [ph.itemPath(id), ph.filePath(id), ph.thumbPath(id)]) await lib.sess.base.append({ op: 'del', path: p });
  await lib.sess.base.update();
  return true;
}
