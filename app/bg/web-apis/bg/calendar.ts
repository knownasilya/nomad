// The Calendar's records and feeds on desktop (nomad://calendar, the AI's listCalendarEvents), on
// the internal nomad.vault API (vault.ts). The rules are shared/calendar.mjs, which the phone's
// backend uses too (mobile/backend/lib/calendar.mjs).
//
// Like Notes, an event is the user's (it shows in every Space) or one Space's. A shared Space's
// events and feeds are in its Space Library (ADR-0029), so every member sees and edits them; a
// viewer only sees them. `ctx` is the RPC event: it names the calling page, and so its Space.
//
// iCal feeds are fetched here, at most every FEED_TTL_MS, and their events kept as one record per
// feed beside it, so the phone and the other members read the copy instead of each fetching.
// A calendar drive (walled.garden/calendar) is followed the same way: a feed with `kind: 'drive'`,
// read over nomad.fs at most every DRIVE_TTL_MS, its events kept in the same copy.

import { net } from 'electron';
import b4a from 'b4a';
import * as logLib from '../../logger';
import * as spaceLibrary from '../../hyper/space-library';
import * as filesystem from '../../filesystem/index';
import { findWebContentsParentWindow } from '../../lib/electron';
import * as tabManager from '../../ui/tabs/manager';
import fsAPI from './fs';
import * as vaultApps from './vault-apps';
import * as cal from '../../../../shared/calendar.mjs';
import * as vault from '../../hyper/vault';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'calendar' });

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT = 20e3;

async function spaceOrNull(ctx) {
  return vaultApps.spaceKey(ctx).catch(() => null);
}

const withSpace = (space) => (rec) => ({ ...rec, space: space || null });

function store(space, kind) {
  return spaceLibrary.records(space || null, kind);
}

async function listKind(space, kind, test) {
  const s = await store(space, kind);
  return (await s.list()).filter(test).map(withSpace(space));
}

// Where event or feed `id` is kept: the user's own, or the Space's.
async function locate(kind, id, space) {
  const file = cal.recordFile(id);
  const own = await (await store(null, kind)).get(file);
  if (own) return { space: null, prev: own };
  if (space) {
    const theirs = await (await store(space, kind)).get(file);
    if (theirs) return { space, prev: theirs };
  }
  return { space: null, prev: null };
}

// This person's name in a shared Space, for "added by".
async function memberName(space) {
  if (!space) return '';
  const share = await spaceLibrary.info(space).catch(() => null);
  if (!share?.shared) return '';
  const list = await spaceLibrary.members(space).catch(() => []);
  return list.find((m) => m.memberId === share.memberId)?.name || '';
}

async function canWrite(space, kind = 'events') {
  return (await store(space, kind).catch(() => ({ writable: false }))).writable;
}

// The calendar a Space sees from `from` to `to` (days, 'YYYY-MM-DD'):
// { space, spaceName, shared, canWriteSpace, events, feeds, occurrences }. `space` here is the page's.
export async function listCalendar(ctx, { from, to }: { from?: string; to?: string } = {}) {
  const space = await spaceOrNull(ctx);
  return calendarOf(space, { from, to });
}

export async function calendarOf(space, { from, to }: { from?: string; to?: string } = {}) {
  const today = cal.dayOf(cal.localWallTime());
  from = cal.isDate(from) ? from : today;
  to = cal.isDate(to) && to > from ? to : cal.addDays(from, 42);
  const share = space
    ? await spaceLibrary.info(space).catch(() => ({ shared: false }))
    : { shared: false };
  const events = [
    ...(await listKind(null, 'events', cal.isEvent)),
    ...(space ? await listKind(space, 'events', cal.isEvent) : []),
  ];
  const feeds = [
    ...(await listKind(null, 'feeds', cal.isFeed)),
    ...(space ? await listKind(space, 'feeds', cal.isFeed) : []),
  ];
  const withCache = [];
  for (const feed of feeds) {
    const cache = await (
      await store(feed.space, 'feedCache')
    )
      .get(cal.recordFile(feed.id))
      .catch(() => null);
    withCache.push({ feed, cache: cal.isFeedCache(cache) ? cache : null });
  }
  return {
    space,
    spaceName: vaultApps.spaceNameOf(space),
    shared: !!share.shared,
    canWriteSpace: space ? await canWrite(space) : true,
    from,
    to,
    events,
    feeds: withCache.map(({ feed, cache }) => ({
      ...feed,
      fetchedAt: cache?.fetchedAt || null,
      error: cache?.error || '',
      count: cache?.events?.length || 0,
    })),
    occurrences: cal.agenda({ events, feeds: withCache.filter((f) => f.cache) }, from, to),
  };
}

