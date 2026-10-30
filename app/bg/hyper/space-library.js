// @ts-nocheck
//
// Shared Spaces on desktop (ADR-0029). A shared Space keeps its library (Drive Registry, bookmarks,
// Reader feeds, Notes, Names) in its own Autobase, the Space Library, which its members replicate.
// The Space's Root Drive (`hyper://private/`) and the Vault are never shared.
//
// This module opens Space Libraries, reads and writes their records, shares a Space (moving its
// library in), runs invites and joins over blind-pairing (as device-pairing.js does for the Vault),
// keeps members and roles, grants members' writer keys on the Space's Drives (Space Writer grants),
// and carries viewers' asks for one Drive over the `nomad/space-control` channel.
// Paths, records and role rules: shared/space-library.mjs.

import Autobase from 'autobase';
import BlindPairing from 'blind-pairing';
import Protomux from 'protomux';
import c from 'compact-encoding';
import z32 from 'z32';
import b4a from 'b4a';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as logLib from '../logger';
import * as daemon from './daemon';
import * as autobases from './autobases';
import * as vault from './vault';
import * as pairing from './device-pairing';
import * as settingsDb from '../dbs/settings';
import * as sl from '../../../shared/space-library.mjs';
import * as apps from '../../../shared/vault-apps.mjs';
import { namesPrefix } from '../../../shared/names.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'space-library' });

// 'changed' { space }: a Space Library's records changed (here or replicated in).
// 'join-request' { space, memberId, name, role }: someone asks to join; 'join-resolved' too.
// 'removed' { space }: this person was removed from a Space.
export const events = new EventEmitter();

// The namespace this Device minted a Space Library's writer key in, before it knew the Library's key
// (a join by invite). Device-local: the user's other Devices open the Library the usual way.
const NS_SETTING = (key) => `space_library_ns:${key}`;
// Invites this Device minted: [{ library, publicKey, role, createdAt }]. Public keys, not secret.
const INVITES_SETTING = 'space_invites';

const hex = (buf) => (buf ? b4a.toString(buf, 'hex') : null);

// Space records
// =

async function spaceRecord(space) {
  if (!sl.isKey(space)) return null;
  return (await vault.listSpaces()).find((s) => s.rootDriveKey === space && !s.movedTo) || null;
}

// { shared, library, role, memberId, removed } for the Space with Root Drive key `space`.
export async function info(space) {
  const rec = await spaceRecord(space);
  if (!sl.isShared(rec)) return { shared: false, library: null, role: null, memberId: null };
  return {
    shared: true,
    library: rec.library,
    role: rec.role || 'viewer',
    memberId: rec.memberId || null,
    // `confirmed`: this Device has seen the member record, so its absence later means a removal.
    confirmed: !!rec.confirmed,
    removed: !!rec.removed,
  };
}

// Opening
// =

const _watched = new Set();

export async function open(libraryKey) {
  const ns = await settingsDb.get(NS_SETTING(libraryKey)).catch(() => null);
  const sess = await autobases.getOrLoadCollaborativeDrive(libraryKey, ns ? { ns } : {});
  if (sess && !_watched.has(libraryKey)) {
    _watched.add(libraryKey);
    _attach(libraryKey, sess);
  }
  return sess;
}

// The open Space Library of a shared Space, with this person's role in it, or null.
export async function forSpace(space) {
  const i = await info(space);
  if (!i.shared) return null;
  const sess = await open(i.library);
  return sess ? { ...i, space, sess, writable: !!sess.writable } : null;
}

// Record I/O on a session
// =

async function listIn(sess, prefix) {
  const out = [];
  for (const { path, record } of await autobases.listRecords(sess, prefix)) {
    try {
      const buf = await autobases.resolveRecordContent(record);
      if (buf) out.push({ path, value: JSON.parse(b4a.toString(buf)) });
    } catch {}
  }
  return out;
}

