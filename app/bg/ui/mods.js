// Mods: the user's own changes to a site (ADR-0023): preset styles, hidden elements, custom CSS
// and JavaScript, each set named and turned on or off from the tab. Records live in the Vault
// (shared/mods.mjs), so the user's other Devices have them; this module keeps them in memory, as
// names.js does, so a page that starts loading gets its Mods at once.
//
// The webview preload (fg/webview-preload/mods.js) applies them: it asks on 'nomad-mods:page'
// (synchronously, before the page paints, so a dark page never flashes white) and again on
// 'nomad-mods:changed'. Its element picker saves picked elements with 'nomad-mods:hide'. The Mods menu
// in the location bar (fg/shell-menus/mods.js) reaches this module through bg.views (tabs/manager.js),
// and My Library → Mods through nomad.vault (web-apis/bg/vault.ts).

import { ipcMain, webContents as allWebContents } from 'electron';
import { EventEmitter } from 'events';
import * as vault from '../hyper/vault';
import * as tabManager from './tabs/manager';
import * as logLib from '../logger';
import * as bst from '../../../shared/mods.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'mods' });

// Electron runs a context-isolated preload in world 999; its globals are out of the page's reach.
const PRELOAD_WORLD = 999;
const CHANGED = 'nomad-mods:changed';
const EMPTY_PAYLOAD = { css: '', scripts: [] };

// Emits 'changed' when any Mod changes, here or on another Device.
export const events = new EventEmitter();

let cache = new Map(); // id -> record
let watchedBase = null;
let timer = null;
/** @type {Promise<any>} */
let writes = Promise.resolve(); // one write at a time, so quick picks don't overwrite each other

export function setup() {
  refresh();
  // A Vault made or joined later (vault.events), and edits from other Devices (the base's updates).
  vault.events.on('changed', () => refresh());

  ipcMain.on('nomad-mods:page', (e) => {
    try {
      e.returnValue = payloadFor(senderUrl(e));
    } catch {
      e.returnValue = EMPTY_PAYLOAD;
    }
  });
  ipcMain.handle('nomad-mods:page-async', (e) => payloadFor(senderUrl(e)));

  // The element picker picked an element: hide it with the given Mod, or the page's first one.
  ipcMain.handle('nomad-mods:hide', async (e, { modId, selector } = {}) => {
    const url = senderUrl(e);
    if (!url) return { error: 'Mods don’t work on this page' };
    try {
      const rec = await addHidden(url, modId, selector);
      return { modId: rec.id, name: rec.name };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  });
  ipcMain.handle('nomad-mods:unhide', async (e, { modId, selector } = {}) => {
    const url = senderUrl(e);
    const b = cache.get(modId);
    if (!url || !b || !bst.matchesSite(b.site, url)) return { error: 'No such Mod on this page' };
    try {
      await save({ id: b.id, hide: b.hide.filter((s) => s !== selector) });
      return { modId: b.id };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  });

  // Every page with Mods takes the change in place (its scripts, on its next load).
  events.on('changed', () => {
    for (const wc of allWebContents.getAllWebContents()) {
      if (!wc.isDestroyed() && bst.pageHost(wc.getURL())) wc.send(CHANGED, {});
    }
  });
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 300);
}

export async function refresh() {
  let sess = null;
  try {
    sess = await vault.getVault();
  } catch {
    return;
  }
  if (sess && sess.base !== watchedBase) {
    if (watchedBase) watchedBase.removeListener('update', scheduleRefresh);
    watchedBase = sess.base;
    watchedBase.on('update', scheduleRefresh);
  }
  const records = sess ? (await vault.listAppRecords(bst.MODS_PREFIX)).filter(bst.isMod) : [];
  const next = new Map(records.map((r) => [r.id, r]));
  const same =
    next.size === cache.size &&
    [...next].every(([k, r]) => cache.get(k)?.updatedAt === r.updatedAt);
  if (same) return;
  cache = next;
  events.emit('changed');
}

// Data
// =

// Every Mod, by site, then oldest first.
export function list() {
  return bst.sortMods([...cache.values()]).sort((a, b) => a.site.localeCompare(b.site));
}

export function get(id) {
  return cache.get(id) || null;
}

// The page's Mods, on or off, oldest first.
export function forUrl(url) {
  return bst.modsFor(url, [...cache.values()]);
}

// For the location bar: null on a page Mods can't change, else how many Mods the site has and
// how many are on.
export function stateFor(url) {
  if (!bst.pageHost(url)) return null;
  const all = forUrl(url);
  return { count: all.length, on: all.filter((b) => b.enabled).length };
}

function payloadFor(url) {
  return url ? bst.pagePayload(url, [...cache.values()]) : EMPTY_PAYLOAD;
}

// Save a Mod: a new one (no id, or an id not stored yet) or changes to one. Fields left out keep
// their values. Writes go one at a time, each on the latest record.
/** @param {{ id?: string, name?: string, site?: string, enabled?: boolean, presets?: string[], hide?: string[], css?: string, js?: string }} fields */
export function save(fields) {
  const run = writes.then(async () => {
    const id = fields.id || bst.newModId();
    const prev = cache.get(id) || null;
    const rec = bst.makeMod({ ...fields, id }, prev);
    await vault.putAppRecord(bst.modPath(id), rec);
    cache.set(id, rec);
    events.emit('changed');
    return rec;
  });
  writes = run.catch(() => {});
  return run;
}

export function remove(id) {
  const run = writes.then(async () => {
    await vault.delAppRecord(bst.modPath(id));
    if (cache.delete(id)) events.emit('changed');
  });
  writes = run.catch(() => {});
  return run;
}

// The Mod that quick changes from the tab go to: the page's first one that is on, or a new one
// named after the site.
async function quickTarget(url, modId = null) {
  const b = modId ? cache.get(modId) : forUrl(url).find((x) => x.enabled);
  if (b && bst.matchesSite(b.site, url)) return b;
  if (modId) throw new Error('No such Mod on this page');
  const site = bst.siteOf(url);
  if (!site) throw new Error('Mods don’t work on this page');
  return save({ site, name: site });
}

async function addHidden(url, modId, selector) {
  if (!bst.isHideSelector(selector)) throw new Error('That element can’t be hidden');
  const b = await quickTarget(url, modId);
  if (b.hide.includes(selector)) return b;
  return save({ id: b.id, hide: [...b.hide, selector], enabled: true });
}

// The Mods menu
// =

// What the menu shows for the page in `wc`.
export function menuState(wc) {
  const url = wc?.getURL() || '';
  const site = bst.siteOf(url);
  if (!site) return { site: null, mods: [], presets: [] };
  const all = forUrl(url);
  const on = all.filter((b) => b.enabled);
  return {
    site,
    mods: all.map((b) => ({
      id: b.id,
      name: b.name,
      site: b.site,
      enabled: b.enabled,
      summary: bst.describeMod(b),
    })),
    presets: bst.PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      on: on.some((b) => b.presets.includes(p.id)),
    })),
  };
}

