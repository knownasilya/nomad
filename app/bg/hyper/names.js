// @ts-nocheck
//
// Names (shared/names.mjs): short words the user gives drives, apps in a private drive, and any URL.
// The user's own names work in every Space; a Space's names (ADR-0029) only in that Space's tabs.
// Both are kept in the Vault (/.vault/names/, /.vault/space-lib/<space>/names/), so every Device
// has them. This module keeps them in memory, so a tab can turn hyper://<name>/ into the real
// address as it navigates (ui/tabs/pane.js, synchronously), and refreshes them when the Vault
// changes. `space` below is a Space's Root Drive key, or null for the user's own names.
//
// Setting a name makes a Vault if this Device has none; a solo Vault still joins another one later
// (vault.adoptVault) and brings its names along.

import { EventEmitter } from 'events';
import * as logLib from '../logger';
import * as vault from './vault';
import * as drives from './drives';
import * as spacesDb from '../dbs/spaces';
import * as spaceLibrary from './space-library';
import {
  namesPrefix,
  namePath,
  namesInSpace,
  pickName,
  makeNameRecord,
  isNameRecord,
  nameError,
  nameTarget,
  resolveNamedUrl,
  approvedNameFor,
} from '../../../shared/names.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'names' });

// Emits 'changed' when the names change, here or on another Device.
export const events = new EventEmitter();

let cache = new Map(); // name -> the user's own record
let spaceCache = new Map(); // Space key -> Map(name -> record)
let watchedBase = null;
let timer = null;

export function setup() {
  refresh();
  // A Vault made or joined later (vault.events), and edits from other Devices (the base's updates).
  vault.events.on('changed', () => refresh());
  // A Space added here or synced from another Device: read its names too.
  spacesDb.events.on('changed', () => scheduleRefresh());
  spaceLibrary.events.on('changed', () => scheduleRefresh());
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 300);
}

function rootKeyOf(space) {
  try {
    const key = space?.root_drive_url ? drives.fromURLToKey(space.root_drive_url) : null;
    return /^[0-9a-f]{64}$/.test(key || '') ? key : null;
  } catch {
    return null;
  }
}

// The Root Drive keys of the Spaces on this Device.
function spaceKeys() {
  return spacesDb.getCachedAll().map(rootKeyOf).filter(Boolean);
}

// The Space key (its Root Drive key) of the local Space `spaceId`, or null. Synchronous, for a tab.
export function spaceKeyForId(spaceId) {
  return rootKeyOf(spacesDb.getCachedAll().find((s) => s.id === spaceId));
}

const toMap = (records) => new Map(records.filter(isNameRecord).map((r) => [r.name, r]));
const sameMap = (a, b) =>
  !!a && !!b && a.size === b.size && [...b].every(([k, r]) => a.get(k)?.updatedAt === r.updatedAt);

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
  const next = toMap(sess ? await vault.listAppRecords(namesPrefix()) : []);
  const nextSpaces = new Map();
  if (sess) {
    for (const key of spaceKeys()) {
      // A shared Space's names are in its Space Library (ADR-0029).
      const m = toMap(await (await spaceLibrary.records(key, 'names')).list().catch(() => []));
      if (m.size) nextSpaces.set(key, m);
    }
  }
  const same =
    sameMap(cache, next) &&
    nextSpaces.size === spaceCache.size &&
    [...nextSpaces].every(([k, m]) => sameMap(spaceCache.get(k), m));
  if (same) return;
  cache = next;
  spaceCache = nextSpaces;
  events.emit('changed');
}

function lookup(name, space) {
  return (space ? spaceCache.get(space)?.get(name) : cache.get(name)) || null;
}

// The names a Space sees, A to Z, each with `space` (its key, or null for the user's own). Without
// a Space, only the user's own names.
export function list(space = null) {
  return namesInSpace([...cache.values()], space ? [...(spaceCache.get(space)?.values() || [])] : [], space);
}

// Every name: the user's own and every Space's.
export function listAll() {
  return [
    ...cache.values(),
    ...[...spaceCache.values()].flatMap((m) => [...m.values()]),
  ];
}

// What `name` means in `space`: the user's own name, else the Space's.
export function get(name, space = null) {
  return pickName(name, space, lookup);
}

// The names in `space` that point to the page at `url` (to its folder, for a hyper:// page).
export function forUrl(url, space = null) {
  const target = nameTarget(url);
  return list(space).filter((r) => !r.hidden && (r.url === target || r.url === url));
}

// The user's own name for the hyper:// page at `url` (not one the AI gave and the user hasn't kept),
// or null. The location bar shows it in place of the drive key.
export function approvedFor(url, space = null) {
  return approvedNameFor(
    url,
    list(space).filter((r) => !r.hidden)
  );
}

// Give `url` the name `name`, in `space` (null: the user's own). `previous` and `previousSpace` name
// the record being changed, when renaming or moving it between the Space and the user's own. Refuses
// a name that already points somewhere else in that place. `auto` marks a name the AI gave
// (auto-names.js); a save without it makes the name the user's.
export async function set({ name, url, title, previous, previousSpace = null, space = null, auto = false }) {
  const err = nameError(name);
  if (err) throw new Error(err);
  const existing = lookup(name, space) || (await getRecord(name, space));
  const same = previous === name && (previousSpace || null) === (space || null);
  if (existing && existing.url !== url && !same) {
    throw new Error(`“${name}” already names ${existing.title || existing.url}`);
  }
  const rec = makeNameRecord({ name, url, title, auto }, existing);
  await putRecord(name, space, rec);
  if (previous && !same && lookup(previous, previousSpace)) {
    await delRecord(previous, previousSpace);
  }
  await refresh();
  logger.info('Set name', { name, url, auto, space: !!space });
  return { ...rec, space: space || null };
}

export async function remove(name, space = null) {
  await delRecord(name, space);
  await refresh();
}

// The user's own names are in the Vault; a Space's in the Vault or, shared, its Space Library.
const nameFile = (name) => namePath(name).slice(namesPrefix().length);

async function getRecord(name, space) {
  if (!space) return vault.readAppRecord(namePath(name));
  return (await spaceLibrary.records(space, 'names')).get(nameFile(name));
}

async function putRecord(name, space, rec) {
  if (!space) return vault.putAppRecord(namePath(name), rec);
  return (await spaceLibrary.records(space, 'names')).put(nameFile(name), rec);
}

async function delRecord(name, space) {
  if (!space) return vault.delAppRecord(namePath(name));
  return (await spaceLibrary.records(space, 'names')).del(nameFile(name));
}

// Where a tab in `space` that opens `url` should go instead, or null when `url` isn't
// hyper://<name>/….
export function resolveUrl(url, space = null) {
  return resolveNamedUrl(url, (name) => get(name, space));
}

// The drive (or app folder) a name, hyper://<name>/, or hyper:// URL refers to, as a hyper:// URL
// ending in "/". For the AI's drive tools. Throws for an unknown name or a name for a web page.
export function resolveDrive(input, space = null) {
  const s = String(input || '').trim();
  const url = /^hyper:\/\//i.test(s)
    ? resolveUrl(s, space) || s
    : resolveUrl(`hyper://${s.toLowerCase()}/`, space);
  if (!url) throw new Error(`No drive is named “${s}”`);
  if (!url.startsWith('hyper://')) throw new Error(`“${s}” names ${url}, not a drive`);
  return nameTarget(url);
}