async function putIn(sess, path, obj) {
  if (!sess.writable) throw new Error('You can view this Space, but not change it');
  await autobases.putInline(sess, path, JSON.stringify(obj));
}

async function delIn(sess, path) {
  if (!sess.writable) throw new Error('You can view this Space, but not change it');
  await autobases.deletePath(sess, path);
}

// A Space's own records of one kind, wherever they are: its Space Library when shared, else the
// Vault (ADR-0029 §1). `kind` is 'notes', 'names' or 'follows'; each record is a file `<name>`
// (`<id>.json`, `<word>.json`, `<host>.json`) under one prefix.
const LIB_PREFIX = { notes: sl.LIB_NOTES, names: sl.LIB_NAMES, follows: sl.LIB_FOLLOWS };
const VAULT_PREFIX = { notes: apps.notesPrefix, names: namesPrefix, follows: apps.followsPrefix };

export async function records(space, kind) {
  const lib = await forSpace(space);
  if (lib) {
    const prefix = LIB_PREFIX[kind];
    return {
      shared: true,
      role: lib.role,
      writable: lib.writable,
      list: async () => (await listIn(lib.sess, prefix)).map((r) => r.value),
      get: (name) => autobases.readJson(lib.sess, prefix + name),
      put: (name, obj) => putIn(lib.sess, prefix + name, obj),
      del: (name) => delIn(lib.sess, prefix + name),
    };
  }
  const prefix = VAULT_PREFIX[kind](space);
  return {
    shared: false,
    role: null,
    writable: true,
    list: () => vault.listAppRecords(prefix),
    get: (name) => vault.readAppRecord(prefix + name),
    put: (name, obj) => vault.putAppRecord(prefix + name, obj),
    del: (name) => vault.delAppRecord(prefix + name),
  };
}

// Sharing a Space (ADR-0029 §2)
// =

// What sharing the Space would move into its Space Library. `root` is its Root Drive session.
export async function collect(space, root) {
  const drives = (await autobases.readJson(root, sl.LIB_DRIVES))?.drives || [];
  const bookmarks = [];
  for (const { path, value } of await listIn(root, sl.LIB_BOOKMARKS)) {
    if (value?.href) bookmarks.push({ name: path.slice(sl.LIB_BOOKMARKS.length), value });
  }
  return {
    drives: Array.isArray(drives) ? drives : [],
    bookmarks,
    follows: await vault.listAppRecords(apps.followsPrefix(space)),
    notes: (await vault.listAppRecords(apps.notesPrefix(space))).filter(apps.isNote),
    names: await vault.listAppRecords(namesPrefix(space)),
  };
}

export async function preview(space, root) {
  const items = await collect(space, root);
  return { summary: sl.shareSummary(items), drives: items.drives.length, notes: items.notes.length };
}

// Share the Space: make its Space Library, move its library in, and point the Space's Vault record
// at it. One copy: the moved records are deleted from the Root Drive and the Vault. `space` is the
// Root Drive key, `root` its session, `meta` its { name, icon, color }, `name` the owner's name.
export async function share({ space, root, meta, name }) {
  const rec = await spaceRecord(space);
  if (!rec) throw new Error('Link this Space to your Vault first. It’s added when the Space is first opened');
  if (sl.isShared(rec)) throw new Error('This Space is already shared');
  const sess = await vault.getVault();
  if (!sess?.writable) throw new Error('This device can’t write to your Vault yet');
  if (!root?.writable) throw new Error('This device can’t change this Space yet');

  const items = await collect(space, root);
  const owner = { memberId: sl.newMemberId(), name: name || 'Owner' };
  const lib = await autobases.createCollaborativeDrive({});
  for (const { path, value } of sl.planShare({ space: meta, owner, items })) {
    await autobases.putInline(lib, path, JSON.stringify(value));
  }
  await vault.putSpaceShare(space, { library: lib.keyStr, role: 'owner', memberId: owner.memberId });

  // The moved records leave the Root Drive and the Vault.
  await autobases.putInline(root, sl.LIB_DRIVES, JSON.stringify({ drives: [] }));
  for (const b of items.bookmarks) await autobases.deletePath(root, sl.LIB_BOOKMARKS + b.name);
  for (const prefix of [apps.followsPrefix(space), apps.notesPrefix(space), namesPrefix(space)]) {
    for (const r of await vault.listAppRecordPaths(prefix)) await vault.delAppRecord(r);
  }
  _watched.add(lib.keyStr);
  _attach(lib.keyStr, lib);
  logger.info('Shared a space', { space, library: lib.keyStr, summary: sl.shareSummary(items) });
  events.emit('changed', { space });
  return info(space);
}

