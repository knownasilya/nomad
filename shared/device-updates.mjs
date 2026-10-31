// nomad/shared/device-updates.mjs
//
// Updating a computer from the phone. After the phone updates itself (or from its Settings →
// Updates and Devices screens), the user can ask one of their computers to install the newest
// release and restart, so the two run the same version again. Both halves are Vault records, so
// only the user's own Devices can make them (every Device in the Vault is a writer, and nobody
// else can write it):
//
//   /.vault/update-requests/<deviceKey>.json   { type, device, version, prerelease, requestedAt, by }
//       "update and restart", written by the asking Device (the phone) for the Device it names.
//       That Device takes it once and deletes it.
//   /.vault/update-status/<deviceKey>.json     { type, device, state, version, requestedAt, by, error, at }
//       how the update is going, written by the Device being updated, so the phone can show it.
//
// `version` in a request is the asking Device's version: the one to reach at least. `prerelease`
// lets the updater take beta releases (the phone runs a beta, or has Beta releases on).
//
// A Device takes a request only when it is fresh (REQUEST_TTL_MS), names this Device, and comes
// from another Device the Vault still lists. A computer that was asleep for a day doesn't restart
// by surprise when it wakes; it updates on its own schedule instead.
//
// Pure: no imports. Used by app/bg/remote-update.js (desktop), mobile/backend/lib/vault-apps.mjs
// and the phone's UI (mobile/lib/deviceUpdates.ts).

export const REQUESTS_PREFIX = '/.vault/update-requests/';
export const STATUS_PREFIX = '/.vault/update-status/';
export const REQUEST_TYPE = 'nomad/update-request';
export const STATUS_TYPE = 'nomad/update-status';

export const REQUEST_TTL_MS = 60 * 60 * 1000;
// How long the computer waits between a downloaded update and its restart, so the user at it can
// see why it is about to close.
export const RESTART_DELAY_MS = 15_000;

// checking → downloading → restarting → updated: the request is on its way.
// current: there was nothing newer. failed / off / unsupported: it didn't happen, and `error` says why.
export const STATES = [
  'checking',
  'downloading',
  'restarting',
  'updated',
  'current',
  'failed',
  'off',
  'unsupported',
];
const BUSY = new Set(['checking', 'downloading', 'restarting']);
// A status that says the computer is busy is stale after this long (it crashed, or lost the Vault).
const BUSY_TTL_MS = 30 * 60 * 1000;

const KEY_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const MAX_ERROR = 300;

export function isDeviceKey(key) {
  return KEY_RE.test(String(key || ''));
}

export function requestPath(deviceKey) {
  if (!isDeviceKey(deviceKey)) throw new Error('Not a Device key');
  return `${REQUESTS_PREFIX}${deviceKey}.json`;
}

export function statusPath(deviceKey) {
  if (!isDeviceKey(deviceKey)) throw new Error('Not a Device key');
  return `${STATUS_PREFIX}${deviceKey}.json`;
}

function cleanVersion(v) {
  const s = typeof v === 'string' ? v.trim().replace(/^v/, '') : '';
  return VERSION_RE.test(s) ? s : null;
}

// A request for `device` to update to at least `version`, from the Device `by`.
export function makeRequest({ device, version, prerelease = false, by }, now = new Date()) {
  requestPath(device); // validates the key
  if (!isDeviceKey(by)) throw new Error('Not a Device key');
  if (by === device) throw new Error('A Device can’t ask itself to update');
  const v = cleanVersion(version);
  return {
    type: REQUEST_TYPE,
    device,
    version: v,
    // A beta can only be reached with prereleases on.
    prerelease: !!prerelease || !!(v && v.includes('-')),
    requestedAt: now.toISOString(),
    by,
  };
}

export function isRequest(rec) {
  return (
    !!rec &&
    rec.type === REQUEST_TYPE &&
    isDeviceKey(rec.device) &&
    isDeviceKey(rec.by) &&
    typeof rec.requestedAt === 'string' &&
    !Number.isNaN(Date.parse(rec.requestedAt))
  );
}

// Whether this Device should act on a request. `devices` is the Vault's Device records.
// Returns { ok: true } or { ok: false, reason } with reason one of:
//   'invalid'   not a request
//   'other'     it names another Device (left for that one)
//   'self'      this Device asked itself
//   'stranger'  the asking Device isn't in the Vault (it was removed)
//   'stale'     older than REQUEST_TTL_MS (or from the future)
export function judgeRequest(rec, { ownKey, devices = [], now = Date.now() } = {}) {
  if (!isRequest(rec)) return { ok: false, reason: 'invalid' };
  if (rec.device !== ownKey) return { ok: false, reason: 'other' };
  if (rec.by === ownKey) return { ok: false, reason: 'self' };
  if (!devices.some((d) => d && d.key === rec.by)) return { ok: false, reason: 'stranger' };
  const age = now - Date.parse(rec.requestedAt);
  if (age > REQUEST_TTL_MS || age < -5 * 60 * 1000) return { ok: false, reason: 'stale' };
  return { ok: true };
}

