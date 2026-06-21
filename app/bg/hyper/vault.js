// @ts-nocheck
//
// The Vault: a single user's identity-level Collaborative Drive (Autobase) that indexes
// their Spaces (by Root Drive key) and trusted Devices (by writer key). It is the root of
// trust for multi-device sync — every Device the user owns is a Writer of the Vault.
//
// See docs/multi-device-protocol.md, ADR-0006 (the Vault) and ADR-0007 (Profile aggregation).
//
// The Vault reuses the exact Autobase shape of every Collaborative Drive (autobases.js
// _openFn/_applyFn): a single Hyperbee view, ops { op:'put'|'del', path, data, encoding? },
// { addWriter, profileUrl? } and { removeWriter }. Vault index records are ordinary put-ops
// at /.vault/* paths so both nomad and mobile persist them with the shared apply function.

import b4a from 'b4a'
import * as logLib from '../logger'
import * as autobases from './autobases'
import * as drives from './drives'
import * as settingsDb from '../dbs/settings'
import * as spacesDb from '../dbs/spaces'
import * as pdb from '../dbs/profile-data-db'

const logger = logLib.get().child({ category: 'hyper', subcategory: 'vault' })

const VAULT_KEY_SETTING = 'vault_key'
const PROFILE_CONTENT_KEY_SETTING = 'profile_content_key'
const VAULT_VERSION = 1

const META_PATH = '/.vault/meta.json'
const SPACES_PREFIX = '/.vault/spaces/'
const DEVICES_PREFIX = '/.vault/devices/'
const WRITER_KEYS_PATH = '/.data/walled.garden/writer-keys.json'

// Identity & lifecycle
// =

export async function getVaultKey() {
  const key = await settingsDb.get(VAULT_KEY_SETTING)
  return key || null
}

export function hasVault() {
  return getVaultKey().then((k) => !!k)
}

// Returns the writable Vault session, creating + persisting it if this Device has none yet.
// Idempotent: a second caller during creation reuses the persisted key.
export async function ensureVault({ profileUrl } = {}) {
  const existing = await getVaultKey()
  if (existing) return autobases.getOrLoadCollaborativeDrive(existing)
  return createVault({ profileUrl })
}

export async function getVault() {
  const key = await getVaultKey()
  if (!key) return null
  return autobases.getOrLoadCollaborativeDrive(key)
}

// Candidate side: this Device just paired into an existing Vault. Persist the received key and
// load the base (writable once the member's addWriter has linearised). Callers then sync Spaces
// from the Vault index. Refuses to clobber an existing Vault.
export async function adoptVault(vaultKey) {
  const existing = await getVaultKey()
  if (existing && existing !== vaultKey) {
    throw new Error('This Device already belongs to a Vault')
  }
  await settingsDb.set(VAULT_KEY_SETTING, vaultKey)
  const sess = await autobases.loadCollaborativeDrive(vaultKey)
  logger.info('Adopted vault', { key: vaultKey, writable: sess?.writable })
  return sess
}

async function createVault({ profileUrl } = {}) {
  const sess = await autobases.createCollaborativeDrive({ type: 'nomad/vault', version: VAULT_VERSION })
  await settingsDb.set(VAULT_KEY_SETTING, sess.keyStr)
  await _putRecord(sess, META_PATH, {
    version: VAULT_VERSION,
    createdAt: new Date().toISOString(),
    profileUrl: profileUrl || null
  })
  logger.info('Created vault', { key: sess.keyStr })
  return sess
}

// Index reads
// =

export async function getMeta() {
  const sess = await getVault()
  if (!sess) return null
  return _readRecord(sess, META_PATH)
}

export async function listSpaces() {
  const sess = await getVault()
  if (!sess) return []
  return _readPrefix(sess, SPACES_PREFIX)
}

export async function listDevices() {
  const sess = await getVault()
  if (!sess) return []
  return _readPrefix(sess, DEVICES_PREFIX)
}

// Index writes
// =