// Members and roles (ADR-0029 §3, §8)
// =

export async function members(space) {
  const lib = await forSpace(space);
  if (!lib) return [];
  return sl.sortMembers((await listIn(lib.sess, sl.MEMBERS_PREFIX)).map((r) => r.value));
}

// Everything the share dialog shows.
export async function status(space) {
  const lib = await forSpace(space);
  if (!lib) return { shared: false };
  const list = await members(space);
  const grants = (await listIn(lib.sess, sl.WRITERS_PREFIX)).map((r) => r.value);
  const requests = [];
  for (const r of sl.pendingRequests(grants, list)) {
    const drive = autobases.getCollaborativeDrive(r.drive);
    requests.push({
      ...r,
      name: list.find((m) => m.memberId === r.memberId)?.name || 'Someone',
      title: drive ? (await autobases.readJson(drive, '/index.json').catch(() => null))?.title || null : null,
      canApprove: !!drive?.writable,
    });
  }
  return {
    shared: true,
    library: lib.library,
    role: lib.role,
    memberId: lib.memberId,
    removed: lib.removed,
    writable: lib.writable,
    members: list,
    joins: canManageHere(lib) ? listJoinRequests(lib.library) : [],
    requests,
  };
}

const canManageHere = (lib) => sl.canManage(lib.role) && lib.writable;

async function _manage(space) {
  const lib = await forSpace(space);
  if (!lib) throw new Error('This Space isn’t shared');
  if (!canManageHere(lib)) throw new Error('Only an owner can do that');
  return lib;
}

export async function setRole(space, memberId, role) {
  const lib = await _manage(space);
  const list = await members(space);
  const err = sl.roleChangeError(list, { by: lib.memberId, target: memberId, role });
  if (err) throw new Error(err);
  const prev = list.find((m) => m.memberId === memberId);
  if (prev.role === role) return prev;
  const next = { ...sl.makeMember({ ...prev, role }, prev), writers: prev.writers || [] };
  for (const key of next.writers) {
    if (!sl.isKey(key)) continue;
    await lib.sess.base.append(sl.canEdit(role) ? { addWriter: key } : { removeWriter: key });
  }
  await lib.sess.base.update();
  await putIn(lib.sess, sl.memberPath(memberId), next);
  logger.info('Changed a member’s role', { space, memberId, role });
  sync(lib.library).catch(() => {});
  return next;
}

export async function removeMember(space, memberId) {
  const lib = await _manage(space);
  const list = await members(space);
  const err = sl.roleChangeError(list, { by: lib.memberId, target: memberId, role: null });
  if (err) throw new Error(err);
  if (memberId === lib.memberId) throw new Error('To leave, use Leave this Space');
  const prev = list.find((m) => m.memberId === memberId);
  if (sl.canEdit(prev.role)) {
    for (const key of prev.writers || []) if (sl.isKey(key)) await lib.sess.base.append({ removeWriter: key });
    await lib.sess.base.update();
  }
  await delIn(lib.sess, sl.memberPath(memberId));
  logger.info('Removed a member', { space, memberId });
  sync(lib.library).catch(() => {});
}

