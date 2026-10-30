// @ts-nocheck
//
// Writer grants on desktop (ADR-0026 §2, ADR-0029 step 2). A Device asks to edit a Drive one of the
// user's other Devices can write by putting a request in the Vault; every desktop watches the Vault
// and adds the asking Device's writer key to any Drive it can write. No prompt: only the user's own
// Devices write the Vault. Records and rules: shared/drive-writers.mjs.
//
// The asking Device's writer key is its own key for that Drive: autobases.js opens a Drive this
// Device didn't create in `autobase:<key>`, whose `local` core belongs to that Drive alone. A Drive
// this Device first opened before that rule keeps the root `local` core, which can't be granted
// (a joined Device's Vault holds it), so status() calls it `legacy`.

import b4a from 'b4a';
import * as logLib from '../logger';
import * as autobases from './autobases';
import * as vault from './vault';
import {
  DRIVE_WRITERS_PREFIX,
  grantPath,
  makeGrantRequest,
  markGranted,
  grantsToMake,
  grantsToRevoke,
  requestState,
  isGrant,
  isKey,
} from '../../../shared/drive-writers.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'drive-writers' });

const hex = (buf) => (buf ? b4a.toString(buf, 'hex') : null);

async function ownDevice() {
  const sess = await vault.getVault();
  return sess ? hex(sess.base?.local?.key) : null;
}

async function listGrants() {
  return vault.listAppRecords(DRIVE_WRITERS_PREFIX);
}

// What this Device can do about editing the Drive `key`:
// { writable, canAsk, legacy, linked, request: { pending, granted, requestedAt } | null }.
// `canAsk` needs a Vault shared with another Device, and a writer key of this Drive's own.
export async function status(key) {
  if (!isKey(key) || !(await autobases.isKnownAutobase(key))) {
    return { writable: false, canAsk: false, legacy: false, linked: false, request: null };
  }
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  const writerKey = hex(sess?.base?.local?.key);
  const device = await ownDevice();
  const linked = (await vault.otherDeviceCount().catch(() => 0)) > 0;
  const legacy = !!writerKey && writerKey === device;
  const request = writerKey ? requestState(await listGrants(), { drive: key, writerKey }) : null;
  const writable = !!sess?.writable;
  return { writable, canAsk: !writable && linked && !legacy && !!device, legacy, linked, request };
}

// Ask the user's other Devices to let this one edit the Drive `key`. Returns status().
export async function request(key) {
  const st = await status(key);
  if (st.writable) return st;
  if (st.legacy) {
    throw new Error('This drive was opened on this device before each drive had its own key, so it can’t be edited here yet');
  }
  if (!st.linked) throw new Error('Link another device first. A device that can edit this drive allows this one.');
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  const writerKey = hex(sess.base.local.key);
  const device = await ownDevice();
  const own = (await vault.listDevices()).find((d) => d.key === device);
  const rec = makeGrantRequest({ drive: key, writerKey, device, name: own?.name });
  await vault.putAppRecord(grantPath(key, writerKey), rec);
  logger.info('Asked to edit a drive', { drive: key, writerKey });
  return status(key);
}

// Grant the requests this Device can, and take the writer keys of removed Devices off: only for
// Drives it already knows and can write. It never loads a Drive it doesn't know just to check.
let _syncing = null;
export function sync() {
  if (!_syncing) _syncing = _sync().finally(() => (_syncing = null));
  return _syncing;
}

