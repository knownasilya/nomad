// nomad/shared/calendar.mjs
//
// The Calendar (nomad://calendar on desktop, the Calendar screen on the phone): events the user or a
// shared Space's members add, and iCal feeds they subscribe to (the school's, a sports club's). The
// records, the repeat rules, the iCal reader and the agenda are here, used by desktop's bg
// (app/bg/web-apis/bg/calendar.ts) and the phone's backend (mobile/backend/lib/calendar.mjs). Tests:
// tests/unit/calendar.test.js.
//
// Where the records are, like Notes (ADR-0017, ADR-0029):
//   the user's own          /.vault/calendar/{events,feeds,feed-cache}/<id>.json
//   one Space's (unshared)  /.vault/spaces/<rootKey>/calendar/…
//   a shared Space's        its Space Library, /calendar/…
//
// A drive can be a calendar too (walled.garden/calendar): its /index.json says so, and each of its
// events is a file in /events/ (walled.garden/calendar-event), in the same wall-time format as the
// records here. The calendar follows one like an iCal feed: a feed record with `kind: 'drive'` and
// the drive's root as `url`, whose copy (feedCache) holds the drive's events. Desktop's bg and the
// phone's backend read the drive (readCalendarDrive's parts below are the rules for what they read).
//
// Times are wall-clock times with no zone: '2026-11-10' for a day, '2026-11-10T18:00' for a time
// (the value an <input type=datetime-local> gives). A household shares a time zone, and "bins at 6pm
// every Tuesday" stays at 6pm across a clock change. An iCal time in UTC is turned into the fetching
// Device's local time.
//
// Pure: no I/O. It runs on the phone's Bare worklet too, so nothing here touches a missing global.

import { isSpaceKey, spaceLibPrefix } from './vault-apps.mjs';

export const EVENT_TYPE = 'nomad/calendar-event';
export const FEED_TYPE = 'nomad/calendar-feed';
export const FEED_CACHE_TYPE = 'nomad/calendar-feed-cache';
// The drive kind (index.json `type`) and the record kind of each of its events.
export const CALENDAR_TYPE = 'walled.garden/calendar';
export const CALENDAR_EVENT_TYPE = 'walled.garden/calendar-event';
export const DEFAULT_EVENTS_PATH = '/events/';

export const MAX_TITLE = 200;
export const MAX_TEXT = 2000;
export const MAX_FEEDS = 20;
export const MAX_FEED_EVENTS = 500;
// A feed is fetched again once its copy is this old.
export const FEED_TTL_MS = 6 * 60 * 60 * 1000;
// A calendar drive changes as its writers add to it, and reading it costs nothing, so its copy is
// read again sooner.
export const DRIVE_TTL_MS = 5 * 60 * 1000;
export const MAX_RANGE_DAYS = 400;

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Paths
// =

const VAULT_CALENDAR = '/.vault/calendar/';
export const LIB_CALENDAR = '/calendar/';
const PARTS = { events: 'events/', feeds: 'feeds/', feedCache: 'feed-cache/' };

// The prefix of one kind of calendar record ('events' | 'feeds' | 'feedCache'): the user's own
// (`space` null) or one Space's in the Vault.
export function calendarPrefix(kind, space = null) {
  if (!PARTS[kind]) throw new Error('Not a calendar record kind: ' + kind);
  return (space ? spaceLibPrefix(space) + 'calendar/' : VAULT_CALENDAR) + PARTS[kind];
}

// The same kind in a shared Space's Library.
export function libraryPrefix(kind) {
  if (!PARTS[kind]) throw new Error('Not a calendar record kind: ' + kind);
  return LIB_CALENDAR + PARTS[kind];
}

const ID_RE = /^[a-z0-9-]{1,40}$/;
export function isCalendarId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function recordFile(id) {
  if (!isCalendarId(id)) throw new Error('Not a calendar id: ' + id);
  return id + '.json';
}

function randomHex(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++)
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return s;
}

export function newCalendarId(now = Date.now(), rand = randomHex) {
  return 'e' + Math.floor(now).toString(36) + '-' + rand(4);
}

// Times
// =

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isDate(s) {
  const m = DATE_RE.exec(String(s || ''));
  return !!m && validParts(+m[1], +m[2], +m[3], 0, 0);
}

