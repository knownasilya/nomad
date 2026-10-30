// nomad/shared/open-tabs.mjs
//
// Open tabs on the user's other Devices, like Chrome's "Tabs from other devices". Each Device
// publishes the tabs it has open, grouped by Space, to its own record in the Vault:
//
//   /.vault/tabs/<deviceKey>.json   { type, device, updatedAt, spaces: [{ rootDriveKey, name, tabs }] }
//
// One record per Device, written only by that Device, so two Devices never overwrite each other.
// A tab is { url, title, pinned?, active? }. Spaces are keyed by Root Drive key, which is the same on
// every Device that shares the Space. Other Devices only read these records: closing a tab on one
// Device never closes it elsewhere.
//
// Pure: no imports. Used by app/bg/ui/open-tabs.js (desktop) and mobile/backend (the phone).

export const OPEN_TABS_PREFIX = '/.vault/tabs/';
export const OPEN_TABS_TYPE = 'nomad/open-tabs';

const KEY_RE = /^[0-9a-f]{64}$/;
const SCHEMES = ['http:', 'https:', 'hyper:'];
const MAX_URL = 2048;
const MAX_TITLE = 300;
const MAX_NAME = 80;
const MAX_TABS = 200; // per Space
const MAX_SPACES = 50;

export function recordPath(deviceKey) {
  if (!KEY_RE.test(String(deviceKey || ''))) throw new Error('Not a device key');
  return `${OPEN_TABS_PREFIX}${deviceKey}.json`;
}

// Whether another Device could open this URL. Only web and hyper:// pages: nomad:// pages, the
// new tab page and file:// are this Device's own. hyper://private/ names this Device's copy of the
// Space's Root Drive, which may be a different Drive on the other Device.
export function isSyncableUrl(url) {
  const s = String(url || '');
  if (!s || s.length > MAX_URL) return false;
  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (!SCHEMES.includes(u.protocol)) return false;
  if (u.protocol === 'hyper:' && u.hostname.toLowerCase() === 'private') return false;
  return !!u.hostname;
}

function clip(s, max) {
  const str = typeof s === 'string' ? s.trim() : '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function normalizeTab(tab) {
  if (!tab || !isSyncableUrl(tab.url)) return null;
  const out = { url: String(tab.url), title: clip(tab.title, MAX_TITLE) };
  if (tab.pinned) out.pinned = true;
  if (tab.active) out.active = true;
  return out;
}

// [{ rootDriveKey, name, tabs }] cleaned up: tabs another Device can't open are dropped, the same
// URL twice in a Space is kept once, Spaces without a Root Drive key or without tabs are left out.
export function normalizeSpaces(spaces) {
  const out = [];
  const seenSpaces = new Set();
  for (const sp of Array.isArray(spaces) ? spaces : []) {
    if (!sp || !KEY_RE.test(String(sp.rootDriveKey || '')) || seenSpaces.has(sp.rootDriveKey)) continue;
    const seen = new Set();
    const tabs = [];
    for (const t of Array.isArray(sp.tabs) ? sp.tabs : []) {
      const tab = normalizeTab(t);
      if (!tab) continue;
      if (seen.has(tab.url)) {
        // Keep the flags of a duplicate (a pinned copy of an open page stays pinned).
        const first = tabs.find((x) => x.url === tab.url);
        if (tab.pinned) first.pinned = true;
        if (tab.active) first.active = true;
        continue;
      }
      seen.add(tab.url);
      tabs.push(tab);
      if (tabs.length >= MAX_TABS) break;
    }
    if (!tabs.length) continue;
    seenSpaces.add(sp.rootDriveKey);
    out.push({ rootDriveKey: sp.rootDriveKey, name: clip(sp.name, MAX_NAME) || 'Space', tabs });
    if (out.length >= MAX_SPACES) break;
  }
  return out;
}

// The record this Device writes.
export function buildRecord(deviceKey, spaces, now = new Date()) {
  recordPath(deviceKey); // validates the key
  return {
    type: OPEN_TABS_TYPE,
    device: deviceKey,
    updatedAt: now.toISOString(),
    spaces: normalizeSpaces(spaces),
  };
}

// True when a write would change nothing another Device sees (updatedAt aside).
export function sameTabs(record, spaces) {
  if (!record || !Array.isArray(record.spaces)) return false;
  return JSON.stringify(record.spaces) === JSON.stringify(normalizeSpaces(spaces));
}

// Every other Device's tabs, for display: [{ deviceKey, name, platform, connected, updatedAt, spaces }].
// Leaves out this Device, Devices no longer in the Vault (removed ones), and Devices with no tabs.
// `devices` are the Vault's device records; `connected` is a Set of device keys connected now.
// When `currentSpace` (a Root Drive key) is given, that Space comes first on each Device.
// Most recently updated Device first.
export function otherDevicesTabs(records, { ownKey = null, devices = [], connected = null, currentSpace = null } = {}) {
  const byKey = new Map((devices || []).filter((d) => d && d.key).map((d) => [d.key, d]));
  const out = [];
  for (const rec of records || []) {
    if (!rec || rec.type !== OPEN_TABS_TYPE || !KEY_RE.test(String(rec.device || ''))) continue;
    if (rec.device === ownKey) continue;
    const device = byKey.get(rec.device);
    if (!device) continue;
    const spaces = normalizeSpaces(rec.spaces);
    if (!spaces.length) continue;
    if (currentSpace) {
      spaces.sort((a, b) => Number(b.rootDriveKey === currentSpace) - Number(a.rootDriveKey === currentSpace));
    }
    out.push({
      deviceKey: rec.device,
      name: device.name || 'Device',
      platform: device.platform || 'unknown',
      connected: connected ? connected.has(rec.device) : false,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : null,
      spaces,
    });
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}
