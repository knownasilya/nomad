// nomad/shared/drive-writers.mjs
//
// Writer grants (ADR-0026 §2): one of the user's Devices asks for its own writer key for one Drive
// to be added to that Drive, and any of the user's Devices that can write the Drive adds it. The
// request is a Vault record, so only the user's own Devices can make one, and the grant needs no
// prompt.
//
//   /.vault/drive-writers/<driveKey>/<writerKey>.json
//   { type, drive, writerKey, device, name, requestedAt, grantedBy?, grantedAt? }
//
// `drive` is the Drive's key, `writerKey` the asking Device's writer key for that Drive (the `local`
// core of the Drive's own namespace on that Device, ADR-0026 §1), `device` its Vault Device key and
// `name` its name. The Device that adds the Writer sets `grantedBy` (its Device key) and
// `grantedAt`. Pure: no imports. Used by app/bg/hyper/drive-writers.js (and the phone later).

export const DRIVE_WRITERS_PREFIX = '/.vault/drive-writers/';
export const GRANT_TYPE = 'nomad/drive-writer';

const KEY = /^[0-9a-f]{64}$/;

export function isKey(s) {
  return typeof s === 'string' && KEY.test(s);
}

export function grantsPrefix(drive = null) {
  if (drive == null) return DRIVE_WRITERS_PREFIX;
  if (!isKey(drive)) throw new Error('Not a drive key: ' + drive);
  return DRIVE_WRITERS_PREFIX + drive + '/';
}

export function grantPath(drive, writerKey) {
  if (!isKey(writerKey)) throw new Error('Not a writer key: ' + writerKey);
  return grantsPrefix(drive) + writerKey + '.json';
}

// The record a Device writes to ask for `writerKey` on `drive`.
export function makeGrantRequest({ drive, writerKey, device, name }, now = new Date().toISOString()) {
  grantPath(drive, writerKey); // validates both keys
  if (!isKey(device)) throw new Error('Not a device key: ' + device);
  return {
    type: GRANT_TYPE,
    drive,
    writerKey,
    device,
    name: String(name || 'A device').slice(0, 100),
    requestedAt: now,
  };
}

export function isGrant(rec) {
  return !!rec && rec.type === GRANT_TYPE && isKey(rec.drive) && isKey(rec.writerKey) && isKey(rec.device);
}

export function markGranted(rec, by, now = new Date().toISOString()) {
  return { ...rec, grantedBy: by, grantedAt: now };
}

// The requests a Device should grant now: not granted yet, from a Device still in the Vault, for a
// Drive `canWrite(drive)` says this Device writes. A Device never grants its own request: it can't
// write the Drive, or it wouldn't have asked.
export function grantsToMake(records, { devices = [], self = null, canWrite = () => false } = {}) {
  const listed = new Set(devices);
  return (records || []).filter(
    (r) => isGrant(r) && !r.grantedBy && listed.has(r.device) && r.device !== self && canWrite(r.drive)
  );
}

// The records of Devices no longer in the Vault, for a Drive `canWrite(drive)` says this Device
// writes: take the writer off (if it was added) and drop the record. Nothing when `devices` doesn't
// list `self`, as a list that misses this Device can't be trusted to say who was removed.
export function grantsToRevoke(records, { devices = [], self = null, canWrite = () => false } = {}) {
  const listed = new Set(devices);
  if (!self || !listed.has(self)) return [];
  return (records || []).filter((r) => isGrant(r) && !listed.has(r.device) && canWrite(r.drive));
}

// This Device's request for `drive`, if it made one: { pending, granted } or null.
export function requestState(records, { drive, writerKey }) {
  const rec = (records || []).find((r) => isGrant(r) && r.drive === drive && r.writerKey === writerKey);
  if (!rec) return null;
  return { pending: !rec.grantedBy, granted: !!rec.grantedBy, requestedAt: rec.requestedAt, grantedAt: rec.grantedAt || null };
}