// What the Device being updated writes as it goes. `request` is the request it answers.
export function makeStatus(
  { device, state, version = null, error = null, request = null },
  now = new Date()
) {
  statusPath(device);
  if (!STATES.includes(state)) throw new Error('Not an update state');
  const err = typeof error === 'string' ? error.trim() : '';
  return {
    type: STATUS_TYPE,
    device,
    state,
    version: cleanVersion(version),
    requestedAt: request?.requestedAt || null,
    by: isDeviceKey(request?.by) ? request.by : null,
    error: err ? (err.length > MAX_ERROR ? err.slice(0, MAX_ERROR - 1) + '…' : err) : null,
    at: now.toISOString(),
  };
}

export function isStatus(rec) {
  return (
    !!rec &&
    rec.type === STATUS_TYPE &&
    isDeviceKey(rec.device) &&
    STATES.includes(rec.state) &&
    typeof rec.at === 'string'
  );
}

// Whether a status says the Device is still working on an update (and isn't stale).
export function isBusy(status, now = Date.now()) {
  if (!isStatus(status) || !BUSY.has(status.state)) return false;
  return now - Date.parse(status.at) < BUSY_TTL_MS;
}

// The line the phone shows under a computer for its update, or '' for nothing to say.
// `pending` is a request it hasn't taken yet.
export function describeUpdate(
  { status = null, pending = null, deviceVersion = null } = {},
  now = Date.now()
) {
  if (pending && isRequest(pending) && now - Date.parse(pending.requestedAt) < REQUEST_TTL_MS) {
    return 'Asked to update. It starts when the computer is online.';
  }
  if (!isStatus(status)) return '';
  const v = status.version ? ` ${status.version}` : '';
  switch (status.state) {
    case 'checking':
      return isBusy(status, now) ? 'Checking for an update…' : '';
    case 'downloading':
      return isBusy(status, now) ? `Downloading${v}…` : '';
    case 'restarting':
      // It restarted with the new version and wrote its Device record before this status.
      if (status.version && deviceVersion === status.version) return `Updated to ${status.version}`;
      return isBusy(status, now) ? `Restarting to install${v}…` : '';
    case 'updated':
      return `Updated to ${status.version || deviceVersion || 'the newest version'}`;
    case 'current':
      return `Already up to date${status.version ? ` (${status.version})` : ''}`;
    case 'off':
      return 'Updating from your other devices is off on that computer.';
    case 'unsupported':
      return status.error || 'Nomad can’t update itself on that computer.';
    case 'failed':
      return `Update failed${status.error ? `: ${status.error}` : ''}`;
    default:
      return '';
  }
}

// Semver order, as the phone's updater compares (mobile/lib/updateRelease.ts compareVersions).
export function compareVersions(a, b) {
  const [aMain, aPre] = splitVersion(a);
  const [bMain, bPre] = splitVersion(b);
  for (let i = 0; i < Math.max(aMain.length, bMain.length); i++) {
    const x = aMain[i] ?? 0;
    const y = bMain[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!aPre.length && !bPre.length) return 0;
  if (!aPre.length) return 1;
  if (!bPre.length) return -1;
  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    const x = aPre[i];
    const y = bPre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return parseInt(x, 10) > parseInt(y, 10) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function splitVersion(v) {
  const s = String(v || '').replace(/^v/, '');
  const dash = s.indexOf('-');
  const main = (dash < 0 ? s : s.slice(0, dash)).split('.').map((n) => parseInt(n, 10) || 0);
  const pre =
    dash < 0
      ? []
      : s
          .slice(dash + 1)
          .split('+')[0]
          .split('.');
  return [main, pre];
}

// The user's computers that run an older Nomad than `version` (the phone's), so the phone can offer
// to update them. A computer with no version on its record is left out: it predates this feature.
export function behindDesktops(devices, { ownKey, version } = {}) {
  const v = cleanVersion(version);
  if (!v) return [];
  return (devices || []).filter(
    (d) =>
      d &&
      isDeviceKey(d.key) &&
      d.key !== ownKey &&
      d.platform === 'desktop' &&
      cleanVersion(d.version) &&
      compareVersions(d.version, v) < 0
  );
}
