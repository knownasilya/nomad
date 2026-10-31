// nomad/shared/space-library.mjs
//
// Shared Spaces (ADR-0029): a Space's library in its own Autobase, the Space Library, shared with
// other people. The paths, record builders and role rules both apps use. Pure: no I/O.
//
// A Space Library is an Autobase with the Drive reducer (shared/fs-core.mjs). Its records are inline
// JSON at these paths:
//
//   /index.json                                  { type: 'nomad/space', name, icon, color, createdAt }
//   /drives.json                                 { drives: [...] }, the Space's Drive Registry
//   /bookmarks/<slug>.json                       a bookmark { href, title }
//   /reader/follows/<name>.json                  a Reader feed (shared/vault-apps.mjs followRecord, followName)
//   /notes/<id>.json                             a Note (shared/vault-apps.mjs)
//   /names/<name>.json                           a Name (shared/names.mjs)
//   /.space/members/<memberId>.json              a Member
//   /.space/writers/<driveKey>/<writerKey>.json  a Space Writer grant
//
// A member's own Vault record for the Space (/.vault/spaces/<rootDriveKey>.json) gains `library`
// (the Space Library key), `role` and `memberId`. Read marks stay in each person's Vault.

import { followName } from './vault-apps.mjs';

export const SPACE_TYPE = 'nomad/space';
export const MEMBER_TYPE = 'nomad/space-member';
export const SPACE_WRITER_TYPE = 'nomad/space-writer';

export const ROLES = ['owner', 'editor', 'viewer'];
export const ROLE_LABELS = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

export const LIB_INDEX = '/index.json';
export const LIB_DRIVES = '/drives.json';
export const LIB_BOOKMARKS = '/bookmarks/';
export const LIB_FOLLOWS = '/reader/follows/';
export const LIB_NOTES = '/notes/';
export const LIB_NAMES = '/names/';
export const MEMBERS_PREFIX = '/.space/members/';
export const WRITERS_PREFIX = '/.space/writers/';

const KEY = /^[0-9a-f]{64}$/;
const MEMBER_ID = /^[0-9a-f]{32}$/;

export function isKey(s) {
  return typeof s === 'string' && KEY.test(s);
}

export function isRole(role) {
  return ROLES.includes(role);
}

// Owners and editors write the Space Library; viewers only read it.
export function canEdit(role) {
  return role === 'owner' || role === 'editor';
}

// Only owners invite, change roles and remove members (an app rule, ADR-0029 §3).
export function canManage(role) {
  return role === 'owner';
}

// A shared Space's Vault record: it names its Space Library.
export function isShared(spaceRecord) {
  return !!spaceRecord && isKey(spaceRecord.library);
}

// Members
// =

// A member id: random, made when someone joins. Never the person's Vault key, which stays secret.
export function newMemberId(rand = randomHex) {
  return rand(16);
}

export function isMemberId(id) {
  return typeof id === 'string' && MEMBER_ID.test(id);
}

export function memberPath(memberId) {
  if (!isMemberId(memberId)) throw new Error('Not a member id: ' + memberId);
  return MEMBERS_PREFIX + memberId + '.json';
}

export function makeMember({ memberId, name, role, profileUrl, addedBy }, prev = null, now = new Date().toISOString()) {
  memberPath(memberId); // validates
  if (!isRole(role)) throw new Error('Not a role: ' + role);
  return {
    type: MEMBER_TYPE,
    memberId,
    name: String(name || (prev && prev.name) || 'Someone').slice(0, 100),
    role,
    ...(profileUrl || prev?.profileUrl ? { profileUrl: String(profileUrl || prev.profileUrl).slice(0, 200) } : {}),
    addedBy: (prev && prev.addedBy) || addedBy || null,
    addedAt: (prev && prev.addedAt) || now,
    updatedAt: now,
  };
}

export function isMember(rec) {
  return !!rec && rec.type === MEMBER_TYPE && isMemberId(rec.memberId) && isRole(rec.role);
}

// Members, owners first, then by name.
export function sortMembers(members) {
  const rank = { owner: 0, editor: 1, viewer: 2 };
  return (members || [])
    .filter(isMember)
    .slice()
    .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
}

