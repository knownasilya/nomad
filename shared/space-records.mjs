// A Space's own Vault record (/.vault/spaces/<rootDriveKey>.json): the rules for renaming,
// recoloring and deleting a Space, shared by desktop (app/bg/hyper/vault.js) and the phone
// (mobile/backend/lib/vault.mjs, mobile/lib/spacesMerge.ts).
//
// Deleting a Space, or leaving a shared one, leaves a tombstone in its place:
//   { rootDriveKey, deleted: true, deletedAt }
// The user's other Devices drop their copy when they see it, and none of them publishes the Space
// into the Vault again (a plain delete would let a Device that still has it bring it back). A
// tombstone has no name, color or library, so readers that only want live Spaces skip it with
// `isLiveSpace`.
//
// Runs on the phone's Bare worklet too: no globals touched as it loads.

export const SPACE_NAME_MAX = 60;

// The palette both apps offer (desktop's Spaces menu, the phone's Space switcher).
export const SPACE_COLORS = ['#6c6cff', '#e85d4a', '#e8a025', '#3ab36e', '#2b9fd4', '#9b59b6', '#e91e8c', '#607d8b'];

const COLOR_RE = /^#[0-9a-f]{6}$/i;

// A name the user typed, tidied: trimmed, inner runs of space made one, at most SPACE_NAME_MAX
// characters. '' when nothing is left.
export function cleanSpaceName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPACE_NAME_MAX)
    .trim();
}

// Why `{ name?, color? }` can't be saved on a Space, or null. Only the fields given are checked.
export function spaceEditError({ name, color } = {}) {
  if (name !== undefined && !cleanSpaceName(name)) return 'Give the Space a name';
  if (color !== undefined && !COLOR_RE.test(String(color))) return 'Pick one of the colors';
  return null;
}

// `rec` with the edit applied (name cleaned). The fields not given stay as they were.
export function editSpaceRecord(rec, { name, color } = {}) {
  const next = { ...rec };
  if (name !== undefined) next.name = cleanSpaceName(name);
  if (color !== undefined) next.color = String(color).toLowerCase();
  return next;
}

export function deletedSpace(rootDriveKey, now = new Date()) {
  return { rootDriveKey, deleted: true, deletedAt: now.toISOString() };
}

export function isDeletedSpace(rec) {
  return !!rec && rec.deleted === true;
}

// A record that stands for a Space the user has: not a move pointer, not a tombstone.
export function isLiveSpace(rec) {
  return !!rec && typeof rec.rootDriveKey === 'string' && !rec.movedTo && !isDeletedSpace(rec);
}

// What deleting does to a Space with Vault record `rec` (null when the Vault doesn't list it):
// 'leave' for a shared Space (ADR-0029: the user leaves it; the others keep it), else 'delete'.
// `personal` is the user's Personal Space, which neither happens to.
export function removeKind(rec, { personal = false } = {}) {
  if (personal) return null;
  return rec && typeof rec.library === 'string' && rec.library ? 'leave' : 'delete';
}
