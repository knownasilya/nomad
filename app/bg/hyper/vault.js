// @ts-nocheck
//
// The Vault: a single user's identity-level Collaborative Drive (Autobase) that indexes
// their Spaces (by Root Drive key) and trusted Devices (by writer key). It is the root of
// trust for multi-device sync — every Device the user owns is a Writer of the Vault.
//
// See docs/multi-device-protocol.md and ADR-0006 (the Vault).
//
// The Vault reuses the exact Autobase shape of every Collaborative Drive (autobases.js
// _openFn/_applyFn): a single Hyperbee view, ops { op:'put'|'del', path, data, encoding? },
// { addWriter, profileUrl? } and { removeWriter }. Vault index records are ordinary put-ops
// at /.vault/* paths so both nomad and mobile persist them with the shared apply function.

import b4a from 'b4a';
import { EventEmitter } from 'events';
import * as logLib from '../logger';
import * as autobases from './autobases';
import * as daemon from './daemon';
import * as drives from './drives';
import * as settingsDb from '../dbs/settings';
import * as spacesDb from '../dbs/spaces';
import * as pdb from '../dbs/profile-data-db';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'vault' });

const VAULT_KEY_SETTING = 'vault_key';
const PENDING_ROOT_MOVE_SETTING = 'vault_pending_root_move';
// The solo Vault this Device left to join another one, until its data is copied across.
const CARRY_FROM_SETTING = 'vault_carry_from';
const VAULT_VERSION = 1;

const META_PATH = '/.vault/meta.json';
const SPACES_PREFIX = '/.vault/spaces/';
const DEVICES_PREFIX = '/.vault/devices/';
// Settings that follow the user to every Device (bg/hyper/synced-settings.js): one record per key,
// { key, value, updatedAt }, so two Devices changing different settings never overwrite each other.
const SETTINGS_PREFIX = '/.vault/settings/';
// The user's own data a solo Vault brings along when this Device joins another Vault: Reader
// subscriptions, Notes (ADR-0017), names (shared/names.mjs), and Drafts (ADR-0012). The rest
// (meta, Spaces, Devices, settings) belongs to the Vault being joined.
const READER_PREFIX = '/.vault/reader/';
const NOTES_PREFIX = '/.vault/notes/';
const NAMES_PREFIX = '/.vault/names/';
const DRAFTS_PREFIX = '/.drafts/';
const CARRY_PREFIXES = [READER_PREFIX, NOTES_PREFIX, NAMES_PREFIX, DRAFTS_PREFIX];

// Emits 'changed' when this Device switches to another Vault, so code that follows the Vault's
// updates (bg/web-apis/bg/vault-apps.ts watch) can follow the new one.
export const events = new EventEmitter();

// Identity & lifecycle
// =

export async function getVaultKey() {
  const key = await settingsDb.get(VAULT_KEY_SETTING);
  return key || null;
}

export function hasVault() {
  return getVaultKey().then((k) => !!k);
}

// Returns the writable Vault session, creating + persisting it if this Device has none yet.
// Idempotent: a second caller during creation reuses the persisted key.
export async function ensureVault({ profileUrl } = {}) {
  const existing = await getVaultKey();
  if (existing) return autobases.getOrLoadCollaborativeDrive(existing);
  return createVault({ profileUrl });
}

let _carryWatched = false;

export async function getVault() {
  const key = await getVaultKey();
  if (!key) return null;
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  // A copy from a left Vault that a restart cut short: finish it once the Vault is writable.
  if (!_carryWatched && sess) {
    _carryWatched = true;
    _watchCarry(sess);
  }
  return sess;
}

// A Vault that this Device created and no other Device has joined. A Device can leave such a Vault
// to join another one (adoptVault); one that has its own Vault otherwise can't. A Vault this Device
// joined is never solo, even with every other Device removed: its writer core is the Device's root
// writer core, which the Vault being joined needs too (multi-device-protocol §3).
export async function isSolo(sess = null) {
  sess = sess || (await getVault());
  if (!sess) return true;
  const base = sess.base;
  if (!base?.local?.key || !b4a.equals(base.local.key, base.key)) return false;
  const own = b4a.toString(base.local.key, 'hex');
  const devices = await _readPrefix(sess, DEVICES_PREFIX);
  return devices.every((d) => d.key === own);
}

