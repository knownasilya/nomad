// A Space's pinned pages (shared/pins.mjs), kept in memory per Space and watched for changes from
// the user's other Devices. They live in /nomad/pins.json of the Space's Root Drive, or of its Space
// Library when the Space is shared (ADR-0029) — the same file the phone's home shortcuts and the
// new tab page use — so pinning on one Device pins on all of them.
//
// The tab manager (tabs/manager.js) draws them as tiles at the top of the sidebar and binds each
// pinned tab to its pin. 'changed' fires with { spaceId } when a Space's pins change.

import { EventEmitter } from 'events';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import hyper from '../hyper/index';
import * as autobases from '../hyper/autobases';
import * as spaceLibrary from '../hyper/space-library';
import * as filesystem from '../filesystem/index';
import * as spacesDb from '../dbs/spaces';
import * as logLib from '../logger';
import * as sp from '../../../shared/pins.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'space-pins' });

export const events = new EventEmitter();

const REFRESH_MS = 300;
const RETRY_MS = 5000; // between first reads that found nothing yet (the drive's 'update' also retries)

// spaceId → { loaded, pins: [{ href, title }], writable, base, timer, loading }
const spaces = new Map();
// (entries also carry `writing`, the last write's promise)

function entry(spaceId) {
  let e = spaces.get(spaceId);
  if (!e) {
    e = { loaded: false, pins: [], writable: true, base: null, timer: null, loading: null };
    spaces.set(spaceId, e);
  }
  return e;
}

// The drive a Space keeps its pins in, and whether this Device can change it.
async function driveOf(spaceId) {
  const space = spacesDb.getCachedAll().find((s) => s.id === spaceId);
  if (!space) return null;
  if (space.root_drive_url) {
    const rootKey = await hyper.drives.fromURLToKey(space.root_drive_url, true);
    const lib = await spaceLibrary.forSpace(rootKey).catch(() => null);
    if (lib) return { sess: lib.sess, writable: !!lib.writable };
  }
  const sess = await filesystem.getOrSetupSpaceDrive(space);
  return sess ? { sess, writable: sess.writable !== false } : null;
}

async function readBookmarks(sess) {
  const out = [];
  for (const { path, record } of await autobases.listRecords(sess, sp.BOOKMARKS_PREFIX)) {
    if (!(path.endsWith('.goto') || path.endsWith('.json'))) continue;
    try {
      const buf = await autobases.resolveRecordContent(record);
      const data = buf ? JSON.parse(b4a.toString(buf)) : null;
      if (data?.href) out.push({ href: data.href, title: data.title });
    } catch {}
  }
  return out;
}

async function readPins(sess) {
  const buf = await autobases.readContent(sess, sp.PINS_PATH);
  return buf ? sp.parsePins(b4a.toString(buf)) : [];
}

function watch(e, sess, spaceId) {
  const base = sess?.base;
  if (!base || base === e.base) return;
  const onUpdate = () => scheduleRefresh(spaceId);
  if (e.base && e.onUpdate) e.base.removeListener('update', e.onUpdate);
  e.base = base;
  e.onUpdate = onUpdate;
  base.on('update', onUpdate);
}

function scheduleRefresh(spaceId) {
  const e = entry(spaceId);
  clearTimeout(e.timer);
  e.timer = setTimeout(() => refresh(spaceId), REFRESH_MS);
}

function samePins(a, b) {
  return a.length === b.length && a.every((p, i) => p.href === b[i].href && p.title === b[i].title);
}

// Read a Space's pins again; 'changed' when they differ (or on the first read).
export async function refresh(spaceId) {
  const e = entry(spaceId);
  if (e.loading) return e.loading;
  e.loading = (async () => {
    try {
      const d = await driveOf(spaceId);
      if (!d) return;
      watch(e, d.sess, spaceId);
      e.writable = d.writable;
      // A Root Drive whose view hasn't synced yet reads as empty; that isn't "no pins", and treating
      // it so would unpin every pinned tab in the Space.
      if (autobases.viewEmpty(d.sess)) return;
      const [hrefs, bookmarks] = await Promise.all([readPins(d.sess), readBookmarks(d.sess)]);
      const pins = sp.titledPins(hrefs, bookmarks);
      if (e.loaded && samePins(e.pins, pins)) return;
      e.pins = pins;
      e.loaded = true;
      events.emit('changed', { spaceId });
    } catch (err) {
      logger.warn('Could not read pinned pages', { spaceId, error: err?.message || String(err) });
    } finally {
      e.loading = null;
    }
  })();
  return e.loading;
}

