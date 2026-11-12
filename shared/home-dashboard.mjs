// The home page as a dashboard: what the user's things look like right now, on one page. Desktop's
// nomad://desktop (the new tab page and the toolbar's Home button) and the phone's home tab both show
// it. Each runtime gathers its own records (desktop: bg/web-apis/bg/vault.ts `homeDashboard`; phone:
// mobile/backend/lib/home.mjs, RPC_APPS `home`/`dashboard`) and this file decides what shows:
//
// - Needs you: what waits for the user's answer: a prompt open on a tab (the AI or a site asking),
//   someone asking to write to one of their drives, to edit a drive or join their shared Space, a
//   new Device asking to join, a stranger's first Message, and a Job that wanted sites it wasn't
//   given. Oldest first: it has waited longest.
// - Notifications: Job results with a notification, Jobs that failed, other members' notices in a
//   shared Space, and Conversations with unread Messages, from the last NOTIFY_DAYS, newest first,
//   leaving out the ones the user cleared (DISMISSED_PATH, `dismiss`).
// - Jobs: the ones running now (or waiting to), and the ones that run next.
// - Coming up: the calendar from now on (an event going on now first).
// - The newest Notes and Assets.
//
// No I/O, no Electron, no globals the phone's Bare worklet lacks. Tests: tests/unit/home-dashboard.test.js.

import { isRun, describeNeed } from './jobs.mjs';
import { noteTitle, noteSnippet } from './vault-apps.mjs';
import { noteLink, jobLink, assetLink, calendarLink } from './item-links.mjs';
import { KIND_ICONS } from './assets.mjs';

export const NOTIFY_DAYS = 7;
export const LIMITS = { waiting: 8, notifications: 6, running: 4, next: 4, events: 6, notes: 5, assets: 8 };
export const MAX_LIMIT = 20;
// The sections a home page layout can size, and the row counts to use: LIMITS, with any whole
// number from 1 to MAX_LIMIT in `limits` taking its place.
export const SIZED = ['notifications', 'next', 'events', 'notes', 'assets'];
export function sectionLimits(limits) {
  const out = { ...LIMITS };
  for (const key of SIZED) {
    const n = Math.round(Number(limits?.[key]));
    if (n >= 1) out[key] = Math.min(n, MAX_LIMIT);
  }
  return out;
}
// How far ahead "Coming up" looks.
export const EVENT_DAYS = 14;
// The notifications the user cleared, one Vault record for all their Devices.
export const DISMISSED_PATH = '/.vault/home/dismissed.json';
export const DISMISSED_TYPE = 'nomad/home-dismissed';
const MAX_DISMISSED = 300;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = /^\d{4}-\d{2}-\d{2}/;
const MS_DAY = 24 * 60 * 60 * 1000;

const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const timeOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
};
const newestFirst = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);