// Turn a Mod on or off. Its CSS comes and goes in place; a script can't be taken back from a
// page, so turning off a Mod with JavaScript reloads the tab.
export async function setEnabled(wc, id, enabled) {
  const b = cache.get(id);
  if (!b || !bst.matchesSite(b.site, wc.getURL())) return;
  await save({ id, enabled: !!enabled });
  if (!enabled && b.js.trim()) wc.reload();
}

// A preset from the menu: off in every Mod on the site that has it, or on in the quick target.
export async function togglePreset(wc, presetId) {
  const url = wc.getURL();
  if (!bst.presetById(presetId)) return;
  const having = forUrl(url).filter((b) => b.enabled && b.presets.includes(presetId));
  if (having.length) {
    for (const b of having)
      await save({ id: b.id, presets: b.presets.filter((p) => p !== presetId) });
    return;
  }
  const b = await quickTarget(url);
  await save({ id: b.id, presets: [...b.presets, presetId] });
}

// Start picking elements to hide. `modId` is the Mod they go to (null: the page's first one
// that is on, made when needed); `at` is a point to start from, the right-click's.
export async function startPicking(wc, modId = null, at = null) {
  if (!wc || wc.isDestroyed() || !bst.pageHost(wc.getURL())) return;
  const b = modId ? cache.get(modId) : null;
  wc.focus();
  const args = JSON.stringify({ modId: b ? b.id : null, name: b ? b.name : null, at });
  await callPage(wc, `startPicking(${args})`);
}

// My Library → Mods, filtered to the site, with one Mod open when `id` is given, or a new
// one for the site when `isNew`.
export function openEditor(wc, { site = null, id = null, isNew = false } = {}) {
  const win = tabManager.findContainingWindow(wc);
  if (!win) return;
  const q = new URLSearchParams();
  if (site) q.set('site', site);
  if (id) q.set('id', id);
  if (isNew) q.set('new', '1');
  const tab = tabManager.findTab(wc);
  /** @type {any} create() types its options from its defaults, which name every option */
  const opts = { setActive: true, adjacentActive: true, spaceId: tab?.spaceId };
  const query = q.toString();
  tabManager.create(win, `nomad://library/mods${query ? '?' + query : ''}`, opts);
}

// The page context menu: pick elements to hide, starting from the one right-clicked.
export function menuItems(wc, props) {
  if (!bst.pageHost(props.pageURL) || (props.frame && props.frame.parent)) return [];
  return [
    {
      label: 'Hide Elements on This Site…',
      click: () => startPicking(wc, null, { x: props.x, y: props.y }),
    },
  ];
}

// The tab context menu: a new Mod for the tab's site, and its Mods to turn on or off, any
// number at once. Empty on a page Mods can't change.
export function tabMenuItems(wc) {
  const url = wc && !wc.isDestroyed() ? wc.getURL() : '';
  const site = bst.siteOf(url);
  if (!site) return [];
  const all = forUrl(url);
  return [
    {
      label: `New Mod for ${site}…`,
      click: () => openEditor(wc, { site, isNew: true }),
    },
    {
      label: 'Mods',
      submenu: [
        ...(all.length
          ? all.map((b) => ({
              label: b.site === site ? b.name : `${b.name} (${b.site})`,
              type: 'checkbox',
              checked: b.enabled,
              click: (item) => setEnabled(wc, b.id, item.checked),
            }))
          : [{ label: `No Mods for ${site}`, enabled: false }]),
        { type: 'separator' },
        { label: 'Manage Mods…', click: () => openEditor(wc, { site }) },
      ],
    },
  ];
}

// The page's address, when the IPC came from a top frame.
function senderUrl(e) {
  const frame = e.senderFrame;
  if (!frame || frame.parent) return null;
  return bst.pageHost(frame.url) ? frame.url : null;
}

function callPage(wc, expr) {
  const code = `(window.__nomadMods ? window.__nomadMods.${expr} : null)`;
  return wc.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD, [{ code }]).catch((err) => {
    logger.warn('Could not reach the page’s Mods', { error: err?.message });
    return null;
  });
}