// Candidate side: this Device just paired into an existing Vault. Persist the received key and
// load the base (writable once the member's addWriter has linearised). Callers then sync Spaces
// from the Vault index. A Device with its own solo Vault leaves it and brings its data along
// (CARRY_PREFIXES); any other existing Vault is refused.
export async function adoptVault(vaultKey) {
  const existing = await getVaultKey();
  const leaving = existing && existing !== vaultKey;
  if (leaving) {
    if (!(await isSolo())) throw new Error('This Device already belongs to a Vault');
    await settingsDb.set(CARRY_FROM_SETTING, existing);
    logger.info('Leaving a solo vault to join another', { from: existing, to: vaultKey });
  }
  await settingsDb.set(VAULT_KEY_SETTING, vaultKey);
  const sess = await autobases.loadCollaborativeDrive(vaultKey);
  logger.info('Adopted vault', { key: vaultKey, writable: sess?.writable });
  if (leaving) {
    events.emit('changed', { key: vaultKey });
    _watchCarry(sess);
  }
  return sess;
}

// Copy the data of the solo Vault this Device left (CARRY_FROM_SETTING) into the current Vault.
// The new Vault turns writable only after the inviting Device's addWriter linearises, so try now
// and again on each update until the copy is done. The old Vault stays on disk, unused.
function _watchCarry(sess) {
  const base = sess?.base;
  const tryCarry = () =>
    runPendingCarry()
      .then((done) => {
        if (done && base) base.removeListener('update', tryCarry);
      })
      .catch((e) => logger.warn('Could not copy data from the old vault yet', { error: e.toString() }));
  if (base) base.on('update', tryCarry);
  tryCarry();
}

let _carrying = null;

// Resolves true when there is nothing (left) to copy.
export function runPendingCarry() {
  if (!_carrying) _carrying = _carry().finally(() => (_carrying = null));
  return _carrying;
}

async function _carry() {
  const from = await settingsDb.get(CARRY_FROM_SETTING);
  if (!from) return true;
  const to = await getVault();
  if (!to || !to.writable) return false;
  const old = await autobases.getOrLoadCollaborativeDrive(from);
  let copied = 0;
  for (const prefix of CARRY_PREFIXES) {
    for (const { path, value } of await _readPrefixEntries(old, prefix)) {
      if (await _carryRecord(to, path, value)) copied++;
    }
  }
  await settingsDb.set(CARRY_FROM_SETTING, '');
  autobases.unloadCollaborativeDrive(from);
  logger.info('Copied data from the old vault', { from, copied });
  return true;
}

// Put one record from the old Vault, unless the new Vault already has a better one: a Note keeps
// the newer edit, read marks are merged, and anything else already there wins.
async function _carryRecord(sess, path, value) {
  const have = await autobases.readJson(sess, path);
  if (have) {
    if (path.startsWith(NOTES_PREFIX) && value?.updatedAt > have.updatedAt) {
      await _putRecord(sess, path, value);
      return true;
    }
    if (path.startsWith(READER_PREFIX) && path.endsWith('/read.json')) {
      const read = [...new Set([...(have.read || []), ...(value?.read || [])])].sort();
      if (read.length === (have.read || []).length) return false;
      await _putRecord(sess, path, { read });
      return true;
    }
    return false;
  }
  await _putRecord(sess, path, value);
  return true;
}

async function createVault({ profileUrl } = {}) {
  const sess = await autobases.createCollaborativeDrive({
    type: 'nomad/vault',
    version: VAULT_VERSION,
  });
  await settingsDb.set(VAULT_KEY_SETTING, sess.keyStr);
  await _putRecord(sess, META_PATH, {
    version: VAULT_VERSION,
    createdAt: new Date().toISOString(),
    profileUrl: profileUrl || null,
  });
  logger.info('Created vault', { key: sess.keyStr });
  events.emit('changed', { key: sess.keyStr });
  return sess;
}

// Index reads
// =

export async function getMeta() {
  const sess = await getVault();
  if (!sess) return null;
  return _readRecord(sess, META_PATH);
}