// Whether `memberId` may change `target` to `role`, or remove them (`role` null). An owner can't
// demote or remove the last owner, themselves included.
export function roleChangeError(members, { by, target, role = null }) {
  const list = (members || []).filter(isMember);
  const actor = list.find((m) => m.memberId === by);
  if (!actor || !canManage(actor.role)) return 'Only an owner can do that';
  const t = list.find((m) => m.memberId === target);
  if (!t) return 'That person isn’t in this Space';
  if (role !== null && !isRole(role)) return 'Not a role';
  const owners = list.filter((m) => m.role === 'owner');
  if (t.role === 'owner' && role !== 'owner' && owners.length === 1) return 'A Space needs an owner. Make someone else an owner first';
  return null;
}

// Whether `memberId` may leave: anyone but the last owner.
export function leaveError(members, memberId) {
  const list = (members || []).filter(isMember);
  const me = list.find((m) => m.memberId === memberId);
  if (me?.role === 'owner' && list.filter((m) => m.role === 'owner').length === 1 && list.length > 1) {
    return 'Make someone else an owner before you leave';
  }
  return null;
}

// Space Writer grants (ADR-0029 §6, §7)
// =
//
// `kind` is 'editor' for one an editor's Device asks for (granted with no prompt while the member
// can edit) or 'request' for a viewer's ask for one Drive (granted only when someone approves).

export function writerGrantPath(drive, writerKey) {
  if (!isKey(drive)) throw new Error('Not a drive key: ' + drive);
  if (!isKey(writerKey)) throw new Error('Not a writer key: ' + writerKey);
  return WRITERS_PREFIX + drive + '/' + writerKey + '.json';
}

export function makeSpaceWriter({ drive, writerKey, memberId, device, kind = 'editor', note }, now = new Date().toISOString()) {
  writerGrantPath(drive, writerKey); // validates
  if (!isMemberId(memberId)) throw new Error('Not a member id: ' + memberId);
  if (kind !== 'editor' && kind !== 'request') throw new Error('Not a grant kind: ' + kind);
  return {
    type: SPACE_WRITER_TYPE,
    drive,
    writerKey,
    memberId,
    device: isKey(device) ? device : null,
    kind,
    ...(note ? { note: String(note).slice(0, 300) } : {}),
    requestedAt: now,
  };
}

export function isSpaceWriter(rec) {
  return !!rec && rec.type === SPACE_WRITER_TYPE && isKey(rec.drive) && isKey(rec.writerKey) && isMemberId(rec.memberId);
}

export function markWriterGranted(rec, by, now = new Date().toISOString()) {
  return { ...rec, grantedBy: by, grantedAt: now };
}

// The grants a Device makes with no prompt: an editor's, not granted yet, for a Drive this Device
// writes (`canWrite`), from a member who can still edit.
export function writersToGrant(records, members, canWrite = () => false) {
  const role = roleMap(members);
  return (records || []).filter(
    (r) => isSpaceWriter(r) && !r.grantedBy && r.kind === 'editor' && canEdit(role.get(r.memberId)) && canWrite(r.drive)
  );
}

// The viewers' asks waiting for someone who writes the Drive to approve or deny.
export function pendingRequests(records, members) {
  const role = roleMap(members);
  return (records || []).filter((r) => isSpaceWriter(r) && !r.grantedBy && r.kind === 'request' && role.has(r.memberId));
}

// The grants to take off a Drive this Device writes: a member who left or was removed, or an
// editor's grant once they can only view. A viewer's approved ask stays while they are a member.
export function writersToRevoke(records, members, canWrite = () => false) {
  const role = roleMap(members);
  return (records || []).filter((r) => {
    if (!isSpaceWriter(r) || !canWrite(r.drive)) return false;
    if (!role.has(r.memberId)) return true;
    return r.kind === 'editor' && !canEdit(role.get(r.memberId));
  });
}

// The grant record a member's Device has for `drive`, if it asked: { pending, granted, kind } or null.
export function writerState(records, { drive, writerKey }) {
  const rec = (records || []).find((r) => isSpaceWriter(r) && r.drive === drive && r.writerKey === writerKey);
  if (!rec) return null;
  return { pending: !rec.grantedBy, granted: !!rec.grantedBy, kind: rec.kind, requestedAt: rec.requestedAt };
}