// Create (no id) or change an event. A new one is the Space's when `inSpace` and this person can
// write its calendar, else the user's own; an existing one stays where it is.
export async function saveEvent(ctx, fields: any = {}) {
  const space = await spaceOrNull(ctx);
  const id = fields.id ? String(fields.id) : cal.newCalendarId();
  const found = fields.id ? await locate('events', id, space) : { space: null, prev: null };
  if (fields.id && !found.prev) throw new Error('That event was deleted');
  const where = found.prev
    ? found.space
    : fields.inSpace && space && (await canWrite(space))
      ? space
      : null;
  if (where && !(await canWrite(where)))
    throw new Error('You can view this Space’s calendar, but not change it');
  const rec = cal.makeEvent({ ...fields, id, by: await memberName(where) }, found.prev);
  await (await store(where, 'events')).put(cal.recordFile(id), rec);
  return withSpace(where)(rec);
}

export async function deleteEvent(ctx, id) {
  const space = await spaceOrNull(ctx);
  const found = await locate('events', String(id || ''), space);
  if (!found.prev) return false;
  if (found.space && !(await canWrite(found.space)))
    throw new Error('You can view this Space’s calendar, but not change it');
  await (await store(found.space, 'events')).del(cal.recordFile(found.prev.id));
  return true;
}

// Subscribe to an iCal feed (the user's, or the Space's when `inSpace`), and fetch it.
export async function saveFeed(ctx, fields: any = {}) {
  const space = await spaceOrNull(ctx);
  const id = fields.id ? String(fields.id) : cal.newCalendarId();
  const found = fields.id ? await locate('feeds', id, space) : { space: null, prev: null };
  const where = found.prev
    ? found.space
    : fields.inSpace && space && (await canWrite(space, 'feeds'))
      ? space
      : null;
  if (where && !(await canWrite(where, 'feeds')))
    throw new Error('You can view this Space’s calendar, but not change it');
  const list = await listKind(where, 'feeds', cal.isFeed);
  if (!found.prev && list.length >= cal.MAX_FEEDS)
    throw new Error(`A calendar can follow at most ${cal.MAX_FEEDS} feeds`);
  const source = cal.sourceOf(fields.url ?? found.prev?.url);
  const same = list.find((f) => f.url === source.url && f.id !== id);
  if (same) throw new Error(`The calendar already follows ${same.name}`);
  let extra: any = {};
  if (source.kind === 'drive') {
    // Read it first: it must be a calendar drive, and it gives the name and color.
    const info = cal.calendarInfo((await readCalendarDrive(source.url)).manifest);
    extra = {
      name: fields.name || found.prev?.name || info.name,
      color: fields.color || found.prev?.color || info.color,
    };
  }
  const rec = cal.makeFeed(
    { ...fields, ...extra, url: source.url, id, by: await memberName(where) },
    found.prev
  );
  await (await store(where, 'feeds')).put(cal.recordFile(id), rec);
  await refreshFeed(withSpace(where)(rec), { force: true });
  return withSpace(where)(rec);
}

export async function deleteFeed(ctx, id) {
  const space = await spaceOrNull(ctx);
  const found = await locate('feeds', String(id || ''), space);
  if (!found.prev) return false;
  if (found.space && !(await canWrite(found.space, 'feeds')))
    throw new Error('You can view this Space’s calendar, but not change it');
  await (await store(found.space, 'feeds')).del(cal.recordFile(found.prev.id));
  await (await store(found.space, 'feedCache')).del(cal.recordFile(found.prev.id)).catch(() => {});
  return true;
}