// Leave a Space: drop this person's member record (when they can write the Library) and the
// Space's link to it. The caller removes the Space itself.
export async function leave(space) {
  const lib = await forSpace(space);
  if (!lib) return;
  const list = await members(space);
  const err = sl.leaveError(list, lib.memberId);
  if (err) throw new Error(err);
  if (lib.writable && lib.memberId && list.some((m) => m.memberId === lib.memberId)) {
    await delIn(lib.sess, sl.memberPath(lib.memberId));
  }
  autobases.unloadCollaborativeDrive(lib.library);
  _watched.delete(lib.library);
  logger.info('Left a space', { space });
}

// Invites and joining (ADR-0029 §4)
// =

let _invites = null;

async function _loadInvites() {
  if (_invites) return _invites;
  try {
    _invites = JSON.parse((await settingsDb.get(INVITES_SETTING)) || '[]');
  } catch {
    _invites = [];
  }
  return _invites;
}

async function _saveInvites() {
  await settingsDb.set(INVITES_SETTING, JSON.stringify(_invites || [])).catch(() => {});
}

// A single-use code for someone to join the Space with `role`. Only an owner invites.
export async function createInvite(space, role) {
  if (role !== 'editor' && role !== 'viewer') throw new Error('Pick Can edit or Can view');
  const lib = await _manage(space);
  const { invite, publicKey } = BlindPairing.createInvite(lib.sess.base.key);
  const invites = await _loadInvites();
  invites.push({ library: lib.library, publicKey: hex(publicKey), role, createdAt: new Date().toISOString() });
  await _saveInvites();
  _listen(lib.library, lib.sess);
  logger.info('Made a space invite', { space, role });
  return { code: z32.encode(invite), role };
}

// library key -> blind-pairing member; library key -> Map(memberId -> pending join)
const _members = new Map();
const _joins = new Map();

// Listen for people joining a Space Library this Device manages. One blind-pairing instance, shared
// with Device pairing (ADR-0029 spike S2), with one member per Library discovery key.
function _listen(library, sess) {
  if (_members.has(library)) return;
  const bp = pairing.instance();
  _members.set(
    library,
    bp.addMember({
      discoveryKey: sess.base.discoveryKey,
      onadd: (candidate) =>
        new Promise((resolve) => {
          _onCandidate(library, candidate, resolve).catch((e) => {
            logger.warn('Could not read a join request', { error: e.toString() });
            resolve();
          });
        }),
    })
  );
}

async function _onCandidate(library, candidate, resolve) {
  const invites = (await _loadInvites()).filter((i) => i.library === library);
  const invite = invites.find((i) => {
    try {
      candidate.open(b4a.from(i.publicKey, 'hex'));
      return true;
    } catch {
      return false;
    }
  });
  if (!invite) return resolve();
  const req = sl.parseJoinRequest(b4a.toString(candidate.userData));
  if (!req) return resolve();
  const sess = await open(library);
  const existing = await autobases.readJson(sess, sl.memberPath(req.memberId));
  if (existing) {
    // Already approved; the candidate asked again. Answer without asking the owner twice.
    try {
      candidate.confirm({ key: sess.base.key, encryptionKey: sess.base.encryptionKey });
    } catch {}
    return resolve();
  }
  if (!_joins.has(library)) _joins.set(library, new Map());
  _joins.get(library).set(req.memberId, { ...req, role: invite.role, invite: invite.publicKey, candidate, resolve, requestedAt: new Date().toISOString() });
  const space = await _spaceOfLibrary(library);
  logger.info('Someone asks to join a space', { space, role: invite.role });
  events.emit('join-request', { space, memberId: req.memberId, name: req.name, role: invite.role });
}

function listJoinRequests(library) {
  return [...(_joins.get(library)?.values() || [])].map(({ memberId, name, role, requestedAt }) => ({ memberId, name, role, requestedAt }));
}