// The pins of a Space as far as they are known ([] until the first read, which this starts).
export function forSpace(spaceId) {
  const e = entry(spaceId);
  if (!e.loaded && !e.loading && Date.now() - (e.triedAt || 0) > RETRY_MS) {
    e.triedAt = Date.now();
    refresh(spaceId);
  }
  return e.pins;
}

export function isLoaded(spaceId) {
  return entry(spaceId).loaded;
}

export function canWrite(spaceId) {
  return entry(spaceId).writable;
}

// Write a Space's pin list, after showing it here at once (so the tile doesn't flicker while the
// write is on its way). `titles` names new pins.
// One write at a time per Space, so two quick changes don't read the same list.
function write(spaceId, fn, titles = {}) {
  const e = entry(spaceId);
  const run = (e.writing || Promise.resolve())
    .catch(() => {})
    .then(() => doWrite(spaceId, fn, titles));
  e.writing = run;
  return run;
}

async function doWrite(spaceId, fn, titles) {
  const e = entry(spaceId);
  const d = await driveOf(spaceId);
  if (!d) throw new Error('No such Space');
  if (!d.writable) throw new Error('You can view this Space, but not change it');
  const current = await readPins(d.sess);
  const next = fn(current);
  const known = new Map(e.pins.map((p) => [p.href, p.title]));
  e.pins = next.map((href) => ({
    href,
    title: titles[href] || known.get(href) || sp.fallbackTitle(href),
  }));
  e.loaded = true;
  events.emit('changed', { spaceId });
  // The phone and the new tab page title a pin by its bookmark, so a new pin needs one.
  const bookmarks = await readBookmarks(d.sess);
  const have = new Set(bookmarks.map((b) => sp.normalizePinUrl(b.href)));
  for (const href of next) {
    if (current.includes(href) || have.has(href)) continue;
    const slug = b4a.toString(crypto.hash(b4a.from(href)), 'hex'); // the phone's bookmark name
    const rec = {
      type: 'nomad/bookmark',
      href,
      title: titles[href] || sp.fallbackTitle(href),
      createdAt: new Date().toISOString(),
    };
    await autobases.putInline(d.sess, `${sp.BOOKMARKS_PREFIX}${slug}.json`, JSON.stringify(rec));
  }
  await autobases.putInline(d.sess, sp.PINS_PATH, b4a.from(sp.serializePins(next)));
  scheduleRefresh(spaceId);
}

export function pin(spaceId, url, title, at) {
  const href = sp.normalizePinUrl(url);
  if (!sp.isPinnable(href)) return Promise.reject(new Error('This page can’t be pinned'));
  return write(spaceId, (pins) => sp.withPin(pins, href, at), { [href]: (title || '').trim() });
}

export function unpin(spaceId, url) {
  return write(spaceId, (pins) => sp.withoutPin(pins, url));
}

export function move(spaceId, url, to) {
  return write(spaceId, (pins) => sp.movePin(pins, url, to));
}

// Add several pages at once (pinned tabs found before the pins were read).
// `pages`: [{ url, title }].
export function pinAll(spaceId, pages) {
  const titles = {};
  for (const p of pages) {
    const h = sp.normalizePinUrl(p.url);
    if (sp.isPinnable(h)) titles[h] = (p.title || '').trim();
  }
  const hrefs = Object.keys(titles);
  if (!hrefs.length) return Promise.resolve();
  return write(spaceId, (pins) => hrefs.reduce((list, h) => sp.withPin(list, h), pins), titles);
}