// Wall-time days ('YYYY-MM-DD'), done in UTC so the machine's zone never moves them.
function dayParts(day) {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(day, n) {
  const d = dayParts(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// How a day reads in a list: "Today", "Tomorrow", "Yesterday", else "Wed 12 Nov".
export function dayLabel(day, today) {
  if (!DAY.test(day || '') || !DAY.test(today || '')) return '';
  day = day.slice(0, 10);
  today = today.slice(0, 10);
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  const d = dayParts(day);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// "Good morning" / "Good afternoon" / "Good evening", from a wall time ('YYYY-MM-DDTHH:MM') or an hour.
export function greeting(wallOrHour) {
  const m = /T(\d{2}):/.exec(String(wallOrHour ?? ''));
  const h = typeof wallOrHour === 'number' ? wallOrHour : m ? Number(m[1]) : NaN;
  if (!Number.isFinite(h)) return 'Hello';
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Needs you
// =

// What waits on the user, oldest first, at most `max`:
// [{ kind, id, title, body, at, url?, ...what answering it needs }]. Kinds:
// - 'prompt': a permission prompt open on a tab ({ id, title, body, ai, at, tabTitle } from desktop's
//   bg/ui/permissions.js `waitingPrompts`). `promptId` brings it forward.
// - 'drive': someone asks to write to a drive this Device owns ({ drive, title, writerKey, profileUrl,
//   name?, requestedAt }), answered with nomad.fs approveRequest/denyRequest.
// - 'edit': a member asks to edit a drive in the shared Space (space-library status `requests`).
// - 'join': someone asks to join the shared Space (status `joins`, or the phone's invites `pending`).
// - 'device': a new Device asks to join the user's Devices (device-pairing `listPendingRequests`).
// - 'message-request': a first Message from someone the Persona doesn't know yet.
// - 'job-needs': a Job's newest run wanted sites or clicks it wasn't given (shared/jobs.mjs `needs`).
export function waiting(
  {
    prompts = [],
    driveRequests = [],
    spaceRequests = [],
    joins = [],
    devices = [],
    conversations = [],
    runs = [],
    jobs = null,
    spaceName = '',
  } = {},
  { max = LIMITS.waiting } = {}
) {
  const out = [];
  const space = clip(spaceName, 40) || 'your Space';
  for (const p of prompts || []) {
    if (!p || p.id == null) continue;
    out.push({
      kind: 'prompt',
      id: 'prompt:' + p.id,
      promptId: p.id,
      ai: !!p.ai,
      title: clip(p.title, 80) || (p.ai ? 'The AI is waiting for your answer' : 'A site is asking for permission'),
      body: clip(p.body, 160),
      tabTitle: clip(p.tabTitle, 60),
      at: p.at || '',
    });
  }
  for (const r of driveRequests || []) {
    if (!r || typeof r.drive !== 'string' || typeof r.writerKey !== 'string') continue;
    out.push({
      kind: 'drive',
      id: 'drive:' + r.drive + ':' + r.writerKey,
      title: `${clip(r.name, 60) || 'Someone'} asks to write to ${clip(r.title, 60) || 'your drive'}`,
      body: 'They could add, change and delete its files.',
      at: r.requestedAt || '',
      drive: r.drive,
      writerKey: r.writerKey,
      url: `hyper://${r.drive}/`,
    });
  }
  for (const r of spaceRequests || []) {
    if (!r || typeof r.drive !== 'string' || typeof r.writerKey !== 'string') continue;
    out.push({
      kind: 'edit',
      id: 'edit:' + r.drive + ':' + r.writerKey,
      title: `${clip(r.name, 60) || 'Someone'} asks to edit ${clip(r.title, 60) || 'a drive'}`,
      body: r.note ? `“${clip(r.note, 140)}”` : `Only that drive, only in ${space}.`,
      at: r.requestedAt || '',
      drive: r.drive,
      writerKey: r.writerKey,
      canApprove: !!r.canApprove,
      url: 'nomad://library/sharing',
    });
  }
  for (const j of joins || []) {
    if (!j || typeof j.memberId !== 'string') continue;
    out.push({
      kind: 'join',
      id: 'join:' + (j.space || '') + ':' + j.memberId,
      title: `${clip(j.name, 60) || 'Someone'} asks to join ${clip(j.spaceName, 40) || space}`,
      body: j.role === 'editor' ? 'As someone who can edit.' : 'As someone who can view.',
      at: j.requestedAt || '',
      memberId: j.memberId,
      space: j.space || null,
      url: 'nomad://library/sharing',
    });
  }
  for (const d of devices || []) {
    if (!d || typeof d.deviceKey !== 'string') continue;
    out.push({
      kind: 'device',
      id: 'device:' + d.deviceKey,
      title: `${clip(d.name, 60) || 'A new device'} asks to join your devices`,
      body: d.platform === 'peer' ? 'An always-on Peer.' : 'It would see and change everything in your Vault.',
      at: d.requestedAt || '',
      url: 'nomad://settings/?view=devices',
    });
  }
  for (const c of conversations || []) {
    if (!c || !c.request || !c.unread) continue;
    const name = clip(c.title || c.last?.fromTitle, 60) || 'Someone';
    out.push({
      kind: 'message-request',
      id: 'request:' + c.personaId + ':' + c.other,
      title: `${name} wants to message you`,
      body: clip(c.last?.message?.text, 160),
      at: c.last?.message?.createdAt || '',
      personaId: c.personaId,
      with: c.other,
      url: `nomad://messages/?persona=${encodeURIComponent(c.personaId)}&with=${encodeURIComponent(c.other)}`,
    });
  }
  // A Job whose newest run was refused something. A later run that wasn't means it's settled.
  const known = Array.isArray(jobs) ? new Set(jobs.map((j) => j?.id)) : null;
  const seen = new Set();
  for (const r of (runs || []).filter(isRun).sort(newestFirst('finishedAt'))) {
    if (seen.has(r.jobId)) continue;
    seen.add(r.jobId);
    if (!Array.isArray(r.needs) || !r.needs.length || (known && !known.has(r.jobId))) continue;
    const first = describeNeed(r.needs[0]);
    const more = r.needs.length - 1;
    out.push({
      kind: 'job-needs',
      id: 'needs:' + r.id,
      title: `${clip(r.title, 60) || 'A Job'} wants to ${first}${more ? ` and ${more} more` : ''}`,
      body: 'Run it with you watching to allow it.',
      at: r.finishedAt || '',
      jobId: r.jobId,
      url: jobLink(r.jobId),
    });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.slice(0, max);
}

// Notifications
// =

// The newest first, at most `max`, from the last `days`:
// [{ kind: 'job' | 'failed' | 'space' | 'message', id, title, body, at, url?, jobId?, personaId?, with? }].
// `runs` are Job runs (shared/jobs.mjs); `notices` a shared Space's notices (shared/space-library.mjs),
// of which only other members' show (`memberId` is this person's); `conversations` the Persona Inbox's
// (shared/inbox.mjs conversations, with `title`).
export function notifications(
  { runs = [], notices = [], memberId = null, spaceName = '', conversations = [] } = {},
  { now = Date.now(), days = NOTIFY_DAYS, max = LIMITS.notifications, dismissed = null } = {}
) {
  const since = now - days * MS_DAY;
  const out = [];
  // A Job's result: its newest run with a notification, or that failed. One row per Job.
  const seen = new Set();
  const sorted = (runs || []).filter(isRun).sort(newestFirst('finishedAt'));
  for (const r of sorted) {
    if (seen.has(r.jobId) || timeOf(r.finishedAt) < since) continue;
    if (r.status === 'error' && !r.stopped) {
      seen.add(r.jobId);
      out.push({
        kind: 'failed',
        id: 'run:' + r.id,
        title: clip(r.title, 80) || 'Job',
        body: clip(r.error || 'The Job didn’t finish.', 160),
        at: r.finishedAt,
        jobId: r.jobId,
        url: jobLink(r.jobId),
      });
    } else if (r.notification && (r.notification.title || r.notification.body)) {
      seen.add(r.jobId);
      out.push({
        kind: 'job',
        id: 'run:' + r.id,
        title: clip(r.notification.title, 80) || clip(r.title, 80) || 'Job',
        body: clip(r.notification.body, 160),
        at: r.finishedAt,
        jobId: r.jobId,
        url: jobLink(r.jobId),
      });
    }
  }
  for (const n of notices || []) {
    if (!n || typeof n.at !== 'string' || (memberId && n.memberId === memberId)) continue;
    if (timeOf(n.at) < since) continue;
    out.push({
      kind: 'space',
      id: 'notice:' + n.id,
      title: clip(n.title, 80) || clip(spaceName, 40) || 'Shared Space',
      body: clip(n.body, 160),
      from: clip(n.from, 60),
      at: n.at,
      ...(n.jobId ? { jobId: n.jobId } : {}),
    });
  }
  for (const c of conversations || []) {
    if (!c || !c.unread || c.request) continue;
    const at = c.last?.message?.createdAt;
    if (typeof at !== 'string') continue;
    const name = clip(c.title || c.last?.fromTitle, 60) || 'Someone';
    out.push({
      kind: 'message',
      id: 'message:' + c.personaId + ':' + c.other,
      title: c.unread > 1 ? `${c.unread} new messages from ${name}` : `New message from ${name}`,
      body: clip(c.last?.message?.text, 160),
      at,
      personaId: c.personaId,
      with: c.other,
      url: `nomad://messages/?persona=${encodeURIComponent(c.personaId)}&with=${encodeURIComponent(c.other)}`,
    });
  }
  out.sort(newestFirst('at'));
  return out.filter((n) => !isDismissed(n, dismissed)).slice(0, max);
}

// Clearing notifications
// =

// The record keeps, per notification id, the time of the item the user cleared (`at`). It stays
// hidden while it is that item; a Conversation's row comes back with a newer Message.
// { type, items: { [id]: at }, updatedAt }.
export function isDismissed(n, record) {
  const at = record?.items?.[n?.id];
  return typeof at === 'string' && typeof n.at === 'string' && n.at <= at;
}

// The record with `items` ([{ id, at }]) added, and entries older than the notifications window
// (plus a day) dropped, so it never grows past what could still show.
export function dismiss(record, items = [], { now = Date.now() } = {}) {
  const keep = new Date(now - (NOTIFY_DAYS + 1) * MS_DAY).toISOString();
  const next = {};
  for (const [id, at] of Object.entries(record?.items || {})) {
    if (typeof at === 'string' && at >= keep) next[id] = at;
  }
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || typeof it.at !== 'string' || it.id.length > 400) continue;
    if (!next[it.id] || next[it.id] < it.at) next[it.id] = it.at;
  }
  const entries = Object.entries(next).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).slice(0, MAX_DISMISSED);
  return { type: DISMISSED_TYPE, items: Object.fromEntries(entries), updatedAt: new Date(now).toISOString() };
}

// Jobs
// =

// { running, next, total, paused }. `running`: the Jobs running now or waiting to (`running` and
// `queued` from bg/ai/jobs.js list(); the phone never knows, so it has none). `next`: the enabled
// Jobs with a next time, soonest first. `jobs` are shared/jobs.mjs jobsWithRuns() rows.
export function jobsOverview(jobs = [], { max = LIMITS.next, maxRunning = LIMITS.running } = {}) {
  const list = (jobs || []).filter((j) => j && typeof j.id === 'string');
  const running = list
    .filter((j) => j.running || j.queued)
    .sort((a, b) => Number(!!a.queued) - Number(!!b.queued) || String(a.title).localeCompare(b.title))
    .slice(0, maxRunning)
    .map((j) => ({ id: j.id, title: j.title, queued: !j.running, url: jobLink(j.id) }));
  const busy = new Set(running.map((j) => j.id));
  const next = list
    .filter((j) => j.enabled && j.nextRunAt && !busy.has(j.id))
    .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : a.nextRunAt > b.nextRunAt ? 1 : 0))
    .slice(0, max)
    .map((j) => ({
      id: j.id,
      title: j.title,
      at: j.nextRunAt,
      when: j.when || '',
      deviceName: j.deviceName || '',
      requested: !!j.requested,
      url: jobLink(j.id),
    }));
  return {
    running,
    next,
    total: list.length,
    paused: list.filter((j) => !j.enabled).length,
  };
}

// Coming up
// =

// The calendar's occurrences (shared/calendar.mjs agenda) that haven't ended by `now`, a wall time
// 'YYYY-MM-DDTHH:MM', in time order: [{ id, title, day, dayLabel, allDay, start, end, ongoing,
// location, feed, color, url }]. `start`/`end` stay wall times: each app shows them on its own clock.
export function upcomingEvents(occurrences = [], now, { max = LIMITS.events } = {}) {
  if (!DAY.test(now || '')) return [];
  const today = now.slice(0, 10);
  const at = now.length >= 16 ? now.slice(0, 16) : today + 'T00:00';
  const out = [];
  for (const o of occurrences || []) {
    if (!o || typeof o.start !== 'string' || !DAY.test(o.start)) continue;
    const day = o.start.slice(0, 10);
    let ongoing;
    if (o.allDay) {
      const last = o.end && DAY.test(o.end) ? o.end.slice(0, 10) : day;
      if (last < today) continue;
      ongoing = day <= today;
    } else {
      const end = typeof o.end === 'string' && o.end.length >= 16 ? o.end.slice(0, 16) : o.start.slice(0, 16);
      if (end <= at && o.start.slice(0, 16) < at) continue;
      ongoing = o.start.slice(0, 16) <= at && end > at;
    }
    // An all-day event that started before today shows under today.
    const shownDay = ongoing && day < today ? today : day;
    out.push({
      id: o.id,
      title: clip(o.title, 120) || 'Event',
      day: shownDay,
      dayLabel: dayLabel(shownDay, today),
      allDay: !!o.allDay,
      start: o.start,
      end: o.end || null,
      ongoing,
      location: clip(o.location, 80),
      feed: o.feed?.name ? clip(o.feed.name, 40) : '',
      color: o.feed?.color || null,
      url: calendarLink(shownDay),
    });
  }
  out.sort((a, b) =>
    a.day !== b.day
      ? a.day < b.day
        ? -1
        : 1
      : a.allDay !== b.allDay
        ? a.allDay
          ? -1
          : 1
        : a.start < b.start
          ? -1
          : a.start > b.start
            ? 1
            : 0
  );
  return out.slice(0, max);
}

// Latest
// =

// The Notes changed last: [{ id, title, snippet, updatedAt, url }]. The phone's list already has
// `title` and `snippet`; desktop's has only the body.
export function latestNotes(notes = [], { max = LIMITS.notes } = {}) {
  return (notes || [])
    .filter((n) => n && typeof n.id === 'string' && typeof n.updatedAt === 'string')
    .sort(newestFirst('updatedAt'))
    .slice(0, max)
    .map((n) => ({
      id: n.id,
      title: n.title || noteTitle(n.body),
      snippet: n.snippet ?? noteSnippet(n.body, 100),
      updatedAt: n.updatedAt,
      url: noteLink(n.id),
    }));
}

// The Assets added last: [{ id, name, kind, icon, mime, thumb, addedAt, by, url }]. `icon` is a
// Font Awesome 5 name (shared/assets.mjs KIND_ICONS).
export function latestAssets(assets = [], { max = LIMITS.assets } = {}) {
  return (assets || [])
    .filter((a) => a && typeof a.id === 'string' && typeof a.addedAt === 'string')
    .sort(newestFirst('addedAt'))
    .slice(0, max)
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind || 'other',
      icon: KIND_ICONS[a.kind] || KIND_ICONS.other,
      mime: a.mime || '',
      bytes: a.bytes || 0,
      thumb: !!a.thumb,
      addedAt: a.addedAt,
      by: a.by || '',
      url: assetLink(a.id),
    }));
}

