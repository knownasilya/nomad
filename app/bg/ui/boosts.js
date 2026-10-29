// Boosts: the user's own changes to a site (ADR-0023): preset styles, hidden elements, custom CSS
// and JavaScript, each set named and turned on or off from the tab. Records live in the Vault
// (shared/boosts.mjs), so the user's other Devices have them; this module keeps them in memory, as
// names.js does, so a page that starts loading gets its Boosts at once.
//
// The webview preload (fg/webview-preload/boosts.js) applies them: it asks on 'nomad-boosts:page'
// (synchronously, before the page paints, so a dark page never flashes white) and again on
// 'nomad-boosts:changed'. Its zapper saves picked elements with 'nomad-boosts:zap'. The Boosts menu
// in the location bar (fg/shell-menus/boosts.js) reaches this module through bg.views (tabs/manager.js),
// and My Library → Boosts through nomad.vault (web-apis/bg/vault.ts).

import { ipcMain, webContents as allWebContents } from 'electron';
import { EventEmitter } from 'events';
import * as vault from '../hyper/vault';
import * as tabManager from './tabs/manager';
import * as logLib from '../logger';
import * as bst from '../../../shared/boosts.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'boosts' });

// Electron runs a context-isolated preload in world 999; its globals are out of the page's reach.
const PRELOAD_WORLD = 999;
const CHANGED = 'nomad-boosts:changed';
const EMPTY_PAYLOAD = { css: '', scripts: [] };

// Emits 'changed' when any Boost changes, here or on another Device.
export const events = new EventEmitter();

let cache = new Map(); // id -> record
let watchedBase = null;
let timer = null;
/** @type {Promise<any>} */
let writes = Promise.resolve(); // one write at a time, so quick zaps don't overwrite each other

export function setup() {
  refresh();
  // A Vault made or joined later (vault.events), and edits from other Devices (the base's updates).
  vault.events.on('changed', () => refresh());

  ipcMain.on('nomad-boosts:page', (e) => {
    try {
      e.returnValue = payloadFor(senderUrl(e));
    } catch {
      e.returnValue = EMPTY_PAYLOAD;
    }
  });
  ipcMain.handle('nomad-boosts:page-async', (e) => payloadFor(senderUrl(e)));

  // The zapper picked an element: hide it with the given Boost, or the page's first one.
  ipcMain.handle('nomad-boosts:zap', async (e, { boostId, selector } = {}) => {
    const url = senderUrl(e);
    if (!url) return { error: 'This page can’t be boosted' };
    try {
      const rec = await addHidden(url, boostId, selector);
      return { boostId: rec.id, name: rec.name };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  });
  ipcMain.handle('nomad-boosts:unzap', async (e, { boostId, selector } = {}) => {
    const url = senderUrl(e);
    const b = cache.get(boostId);
    if (!url || !b || !bst.matchesSite(b.site, url)) return { error: 'No such Boost on this page' };
    try {
      await save({ id: b.id, hide: b.hide.filter((s) => s !== selector) });
      return { boostId: b.id };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  });

  // Every page with Boosts takes the change in place (its scripts, on its next load).
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
  const records = sess ? (await vault.listAppRecords(bst.BOOSTS_PREFIX)).filter(bst.isBoost) : [];
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

// Every Boost, by site, then oldest first.
export function list() {
  return bst.sortBoosts([...cache.values()]).sort((a, b) => a.site.localeCompare(b.site));
}

export function get(id) {
  return cache.get(id) || null;
}

// The page's Boosts, on or off, oldest first.
export function forUrl(url) {
  return bst.boostsFor(url, [...cache.values()]);
}

// For the location bar: null on a page Boosts can't change, else how many Boosts the site has and
// how many are on.
export function stateFor(url) {
  if (!bst.pageHost(url)) return null;
  const all = forUrl(url);
  return { count: all.length, on: all.filter((b) => b.enabled).length };
}

function payloadFor(url) {
  return url ? bst.pagePayload(url, [...cache.values()]) : EMPTY_PAYLOAD;
}

// Save a Boost: a new one (no id, or an id not stored yet) or changes to one. Fields left out keep
// their values. Writes go one at a time, each on the latest record.
/** @param {{ id?: string, name?: string, site?: string, enabled?: boolean, presets?: string[], hide?: string[], css?: string, js?: string }} fields */
export function save(fields) {
  const run = writes.then(async () => {
    const id = fields.id || bst.newBoostId();
    const prev = cache.get(id) || null;
    const rec = bst.makeBoost({ ...fields, id }, prev);
    await vault.putAppRecord(bst.boostPath(id), rec);
    cache.set(id, rec);
    events.emit('changed');
    return rec;
  });
  writes = run.catch(() => {});
  return run;
}

export function remove(id) {
  const run = writes.then(async () => {
    await vault.delAppRecord(bst.boostPath(id));
    if (cache.delete(id)) events.emit('changed');
  });
  writes = run.catch(() => {});
  return run;
}

// The Boost that quick changes from the tab go to: the page's first one that is on, or a new one
// named after the site.
async function quickTarget(url, boostId = null) {
  const b = boostId ? cache.get(boostId) : forUrl(url).find((x) => x.enabled);
  if (b && bst.matchesSite(b.site, url)) return b;
  if (boostId) throw new Error('No such Boost on this page');
  const site = bst.siteOf(url);
  if (!site) throw new Error('This page can’t be boosted');
  return save({ site, name: site });
}

async function addHidden(url, boostId, selector) {
  if (!bst.isHideSelector(selector)) throw new Error('That element can’t be hidden');
  const b = await quickTarget(url, boostId);
  if (b.hide.includes(selector)) return b;
  return save({ id: b.id, hide: [...b.hide, selector], enabled: true });
}

// The Boosts menu
// =

// What the menu shows for the page in `wc`.
export function menuState(wc) {
  const url = wc?.getURL() || '';
  const site = bst.siteOf(url);
  if (!site) return { site: null, boosts: [], presets: [] };
  const all = forUrl(url);
  const on = all.filter((b) => b.enabled);
  return {
    site,
    boosts: all.map((b) => ({
      id: b.id,
      name: b.name,
      site: b.site,
      enabled: b.enabled,
      summary: bst.describeBoost(b),
    })),
    presets: bst.PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      on: on.some((b) => b.presets.includes(p.id)),
    })),
  };
}