// Approve a join: the member record (with the writer key they sent), addWriter when the role can
// edit, then confirm, which hands them the Library's key. The invite is used up.
export async function approveJoin(space, memberId) {
  const lib = await _manage(space);
  const req = _joins.get(lib.library)?.get(memberId);
  if (!req) throw new Error('That request is gone. Ask them to enter the code again');
  const rec = { ...sl.makeMember({ memberId, name: req.name, role: req.role, profileUrl: req.profileUrl, addedBy: lib.memberId }), writers: [req.writerKey] };
  await putIn(lib.sess, sl.memberPath(memberId), rec);
  if (sl.canEdit(req.role)) {
    await lib.sess.base.append({ addWriter: req.writerKey });
    await lib.sess.base.update();
  }
  try {
    req.candidate.confirm({ key: lib.sess.base.key, encryptionKey: lib.sess.base.encryptionKey });
  } finally {
    req.resolve();
    _joins.get(lib.library).delete(memberId);
  }
  _invites = (await _loadInvites()).filter((i) => i.publicKey !== req.invite);
  await _saveInvites();
  logger.info('Approved a member', { space, memberId, role: req.role });
  events.emit('join-resolved', { space, memberId, approved: true });
  return rec;
}

export async function denyJoin(space, memberId) {
  const lib = await _manage(space);
  const req = _joins.get(lib.library)?.get(memberId);
  if (!req) return;
  req.resolve();
  _joins.get(lib.library).delete(memberId);
  events.emit('join-resolved', { space, memberId, approved: false });
}

// Join with a code. Mints this Device's writer key for the Library in a fresh namespace first (its
// key isn't known yet), asks, and once an owner approves, opens the Library there and waits for its
// index. Returns { library, memberId, index }; the caller makes the Space (filesystem joinSpace).
export async function join(code, { name, profileUrl } = {}) {
  let invite;
  try {
    invite = z32.decode(String(code || '').trim());
  } catch {
    throw new Error('That code isn’t right. Check it and try again');
  }
  const ns = randomBytes(32).toString('hex');
  const store = daemon.getCorestore();
  const core = Autobase.getLocalCore(store.namespace(ns));
  await core.ready();
  const writerKey = hex(core.key);
  await core.close();
  const memberId = sl.newMemberId();
  const userData = b4a.from(JSON.stringify(sl.makeJoinRequest({ memberId, name, writerKey, profileUrl })));

  const library = await new Promise((resolve, reject) => {
    try {
      const candidate = pairing.instance().addCandidate({
        invite,
        userData,
        onadd: (result) => resolve(hex(result.key)),
      });
      candidate.pairing.catch(reject);
    } catch (e) {
      reject(e);
    }
  });
  await settingsDb.set(NS_SETTING(library), ns);
  const sess = await open(library);
  const index = await _waitFor(() => autobases.readJson(sess, sl.LIB_INDEX), 30000);
  logger.info('Joined a shared space', { library, writable: sess.writable });
  return { library, memberId, index: sl.isSpaceIndex(index) ? index : sl.makeSpaceIndex({}) };
}

async function _waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Writing the Space's Drives (ADR-0029 §6, §7)
// =

// The shared Space a Drive belongs to, as this Device knows it: { space, lib } or null.
export async function spaceOfDrive(driveKey) {
  for (const s of await vault.listSpaces()) {
    if (!sl.isShared(s) || s.movedTo) continue;
    const lib = await forSpace(s.rootDriveKey).catch(() => null);
    if (!lib) continue;
    const list = (await autobases.readJson(lib.sess, sl.LIB_DRIVES))?.drives || [];
    if (list.some((d) => d && d.key === driveKey)) return { space: s.rootDriveKey, lib };
  }
  return null;
}