// The whole dashboard. `now` is a wall time ('YYYY-MM-DDTHH:MM', the user's clock) for the calendar;
// `at` the real time (ms) for "the last 7 days". Each input may be missing: its section is empty.
// `limits` asks for more or fewer rows in a section than LIMITS gives (a home page layout's
// HomeNotes(10), shared/home-layout.mjs), each between 1 and MAX_LIMIT.
/** @param {any} [input] @param {{ now?: string, at?: number, limits?: any }} [opts] */
export function dashboard(
  {
    jobs = [],
    runs = [],
    notes = [],
    assets = [],
    occurrences = [],
    notices = [],
    memberId = null,
    spaceName = '',
    conversations = [],
    prompts = [],
    driveRequests = [],
    spaceRequests = [],
    joins = [],
    devices = [],
    dismissed = null,
  } = {},
  { now, at = Date.now(), limits = null } = {}
) {
  const max = sectionLimits(limits);
  const sources = { runs, notices, memberId, spaceName, conversations };
  // Every notification not cleared yet, for Clear all: the list below shows only the newest.
  const uncleared = notifications(sources, { now: at, max: Infinity, dismissed });
  return {
    now: now || null,
    greeting: greeting(now),
    waiting: waiting({ prompts, driveRequests, spaceRequests, joins, devices, conversations, runs, jobs, spaceName }),
    notifications: uncleared.slice(0, max.notifications),
    notificationKeys: uncleared.map((n) => ({ id: n.id, at: n.at })),
    jobs: jobsOverview(jobs, { max: max.next }),
    events: upcomingEvents(occurrences, now, { max: max.events }),
    notes: latestNotes(notes, { max: max.notes }),
    assets: latestAssets(assets, { max: max.assets }),
    unreadMessages: (conversations || []).reduce((n, c) => n + (c && !c.request ? c.unread || 0 : 0), 0),
  };
}