export function isDateTime(s) {
  const m = TIME_RE.exec(String(s || ''));
  return !!m && validParts(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

function validParts(y, mo, d, h, mi) {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || h > 23 || mi > 59) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// A wall time as minutes since 1970 on a clock with no zone (so adding days never meets a DST jump).
function toMinutes(s) {
  const t = TIME_RE.exec(s);
  if (t) return Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5]) / 60000;
  const d = DATE_RE.exec(s);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]) / 60000;
  return NaN;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function fromMinutes(min, withTime) {
  const dt = new Date(min * 60000);
  const day = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  return withTime ? `${day}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` : day;
}

// The local wall time of a JS Date, as this format: what "now" is on this Device.
export function localWallTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dayOf(s) {
  return String(s || '').slice(0, 10);
}

export function addDays(day, n) {
  return fromMinutes(toMinutes(dayOf(day)) + n * 1440, false);
}

// Sunday 0 … Saturday 6.
export function weekday(day) {
  return new Date(toMinutes(dayOf(day)) * 60000).getUTCDay();
}

// Records
// =

const clean = (s, max) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const cleanText = (s, max) =>
  String(s ?? '')
    .trim()
    .slice(0, max);

/** @param {{ freq?: string, interval?: number, until?: string, count?: number, byDay?: number[] } | null | undefined} r */
export function normalizeRepeat(r) {
  if (!r || !r.freq || r.freq === 'none') return null;
  if (!FREQS.includes(r.freq)) throw new Error('A repeat is daily, weekly, monthly or yearly');
  const interval = Math.floor(Number(r.interval) || 1);
  if (interval < 1 || interval > 99) throw new Error('Repeat every 1 to 99');
  const out = { freq: r.freq, interval };
  if (r.until) {
    if (!isDate(dayOf(r.until))) throw new Error('Not a date: ' + r.until);
    out.until = dayOf(r.until);
  }
  if (r.count) {
    const count = Math.floor(Number(r.count));
    if (count >= 1 && count <= 1000) out.count = count;
  }
  if (r.freq === 'weekly' && Array.isArray(r.byDay) && r.byDay.length) {
    const days = [...new Set(r.byDay.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (days.length) out.byDay = days;
  }
  return out;
}

// The event record to store. `prev` is the stored event with that id, if any. `by` is who added it
// (a member's name in a shared Space), kept from the first save.
/**
 * @param {{ id: string, title?: string, start?: string, end?: string, allDay?: boolean, location?: string,
 *   notes?: string, repeat?: any, by?: string }} f
 */
export function makeEvent(f, prev = null, now = new Date().toISOString()) {
  if (!isCalendarId(f.id)) throw new Error('Not a calendar id: ' + f.id);
  const title = clean(f.title, MAX_TITLE);
  if (!title) throw new Error('An event needs a title');
  const allDay = !!f.allDay;
  let start = String(f.start || '');
  let end = f.end ? String(f.end) : '';
  if (allDay) {
    start = dayOf(start);
    end = end ? dayOf(end) : '';
    if (!isDate(start)) throw new Error('Pick a day for the event');
    if (end && !isDate(end)) throw new Error('Not a date: ' + end);
  } else {
    if (isDate(start)) start += 'T09:00';
    if (!isDateTime(start)) throw new Error('Pick a day and time for the event');
    if (end && isDate(end)) end += 'T' + start.slice(11);
    if (end && !isDateTime(end)) throw new Error('Not a time: ' + end);
  }
  if (end && toMinutes(end) < toMinutes(start))
    throw new Error('An event can’t end before it starts');
  const rec = {
    type: EVENT_TYPE,
    id: f.id,
    title,
    start,
    allDay,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  if (end && end !== start) rec.end = end;
  const location = clean(f.location, MAX_TITLE);
  if (location) rec.location = location;
  const notes = cleanText(f.notes, MAX_TEXT);
  if (notes) rec.notes = notes;
  const repeat = normalizeRepeat(f.repeat);
  if (repeat) rec.repeat = repeat;
  const by = clean(prev?.by || f.by, 60);
  if (by) rec.by = by;
  const remind = normalizeRemind(f.remind);
  if (remind !== null) rec.remind = remind;
  return rec;
}

export function isEvent(rec) {
  return (
    !!rec &&
    rec.type === EVENT_TYPE &&
    isCalendarId(rec.id) &&
    typeof rec.title === 'string' &&
    (isDate(rec.start) || isDateTime(rec.start))
  );
}

// An iCal feed URL, tidied: webcal:// is https://. Throws for anything that isn't http(s).
export function feedUrl(url) {
  let s = String(url || '').trim();
  if (/^webcals?:\/\//i.test(s)) s = 'https://' + s.replace(/^webcals?:\/\//i, '');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That isn’t a calendar link');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new Error('A calendar link starts with https://');
  u.hash = '';
  return u.toString();
}

// A calendar drive's root, 'hyper://<key>/', from any link into it. Null for anything else.
const DRIVE_RE = /^hyper:\/\/([0-9a-z]{52,64})(?:[/?#]|$)/i;
export function driveRoot(url) {
  const m = DRIVE_RE.exec(String(url || '').trim());
  return m ? `hyper://${m[1].toLowerCase()}/` : null;
}

// What a link the user pastes follows: { kind: 'drive', url } for a hyper:// drive, else
// { kind: 'ics', url } for an iCal link. Throws for anything else.
export function sourceOf(url) {
  const s = String(url || '').trim();
  if (/^hyper:\/\//i.test(s)) {
    const root = driveRoot(s);
    if (!root) throw new Error('That isn’t a drive’s hyper:// address');
    return { kind: 'drive', url: root };
  }
  return { kind: 'ics', url: feedUrl(s) };
}

export function isDriveFeed(feed) {
  return !!feed && feed.kind === 'drive';
}

/** @param {{ id: string, url: string, name?: string, color?: string, by?: string }} f */
export function makeFeed(f, prev = null, now = new Date().toISOString()) {
  if (!isCalendarId(f.id)) throw new Error('Not a calendar id: ' + f.id);
  const { kind, url } = sourceOf(f.url);
  const name = clean(f.name, 80) || (kind === 'drive' ? 'Calendar drive' : hostOf(url));
  const rec = {
    type: FEED_TYPE,
    id: f.id,
    url,
    name,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  if (kind === 'drive') rec.kind = 'drive';
  if (/^#[0-9a-f]{6}$/i.test(String(f.color || ''))) rec.color = f.color.toLowerCase();
  const by = clean(prev?.by || f.by, 60);
  if (by) rec.by = by;
  return rec;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Calendar';
  }
}

export function isFeed(rec) {
  return !!rec && rec.type === FEED_TYPE && isCalendarId(rec.id) && typeof rec.url === 'string';
}

// The copy of a feed's events: { type, feedId, url, fetchedAt, events, error? }. Keeps what can still
// show (anything that repeats, or ends within the last 30 days or later), at most MAX_FEED_EVENTS.
export function makeFeedCache(
  feed,
  { events = [], error = '' } = {},
  prev = null,
  now = new Date()
) {
  const cutoff = addDays(localWallTime(now), -30);
  const keep = [];
  for (const e of events) {
    if (keep.length >= MAX_FEED_EVENTS) break;
    if (!e || !e.title || !(isDate(e.start) || isDateTime(e.start))) continue;
    if (!e.repeat && dayOf(e.end || e.start) < cutoff) continue;
    const out = {
      uid: clean(e.uid, 200) || e.start + e.title,
      title: clean(e.title, MAX_TITLE),
      start: e.start,
      allDay: !!e.allDay,
    };
    if (e.end) out.end = e.end;
    if (e.location) out.location = clean(e.location, MAX_TITLE);
    if (e.notes) out.notes = cleanText(e.notes, MAX_TEXT);
    if (e.repeat) out.repeat = e.repeat;
    if (e.exclude?.length) out.exclude = e.exclude.slice(0, 100);
    keep.push(out);
  }
  const rec = {
    type: FEED_CACHE_TYPE,
    feedId: feed.id,
    url: feed.url,
    fetchedAt: now.toISOString(),
    events: error && prev ? prev.events || [] : keep,
  };
  if (error) rec.error = clean(error, 200);
  return rec;
}

export function isFeedCache(rec) {
  return (
    !!rec && rec.type === FEED_CACHE_TYPE && isCalendarId(rec.feedId) && Array.isArray(rec.events)
  );
}

// Whether a feed's copy is old enough to fetch again. Pass the feed for its kind's wait: a calendar
// drive's is DRIVE_TTL_MS.
export function feedDue(cache, now = Date.now(), feed = null) {
  if (!cache || !cache.fetchedAt) return true;
  return now - Date.parse(cache.fetchedAt) >= (isDriveFeed(feed) ? DRIVE_TTL_MS : FEED_TTL_MS);
}

// Calendar drives
// =
//
// A drive whose /index.json is { type: 'walled.garden/calendar', title, description?, color?,
// eventsPath? } keeps one file per event in eventsPath ('/events/' unless it says otherwise):
// /events/<name>.json, { type: 'walled.garden/calendar-event', title, start, end?, allDay?,
// location?, notes?, repeat?, exclude?, status? }. `start`, `end`, `repeat` and `exclude` are as an
// event record's here; a 'cancelled' status leaves the event out. The file's name is its uid.

export function isCalendarManifest(m) {
  return !!m && typeof m === 'object' && m.type === CALENDAR_TYPE;
}

// The folder a calendar drive keeps its events in, '/like/this/'. Anything odd is the default.
export function calendarEventsPath(manifest) {
  let p = typeof manifest?.eventsPath === 'string' ? manifest.eventsPath.trim() : '';
  if (!p || p.length > 200 || /(^|\/)\.\.?(\/|$)/.test(p) || /[\\?#]/.test(p))
    return DEFAULT_EVENTS_PATH;
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  return p.replace(/\/{2,}/g, '/');
}

// What the calendar takes from a calendar drive's manifest: { name, color }.
export function calendarInfo(manifest) {
  const out = { name: clean(manifest?.title, 80) || 'Calendar drive', color: null };
  if (/^#[0-9a-f]{6}$/i.test(String(manifest?.color || '')))
    out.color = manifest.color.toLowerCase();
  return out;
}

// The event files among a drive's listed paths (`keys`, as nomad.fs.list gives them): the .json
// files right in eventsPath, sorted, at most `max`.
export function eventFiles(keys, eventsPath = DEFAULT_EVENTS_PATH, max = MAX_FEED_EVENTS * 2) {
  const out = [];
  for (const k of keys || []) {
    const path = String(typeof k === 'string' ? k : k?.key || '');
    const p = path.startsWith('/') ? path : '/' + path;
    if (!p.startsWith(eventsPath)) continue;
    const name = p.slice(eventsPath.length);
    if (!/^[^/]{1,120}\.json$/.test(name) || name.startsWith('.')) continue;
    out.push(p);
  }
  return [...new Set(out)].sort().slice(0, max);
}

// One event file of a calendar drive as the calendar keeps it (a feed copy's event), or null when it
// isn't one. `path` is the file's path; its name is the event's uid.
export function driveEvent(rec, path = '') {
  if (!rec || typeof rec !== 'object' || rec.type !== CALENDAR_EVENT_TYPE) return null;
  if (String(rec.status || '').toLowerCase() === 'cancelled') return null;
  const title = clean(rec.title, MAX_TITLE);
  if (!title) return null;
  const allDay = rec.allDay === true || (rec.allDay !== false && isDate(rec.start));
  let start = String(rec.start || '');
  let end = rec.end ? String(rec.end) : '';
  if (allDay) {
    start = dayOf(start);
    end = end ? dayOf(end) : '';
    if (!isDate(start) || (end && !isDate(end))) return null;
  } else {
    if (!isDateTime(start)) return null;
    if (end && isDate(end)) end += 'T' + start.slice(11);
    if (end && !isDateTime(end)) return null;
  }
  if (end && toMinutes(end) < toMinutes(start)) end = '';
  const uid =
    String(path)
      .split('/')
      .pop()
      .replace(/\.json$/, '') || start + title;
  const ev = { uid, title, start, allDay };
  if (end && end !== start) ev.end = end;
  const location = clean(rec.location, MAX_TITLE);
  if (location) ev.location = location;
  const notes = cleanText(rec.notes, MAX_TEXT);
  if (notes) ev.notes = notes;
  try {
    const repeat = normalizeRepeat(rec.repeat);
    if (repeat) ev.repeat = repeat;
  } catch {
    return null;
  }
  if (Array.isArray(rec.exclude)) {
    const ex = rec.exclude
      .map(String)
      .filter((x) => (allDay ? isDate(x) : isDateTime(x) || isDate(x)));
    const full = ex.map((x) => (!allDay && isDate(x) ? x + 'T' + start.slice(11) : x));
    if (full.length) ev.exclude = full.slice(0, 100);
  }
  return ev;
}

// A calendar drive's events from its files, [{ path, value }] (value is the parsed JSON, or the text),
// in time order. Anything that isn't an event is left out.
export function driveEvents(files = []) {
  const out = [];
  for (const f of files) {
    let v = f?.value;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        continue;
      }
    }
    const ev = driveEvent(v, f?.path);
    if (ev) out.push(ev);
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

// Repeats
// =

// The times an event happens that overlap [from, to) (days, 'YYYY-MM-DD'): [{ start, end }].
export function occurrences(ev, from, to, limit = 1000) {
  const withTime = !ev.allDay && isDateTime(ev.start);
  const startMin = toMinutes(ev.start);
  if (!Number.isFinite(startMin)) return [];
  const hasEnd = !!ev.end && Number.isFinite(toMinutes(ev.end));
  const length = hasEnd ? Math.max(toMinutes(ev.end) - startMin, 0) : 0;
  // How long it takes up: an all-day event runs to the end of its last day; a time with no end is
  // shown as a moment.
  const span = withTime ? Math.max(length, 1) : length + 1440;
  const fromMin = toMinutes(from);
  const toMin = toMinutes(to);
  const excluded = new Set(ev.exclude || []);
  const out = [];
  const take = (s) => {
    if (s < toMin && s + span > fromMin && !excluded.has(fromMinutes(s, withTime))) {
      out.push({
        start: fromMinutes(s, withTime),
        end: hasEnd ? fromMinutes(s + length, withTime) : null,
      });
    }
  };
  const r = ev.repeat;
  if (!r) {
    take(startMin);
    return out;
  }
  const untilMin = r.until ? toMinutes(r.until) + 1440 : Infinity;
  const count = r.count || Infinity;
  const timeOfDay = startMin - toMinutes(dayOf(ev.start));
  const first = new Date(startMin * 60000);
  let n = 0;
  let steps = 0;
  const done = (s) => s >= untilMin || s >= toMin || n >= count || out.length >= limit;
  const each = (s) => {
    n++;
    take(s);
  };
  if (r.freq === 'daily') {
    for (let s = startMin; !done(s) && steps++ < 50000; s += 1440 * r.interval) each(s);
  } else if (r.freq === 'weekly') {
    const days = r.byDay?.length ? r.byDay : [first.getUTCDay()];
    const weekStart = toMinutes(dayOf(ev.start)) - first.getUTCDay() * 1440;
    for (let w = weekStart; steps++ < 10000; w += 7 * 1440 * r.interval) {
      let stop = false;
      for (const d of days) {
        const s = w + d * 1440 + timeOfDay;
        if (s < startMin) continue;
        if (done(s)) {
          stop = true;
          break;
        }
        each(s);
      }
      if (stop) break;
    }
  } else if (r.freq === 'monthly' || r.freq === 'yearly') {
    const y0 = first.getUTCFullYear();
    const m0 = first.getUTCMonth();
    const d0 = first.getUTCDate();
    for (let k = 0; steps++ < 5000; k += r.interval) {
      const months = r.freq === 'monthly' ? k : k * 12;
      const y = y0 + Math.floor((m0 + months) / 12);
      const m = (m0 + months) % 12;
      if (d0 > daysInMonth(y, m + 1)) continue; // no 31st this month
      const s = Date.UTC(y, m, d0) / 60000 + timeOfDay;
      if (done(s)) break;
      each(s);
    }
  }
  return out;
}

// Every event and feed event that happens in [from, to), in time order:
// [{ id, title, start, end, allDay, location, notes, by, repeats, feed: { id, name, color } | null }].
// `events` are the stored events; `feeds` are { feed, cache } pairs.
export function agenda({ events = [], feeds = [] }, from, to) {
  const out = [];
  const range = Math.min(MAX_RANGE_DAYS, Math.max(1, (toMinutes(to) - toMinutes(from)) / 1440));
  to = addDays(from, range);
  for (const ev of events) {
    if (!isEvent(ev)) continue;
    for (const o of occurrences(ev, from, to)) {
      out.push({
        id: ev.id,
        title: ev.title,
        start: o.start,
        end: o.end,
        allDay: !!ev.allDay,
        location: ev.location || '',
        notes: ev.notes || '',
        by: ev.by || '',
        repeats: !!ev.repeat,
        feed: null,
      });
    }
  }
  for (const { feed, cache } of feeds) {
    if (!isFeed(feed) || !isFeedCache(cache)) continue;
    for (const ev of cache.events) {
      for (const o of occurrences(ev, from, to)) {
        out.push({
          id: feed.id + ':' + ev.uid,
          title: ev.title,
          start: o.start,
          end: o.end,
          allDay: !!ev.allDay,
          location: ev.location || '',
          notes: ev.notes || '',
          by: '',
          repeats: !!ev.repeat,
          feed: {
            id: feed.id,
            name: feed.name,
            color: feed.color || null,
            kind: isDriveFeed(feed) ? 'drive' : 'ics',
            url: feed.url,
          },
        });
      }
    }
  }
  out.sort((a, b) =>
    a.start < b.start
      ? -1
      : a.start > b.start
        ? 1
        : a.allDay === b.allDay
          ? a.title.localeCompare(b.title)
          : a.allDay
            ? -1
            : 1
  );
  return out;
}

// How an occurrence reads in a list: "Tue 10 Nov, 18:00–19:00" or "Tue 10 Nov, all day".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function describeWhen(o) {
  const day = dayOf(o.start);
  const label = `${DAY_NAMES[weekday(day)]} ${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}`;
  if (o.allDay) {
    const last = o.end ? dayOf(o.end) : day;
    return last > day
      ? `${label} to ${DAY_NAMES[weekday(last)]} ${+last.slice(8, 10)} ${MONTHS[+last.slice(5, 7) - 1]}`
      : `${label}, all day`;
  }
  const t = o.start.slice(11, 16);
  const e = o.end ? (dayOf(o.end) === day ? o.end.slice(11, 16) : null) : null;
  return e ? `${label}, ${t}–${e}` : `${label}, ${t}`;
}

// How a repeat reads: "Every week on Tue", "Every 2 months".
export function describeRepeat(r) {
  if (!r) return '';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let s = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  if (r.freq === 'weekly' && r.byDay?.length)
    s += ' on ' + r.byDay.map((d) => DAY_NAMES[d]).join(', ');
  if (r.until) s += ` until ${r.until}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}

// The AI's view of an agenda: one line per occurrence.
export function agendaText(list, { max = 200 } = {}) {
  if (!list.length) return 'Nothing on the calendar in that time.';
  const lines = list.slice(0, max).map((o) => {
    const extra = [
      o.location && `at ${o.location}`,
      o.feed && `from ${o.feed.name}`,
      o.by && `added by ${o.by}`,
    ].filter(Boolean);
    return `- ${describeWhen(o)}: ${o.title}${extra.length ? ` (${extra.join('; ')})` : ''}`;
  });
  if (list.length > max) lines.push(`[${list.length - max} more not shown]`);
  return lines.join('\n');
}

// iCal
// =

const RRULE_FREQ = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unescapeText(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1');
}

// An iCal date or date-time as this format. A UTC time ('Z') becomes the local time of `toLocal`
// (this Device's zone by default); one with a TZID is taken as wall time.
function icalTime(value, params, toLocal) {
  const v = String(value || '').trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d || params.VALUE === 'DATE') {
    const m = d || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return m ? { value: `${m[1]}-${m[2]}-${m[3]}`, allDay: true } : null;
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!t) return null;
  if (t[7]) {
    const date = new Date(Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5]));
    return { value: toLocal(date), allDay: false };
  }
  return { value: `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}`, allDay: false };
}

function parseRrule(value, toLocal) {
  const parts = {};
  for (const kv of String(value || '').split(';')) {
    const [k, v] = kv.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = RRULE_FREQ[(parts.FREQ || '').toUpperCase()];
  if (!freq) return null;
  const r = { freq, interval: Math.max(1, Math.min(99, parseInt(parts.INTERVAL, 10) || 1)) };
  if (parts.UNTIL) {
    const u = icalTime(parts.UNTIL, {}, toLocal);
    if (u) r.until = dayOf(u.value);
  }
  if (parts.COUNT) r.count = Math.max(1, Math.min(1000, parseInt(parts.COUNT, 10) || 1));
  if (freq === 'weekly' && parts.BYDAY) {
    const days = parts.BYDAY.split(',')
      .map((d) => BYDAY[d.replace(/^[+-]?\d+/, '').toUpperCase()])
      .filter((d) => d !== undefined);
    if (days.length) r.byDay = [...new Set(days)].sort();
  }
  return r;
}

// The events of an iCal file (VEVENTs): [{ uid, title, start, end, allDay, location, repeat, exclude }].
// Recurrence overrides (RECURRENCE-ID) and the rarer RRULE parts are left out: the base event shows.
export function parseIcs(text, { toLocal = localWallTime, max = 5000 } = {}) {
  const lines = String(text || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/);
  const out = [];
  /** @type {any} the VEVENT being read */
  let cur = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      cur = { exclude: [] };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) {
      depth++;
      continue;
    }
    if (/^END:/i.test(line) && depth > 0) {
      depth--;
      continue;
    }
    if (/^END:VEVENT$/i.test(line)) {
      if (cur.start && cur.title && !cur.recurrenceId && cur.status !== 'CANCELLED') {
        const ev = {
          uid: cur.uid || '',
          title: cur.title,
          start: cur.start.value,
          allDay: cur.start.allDay,
        };
        if (cur.end) {
          // An all-day DTEND is the day after the last day.
          ev.end = cur.start.allDay && cur.end.allDay ? addDays(cur.end.value, -1) : cur.end.value;
          if (ev.end === ev.start || (ev.end && ev.end < ev.start)) delete ev.end;
        }
        if (cur.location) ev.location = cur.location;
        if (cur.repeat) ev.repeat = cur.repeat;
        if (cur.exclude.length) ev.exclude = cur.exclude;
        out.push(ev);
        if (out.length >= max) break;
      }
      cur = null;
      continue;
    }
    if (depth > 0) continue; // inside a VALARM
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon).split(';');
    const name = head[0].toUpperCase();
    const params = {};
    for (const p of head.slice(1)) {
      const [k, v] = p.split('=');
      if (k) params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, '');
    }
    const value = line.slice(colon + 1);
    if (name === 'UID') cur.uid = value.trim();
    else if (name === 'SUMMARY') cur.title = unescapeText(value).trim();
    else if (name === 'LOCATION') cur.location = unescapeText(value).trim();
    else if (name === 'DTSTART') cur.start = icalTime(value, params, toLocal);
    else if (name === 'DTEND') cur.end = icalTime(value, params, toLocal);
    else if (name === 'RRULE') cur.repeat = parseRrule(value, toLocal);
    else if (name === 'RECURRENCE-ID') cur.recurrenceId = true;
    else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (name === 'EXDATE') {
      for (const v of value.split(',')) {
        const x = icalTime(v, params, toLocal);
        if (x)
          cur.exclude.push(
            cur.start && !cur.start.allDay && x.allDay
              ? x.value + 'T' + cur.start.value.slice(11)
              : x.value
          );
      }
    }
  }
  return out;
}

// What sharing a Space moves into its Library: the paths of its calendar records there.
export function shareCalendarPaths(items = {}) {
  const out = [];
  for (const e of items.events || [])
    if (isEvent(e)) out.push({ path: libraryPrefix('events') + e.id + '.json', value: e });
  for (const f of items.feeds || [])
    if (isFeed(f)) out.push({ path: libraryPrefix('feeds') + f.id + '.json', value: f });
  return out;
}

export { isSpaceKey };

// Reminders
// =
//
// An event can remind everyone who sees it (`remind`: minutes before it starts). It's on the
// record, so in a shared Space every member's phone and computers remind them: "remind the whole
// house". An all-day event's reminder counts from ALL_DAY_AT on its day, so "1 day before" is 9 AM
// the day before. Feeds' events don't remind. Desktop shows them from bg/ui/desktop-notifications.js
// (the `notify_calendar` setting); the phone schedules them ahead with expo-notifications
// (mobile/lib/useCalendarReminders.ts). Tests: tests/unit/calendar-reminders.test.js.

export const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const ALL_DAY_AT = '09:00';
// A reminder missed while the Device was off or asleep still shows if it's this recent.
export const REMIND_LATE_MS = 30 * 60 * 1000;

export function normalizeRemind(v) {
  if (v === null || v === undefined || v === '' || v === false) return null;
  const n = Number(v);
  return REMIND_OPTIONS.includes(n) ? n : null;
}

// The choices for an all-day event: a reminder under a day is "on the day", so offer one of those.
export function remindOptions(allDay = false) {
  return allDay ? [0, 1440, 2880, 10080] : REMIND_OPTIONS;
}

// How a choice reads: "At the start", "10 minutes before", "1 day before". All day: "On the day, at 9 AM".
export function describeRemind(min, allDay = false) {
  const n = normalizeRemind(min);
  if (n === null) return 'No reminder';
  if (allDay) {
    if (n < 1440) return 'On the day, at 9 AM';
    if (n === 10080) return '1 week before, at 9 AM';
    const days = n / 1440;
    return `${days} day${days === 1 ? '' : 's'} before, at 9 AM`;
  }
  if (n === 0) return 'At the start';
  if (n < 60) return `${n} minutes before`;
  if (n < 1440) return `${n / 60} hour${n === 60 ? '' : 's'} before`;
  if (n === 10080) return '1 week before';
  return `${n / 1440} day${n === 1440 ? '' : 's'} before`;
}

// When one occurrence's reminder is due, as a wall time.
export function reminderAt(o, remind) {
  const n = normalizeRemind(remind);
  if (n === null) return null;
  const base = o.allDay ? `${dayOf(o.start)}T${ALL_DAY_AT}` : o.start;
  const m = toMinutes(base);
  if (Number.isNaN(m)) return null;
  // An all-day event's reminder on the day itself is at ALL_DAY_AT, whatever under a day was picked.
  const before = o.allDay && n < 1440 ? 0 : n;
  return fromMinutes(m - before, true);
}

// 12-hour times, as the calendar shows them ("6:30 PM").
function time12(hhmm) {
  const h = +hhmm.slice(0, 2);
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? 'AM' : 'PM'}`;
}

// What a reminder says: the event's title, and when, from the time it shows.
export function reminderText(r) {
  const day = dayOf(r.start);
  const remindDay = dayOf(r.at);
  const when =
    day === remindDay
      ? 'Today'
      : day === addDays(remindDay, 1)
        ? 'Tomorrow'
        : describeWhen({ start: day, allDay: true }).replace(/, all day$/, '');
  const parts = [`${when}, ${r.allDay ? 'all day' : time12(r.start.slice(11, 16))}`];
  if (r.location) parts.push(r.location);
  return { title: r.title, body: parts.join(' · ') };
}

// Every reminder due in [from, to) (wall times, 'YYYY-MM-DDTHH:MM') for these events, soonest
// first. `key` names one occurrence's reminder, so a Device shows or schedules it once.
export function remindersBetween(events, from, to) {
  const out = [];
  const lo = toMinutes(from);
  const hi = toMinutes(to);
  if (Number.isNaN(lo) || Number.isNaN(hi) || hi <= lo) return out;
  // An occurrence can start up to a week after its reminder: look that far past `to`.
  const fromDay = dayOf(from);
  const toDay = addDays(dayOf(to), 8);
  for (const ev of events || []) {
    if (!isEvent(ev) || normalizeRemind(ev.remind) === null) continue;
    for (const o of occurrences(ev, fromDay, toDay)) {
      const at = reminderAt({ start: o.start, allDay: !!ev.allDay }, ev.remind);
      const m = at ? toMinutes(at) : NaN;
      if (!(m >= lo && m < hi)) continue;
      out.push({
        key: `${ev.id}@${o.start}`,
        id: ev.id,
        title: ev.title,
        start: o.start,
        allDay: !!ev.allDay,
        location: ev.location || '',
        at,
        space: ev.space || null,
      });
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key.localeCompare(b.key)));
  return out;
}

// A wall time `ms` milliseconds from `wall` (for "now minus REMIND_LATE_MS").
export function addWallMs(wall, ms) {
  return fromMinutes(toMinutes(wall) + Math.round(ms / 60000), true);
}
