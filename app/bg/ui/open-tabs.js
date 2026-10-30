// Open tabs on the user's other Devices (shared/open-tabs.mjs). This Device writes its own open
// tabs, grouped by Space, to /.vault/tabs/<its key>.json a few seconds after they change, and
// nomad://history ("Tabs From Other Devices") reads the other Devices' records through
// nomad.vault.listDeviceTabs (web-apis/bg/vault.ts).
//
// It writes only when this Device has a writable Vault that another Device has joined, never
// makes a Vault, and skips a write that would change nothing. The `sync_open_tabs` setting turns
// it off for this Device, which also deletes this Device's record.

import { app, BrowserWindow } from 'electron';
import b4a from 'b4a';
import * as vault from '../hyper/vault';
import * as drives from '../hyper/drives';
import * as devicePresence from '../hyper/device-presence';
import * as spacesDb from '../dbs/spaces';
import * as settingsDb from '../dbs/settings';
import * as tabManager from './tabs/manager';
import * as logLib from '../logger';
import * as ot from '../../../shared/open-tabs.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'open-tabs' });

const SETTING = 'sync_open_tabs';
const DEBOUNCE_MS = 5000;
const RETRY_MS = 60_000; // a Vault made, joined or made writable later

let timer = null;
let writing = Promise.resolve();

export function setup() {
  const watchWindow = (win) => {
    win.on('custom-pages-updated', schedule);
    win.on('closed', schedule);
  };
  for (const win of BrowserWindow.getAllWindows()) watchWindow(win);
  app.on('browser-window-created', (_e, win) => watchWindow(win));
  spacesDb.events.on('changed', schedule);
  settingsDb.on('set:' + SETTING, () => schedule());
  vault.events.on('changed', () => schedule());
  setInterval(schedule, RETRY_MS).unref?.();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    writing = writing
      .then(publish)
      .catch((err) => logger.warn('Could not publish open tabs', { error: err?.message }));
  }, DEBOUNCE_MS);
}

async function enabled() {
  return Number((await settingsDb.get(SETTING)) ?? 1) !== 0;
}

function ownKey(sess) {
  return sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
}

function rootKeyOf(space) {
  try {
    return space?.root_drive_url ? drives.fromURLToKey(space.root_drive_url) : null;
  } catch {
    return null;
  }
}

// This Device's open tabs as [{ rootDriveKey, name, tabs }], every window and every Space.
export function collect() {
  const bySpace = new Map(); // space id -> tabs
  const all = tabManager.getAllAcrossWindows();
  for (const winId in all) {
    for (const tab of all[winId] || []) {
      if (tab.isHidden) continue;
      const list = bySpace.get(tab.spaceId) || [];
      list.push({
        url: tab.url || tab.loadingURL,
        title: tab.title,
        pinned: tab.isPinned,
        active: tab.isActive,
      });
      bySpace.set(tab.spaceId, list);
    }
  }
  const out = [];
  for (const space of spacesDb.getCachedAll()) {
    const rootDriveKey = rootKeyOf(space);
    const tabs = bySpace.get(space.id);
    if (rootDriveKey && tabs?.length) out.push({ rootDriveKey, name: space.name, tabs });
  }
  return ot.normalizeSpaces(out);
}

async function publish() {
  const sess = await vault.getVault();
  if (!sess || !sess.writable) return;
  const key = ownKey(sess);
  if (!key) return;
  const path = ot.recordPath(key);
  const existing = await vault.readAppRecord(path);
  if (!(await enabled())) {
    if (existing) {
      await vault.delAppRecord(path);
      logger.info('Stopped sharing open tabs');
    }
    return;
  }
  // Nobody to show them to: don't grow the Vault's log for nothing.
  if (!existing && (await vault.otherDeviceCount()) === 0) return;
  const spaces = collect();
  if (ot.sameTabs(existing, spaces)) return;
  await vault.putAppRecord(path, ot.buildRecord(key, spaces));
}

// Every other Device's open tabs, the caller's Space first. `currentSpace` is a Root Drive key.
export async function listOtherDevices(currentSpace = null) {
  const sess = await vault.getVault();
  if (!sess) return { devices: [], linked: false, sharing: await enabled() };
  const [records, devices] = await Promise.all([
    vault.listAppRecords(ot.OPEN_TABS_PREFIX),
    vault.listDevices(),
  ]);
  return {
    devices: ot.otherDevicesTabs(records, {
      ownKey: ownKey(sess),
      devices,
      connected: new Set(devicePresence.connectedDevices()),
      currentSpace,
    }),
    linked: devices.length > 1,
    sharing: await enabled(),
  };
}