export async function listSpaces() {
  const sess = await getVault();
  if (!sess) return [];
  return _readPrefix(sess, SPACES_PREFIX);
}

export async function listDevices() {
  const sess = await getVault();
  if (!sess) return [];
  return _readPrefix(sess, DEVICES_PREFIX);
}

// How many Devices other than this one are in the Vault.
export async function otherDeviceCount() {
  const sess = await getVault();
  if (!sess) return 0;
  const own = sess.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
  return (await _readPrefix(sess, DEVICES_PREFIX)).filter((d) => d.key !== own).length;
}

// The synced settings as { key: value }. Empty with no Vault.
export async function listSyncedSettings() {
  const sess = await getVault();
  if (!sess) return {};
  const out = {};
  for (const rec of await _readPrefix(sess, SETTINGS_PREFIX)) {
    if (rec && typeof rec.key === 'string') out[rec.key] = rec.value;
  }
  return out;
}

// App records: the Reader's and Notes' data (shared/vault-apps.mjs, ADR-0017). Reads give null / []
// with no Vault. Callers create the Vault on first use (ensureVault): this Device can still join
// another Vault later, since a solo Vault comes along (adoptVault).

export async function readAppRecord(path) {
  const sess = await getVault();
  if (!sess) return null;
  return _readRecord(sess, path);
}

export async function listAppRecords(prefix) {
  const sess = await getVault();
  if (!sess) return [];
  return _readPrefix(sess, prefix);
}

export async function putAppRecord(path, obj) {
  await _putRecord(await _writableVault(), path, obj);
}

export async function delAppRecord(path) {
  await _delRecord(await _writableVault(), path);
}

async function _writableVault() {
  const sess = await ensureVault();
  if (!sess.writable) {
    throw new Error('This device can’t write to your Vault yet. Keep your other device online until it syncs, then try again.');
  }
  return sess;
}

// Index writes
// =