// What this person can do about editing `driveKey`, a Drive of a shared Space: null when it isn't
// one, else { space, name, role, ask: 'editor' | 'request', state }.
export async function driveStatus(driveKey, writerKey) {
  const found = await spaceOfDrive(driveKey);
  if (!found) return null;
  const { space, lib } = found;
  const grants = (await listIn(lib.sess, sl.WRITERS_PREFIX + driveKey + '/')).map((r) => r.value);
  const state = writerKey ? sl.writerState(grants, { drive: driveKey, writerKey }) : null;
  const pending = _outgoing.get(lib.library)?.find((r) => r.drive === driveKey && r.writerKey === writerKey);
  const index = await autobases.readJson(lib.sess, sl.LIB_INDEX).catch(() => null);
  return {
    space,
    name: (sl.isSpaceIndex(index) && index.name) || 'this Space',
    role: lib.role,
    ask: sl.canEdit(lib.role) ? 'editor' : 'request',
    state: state || (pending ? { pending: true, granted: false, kind: 'request', sent: true } : null),
  };
}

// Ask for `writerKey` on `driveKey`. An editor writes the grant record (granted with no prompt); a
// viewer can't write the Library, so the ask goes to the members who can, over nomad/space-control.
export async function askForDrive(driveKey, writerKey, { device = null, note = '' } = {}) {
  const found = await spaceOfDrive(driveKey);
  if (!found) throw new Error('This drive isn’t in a shared Space');
  const { lib } = found;
  if (!lib.memberId) throw new Error('This Space doesn’t know you yet. Try again in a moment');
  if (sl.canEdit(lib.role)) {
    const rec = sl.makeSpaceWriter({ drive: driveKey, writerKey, memberId: lib.memberId, device, kind: 'editor' });
    await putIn(lib.sess, sl.writerGrantPath(driveKey, writerKey), rec);
  } else {
    const rec = sl.makeSpaceWriter({ drive: driveKey, writerKey, memberId: lib.memberId, device, kind: 'request', note });
    if (!_outgoing.has(lib.library)) _outgoing.set(lib.library, []);
    const list = _outgoing.get(lib.library);
    if (!list.some((r) => r.drive === driveKey && r.writerKey === writerKey)) list.push(rec);
    _sendAll(lib.library);
  }
  logger.info('Asked to edit a drive in a shared space', { drive: driveKey, role: lib.role });
}

// Approve or deny a viewer's ask. Only a Device that writes the Drive approves.
export async function answerRequest(space, driveKey, writerKey, approve) {
  const lib = await forSpace(space);
  if (!lib?.writable) throw new Error('You can’t change this Space');
  const path = sl.writerGrantPath(driveKey, writerKey);
  const rec = await autobases.readJson(lib.sess, path);
  if (!sl.isSpaceWriter(rec)) throw new Error('That request is gone');
  if (!approve) {
    await delIn(lib.sess, path);
    return;
  }
  const drive = autobases.getCollaborativeDrive(driveKey) || (await autobases.getOrLoadCollaborativeDrive(driveKey));
  if (!drive?.writable) throw new Error('Only someone who can edit this drive can let them edit it');
  await drive.base.append({ addWriter: writerKey });
  await drive.base.update();
  await putIn(lib.sess, path, sl.markWriterGranted(rec, lib.memberId));
  logger.info('Approved an ask to edit a drive', { space, drive: driveKey });
}

// Keeping each Space Library in step
// =

const _timers = new Map();

function _attach(library, sess) {
  const run = () => {
    clearTimeout(_timers.get(library));
    _timers.set(
      library,
      setTimeout(() => {
        sync(library).catch((e) => logger.warn('Space library sync failed', { library, error: e.toString() }));
      }, 1000)
    );
  };
  sess.base.on('update', run);
  _ensureControlListener();
  const swarm = daemon.getSwarm();
  if (swarm) for (const conn of swarm.connections) _openControl(conn, library);
  run();
}

async function _spaceOfLibrary(library) {
  return (await vault.listSpaces()).find((s) => s.library === library && !s.movedTo)?.rootDriveKey || null;
}

