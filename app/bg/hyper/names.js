// @ts-nocheck
//
// Names (shared/names.mjs): short words the user gives drives, apps in a private drive, and any URL.
// One set per user, kept in the Vault (/.vault/names/), so every Device has them. This module keeps
// them in memory, so a tab can turn hyper://<name>/ into the real address as it navigates
// (ui/tabs/pane.js, synchronously), and refreshes them when the Vault changes.
//
// Setting a name makes a Vault if this Device has none; a solo Vault still joins another one later
// (vault.adoptVault) and brings its names along.

import { EventEmitter } from 'events';
import * as logLib from '../logger';
import * as vault from './vault';
import {
  NAMES_PREFIX,
  namePath,
  makeNameRecord,
  isNameRecord,
  nameError,
  nameTarget,
  resolveNamedUrl,
} from '../../../shared/names.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'names' });

// Emits 'changed' when the names change, here or on another Device.
export const events = new EventEmitter();

let cache = new Map(); // name -> record
let watchedBase = null;
let timer = null;

export function setup() {
  refresh();
  // A Vault made or joined later (vault.events), and edits from other Devices (the base's updates).
  vault.events.on('changed', () => refresh());
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
  const records = sess ? (await vault.listAppRecords(NAMES_PREFIX)).filter(isNameRecord) : [];
  const next = new Map(records.map((r) => [r.name, r]));
  const same = next.size === cache.size && [...next].every(([k, r]) => cache.get(k)?.updatedAt === r.updatedAt);
  if (same) return;
  cache = next;
  events.emit('changed');
}

// All names, A to Z.
export function list() {
  return [...cache.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function get(name) {
  return cache.get(name) || null;
}

// The names that point to the page at `url` (to its folder, for a hyper:// page).
export function forUrl(url) {
  const target = nameTarget(url);
  return list().filter((r) => r.url === target || r.url === url);
}

// Give `url` the name `name`. `previous` is the name being changed, when renaming. Refuses a name
// that already points somewhere else.
export async function set({ name, url, title, previous }) {
  const err = nameError(name);
  if (err) throw new Error(err);
  const existing = cache.get(name) || (await vault.readAppRecord(namePath(name)));
  if (existing && existing.url !== url && previous !== name) {
    throw new Error(`“${name}” already names ${existing.title || existing.url}`);
  }
  const rec = makeNameRecord({ name, url, title }, existing);
  await vault.putAppRecord(namePath(name), rec);
  if (previous && previous !== name && cache.has(previous)) await vault.delAppRecord(namePath(previous));
  await refresh();
  logger.info('Set name', { name, url });
  return rec;
}

export async function remove(name) {
  await vault.delAppRecord(namePath(name));
  await refresh();
}

// Where a tab that opens `url` should go instead, or null when `url` isn't hyper://<name>/….
export function resolveUrl(url) {
  return resolveNamedUrl(url, (name) => cache.get(name) || null);
}

// The drive (or app folder) a name, hyper://<name>/, or hyper:// URL refers to, as a hyper:// URL
// ending in "/". For the AI's drive tools. Throws for an unknown name or a name for a web page.
export function resolveDrive(input) {
  const s = String(input || '').trim();
  const url = /^hyper:\/\//i.test(s) ? resolveUrl(s) || s : resolveUrl(`hyper://${s.toLowerCase()}/`);
  if (!url) throw new Error(`No drive is named “${s}”`);
  if (!url.startsWith('hyper://')) throw new Error(`“${s}” names ${url}, not a drive`);
  return nameTarget(url);
}