async function _sync() {
  const sess = await vault.getVault();
  if (!sess || !sess.writable) return { granted: 0, revoked: 0 };
  const self = hex(sess.base.local.key);
  const devices = (await vault.listDevices()).map((d) => d.key);
  let records = (await listGrants()).filter(isGrant);
  if (devices.some((d) => d !== self) && (await askForSpaceRoots(records, self))) {
    records = (await listGrants()).filter(isGrant);
  }
  if (!records.length) return { granted: 0, revoked: 0 };
  const listed = new Set(devices);
  const writable = new Set();
  const checked = new Set();
  for (const r of records) {
    if ((r.grantedBy && listed.has(r.device)) || checked.has(r.drive)) continue;
    checked.add(r.drive);
    if (!(await autobases.isKnownAutobase(r.drive))) continue;
    const drive = await autobases.getOrLoadCollaborativeDrive(r.drive).catch(() => null);
    if (drive?.writable) writable.add(r.drive);
  }
  const opts = { devices, self, canWrite: (d) => writable.has(d) };
  let granted = 0;
  let revoked = 0;
  for (const r of grantsToMake(records, opts)) {
    try {
      const drive = await autobases.getOrLoadCollaborativeDrive(r.drive);
      await drive.base.append({ addWriter: r.writerKey });
      await drive.base.update();
      await vault.putAppRecord(grantPath(r.drive, r.writerKey), markGranted(r, self));
      granted++;
      logger.info('Granted a device writer key on a drive', { drive: r.drive, device: r.device });
    } catch (e) {
      logger.warn('Could not grant a writer key', { drive: r.drive, error: e.toString() });
    }
  }
  // A removed Device's grants. A record for a Drive only another Device writes stays for that one.
  for (const r of grantsToRevoke(records, opts)) {
    try {
      if (r.grantedBy) {
        const drive = await autobases.getOrLoadCollaborativeDrive(r.drive);
        await drive.base.append({ removeWriter: r.writerKey });
        await drive.base.update();
      }
      await vault.delAppRecord(grantPath(r.drive, r.writerKey));
      revoked++;
      logger.info('Revoked a removed device’s writer key on a drive', { drive: r.drive, device: r.device });
    } catch (e) {
      logger.warn('Could not revoke a writer key', { drive: r.drive, error: e.toString() });
    }
  }
  return { granted, revoked };
}

// A Space's Root Drive holds its Library (bookmarks, /drives.json), so every Device of the user
// should write it without asking. Fan-out at pairing adds the Vault Device key (multi-device-protocol
// §3), which a Root Drive opened in its own namespace doesn't use; ask for that namespace's key.
// Only Root Drives already open here. Returns how many it asked for.
async function askForSpaceRoots(records, self) {
  let asked = 0;
  for (const space of await vault.listSpaces()) {
    const key = space?.rootDriveKey;
    const drive = isKey(key) ? autobases.getCollaborativeDrive(key) : null;
    const writerKey = hex(drive?.base?.local?.key);
    if (!drive || drive.writable || !writerKey || writerKey === self) continue;
    if (requestState(records, { drive: key, writerKey })) continue;
    try {
      const own = (await vault.listDevices()).find((d) => d.key === self);
      const rec = makeGrantRequest({ drive: key, writerKey, device: self, name: own?.name });
      await vault.putAppRecord(grantPath(key, writerKey), rec);
      asked++;
      logger.info('Asked to edit a Space Root Drive', { drive: key, writerKey });
    } catch (e) {
      logger.warn('Could not ask to edit a Space Root Drive', { drive: key, error: e.toString() });
    }
  }
  return asked;
}

// Sync as requests and Device changes replicate in, and once at startup. Follows this Device onto
// another Vault. Call it again once this Device has a Vault (after pairing); it attaches only once.
let _watchedBase = null;
let _timer = null;
let _listening = false;
const run = () => {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    sync().catch((e) => logger.warn('Syncing writer keys failed', { error: e.toString() }));
  }, 1500);
};
const attach = () =>
  vault
    .getVault()
    .then((sess) => {
      if (!sess || sess.base === _watchedBase) return;
      if (_watchedBase) _watchedBase.removeListener('update', run);
      _watchedBase = sess.base;
      _watchedBase.on('update', run);
      run();
    })
    .catch(() => {});

export function watch() {
  if (!_listening) {
    _listening = true;
    vault.events.on('changed', attach);
  }
  return attach();
}