// One pass over a Library: this person's role and member record, the Space Writer grants this
// Device can make or take back, and the viewers' asks waiting to be written down.
export async function sync(library) {
  const space = await _spaceOfLibrary(library);
  if (!space) return;
  const lib = await forSpace(space);
  if (!lib) return;
  const list = await members(space);
  const me = list.find((m) => m.memberId === lib.memberId);

  // My role in my Vault follows the Library; a missing record after I had one means I was removed.
  if (lib.memberId) {
    if (me && (me.role !== lib.role || lib.removed || !lib.confirmed)) {
      await vault.putSpaceShare(space, { role: me.role, removed: false, confirmed: true }).catch(() => {});
    } else if (!me && lib.confirmed && !lib.removed) {
      await vault.putSpaceShare(space, { removed: true }).catch(() => {});
      events.emit('removed', { space });
    }
  }

  // Keep my writer key on my member record, so an owner can take it off if my role changes.
  const own = hex(lib.sess.base.local?.key);
  if (me && lib.writable && own && !(me.writers || []).includes(own)) {
    await putIn(lib.sess, sl.memberPath(me.memberId), { ...me, writers: [...(me.writers || []), own] }).catch(() => {});
  }

  if (lib.writable) {
    const grants = (await listIn(lib.sess, sl.WRITERS_PREFIX)).map((r) => r.value).filter(sl.isSpaceWriter);
    const writable = new Set();
    for (const key of new Set(grants.map((g) => g.drive))) {
      const drive = autobases.getCollaborativeDrive(key);
      if (drive?.writable) writable.add(key);
    }
    const canWrite = (d) => writable.has(d);
    for (const g of sl.writersToGrant(grants, list, canWrite)) {
      try {
        const drive = autobases.getCollaborativeDrive(g.drive);
        await drive.base.append({ addWriter: g.writerKey });
        await drive.base.update();
        await putIn(lib.sess, sl.writerGrantPath(g.drive, g.writerKey), sl.markWriterGranted(g, lib.memberId));
        logger.info('Granted a member’s writer key on a drive', { drive: g.drive });
      } catch (e) {
        logger.warn('Could not grant a member’s writer key', { drive: g.drive, error: e.toString() });
      }
    }
    for (const g of sl.writersToRevoke(grants, list, canWrite)) {
      try {
        const drive = autobases.getCollaborativeDrive(g.drive);
        if (g.grantedBy) {
          await drive.base.append({ removeWriter: g.writerKey });
          await drive.base.update();
        }
        await delIn(lib.sess, sl.writerGrantPath(g.drive, g.writerKey));
        logger.info('Took a member’s writer key off a drive', { drive: g.drive });
      } catch (e) {
        logger.warn('Could not take a writer key off', { drive: g.drive, error: e.toString() });
      }
    }
    // Asks that came in over the channel while this Device couldn't write them down yet.
    for (const rec of _incoming.get(library) || []) await _keepRequest(library, rec).catch(() => {});
    _incoming.delete(library);
  }

  // An editor asks for its key on the Space's Drives it has open here and can't write.
  if (sl.canEdit(me?.role) && lib.writable) {
    const drives = (await autobases.readJson(lib.sess, sl.LIB_DRIVES))?.drives || [];
    const grants = (await listIn(lib.sess, sl.WRITERS_PREFIX)).map((r) => r.value);
    const device = await _ownDevice();
    for (const d of drives) {
      const drive = d?.key ? autobases.getCollaborativeDrive(d.key) : null;
      const writerKey = hex(drive?.base?.local?.key);
      if (!drive || drive.writable || !writerKey || writerKey === device) continue;
      if (sl.writerState(grants, { drive: d.key, writerKey })) continue;
      await askForDrive(d.key, writerKey, { device }).catch(() => {});
    }
  }

  // Stop re-sending a viewer's asks once they are written down.
  const out = _outgoing.get(library);
  if (out?.length) {
    const grants = (await listIn(lib.sess, sl.WRITERS_PREFIX)).map((r) => r.value);
    _outgoing.set(library, out.filter((r) => !sl.writerState(grants, r)));
  }
  events.emit('changed', { space });
}