// Store a synced setting for the user's other Devices. Returns false with no Vault (nothing to
// sync with yet). Never creates a Vault just for this.
export async function putSyncedSetting(key, value) {
  const sess = await getVault();
  if (!sess) return false;
  await _putRecord(sess, `${SETTINGS_PREFIX}${key}.json`, {
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

// Record a Space in the Vault so other Devices can discover and replicate its Root Drive.
// Keyed by rootDriveKey (globally stable) — NOT space.id, which is a device-local autoincrement
// and would collide/diverge across Devices. originId is a non-authoritative hint only.
export async function registerSpace(space, rootDriveKey) {
  const sess = await ensureVault();
  await _putRecord(sess, `${SPACES_PREFIX}${rootDriveKey}.json`, {
    rootDriveKey,
    name: space.name,
    icon: space.icon,
    color: space.color,
    sortOrder: space.sort_order ?? 0,
    originId: space.id,
    createdAt: space.created_at || new Date().toISOString(),
  });
  logger.info('Registered space in vault', { spaceId: space.id, rootDriveKey });
}

// Queue a Root Drive move and try it now. The queue (a "<fromKey>:<toKey>" setting) outlives a failed
// attempt: setup updates the local space record first, so once that is saved, nothing else on this
// Device remembers the old key.
export async function queueSpaceRootMove(fromKey, toKey) {
  await settingsDb.set(PENDING_ROOT_MOVE_SETTING, `${fromKey}:${toKey}`);
  return runPendingSpaceRootMove();
}

// Retry a queued Root Drive move. Setup calls this on every start; it clears the queue once the
// move is done (or there is no Vault record to move).
export async function runPendingSpaceRootMove() {
  const pending = await settingsDb.get(PENDING_ROOT_MOVE_SETTING);
  if (!pending) return;
  const [fromKey, toKey] = String(pending).split(':');
  if (fromKey && toKey && fromKey !== toKey) await moveSpaceRoot(fromKey, toKey);
  await settingsDb.set(PENDING_ROOT_MOVE_SETTING, '');
}

// A Space's Root Drive got a new key on this Device (setup recreates an unusable root drive).
// Index the Space under the new key and leave the old record as a `movedTo` pointer, so paired
// Devices repoint their copy of the Space instead of adding a second one. Writers of the old Root
// Drive are not Writers of the new one, so fan the known Devices out to it.
export async function moveSpaceRoot(fromKey, toKey) {
  const sess = await getVault();
  if (!sess) return;
  const old = await _readRecord(sess, `${SPACES_PREFIX}${fromKey}.json`);
  if (!old || old.movedTo) {
    logger.info('No space root to move in vault', { fromKey, toKey, found: !!old, movedTo: old?.movedTo });
    return;
  }
  await _putRecord(sess, `${SPACES_PREFIX}${toKey}.json`, { ...old, rootDriveKey: toKey });
  await _putRecord(sess, `${SPACES_PREFIX}${fromKey}.json`, { rootDriveKey: fromKey, movedTo: toKey });
  // The Space's Reader subscriptions are keyed by its Root Drive key (ADR-0017): move them too.
  const readerFrom = `${READER_PREFIX}${fromKey}/`;
  for (const { path, value } of await _readPrefixEntries(sess, readerFrom)) {
    await _carryRecord(sess, `${READER_PREFIX}${toKey}/${path.slice(readerFrom.length)}`, value);
  }
  const root = await autobases.getOrLoadCollaborativeDrive(toKey);
  if (root) {
    for (const device of await listDevices()) {
      try {
        await root.base.append({ addWriter: device.key });
      } catch (e) {
        logger.warn('addWriter on moved root failed', { deviceKey: device.key, error: e.toString() });
      }
    }
    await root.base.update();
  }
  logger.info('Moved space root in vault', { fromKey, toKey });
}

// Add a Device: make its key a Writer of the Vault AND of every indexed Root Drive (fan-out),
// then record human-readable metadata. The Autobase oplog (addWriter) is the security boundary;
// the device record is for naming/management.
export async function addDevice(deviceKey, { name, platform } = {}) {
  const sess = await ensureVault();
  logger.info('addDevice: appending addWriter', { deviceKey });
  await sess.base.append({ addWriter: deviceKey });
  await sess.base.update();
  logger.info('addDevice: writing device record', { deviceKey });
  await _putRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`, {
    key: deviceKey,
    name: name || 'Unnamed device',
    platform: platform || 'unknown',
    addedAt: new Date().toISOString(),
  });
  logger.info('Added device to vault', { deviceKey, platform });
  // Background — do NOT block the approval on slow per-space-drive replication.
  // The device is already a Vault writer; fan-out catches up async.
  fanOutAddWriter(deviceKey).catch((e) =>
    logger.warn('addWriter fan-out failed', { error: e.toString() })
  );
}

// Ensure THIS Device has its own record in the Vault index. The creating/owner Device is the
// Autobase bootstrap writer, so it never passes through addDevice() (which is only run for
// candidates that pair in) — without this, its record never exists and therefore never replicates,
// so no OTHER Device can see it. That's why a freshly-linked phone only ever saw itself.
// Idempotent and cheap: a module flag + an existence check short-circuit once the record is written,
// and it never re-adds a writer (the owner already is one). Safe to call on every status poll.
let _ownDeviceRegistered = false;
export async function registerOwnDevice({ name, platform } = {}) {
  if (_ownDeviceRegistered) return;
  const sess = await getVault();
  if (!sess) return;
  const localKey = sess.base?.local?.key;
  if (!localKey) return;
  const key = b4a.toString(localKey, 'hex');
  const existing = await _readRecord(sess, `${DEVICES_PREFIX}${key}.json`);
  if (existing) {
    _ownDeviceRegistered = true;
    return;
  }
  await _putRecord(sess, `${DEVICES_PREFIX}${key}.json`, {
    key,
    name: name || 'This device',
    platform: platform || 'unknown',
    addedAt: new Date().toISOString(),
  });
  _ownDeviceRegistered = true;
  logger.info('Registered own device in vault', { key });
}

// Rename a Device. Any writer can update the record (it's a plain put into the Vault); the change
// replicates to all Devices. The name is cosmetic.
export async function renameDevice(deviceKey, name) {
  const sess = await getVault();
  if (!sess) return;
  const rec = await _readRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`);
  if (!rec) return;
  rec.name = name;
  await _putRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`, rec);
  logger.info('Renamed device', { deviceKey, name });
}

// Revoke a Device: removeWriter from the Vault and every indexed Root Drive, drop its record.
// NOTE (ADR-0006): this stops future accepted writes but cannot retroactively un-share data the
// device already replicated, and the device keeps local copies. The UI must say so plainly.
export async function removeDevice(deviceKey) {
  const sess = await getVault();
  if (!sess) return;
  logger.info('removeDevice: appending removeWriter', { deviceKey });
  await sess.base.append({ removeWriter: deviceKey });
  await sess.base.update();
  await _delRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`);
  logger.info('Removed device from vault', { deviceKey });
  // Background — see addDevice.
  fanOutRemoveWriter(deviceKey).catch((e) =>
    logger.warn('removeWriter fan-out failed', { error: e.toString() })
  );
}

// Profile
// =

// The canonical public Profile Drive URL (single-writer, owned by the origin Device).
export async function getProfileUrl() {
  const row = await pdb.get('SELECT url FROM profiles WHERE id = 0');
  return row?.url || null;
}

// Writer fan-out
// =

export async function fanOutAddWriter(deviceKey) {
  await _forEachSpaceDrive(async (sess) => {
    await sess.base.append({ addWriter: deviceKey });
    await sess.base.update();
  });
}

export async function fanOutRemoveWriter(deviceKey) {
  await _forEachSpaceDrive(async (sess) => {
    try {
      await sess.base.append({ removeWriter: deviceKey });
      await sess.base.update();
    } catch (e) {
      logger.warn('removeWriter fan-out failed for a drive', { deviceKey, error: e.toString() });
    }
  });
}

async function _forEachSpaceDrive(fn) {
  const spaces = await listSpaces();
  for (const space of spaces) {
    if (!space.rootDriveKey || space.movedTo) continue;
    const sess = await autobases.getOrLoadCollaborativeDrive(space.rootDriveKey);
    if (sess) await fn(sess);
  }
}

// Candidate side: after pairing into a Vault, mirror its Space index into the local spaces DB so
// the joined Device shows the same Spaces. Idempotent — skips Spaces already present locally
// (matched by Root Drive key). New Spaces' Root Drives are set up lazily on first activation.
export async function syncSpacesFromVault() {
  const sess = await getVault();
  if (!sess) return { created: 0 };
  const vaultSpaces = await listSpaces();
  const local = await spacesDb.list();
  const haveKeys = new Set(
    local
      .map((s) => (s.root_drive_url ? drives.fromURLToKey(s.root_drive_url) : null))
      .filter(Boolean)
  );
  // A moved Root Drive: repoint the local copy of the Space so it doesn't turn into a second one.
  for (const vs of vaultSpaces) {
    if (!vs.movedTo || !haveKeys.has(vs.rootDriveKey) || haveKeys.has(vs.movedTo)) continue;
    const space = local.find((s) => s.root_drive_url && drives.fromURLToKey(s.root_drive_url) === vs.rootDriveKey);
    if (!space) continue;
    await spacesDb.update(space.id, { rootDriveUrl: `hyper://${vs.movedTo}/` });
    haveKeys.delete(vs.rootDriveKey);
    haveKeys.add(vs.movedTo);
  }
  let created = 0;
  for (const vs of vaultSpaces) {
    if (!vs.rootDriveKey || vs.movedTo || haveKeys.has(vs.rootDriveKey)) continue;
    const space = await spacesDb.create({
      name: vs.name || 'Space',
      icon: vs.icon || 'circle',
      color: vs.color || '#6c6cff',
    });
    await spacesDb.update(space.id, { rootDriveUrl: `hyper://${vs.rootDriveKey}/` });
    created++;
  }
  logger.info('Synced spaces from vault', { created });
  return { created };
}

// Owner side: publish this Device's local Spaces into the Vault index so they replicate to the
// user's other Devices — the symmetric counterpart of syncSpacesFromVault. registerSpace is never
// called at space-creation time, so without this backfill a paired Device sees the Devices index
// but zero Spaces. Idempotent: skips Spaces already indexed in the Vault (matched by Root Drive
// key) so repeated opens of the Devices page don't append redundant ops to the Autobase.
export async function syncSpacesToVault() {
  const sess = await getVault();
  if (!sess) return { registered: 0 };
  const indexed = new Set((await listSpaces()).map((s) => s.rootDriveKey).filter(Boolean));
  const local = await spacesDb.list();
  let registered = 0;
  for (const space of local) {
    const rootDriveKey = space.root_drive_url ? drives.fromURLToKey(space.root_drive_url) : null;
    if (!rootDriveKey || indexed.has(rootDriveKey)) continue;
    await registerSpace(space, rootDriveKey);
    registered++;
  }
  if (registered) logger.info('Synced spaces to vault', { registered });
  return { registered };
}

// Sync status for the Devices page: the Vault, plus every Space known here OR in the Vault index,
// so a Space this Device has under one key and the Vault under another shows up as a mismatch.
// Only reads drives that are already loaded — never opens one, so this can't hang on a missing peer.
export async function getSyncStatus() {
  const swarm = await daemon.getDaemonStatus();
  const vaultSess = await getVault();
  const vaultSpaces = vaultSess ? await listSpaces() : [];
  const local = await spacesDb.list();

  const byKey = new Map();
  for (const sp of local) {
    const key = sp.root_drive_url ? drives.fromURLToKey(sp.root_drive_url) : null;
    if (key) byKey.set(key, { name: sp.name, rootDriveKey: key, here: true, inVault: false });
  }
  for (const vs of vaultSpaces) {
    if (!vs.rootDriveKey) continue;
    const row = byKey.get(vs.rootDriveKey) || { name: vs.name, rootDriveKey: vs.rootDriveKey, here: false };
    row.inVault = true;
    if (vs.movedTo) row.movedTo = vs.movedTo;
    byKey.set(vs.rootDriveKey, row);
  }

  const spaces = [];
  for (const row of byKey.values()) {
    const sess = autobases.getCollaborativeDrive(row.rootDriveKey);
    const st = sess ? await _driveStatus(sess) : { loaded: false };
    let driveCount = null;
    if (sess) {
      try {
        const reg = await autobases.readJson(sess, '/drives.json');
        driveCount = Array.isArray(reg?.drives) ? reg.drives.length : 0;
      } catch {}
    }
    spaces.push({ ...row, ...st, driveCount });
  }
  return {
    connections: swarm.connections || 0,
    vault: vaultSess ? await _driveStatus(vaultSess) : null,
    spaces,
  };
}

// One Autobase's replication state. `peers` and the lengths come from its bootstrap core (the
// creating writer's log): synced when every peer's length is no longer than ours.
async function _driveStatus(sess) {
  const base = sess.base;
  const out = {
    loaded: true,
    key: sess.keyStr,
    writable: !!base.writable,
    viewLength: base.view?.core?.length ?? 0,
    peers: 0,
    length: 0,
    remoteLength: 0,
  };
  const core = daemon.getCorestore().get({ key: base.key });
  try {
    await core.ready();
    out.peers = core.peers.length;
    out.length = core.length;
    out.remoteLength = Math.max(core.length, ...core.peers.map((p) => p.remoteLength || 0));
  } catch {
  } finally {
    await core.close().catch(() => {});
  }
  return out;
}

// internal record helpers (Hyperbee view <-> JSON)
// =

async function _putRecord(sess, path, obj) {
  // Vault index records are small JSON control records — stored inline in the view.
  await autobases.putInline(sess, path, obj);
}

async function _delRecord(sess, path) {
  await autobases.deletePath(sess, path);
}

async function _readRecord(sess, path) {
  await sess.base.update();
  return autobases.readJson(sess, path);
}

// Like _readPrefix, with each record's path.
async function _readPrefixEntries(sess, prefix) {
  await sess.base.update();
  const out = [];
  for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    try {
      const buf = await autobases.resolveRecordContent(node.value);
      const path = typeof node.key === 'string' ? node.key : b4a.toString(node.key);
      if (buf) out.push({ path, value: JSON.parse(b4a.toString(buf)) });
    } catch {}
  }
  return out;
}

async function _readPrefix(sess, prefix) {
  await sess.base.update();
  const out = [];
  for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    try {
      const buf = await autobases.resolveRecordContent(node.value);
      if (buf) out.push(JSON.parse(b4a.toString(buf)));
    } catch {}
  }
  return out;
}