function roleMap(members) {
  return new Map((members || []).filter(isMember).map((m) => [m.memberId, m.role]));
}

// Sharing a Space (ADR-0029 §2)
// =

// The records a Space Library starts with when its owner shares it: its index, the owner's member
// record, and the Space's library moved in. `items` holds what the Space has today:
// { drives, bookmarks: [{ name, value }], follows: [rec], notes: [rec], names: [rec] }.
// Returns [{ path, value }]; /drives.json is the one record that isn't from a list.
export function planShare({ space, owner, items = {} }, now = new Date().toISOString()) {
  const out = [
    { path: LIB_INDEX, value: makeSpaceIndex(space, now) },
    { path: memberPath(owner.memberId), value: makeMember({ ...owner, role: 'owner', addedBy: owner.memberId }, null, now) },
    { path: LIB_DRIVES, value: { drives: Array.isArray(items.drives) ? items.drives : [] } },
  ];
  for (const b of items.bookmarks || []) {
    if (b && typeof b.name === 'string' && /^[^/]+$/.test(b.name) && b.value?.href) out.push({ path: LIB_BOOKMARKS + b.name, value: b.value });
  }
  for (const f of items.follows || []) {
    const host = followHost(f?.url);
    if (host) out.push({ path: LIB_FOLLOWS + host + '.json', value: f });
  }
  for (const n of items.notes || []) {
    if (n && typeof n.id === 'string' && /^[a-z0-9-]+$/.test(n.id)) out.push({ path: LIB_NOTES + n.id + '.json', value: n });
  }
  for (const n of items.names || []) {
    if (n && typeof n.name === 'string' && /^[a-z0-9-]+$/.test(n.name)) out.push({ path: LIB_NAMES + n.name + '.json', value: n });
  }
  return out;
}

// What the share dialog says will be shared, e.g. "4 drives, 1 contact, 12 notes".
export function shareSummary(items = {}) {
  const drives = (items.drives || []).filter((d) => d && d.key);
  const contacts = drives.filter((d) => Array.isArray(d.tags) && d.tags.includes('contact')).length;
  const parts = [
    [drives.length - contacts, 'drive'],
    [contacts, 'contact'],
    [(items.bookmarks || []).length, 'bookmark'],
    [(items.follows || []).length, 'feed'],
    [(items.notes || []).length, 'note'],
    [(items.names || []).length, 'name'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Nothing yet';
}

export function makeSpaceIndex(space = {}, now = new Date().toISOString()) {
  return {
    type: SPACE_TYPE,
    name: String(space.name || 'Space').slice(0, 100),
    icon: String(space.icon || 'circle').slice(0, 40),
    color: String(space.color || '#6c6cff').slice(0, 20),
    createdAt: space.createdAt || now,
  };
}

export function isSpaceIndex(rec) {
  return !!rec && rec.type === SPACE_TYPE && typeof rec.name === 'string';
}

// The name a follow record is filed under (the same file name as /.vault/reader/<space>/follows/):
// a drive's host, or web-<hash> for an RSS or Atom feed. Null for a record that isn't a feed.
export function followHost(url) {
  try {
    return followName(url);
  } catch {
    return null;
  }
}

// Invites (ADR-0029 §4)
// =
//
// The candidate sends this as blind-pairing userData. `writerKey` is the key it minted for the
// Space Library in a namespace it keeps for that Library.

export function makeJoinRequest({ memberId, name, writerKey, profileUrl }) {
  if (!isMemberId(memberId)) throw new Error('Not a member id: ' + memberId);
  if (!isKey(writerKey)) throw new Error('Not a writer key: ' + writerKey);
  return {
    memberId,
    name: String(name || 'Someone').slice(0, 100),
    writerKey,
    ...(profileUrl ? { profileUrl: String(profileUrl).slice(0, 200) } : {}),
  };
}

export function parseJoinRequest(data) {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (!obj || !isMemberId(obj.memberId) || !isKey(obj.writerKey)) return null;
    return makeJoinRequest(obj);
  } catch {
    return null;
  }
}

function randomHex(bytes) {
  const c = globalThis.crypto;
  const buf = new Uint8Array(bytes);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