async function _ownDevice() {
  const sess = await vault.getVault().catch(() => null);
  return hex(sess?.base?.local?.key);
}

// Open every shared Space's Library at startup, so it replicates and grants keep flowing.
export async function watchAll() {
  for (const s of await vault.listSpaces()) {
    if (!sl.isShared(s) || s.movedTo) continue;
    open(s.library)
      .then((sess) => {
        if (sess && sl.canManage(s.role) && sess.writable) _listen(s.library, sess);
      })
      .catch((e) => logger.warn('Could not open a space library', { library: s.library, error: e.toString() }));
  }
}

// nomad/space-control (ADR-0029 §7)
// =
// A viewer can't write the Space Library, so its ask for one Drive goes over a Protomux channel on
// the swarm connections, keyed by the Library, to a member's Device that can write it down. The ask
// is sent again to each peer that connects until the viewer sees its record.

const CONTROL_PROTOCOL = 'nomad/space-control';
const _channels = new Map(); // library -> Map(peerId -> message)
const _outgoing = new Map(); // library -> [space writer record]
const _incoming = new Map(); // library -> [space writer record], kept until this Device can write
let _controlListening = false;

function _ensureControlListener() {
  if (_controlListening) return;
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  _controlListening = true;
  swarm.on('connection', (conn) => {
    for (const library of _watched) _openControl(conn, library);
  });
}

function _openControl(conn, library) {
  const peerId = hex(conn.remotePublicKey);
  if (!peerId) return;
  if (!_channels.has(library)) _channels.set(library, new Map());
  const peers = _channels.get(library);
  if (peers.has(peerId)) return;
  let mux;
  try {
    mux = Protomux.from(conn);
  } catch {
    return;
  }
  const channel = mux.createChannel({
    protocol: CONTROL_PROTOCOL,
    id: b4a.from(library, 'hex'),
    messages: [
      {
        encoding: c.buffer,
        onmessage(data) {
          let msg;
          try {
            msg = JSON.parse(b4a.toString(data));
          } catch {
            return;
          }
          if (msg?.type === 'access-request' && sl.isSpaceWriter(msg.grant) && msg.grant.kind === 'request') {
            _receive(library, msg.grant).catch(() => {});
          }
        },
      },
    ],
    onopen() {
      _sendTo(library, peerId);
    },
    onclose() {
      peers.delete(peerId);
    },
  });
  if (!channel) return;
  peers.set(peerId, channel.messages[0]);
  channel.open();
}

function _sendTo(library, peerId) {
  const msg = _channels.get(library)?.get(peerId);
  for (const grant of _outgoing.get(library) || []) {
    try {
      msg?.send(b4a.from(JSON.stringify({ type: 'access-request', grant })));
    } catch {}
  }
}

function _sendAll(library) {
  for (const peerId of _channels.get(library)?.keys() || []) _sendTo(library, peerId);
}

async function _receive(library, grant) {
  const sess = await open(library);
  if (!sess?.writable) {
    if (!_incoming.has(library)) _incoming.set(library, []);
    _incoming.get(library).push(grant);
    return;
  }
  await _keepRequest(library, grant);
}

// Write a viewer's ask down, after checking the member it names is a viewer of this Space.
async function _keepRequest(library, grant) {
  const sess = await open(library);
  const member = await autobases.readJson(sess, sl.memberPath(grant.memberId)).catch(() => null);
  if (!sl.isMember(member) || member.role !== 'viewer') return;
  const path = sl.writerGrantPath(grant.drive, grant.writerKey);
  if (await autobases.readJson(sess, path)) return;
  const rec = sl.makeSpaceWriter({ ...grant, kind: 'request' }, grant.requestedAt);
  await putIn(sess, path, rec);
  const space = await _spaceOfLibrary(library);
  logger.info('Kept a viewer’s ask to edit a drive', { space, drive: grant.drive });
  events.emit('changed', { space });
}
