// The family album (ADR-0043): photos the people of a shared Space add from their phones and
// computers. Desktop (app/bg/web-apis/bg/photos.ts) and the phone (mobile/backend/lib/photos.mjs)
// use these rules.
//
// A photo lives in its Space's Library (ADR-0029), the Autobase every member already replicates and
// every editor already writes: one small record (`/photos/items/<id>.json`) and two files, the photo
// scaled to MAX_SIDE (`/photos/files/<id>.jpg`) and a thumbnail (`/photos/thumbs/<id>.jpg`). The files
// are blobs in the adding writer's own blob core, so the oplog carries only pointers. There is no
// album for a Space that isn't shared: the album is for a household, and a person's own photos are
// on their own phone already.
//
// No Electron imports, and nothing touched as the module loads that Bare lacks.

export const PHOTO_TYPE = 'nomad/photo';
export const LIB_PHOTOS = '/photos/';
export const ITEMS = LIB_PHOTOS + 'items/';
export const FILES = LIB_PHOTOS + 'files/';
export const THUMBS = LIB_PHOTOS + 'thumbs/';

// The photo is scaled so its long side is at most MAX_SIDE, the thumbnail to THUMB_SIDE, both JPEG.
export const MAX_SIDE = 2560;
export const THUMB_SIDE = 480;
export const QUALITY = 0.85;
export const THUMB_QUALITY = 0.75;
// What a stored file may weigh, scaled: a refused write, never a cut photo.
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_THUMB_BYTES = 400 * 1024;
export const MAX_CAPTION = 500;
// One add at a time from a picker.
export const MAX_BATCH = 30;

const ID_RE = /^p[a-z0-9]{6,14}-[a-z0-9]{4,10}$/;
export function isPhotoId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function randomPart(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function newPhotoId(now = Date.now(), rand = randomPart) {
  return 'p' + Math.floor(now).toString(36) + '-' + rand(6);
}

function check(id) {
  if (!isPhotoId(id)) throw new Error('Not a photo id: ' + id);
  return id;
}
export const itemPath = (id) => ITEMS + check(id) + '.json';
export const filePath = (id) => FILES + check(id) + '.jpg';
export const thumbPath = (id) => THUMBS + check(id) + '.jpg';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
function isoOrNull(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// EXIF's DateTimeOriginal ('2026:11:05 14:03:22', no zone) as an ISO time, read as this Device's
// local time, or null.
export function exifTime(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(d.getTime()) && +m[1] > 1990 ? d.toISOString() : null;
}

const posInt = (n, max = 100000) => {
  const v = Math.floor(Number(n));
  return v > 0 && v <= max ? v : 0;
};

/**
 * A photo's record. `by` and `memberId` say who added it; an edit (a caption) keeps them.
 * @param {{ id: string, by?: string, memberId?: string | null, takenAt?: string | null, width?: number, height?: number, bytes?: number, caption?: string }} f
 */
export function makePhoto(f, prev = null, now = new Date().toISOString()) {
  const id = check(String(f.id || ''));
  const caption = String(f.caption ?? prev?.caption ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION);
  const rec = {
    type: PHOTO_TYPE,
    id,
    addedAt: prev?.addedAt || now,
    takenAt: isoOrNull(prev ? prev.takenAt : f.takenAt) || prev?.addedAt || now,
    width: posInt(prev ? prev.width : f.width),
    height: posInt(prev ? prev.height : f.height),
    bytes: posInt(prev ? prev.bytes : f.bytes, MAX_BYTES),
    by: String(prev ? prev.by || '' : f.by || '').slice(0, 100),
    memberId: (prev ? prev.memberId : f.memberId) || null,
    updatedAt: now,
  };
  if (caption) rec.caption = caption;
  return rec;
}

export function isPhoto(rec) {
  return !!rec && rec.type === PHOTO_TYPE && isPhotoId(rec.id) && typeof rec.takenAt === 'string';
}

// The sizes of the stored files, refused before anything is written.
export function sizeError({ bytes, thumbBytes }) {
  if (!(bytes > 0)) return 'That photo is empty';
  if (bytes > MAX_BYTES) return `That photo is too big (${Math.round(bytes / 1048576)} MB, at most ${MAX_BYTES / 1048576} MB)`;
  if (!(thumbBytes > 0) || thumbBytes > MAX_THUMB_BYTES) return 'That photo’s thumbnail didn’t come out';
  return '';
}

// Newest taken first, then newest added.
export function sortPhotos(list) {
  return [...list].sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '') || (b.addedAt || '').localeCompare(a.addedAt || ''));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The album by month of taking, newest first: [{ month: 'YYYY-MM', label: 'November 2026', photos }].
// `local` turns an ISO time into this Device's 'YYYY-MM' (passed in for tests).
export function byMonth(list, local = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}) {
  const groups = new Map();
  for (const p of sortPhotos(list)) {
    const m = local(p.takenAt);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(p);
  }
  return [...groups].map(([month, photos]) => ({ month, label: `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`, photos }));
}

// Who may remove a photo: the person who added it, or whoever manages the Space.
export function canDelete(photo, { memberId = null, role = null, writable = false } = {}) {
  if (!writable) return false;
  if (role === 'owner') return true;
  return !!memberId && photo?.memberId === memberId;
}