// Record a Space in the Vault so other Devices can discover and replicate its Root Drive.
// Keyed by rootDriveKey (globally stable) — NOT space.id, which is a device-local autoincrement
// and would collide/diverge across Devices. originId is a non-authoritative hint only.
export async function registerSpace(space, rootDriveKey) {
  const sess = await ensureVault()
  await _putRecord(sess, `${SPACES_PREFIX}${rootDriveKey}.json`, {
    rootDriveKey,
    name: space.name,
    icon: space.icon,
    color: space.color,
    sortOrder: space.sort_order ?? 0,
    originId: space.id,
    createdAt: space.created_at || new Date().toISOString()
  })
  logger.info('Registered space in vault', { spaceId: space.id, rootDriveKey })
}

// Add a Device: make its key a Writer of the Vault AND of every indexed Root Drive (fan-out),
// then record human-readable metadata. The Autobase oplog (addWriter) is the security boundary;
// the device record is for naming/management.
export async function addDevice(deviceKey, { name, platform, profileContentKey } = {}) {
  const sess = await ensureVault()
  logger.info('addDevice: appending addWriter', { deviceKey })
  await sess.base.append({ addWriter: deviceKey })
  await sess.base.update()
  logger.info('addDevice: writing device record', { deviceKey })
  await _putRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`, {
    key: deviceKey,
    name: name || 'Unnamed device',
    platform: platform || 'unknown',
    profileContentKey: profileContentKey || null,
    addedAt: new Date().toISOString()
  })
  logger.info('Added device to vault', { deviceKey, platform })
  // Background — do NOT block the approval on slow per-space-drive replication or profile-drive
  // maintenance. The device is already a Vault writer; fan-out and writer-keys catch up async.
  fanOutAddWriter(deviceKey).catch((e) => logger.warn('addWriter fan-out failed', { error: e.toString() }))
  syncWriterKeys().catch((e) => logger.warn('writer-keys sync failed', { error: e.toString() }))
}

// Ensure THIS Device has its own record in the Vault index. The creating/owner Device is the
// Autobase bootstrap writer, so it never passes through addDevice() (which is only run for
// candidates that pair in) — without this, its record never exists and therefore never replicates,
// so no OTHER Device can see it. That's why a freshly-linked phone only ever saw itself.
// Idempotent and cheap: a module flag + an existence check short-circuit once the record is written,
// and it never re-adds a writer (the owner already is one). Safe to call on every status poll.
let _ownDeviceRegistered = false
export async function registerOwnDevice({ name, platform } = {}) {
  if (_ownDeviceRegistered) return
  const sess = await getVault()
  if (!sess) return
  const localKey = sess.base?.local?.key
  if (!localKey) return
  const key = b4a.toString(localKey, 'hex')
  const existing = await _readRecord(sess, `${DEVICES_PREFIX}${key}.json`)
  if (existing) {
    _ownDeviceRegistered = true
    return
  }
  await _putRecord(sess, `${DEVICES_PREFIX}${key}.json`, {
    key,
    name: name || 'This device',
    platform: platform || 'unknown',
    profileContentKey: null,
    addedAt: new Date().toISOString()
  })
  _ownDeviceRegistered = true
  logger.info('Registered own device in vault', { key })
}

// Rename a Device. Any writer can update the record (it's a plain put into the Vault); the change
// replicates to all Devices. No writer-keys re-sync needed — the name is cosmetic.
export async function renameDevice(deviceKey, name) {
  const sess = await getVault()
  if (!sess) return
  const rec = await _readRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`)
  if (!rec) return
  rec.name = name
  await _putRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`, rec)
  logger.info('Renamed device', { deviceKey, name })
}

// Revoke a Device: removeWriter from the Vault and every indexed Root Drive, drop its record.
// NOTE (ADR-0006): this stops future accepted writes but cannot retroactively un-share data the
// device already replicated, and the device keeps local copies. The UI must say so plainly.
export async function removeDevice(deviceKey) {
  const sess = await getVault()
  if (!sess) return
  logger.info('removeDevice: appending removeWriter', { deviceKey })
  await sess.base.append({ removeWriter: deviceKey })
  await sess.base.update()
  await _delRecord(sess, `${DEVICES_PREFIX}${deviceKey}.json`)
  logger.info('Removed device from vault', { deviceKey })
  // Background — see addDevice.
  fanOutRemoveWriter(deviceKey).catch((e) => logger.warn('removeWriter fan-out failed', { error: e.toString() }))
  syncWriterKeys().catch((e) => logger.warn('writer-keys sync failed', { error: e.toString() }))
}

// Profile aggregation (ADR-0007)
// =

// The canonical public Profile Drive URL (single-writer, owned by the origin Device).
export async function getProfileUrl() {
  const row = await pdb.get('SELECT url FROM profiles WHERE id = 0')
  return row?.url || null
}

// This Device's own profile content drive — where it publishes social posts when it does NOT own
// the canonical Profile Drive. Created once; key persisted and advertised during pairing so the
// canonical owner can list it in writer-keys.json.
export async function ensureProfileContentDrive() {
  const existing = await settingsDb.get(PROFILE_CONTENT_KEY_SETTING)
  if (existing) return existing
  const drive = await drives.createNewDrive({ type: 'walled.garden/person' })
  const key = drives.fromURLToKey(drive.url)
  await settingsDb.set(PROFILE_CONTENT_KEY_SETTING, key)
  return key
}

// Owner-only projection: write every Device's profile content-drive key into writer-keys.json on
// the canonical Profile Drive, so readers aggregate posts across Devices as one identity. Only the
// Device that owns the canonical profile (where it is writable) maintains the file; others no-op.
export async function syncWriterKeys() {
  const url = await getProfileUrl()
  if (!url) return
  const drive = await drives.getOrLoadDrive(url)
  if (!drive || !drive.writable) return
  const devices = await listDevices()
  const keys = devices.map((d) => d.profileContentKey).filter(Boolean)
  const record = { type: 'walled.garden/writer-keys', keys }
  await drive.drive.put(WRITER_KEYS_PATH, b4a.from(JSON.stringify(record, null, 2)))
  logger.info('Synced writer-keys.json', { count: keys.length })
}

// Writer fan-out
// =

export async function fanOutAddWriter(deviceKey) {
  await _forEachSpaceDrive(async (sess) => {
    await sess.base.append({ addWriter: deviceKey })
    await sess.base.update()
  })
}

export async function fanOutRemoveWriter(deviceKey) {
  await _forEachSpaceDrive(async (sess) => {
    try {
      await sess.base.append({ removeWriter: deviceKey })
      await sess.base.update()
    } catch (e) {
      logger.warn('removeWriter fan-out failed for a drive', { deviceKey, error: e.toString() })
    }
  })
}

async function _forEachSpaceDrive(fn) {
  const spaces = await listSpaces()
  for (const space of spaces) {
    if (!space.rootDriveKey) continue
    const sess = await autobases.getOrLoadCollaborativeDrive(space.rootDriveKey)
    if (sess) await fn(sess)
  }
}

// Migration: single-writer Hyperdrive Root Drive -> Collaborative Drive (Autobase)
// =

// Convert one Space's Root Drive to an Autobase, copying its files, and register it in the Vault.
// Returns the new hyper:// url. Idempotent-ish: skips spaces whose root drive is already an Autobase.
// (ADR-0006) Converting changes the drive's key/url; we rewrite spaces.root_drive_url. /drives.json
// content is carried over by the file copy; in-memory caches in filesystem/index.js must be reset
// by the caller after migration.
export async function migrateSpaceRootDrive(space) {
  if (!space.root_drive_url) {
    // No root drive yet — nothing to copy; just ensure one exists as an Autobase.
    const sess = await autobases.createCollaborativeDrive({ type: 'unwalled.garden/person' })
    await spacesDb.update(space.id, { rootDriveUrl: sess.url })
    await registerSpace(space, sess.keyStr)
    return sess.url
  }

  // Already collaborative? skip.
  const existingKey = drives.fromURLToKey(space.root_drive_url)
  if (autobases.getCollaborativeDrive(existingKey)) {
    await registerSpace(space, existingKey)
    return space.root_drive_url
  }

  const srcDrive = await drives.getOrLoadDrive(space.root_drive_url)
  if (!srcDrive) throw new Error(`Could not load root drive for space ${space.id}`)

  // Carry over the index.json as the new drive's metadata seed.
  let meta = {}
  try {
    const buf = await srcDrive.drive.get('/index.json')
    if (buf) meta = JSON.parse(b4a.toString(buf))
  } catch {}

  const dst = await autobases.createCollaborativeDrive(meta)

  // Copy every file from the single-writer Hyperdrive into the Autobase view via put-ops.
  const ignore = new Set(['/.dat', '/.git'])
  for await (const entry of srcDrive.drive.list('/')) {
    if (ignore.has(entry.key)) continue
    const buf = await srcDrive.drive.get(entry.key)
    if (!buf) continue
    await dst.base.append({ op: 'put', path: entry.key, data: b4a.toString(buf, 'base64'), encoding: 'base64' })
  }
  await dst.base.update()

  await spacesDb.update(space.id, { rootDriveUrl: dst.url })
  await registerSpace(space, dst.keyStr)
  logger.info('Migrated space root drive to autobase', {
    spaceId: space.id,
    from: space.root_drive_url,
    to: dst.url
  })
  return dst.url
}

// Migrate every Space. Reports progress via onProgress({ spaceId, done, total }).
// Runs on first device-link (ADR-0006). Best-effort per space; a failure is logged and surfaced
// so the caller can retry rather than leaving a half-migrated identity silently.
export async function migrateAllSpaces({ onProgress } = {}) {
  await ensureVault()
  const spaces = await spacesDb.list()
  const failures = []
  const migratedSpaceIds = []
  let done = 0
  for (const space of spaces) {
    try {
      await migrateSpaceRootDrive(space)
      migratedSpaceIds.push(space.id)
    } catch (e) {
      logger.error('Space migration failed', { spaceId: space.id, error: e.toString() })
      failures.push({ spaceId: space.id, error: e.toString() })
    }
    done++
    if (onProgress) onProgress({ spaceId: space.id, done, total: spaces.length })
  }
  // migratedSpaceIds lets the caller reset filesystem's in-memory root-drive cache for the
  // spaces whose URL just changed (kept out of this module to avoid a filesystem import cycle).
  return { total: spaces.length, migrated: migratedSpaceIds.length, migratedSpaceIds, failures }
}

// Candidate side: after pairing into a Vault, mirror its Space index into the local spaces DB so
// the joined Device shows the same Spaces. Idempotent — skips Spaces already present locally
// (matched by Root Drive key). New Spaces' Root Drives are set up lazily on first activation.
export async function syncSpacesFromVault() {
  const sess = await getVault()
  if (!sess) return { created: 0 }
  const vaultSpaces = await listSpaces()
  const local = await spacesDb.list()
  const haveKeys = new Set(
    local.map((s) => (s.root_drive_url ? drives.fromURLToKey(s.root_drive_url) : null)).filter(Boolean)
  )
  let created = 0
  for (const vs of vaultSpaces) {
    if (!vs.rootDriveKey || haveKeys.has(vs.rootDriveKey)) continue
    const space = await spacesDb.create({
      name: vs.name || 'Space',
      icon: vs.icon || 'circle',
      color: vs.color || '#6c6cff'
    })
    await spacesDb.update(space.id, { rootDriveUrl: `hyper://${vs.rootDriveKey}/` })
    created++
  }
  logger.info('Synced spaces from vault', { created })
  return { created }
}

// internal record helpers (Hyperbee view <-> JSON)
// =

async function _putRecord(sess, path, obj) {
  await sess.base.append({ op: 'put', path, data: JSON.stringify(obj) })
  await sess.base.update()
}

async function _delRecord(sess, path) {
  await sess.base.append({ op: 'del', path })
  await sess.base.update()
}

async function _readRecord(sess, path) {
  await sess.base.update()
  const node = await sess.drive.get(path)
  if (!node || !node.value) return null
  try {
    return JSON.parse(b4a.toString(node.value))
  } catch {
    return null
  }
}

async function _readPrefix(sess, prefix) {
  await sess.base.update()
  const out = []
  for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    try {
      out.push(JSON.parse(b4a.toString(node.value)))
    } catch {}
  }
  return out
}