// GET an iCal file. Public feeds only: no cookies, and nothing on this computer's own network.
async function fetchIcs(url) {
  const u = new URL(url);
  if (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(u.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)
  ) {
    throw new Error('A calendar feed must be on the internet');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1' },
      credentials: 'omit',
    } as any);
    if (!res.ok) throw new Error(`The feed answered ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(
      buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
    );
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 5000)))
      throw new Error('That link isn’t an iCal calendar');
    return text;
  } catch (err) {
    throw new Error(
      controller.signal.aborted ? 'The feed took too long to answer' : err?.message || String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

// The internal caller for drive reads: no page, no tab.
const fsCtx = {
  sender: { getURL: () => 'nomad://calendar/', getURLOrigin: () => 'nomad://calendar/' },
};
const DRIVE_TIMEOUT = 20e3;

async function readDriveText(url, timeout = DRIVE_TIMEOUT) {
  const v = await fsAPI.readFile.call(fsCtx, url, { encoding: 'utf8', timeout, draft: false });
  if (v === null || v === undefined) throw new Error('Not found');
  return typeof v === 'string' ? v : b4a.toString(v);
}

// A calendar drive's manifest and events (shared/calendar.mjs reads them). Throws when the drive is
// out of reach or isn't a calendar.
export async function readCalendarDrive(url, { timeout = DRIVE_TIMEOUT } = {}) {
  const root = cal.driveRoot(url);
  if (!root) throw new Error('That isn’t a drive’s hyper:// address');
  let manifest;
  try {
    manifest = JSON.parse(await readDriveText(root + 'index.json', timeout));
  } catch {
    throw new Error('Couldn’t reach that drive. Is it online?');
  }
  if (!cal.isCalendarManifest(manifest))
    throw new Error(
      'That drive isn’t a calendar (its index.json type isn’t walled.garden/calendar)'
    );
  const dir = cal.calendarEventsPath(manifest);
  const keys = await fsAPI.list
    .call(fsCtx, root + dir.slice(1), { timeout, draft: false })
    .catch(() => []);
  const paths = cal.eventFiles(keys, dir);
  const files: any[] = [];
  for (let i = 0; i < paths.length; i += 20) {
    const batch = paths.slice(i, i + 20);
    const texts = await Promise.all(
      batch.map((p) => readDriveText(root + p.slice(1), timeout).catch(() => null))
    );
    batch.forEach((path, j) => texts[j] != null && files.push({ path, value: texts[j] }));
  }
  return { url: root, manifest, events: cal.driveEvents(files) };
}

// Fetch one feed (where it's kept, `feed.space`) when its copy is old, or always with `force`.
// A Space viewer can't write the copy, so it only reads the one its members keep.
export async function refreshFeed(feed, { force = false } = {}) {
  const s = await store(feed.space, 'feedCache');
  if (!s.writable) return null;
  const prev = await s.get(cal.recordFile(feed.id)).catch(() => null);
  if (!force && !cal.feedDue(prev, Date.now(), feed)) return prev;
  let rec;
  try {
    const events = cal.isDriveFeed(feed)
      ? (await readCalendarDrive(feed.url)).events
      : cal.parseIcs(await fetchIcs(feed.url));
    rec = cal.makeFeedCache(feed, { events }, prev);
  } catch (err) {
    logger.info('Calendar feed failed', { url: feed.url, error: String(err?.message || err) });
    rec = cal.makeFeedCache(
      feed,
      { error: String(err?.message || err) },
      cal.isFeedCache(prev) ? prev : null
    );
  }
  await s.put(cal.recordFile(feed.id), rec);
  return rec;
}

// Fetch the feeds Space `space` sees (the user's and the Space's) that are due, or all with `force`.
export async function refreshDue(space, { force = false } = {}) {
  const feeds = [
    ...(await listKind(null, 'feeds', cal.isFeed)),
    ...(space ? await listKind(space, 'feeds', cal.isFeed) : []),
  ];
  await Promise.all(feeds.map((f) => refreshFeed(f, { force }).catch(() => null)));
}

// The same for the page's Space, then its calendar.
export async function refreshFeeds(ctx, { force = false } = {}) {
  await refreshDue(await spaceOrNull(ctx), { force });
  return listCalendar(ctx);
}

// For a Job or the AI with no page: the agenda of Space `space` as text.
export async function agendaText(space, { from, days = 7 }: { from?: string; days?: number } = {}) {
  const start = cal.isDate(from) ? from : cal.dayOf(cal.localWallTime());
  const n = Math.max(1, Math.min(60, Math.floor(Number(days) || 7)));
  const c = await calendarOf(space, { from: start, to: cal.addDays(start, n) });
  return {
    text: cal.agendaText(c.occurrences),
    occurrences: c.occurrences,
    from: c.from,
    to: c.to,
  };
}

// The calendar drives in the page's Space that the calendar doesn't follow yet, to add with one
// click: [{ url, name, color, writable }]. Each drive's index.json is read with a short wait, so a
// drive that isn't online is left out.
export async function listCalendarDrives(ctx) {
  let spaceId = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
  if (!spaceId && ctx?.sender) {
    const win = findWebContentsParentWindow(ctx.sender);
    if (win) spaceId = tabManager.getWindowActiveSpaceId(win);
  }
  const space = await spaceOrNull(ctx);
  const drives = await filesystem.listDrivesForSpace(spaceId).catch(() => []);
  const followed = new Set(
    [
      ...(await listKind(null, 'feeds', cal.isFeed)),
      ...(space ? await listKind(space, 'feeds', cal.isFeed) : []),
    ].map((f) => f.url)
  );
  const out = await Promise.all(
    (drives || []).slice(0, 200).map(async (d: any) => {
      const url = cal.driveRoot(`hyper://${d.key}/`);
      if (!url || followed.has(url)) return null;
      try {
        const manifest = JSON.parse(await readDriveText(url + 'index.json', 3e3));
        if (!cal.isCalendarManifest(manifest)) return null;
        const info = cal.calendarInfo(manifest);
        return { url, name: info.name, color: info.color };
      } catch {
        return null;
      }
    })
  );
  return out.filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name));
}

// Reminders due in [from, to) (wall times) across the user's own events and every Space in their
// Vault (shared/calendar.mjs remindersBetween), for bg/ui/desktop-notifications.js. A shared Space's
// events are its household's, so everyone in it is reminded.
export async function remindersBetween(from: string, to: string) {
  const spaces = (await vault.listSpaces().catch(() => []))
    .filter((s) => s && cal.isSpaceKey(s.rootDriveKey) && !s.movedTo && !s.removed)
    .map((s) => ({ key: s.rootDriveKey, name: s.name || '' }));
  const events = await listKind(null, 'events', cal.isEvent).catch(() => []);
  const names = new Map(spaces.map((s) => [s.key, s.name]));
  for (const s of spaces) events.push(...(await listKind(s.key, 'events', cal.isEvent).catch(() => [])));
  return cal.remindersBetween(events, from, to).map((r) => ({ ...r, spaceName: r.space ? names.get(r.space) || '' : '' }));
}