// Turn a Boost on or off. Its CSS comes and goes in place; a script can't be taken back from a
// page, so turning off a Boost with JavaScript reloads the tab.
export async function setEnabled(wc, id, enabled) {
  const b = cache.get(id);
  if (!b || !bst.matchesSite(b.site, wc.getURL())) return;
  await save({ id, enabled: !!enabled });
  if (!enabled && b.js.trim()) wc.reload();
}

// A preset from the menu: off in every Boost on the site that has it, or on in the quick target.
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

// Start picking elements to hide. `boostId` is the Boost they go to (null: the page's first one
// that is on, made when needed); `at` is a point to start from, the right-click's.
export async function startZap(wc, boostId = null, at = null) {
  if (!wc || wc.isDestroyed() || !bst.pageHost(wc.getURL())) return;
  const b = boostId ? cache.get(boostId) : null;
  wc.focus();
  const args = JSON.stringify({ boostId: b ? b.id : null, name: b ? b.name : null, at });
  await callPage(wc, `startZap(${args})`);
}

// My Library → Boosts, filtered to the site, with one Boost open when `id` is given, or a new
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
  tabManager.create(win, `nomad://library/boosts${query ? '?' + query : ''}`, opts);
}

// The page context menu: zap from the element that was right-clicked.
export function menuItems(wc, props) {
  if (!bst.pageHost(props.pageURL) || (props.frame && props.frame.parent)) return [];
  return [
    {
      label: 'Hide Elements on This Site…',
      click: () => startZap(wc, null, { x: props.x, y: props.y }),
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
  const code = `(window.__nomadBoosts ? window.__nomadBoosts.${expr} : null)`;
  return wc.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD, [{ code }]).catch((err) => {
    logger.warn('Could not reach the page’s Boosts', { error: err?.message });
    return null;
  });
}
