// nomad/shared/jobs.mjs
//
// AI Jobs (ADR-0030): a saved prompt the user's AI runs by itself, on demand or on a schedule, whose
// result can notify the user's phone. A Job and each of its runs are Vault records, so every linked
// Device sees them:
//
//   /.vault/jobs/<id>.json                { type, id, title, prompt, source?, writes?, schedule, notify, enabled,
//                                           device, space, createdAt, updatedAt, scheduleFrom }
//   /.vault/job-runs/<jobId>/<runId>.json { type, id, jobId, title, device, trigger, startedAt, finishedAt,
//                                           status, output, error?, notification }
//   /.vault/job-requests/<jobId>.json     { type, jobId, requestedAt, by }   "run it now", from a Device
//                                           without an AI Runtime (the phone); the Job's Device runs it
//                                           and deletes the record
//
// `device` is the Device that runs the Job on its schedule (the one it was made on, unless the user
// moves it): one Device, so two desktops never run the same Job twice. Any Device that has an AI
// Runtime can run it by hand. `space` is the Root Drive key of the Space whose Reader the Job reads.
//
// A schedule is null (by hand only) or one of:
//   { kind: 'interval', minutes, from?, to?, days? }  every N minutes (15 or more), only between
//                                                    from and to ('HH:MM') and on days, if given
//   { kind: 'daily', times: ['HH:MM', …], days? }    at these times, on these weekdays (none: every day)
//   { kind: 'monthly', dates: [1, 15, -1], times }   on these days of the month (-1: the last day)
//   { kind: 'once', at: ISO }                        once, then never again
//   { kind: 'cron', expr: '0 8 * * 1-5' }            a five-field cron expression
// Weekdays are 0 = Sunday to 6. Times are the running Device's local time. (Older daily records
// have one `time` instead of `times`.)
//
// A Job can come from a drive (`source`): a folder with `job.js` (a module, run like the AI's execute
// code: `import { nomad } from 'nomad:runtime'` and `export default async function main(params)`)
// and/or `job.md` (a prompt). A module runs first; with a prompt, the AI gets the module's result
// with it, and without one the result is the run's answer. The Job's own `prompt` is then optional
// extra instructions. A source in one of the user's own drives (one this Device can write) is
// `live`: each run reads the files as they are now. Anyone else's is copied into the record when
// it's added, so its owner can't change what runs on the user's computer; `changed` is the hash of
// a newer version the runner saw, and the user accepts it by adding the source again.
//
//   source: { url, live, module?, prompt?, hash?, copiedAt?, changed? }
//
// A Job reads and changes nothing unless it was given `writes` when it was made or edited: drives it
// may write ({ url, draft } — `draft` stages its writes in the drive's Draft for the user to publish),
// and whether it may write Notes and change Reader (follow, unfollow, mark read). Nothing else:
// the runner offers only those write capabilities, and its permission check grants only those.
//
//   writes: { drives: [{ url: 'hyper://<key>/', draft }], notes, reader }
//
// `notify` is 'always' (every run sends its answer), 'auto' (only when the AI calls notify), or
// 'never'. A failed run notifies too, once per streak of failures, unless 'never'.
//
// Pure: no imports. Used by app/bg/ai/jobs.js (desktop), mobile/backend (the phone) and the phone's UI.

export const JOBS_PREFIX = '/.vault/jobs/';
export const RUNS_PREFIX = '/.vault/job-runs/';
export const REQUESTS_PREFIX = '/.vault/job-requests/';
export const REQUEST_TYPE = 'nomad/job-request';
export const JOB_TYPE = 'nomad/job';
export const RUN_TYPE = 'nomad/job-run';

export const NOTIFY = ['always', 'auto', 'never'];
export const MIN_INTERVAL = 15; // minutes
export const MAX_INTERVAL = 7 * 24 * 60;
export const KEEP_RUNS = 10; // per Job; older runs are deleted
export const MAX_OUTPUT = 8000; // characters of a run's answer kept in the Vault
const MAX_TITLE = 80;
const MAX_PROMPT = 8000;
const MAX_NOTE_TITLE = 80;
const MAX_NOTE_BODY = 300;
const MAX_ERROR = 500;
export const MAX_MODULE = 32_000; // the execute sandbox's limit (search-execute.mjs MAX_CODE)
export const SOURCE_MODULE = 'job.js';
export const SOURCE_PROMPT = 'job.md';

const ID_RE = /^[a-z0-9-]{6,40}$/;
const KEY_RE = /^[0-9a-f]{64}$/;
const DRIVE_HOST_RE = /^[0-9a-z]{52,64}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clip(s, max) {
  const str = typeof s === 'string' ? s.trim() : '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function randomPart() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

export function newJobId() {
  return 'job-' + Date.now().toString(36) + '-' + randomPart();
}

// Run ids sort by start time, so the newest run is the last key under the Job's prefix.
export function newRunId(now = new Date()) {
  return now.getTime().toString(36).padStart(9, '0') + '-' + randomPart();
}

export function isJobId(id) {
  return ID_RE.test(String(id || ''));
}

export function jobPath(id) {
  if (!isJobId(id)) throw new Error('Not a Job id');
  return `${JOBS_PREFIX}${id}.json`;
}

export function runsPrefix(jobId) {
  if (!isJobId(jobId)) throw new Error('Not a Job id');
  return `${RUNS_PREFIX}${jobId}/`;
}

export function runPath(jobId, runId) {
  if (!isJobId(runId)) throw new Error('Not a run id');
  return `${runsPrefix(jobId)}${runId}.json`;
}

export function requestPath(jobId) {
  if (!isJobId(jobId)) throw new Error('Not a Job id');
  return `${REQUESTS_PREFIX}${jobId}.json`;
}

export function makeRequest(jobId, by = null, now = new Date()) {
  requestPath(jobId); // validates the id
  return {
    type: REQUEST_TYPE,
    jobId,
    requestedAt: now.toISOString(),
    by: KEY_RE.test(String(by || '')) ? by : null,
  };
}

export function isRequest(rec) {
  return !!rec && rec.type === REQUEST_TYPE && isJobId(rec.jobId);
}

export function isJob(rec) {
  return !!rec && rec.type === JOB_TYPE && isJobId(rec.id);
}

export function isRun(rec) {
  return !!rec && rec.type === RUN_TYPE && isJobId(rec.id) && isJobId(rec.jobId);
}

// Schedules
// =

const MON_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MAX_TIMES = 24; // times of day in one schedule
const MAX_DATES = 31;
const LAST = -1; // the last day of the month, in a monthly schedule's dates
const SEARCH_DAYS = 366 * 5; // how far ahead a schedule's next time is looked for

// A schedule as the AI or a form gives it, checked and tidied. Also takes words: "hourly", "daily
// 08:00", "weekdays 9:00 and 17:00", "every 30 minutes from 9:00 to 17:00 on weekdays", "monthly on
// the 1st and 15th at 9am", "last day of the month 18:00", "tomorrow 9:00", "in 2 hours",
// "2026-11-02 09:00", or a cron expression ("0 8 * * 1-5"). `now` is for the relative ones. Null for
// none (by hand only). Throws for anything else.
export function normalizeSchedule(input, now = new Date()) {
  if (input == null || input === '' || input === 'manual' || input === 'none') return null;
  if (typeof input === 'string') return parseSchedule(input, now);
  if (typeof input !== 'object')
    throw new Error('A schedule is an object, a phrase like "daily 08:00", or null');
  switch (input.kind) {
    case 'interval': {
      const minutes = Math.round(Number(input.minutes));
      if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL) {
        throw new Error(`A Job can run at most every ${MIN_INTERVAL} minutes`);
      }
      if (minutes > MAX_INTERVAL)
        throw new Error('An interval can be at most a week; use a daily or monthly schedule');
      const out = { kind: 'interval', minutes };
      if (input.from != null || input.to != null) {
        const from = normalizeTime(input.from ?? '00:00');
        const to = normalizeTime(input.to ?? '23:59');
        if (to <= from) throw new Error('An interval’s `to` is later in the day than its `from`');
        Object.assign(out, { from, to });
      }
      const days = normalizeDays(input.days);
      return days ? { ...out, days } : out;
    }
    case 'daily': {
      const times = normalizeTimes(input.times ?? input.time);
      const days = normalizeDays(input.days);
      return days ? { kind: 'daily', times, days } : { kind: 'daily', times };
    }
    case 'monthly':
      return {
        kind: 'monthly',
        dates: normalizeDates(input.dates ?? input.date),
        times: normalizeTimes(input.times ?? input.time),
      };
    case 'once': {
      const at = new Date(input.at);
      if (input.at == null || Number.isNaN(at.getTime()))
        throw new Error('A one-time schedule needs `at`, a date and time like 2026-11-02T09:00');
      return { kind: 'once', at: at.toISOString() };
    }
    case 'cron':
      return { kind: 'cron', expr: parseCron(input.expr).expr };
  }
  throw new Error('A schedule\'s kind is "interval", "daily", "monthly", "once" or "cron"');
}

function normalizeTime(t) {
  const m = TIME_RE.exec(String(t ?? '').trim());
  if (!m) throw new Error('A time is HH:MM, 24-hour, like 08:00');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function normalizeTimes(times) {
  const list = (Array.isArray(times) ? times : [times]).filter((t) => t != null && t !== '');
  if (!list.length) throw new Error('A schedule needs a time of day, like 08:00');
  const out = [...new Set(list.map(normalizeTime))].sort();
  if (out.length > MAX_TIMES)
    throw new Error(`A schedule can have at most ${MAX_TIMES} times a day`);
  return out;
}

function normalizeDays(days) {
  if (days == null) return null;
  if (!Array.isArray(days)) throw new Error('days is a list of weekdays, 0 (Sunday) to 6');
  const nums = days.map(Number);
  if (nums.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('days is a list of weekdays, 0 (Sunday) to 6');
  }
  const out = [...new Set(nums)].sort((a, b) => a - b);
  return out.length && out.length < 7 ? out : null;
}

function normalizeDates(dates) {
  const list = (Array.isArray(dates) ? dates : [dates]).filter((d) => d != null && d !== '');
  const nums = list.map((d) => (d === 'last' ? LAST : Number(d)));
  if (!nums.length || nums.some((d) => !Number.isInteger(d) || d === 0 || d < LAST || d > 31)) {
    throw new Error(
      'dates is a list of days of the month, 1 to 31, or -1 (or "last") for the last day'
    );
  }
  const out = [...new Set(nums)].sort((a, b) => (a === LAST ? 1 : b === LAST ? -1 : a - b));
  return out.slice(0, MAX_DATES);
}

// Cron
// =

const CRON_FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  {
    name: 'month',
    min: 1,
    max: 12,
    names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
    base: 1,
  },
  {
    name: 'day of week',
    min: 0,
    max: 7,
    names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    base: 0,
  },
];
const CRON_ALIASES = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

// A standard five-field cron expression (minute hour day-of-month month day-of-week, with *, lists,
// ranges, steps, and month and day names), in the running computer's local time. As in cron, a day
// matches when either day field matches if both are restricted. Throws for a bad one, or one that
// runs more often than every MIN_INTERVAL minutes.
export function parseCron(input) {
  const raw = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const expr = CRON_ALIASES[raw] || raw;
  const parts = expr.split(' ');
  if (parts.length !== 5) {
    throw new Error(
      'A cron expression has five fields: minute hour day-of-month month day-of-week, like "0 8 * * 1-5"'
    );
  }
  const sets = parts.map((p, i) => cronField(p, CRON_FIELDS[i]));
  if (sets[4].has(7)) {
    sets[4].delete(7);
    sets[4].add(0);
  }
  // Its times in a day, and the gap between them (across midnight too), must be MIN_INTERVAL or more.
  const day = [];
  for (const h of sets[1]) for (const m of sets[0]) day.push(h * 60 + m);
  day.sort((a, b) => a - b);
  const gaps = day.map((t, i) => (i ? t - day[i - 1] : t + 24 * 60 - day[day.length - 1]));
  if (day.length > 1 && Math.min(...gaps) < MIN_INTERVAL) {
    throw new Error(`A Job can run at most every ${MIN_INTERVAL} minutes`);
  }
  return {
    expr: CRON_ALIASES[raw] ? raw : parts.join(' '),
    minute: sets[0],
    hour: sets[1],
    dom: sets[2],
    month: sets[3],
    dow: sets[4],
    domAny: parts[2] === '*',
    dowAny: parts[4] === '*',
  };
}

function cronField(text, f) {
  const out = new Set();
  for (const item of text.split(',')) {
    const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/.exec(item);
    if (!m) throw new Error(`“${text}” isn’t a cron ${f.name}`);
    const step = m[2] ? Number(m[2]) : 1;
    if (!step) throw new Error(`A cron step can’t be 0`);
    let lo = f.min;
    let hi = f.max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map((v) => cronValue(v, f));
      lo = a;
      hi = b ?? (m[2] ? f.max : a);
    }
    if (lo > hi) throw new Error(`“${item}” runs backwards in the cron ${f.name}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function cronValue(v, f) {
  const named = f.names ? f.names.indexOf(v.slice(0, 3)) : -1;
  const n = named >= 0 && /^[a-z]+$/.test(v) ? named + f.base : Number(v);
  if (!Number.isInteger(n) || n < f.min || n > f.max) {
    throw new Error(`“${v}” is out of range for the cron ${f.name} (${f.min}–${f.max})`);
  }
  return n;
}

function cronDayMatches(c, at) {
  if (!c.month.has(at.getMonth() + 1)) return false;
  const dom = c.dom.has(at.getDate());
  const dow = c.dow.has(at.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow;
}

// Phrases
// =

const DAY_WORDS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_WORDS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
// 08:00, 8:00, 8am, 8:30 pm, noon, midnight.
const CLOCK_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b|\b(noon|midnight)\b/g;

function clockTimes(s) {
  const out = [];
  for (const m of s.matchAll(CLOCK_RE)) {
    if (m[6]) out.push(m[6] === 'noon' ? '12:00' : '00:00');
    else if (m[3]) {
      let h = Number(m[1]) % 12;
      if (m[3] === 'pm') h += 12;
      out.push(`${String(h).padStart(2, '0')}:${m[2] || '00'}`);
    } else out.push(`${m[4].padStart(2, '0')}:${m[5]}`);
  }
  return out;
}

function weekdaysIn(s) {
  if (/\bweekdays?\b/.test(s)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(s)) return [0, 6];
  const days = [
    ...s.matchAll(
      /\b(sun|mon|tue|wed|thu|fri|sat)(?:days?|s|sdays?|nesdays?|rs|rsdays?|urdays?)?\b/g
    ),
  ].map((m) => DAY_WORDS[m[1]]);
  return days.length ? days : null;
}

const HELP =
  'Try "daily 08:00", "weekdays 9:00 and 17:00", "every 2 hours", "monthly on the 1st at 9:00", "tomorrow 9:00" or a cron expression like "0 8 * * 1-5"';

function parseSchedule(text, now) {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ');

  // Cron: "cron …", an @alias, or five fields that parse as one.
  const said = /^cron\s+(.+)$/.exec(s)?.[1];
  if (said || CRON_ALIASES[s]) return { kind: 'cron', expr: parseCron(said || s).expr };
  if (/^[\d*][\d*,/-]*( [\d*a-z][\d*,/\-a-z]*){4}$/.test(s)) {
    try {
      return { kind: 'cron', expr: parseCron(s).expr };
    } catch (err) {
      if (/^[\d*,/\- ]+$/.test(s)) throw err; // only cron could mean that
    }
  }

  // Once: "in 2 hours", "tomorrow 9:00", "today at 5pm", "2026-11-02 09:00", "Nov 2 9:00", "once …".
  const rel = /^(?:once )?in (\d+) ?(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0] === 'm' ? 60_000 : rel[2][0] === 'h' ? 3_600_000 : 86_400_000;
    return onceAt(new Date(new Date(now).getTime() + n * unit));
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?\b/.exec(s);
  if (iso) {
    const [h, m] = (
      clockTimes(s.replace(iso[0], ' '))[0] || (iso[4] ? `${iso[4]}:${iso[5]}` : '09:00')
    )
      .split(':')
      .map(Number);
    return onceAt(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), h, m));
  }
  const named =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/.exec(s);
  if (
    /\b(today|tonight|tomorrow|once)\b/.test(s) ||
    (named && !/\b(every|monthly|each)\b/.test(s))
  ) {
    const base = new Date(now);
    let day = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    if (/\btomorrow\b/.test(s)) day.setDate(day.getDate() + 1);
    if (named) {
      day = new Date(base.getFullYear(), MONTH_WORDS[named[1]], Number(named[2]));
      if (day < new Date(base.getFullYear(), base.getMonth(), base.getDate()))
        day.setFullYear(day.getFullYear() + 1);
    }
    const [time] = clockTimes(s.replace(named?.[0] || '', ' '));
    if (!time) throw new Error(`“${text}” needs a time, like "tomorrow 9:00"`);
    const [h, m] = time.split(':').map(Number);
    day.setHours(h, m, 0, 0);
    return onceAt(day);
  }

  // Intervals, with an optional window and days: "every 30 minutes from 9:00 to 17:00 on weekdays".
  const every = /\bevery (\d+)? ?(m|min|mins|minutes?|h|hr|hrs|hours?)\b/.exec(s);
  if (every || /\b(hourly|every hour)\b/.test(s)) {
    const n = every ? Number(every[1] || 1) : 1;
    const minutes = every && every[2][0] === 'm' ? n : n * 60;
    const times = clockTimes(s);
    const days = weekdaysIn(s);
    return normalizeSchedule({
      kind: 'interval',
      minutes,
      ...(times.length >= 2 ? { from: times[0], to: times[1] } : {}),
      ...(days ? { days } : {}),
    });
  }

  const times = clockTimes(s);
  if (!times.length) throw new Error(`“${text}” isn’t a schedule. ${HELP}`);

  // Monthly: "monthly on the 1st and 15th 9:00", "last day of the month 18:00", "on the 3rd at 8am".
  const ords = [...s.replace(CLOCK_RE, ' ').matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/g)].map((m) =>
    Number(m[1])
  );
  const last = /\blast day\b/.test(s);
  if (/\bmonth/.test(s) || ords.length || last) {
    const dates = [...ords, ...(last ? [LAST] : [])];
    return normalizeSchedule({ kind: 'monthly', dates: dates.length ? dates : [1], times });
  }

  return normalizeSchedule({ kind: 'daily', times, days: weekdaysIn(s) });
}

function onceAt(at) {
  if (Number.isNaN(at.getTime())) throw new Error('That date isn’t a real date');
  return { kind: 'once', at: at.toISOString() };
}

// Descriptions
// =

// "Every 2 hours", "Every 30 minutes, 09:00–17:00 on weekdays", "Every day at 08:00", "Weekdays at
// 09:00 and 17:00", "Mon, Wed at 07:30", "Monthly on the 1st and last day at 09:00", "Once, Mon Nov
// 2 at 09:00", "Cron 0 8 * * 1-5", "By hand".
export function describeSchedule(schedule) {
  if (!schedule) return 'By hand';
  switch (schedule.kind) {
    case 'interval': {
      const m = schedule.minutes;
      let when;
      if (m % (24 * 60) === 0)
        when = m === 24 * 60 ? 'Every 24 hours' : `Every ${m / (24 * 60)} days`;
      else if (m % 60 === 0) when = m === 60 ? 'Every hour' : `Every ${m / 60} hours`;
      else when = `Every ${m} minutes`;
      const window = schedule.from ? `, ${schedule.from}–${schedule.to}` : '';
      const named = schedule.days ? describeDays(schedule.days) : '';
      const days = named ? ` on ${/^Week/.test(named) ? named.toLowerCase() : named}` : '';
      return when + window + days;
    }
    case 'daily':
      return `${schedule.days ? describeDays(schedule.days) : 'Every day'} at ${listWords(timesOf(schedule))}`;
    case 'monthly':
      return `Monthly on the ${listWords(schedule.dates.map(ordinal))} at ${listWords(timesOf(schedule))}`;
    case 'once': {
      const at = new Date(schedule.at);
      return `Once, ${DAY_NAMES[at.getDay()]} ${MON_NAMES[at.getMonth()]} ${at.getDate()} at ${hhmm(at)}`;
    }
    case 'cron':
      return `Cron ${schedule.expr}`;
  }
  return 'By hand';
}

function describeDays(days) {
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

function listWords(items) {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function ordinal(d) {
  if (d === LAST) return 'last day';
  const s = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th';
  return d + s;
}

function hhmm(at) {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

// A daily or monthly schedule's times (older records have one `time`).
function timesOf(schedule) {
  return schedule.times || (schedule.time ? [schedule.time] : []);
}

// Next times
// =

// The first time the schedule runs strictly after `after`, or null for none.
export function nextRunAt(schedule, after) {
  if (!schedule) return null;
  const from = new Date(after);
  if (Number.isNaN(from.getTime())) return null;
  switch (schedule.kind) {
    case 'interval':
      return nextInterval(schedule, from);
    case 'daily':
      return nextOnDays(
        from,
        timesOf(schedule),
        (day) => !schedule.days || schedule.days.includes(day.getDay())
      );
    case 'monthly':
      return nextOnDays(from, timesOf(schedule), (day) => monthlyDateMatches(schedule.dates, day));
    case 'once': {
      const at = new Date(schedule.at);
      return at > from ? at : null;
    }
    case 'cron': {
      let c;
      try {
        c = parseCron(schedule.expr);
      } catch {
        return null;
      }
      const times = [];
      for (const h of [...c.hour].sort((a, b) => a - b)) {
        for (const m of [...c.minute].sort((a, b) => a - b))
          times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
      return nextOnDays(from, times, (day) => cronDayMatches(c, day));
    }
  }
  return null;
}

function monthlyDateMatches(dates, day) {
  const lastDate = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  return dates.some((d) => (d === LAST ? day.getDate() === lastDate : d === day.getDate()));
}

// The first of `times` (sorted HH:MM) on a day that matches, strictly after `from`.
function nextOnDays(from, times, dayMatches) {
  if (!times.length) return null;
  const hm = times.map((t) => t.split(':').map(Number));
  for (let d = 0; d <= SEARCH_DAYS; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    if (!dayMatches(day)) continue;
    for (const [h, m] of hm) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
      if (at > from) return at;
    }
  }
  return null;
}

// Every `minutes` after the last run, but only inside the window and on the days, if it has them.
// Outside them it next runs when the window opens.
function nextInterval(schedule, from) {
  const next = new Date(from.getTime() + schedule.minutes * 60_000);
  if (!schedule.from && !schedule.days) return next;
  const okDay = (at) => !schedule.days || schedule.days.includes(at.getDay());
  const t = hhmm(next);
  if (okDay(next) && (!schedule.from || (t >= schedule.from && t <= schedule.to))) return next;
  // The window's next opening after `from` (or the next allowed day's midnight without a window).
  return nextOnDays(from, [schedule.from || '00:00'], okDay);
}

// When the Job next runs on its schedule: the first time after its last run, or after the schedule
// was set (so a new schedule never fires for a time that already went by). A time missed while the
// Device was asleep is due at once, and runs once, however many were missed. A one-time schedule
// runs once: a run by hand before its time doesn't count.
export function dueAt(job, lastRunAt = null) {
  if (!job || !job.enabled || !job.schedule) return null;
  if (job.schedule.kind === 'once') {
    const at = new Date(job.schedule.at);
    if (Number.isNaN(at.getTime())) return null;
    return lastRunAt && new Date(lastRunAt) >= at ? null : at;
  }
  const times = [job.scheduleFrom, lastRunAt]
    .map((t) => new Date(t || 0).getTime())
    .filter((t) => t > 0);
  if (!times.length) return null;
  return nextRunAt(job.schedule, new Date(Math.max(...times)));
}

export function isDue(job, lastRunAt, now = new Date()) {
  const at = dueAt(job, lastRunAt);
  return !!at && at.getTime() <= new Date(now).getTime();
}

// Jobs
// =

// The record to store: a new Job (no `prev`) or changes to `prev`, where fields left out keep their
// values. `device` and `space` are where a new Job runs and reads Reader. Throws for a bad field.
export function makeJob(fields, prev = null, now = new Date()) {
  const f = fields || {};
  const iso = now.toISOString();
  const id = prev?.id || f.id;
  if (!isJobId(id)) throw new Error('Not a Job id');

  const prompt = f.prompt !== undefined ? String(f.prompt || '').trim() : prev?.prompt || '';
  if (prompt.length > MAX_PROMPT)
    throw new Error(`A Job's prompt can be at most ${MAX_PROMPT} characters`);
  const source =
    f.source !== undefined
      ? f.source
        ? makeSource(f.source, prev?.source, now)
        : null
      : prev?.source || null;
  if (!prompt && !source) {
    throw new Error(
      'A Job needs a prompt (what the AI should do each time it runs) or a drive with job.js or job.md'
    );
  }

  const title =
    clip(f.title !== undefined ? f.title : prev?.title, MAX_TITLE) ||
    clip(prompt.split('\n')[0], 60) ||
    clip(f.source?.title, MAX_TITLE) ||
    sourceTitle(source);
  const schedule =
    f.schedule !== undefined ? normalizeSchedule(f.schedule, now) : prev?.schedule || null;
  if (
    schedule?.kind === 'once' &&
    f.schedule !== undefined &&
    new Date(schedule.at).getTime() < now.getTime() - 60_000 &&
    JSON.stringify(schedule) !== JSON.stringify(prev?.schedule || null)
  ) {
    throw new Error(`${describeSchedule(schedule)} has already passed`);
  }
  const notify = f.notify !== undefined ? f.notify : prev?.notify || 'always';
  if (!NOTIFY.includes(notify)) throw new Error('notify is "always", "auto" or "never"');
  const enabled = f.enabled !== undefined ? !!f.enabled : prev ? prev.enabled : true;
  const writes = f.writes !== undefined ? normalizeWrites(f.writes) : prev?.writes || null;

  const device = f.device !== undefined ? f.device : prev?.device || null;
  if (device != null && !KEY_RE.test(device)) throw new Error('Not a Device key');
  const space = f.space !== undefined ? f.space : prev?.space || null;
  if (space != null && !KEY_RE.test(space)) throw new Error('Not a Space key');

  // A schedule counts from when it was set, turned back on, or moved to another Device.
  const restart =
    !prev ||
    JSON.stringify(schedule) !== JSON.stringify(prev.schedule || null) ||
    (enabled && !prev.enabled) ||
    device !== prev.device;

  return {
    type: JOB_TYPE,
    id,
    title,
    prompt,
    ...(source ? { source } : {}),
    ...(writes ? { writes } : {}),
    schedule,
    notify,
    enabled,
    device,
    space,
    createdAt: prev?.createdAt || iso,
    updatedAt: iso,
    scheduleFrom: restart ? iso : prev.scheduleFrom || prev.createdAt || iso,
  };
}

// Drive sources
// =

// The files a source URL names: a folder's job.js and job.md, or a .js or .md file and the file
// next to it with the other extension. `drive` is the drive's root URL, `url` the tidied source.
// Throws for anything but a hyper:// drive URL with a key (resolve names first).
export function sourceFiles(input) {
  const m = /^hyper:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(String(input || '').trim());
  if (!m || !DRIVE_HOST_RE.test(m[1].toLowerCase())) {
    throw new Error(
      'A Job’s source is a hyper:// drive URL, like hyper://<key>/ or hyper://<key>/jobs/digest.js'
    );
  }
  const drive = `hyper://${m[1].toLowerCase()}/`;
  let path = (m[2] || '/').replace(/\/{2,}/g, '/');
  if (path.split('/').includes('..')) throw new Error('A Job’s source can’t use ..');
  let module, prompt;
  if (/\.js$/i.test(path)) {
    module = path;
    prompt = path.replace(/\.js$/i, '.md');
  } else if (/\.md$/i.test(path)) {
    prompt = path;
    module = path.replace(/\.md$/i, '.js');
  } else {
    if (!path.endsWith('/')) path += '/';
    module = path + SOURCE_MODULE;
    prompt = path + SOURCE_PROMPT;
  }
  return { url: drive.slice(0, -1) + path, drive, module, prompt };
}

// A short, stable hash of a source's files, to tell a newer version from the copy. Not for security:
// the copy is what runs, and the user looks at a new version before taking it.
export function hashSource(module, prompt) {
  const s = `${module ?? ''}\u0000${prompt ?? ''}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// A Job's `source` from what was read from the drive: { url, live, module?, prompt?, title? }, where
// module and prompt are the files' text or null when missing (title only names a new Job). A live source keeps only its URL: each run
// reads the files. Otherwise the files are copied in.
export function makeSource(input, prev = null, now = new Date()) {
  if (!input || typeof input !== 'object')
    throw new Error('source is { url, live, module?, prompt? }');
  const { url } = sourceFiles(input.url);
  if (input.live) return { url, live: true };
  const module = typeof input.module === 'string' && input.module.trim() ? input.module : null;
  const prompt =
    typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.trim() : null;
  if (!module && !prompt) {
    // Kept as it was: the record already holds the copy (an edit that doesn't touch the source).
    if (prev && !prev.live && prev.url === url && (prev.module || prev.prompt)) return prev;
    throw new Error(`${url} has no ${SOURCE_MODULE} or ${SOURCE_PROMPT}`);
  }
  checkSourceFiles(module, prompt);
  const hash = hashSource(module, prompt);
  if (prev && !prev.live && prev.url === url && prev.hash === hash) {
    const { changed, ...same } = prev;
    return changed && changed !== hash ? prev : same;
  }
  return {
    url,
    live: false,
    ...(module ? { module } : {}),
    ...(prompt ? { prompt } : {}),
    hash,
    copiedAt: now.toISOString(),
  };
}

// Throws when a source's files are too big to run.
export function checkSourceFiles(module, prompt) {
  if (module && module.length > MAX_MODULE) {
    throw new Error(`${SOURCE_MODULE} can be at most ${MAX_MODULE} characters`);
  }
  if (prompt && prompt.length > MAX_PROMPT) {
    throw new Error(`${SOURCE_PROMPT} can be at most ${MAX_PROMPT} characters`);
  }
}

// The source with a newer version noted (the runner saw `hash` in the drive), or null when there's
// nothing new to note.
export function noteSourceChange(source, hash) {
  if (!source || source.live || !hash || hash === source.hash || hash === source.changed)
    return null;
  return { ...source, changed: hash };
}

// What a run does: { module, prompt } from the source's files (`files`: what a live source read now;
// a copied source uses its copy) and the Job's own prompt. Either can be null, not both.
export function jobWork(job, files = null) {
  const from = job?.source ? (job.source.live ? files || {} : job.source) : {};
  const module = from.module || null;
  const prompt = [from.prompt, job?.prompt]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!module && !prompt) {
    throw new Error(
      job?.source
        ? `${job.source.url} has no ${SOURCE_MODULE} or ${SOURCE_PROMPT}`
        : 'The Job has no prompt'
    );
  }
  return { module, prompt: prompt || null };
}

// The AI's prompt when a module ran first: the prompt, then what the module returned.
export function promptWithResult(prompt, result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);
  return `${prompt}\n\nThe Job’s module (${SOURCE_MODULE}) ran first and returned:\n\n\`\`\`\n${text || '(nothing)'}\n\`\`\``;
}

function sourceTitle(source) {
  if (!source) return '';
  const heading = /^#\s+(.+)$/m.exec(source.prompt || '');
  if (heading) return clip(heading[1], 60);
  const { drive, url } = sourceFiles(source.url);
  const name = url
    .slice(drive.length - 1)
    .replace(/\/$/, '')
    .split('/')
    .pop();
  return clip(name ? name.replace(/\.(js|md)$/i, '') : `Job from ${drive.slice(8, 14)}…`, 60);
}

// Writes
// =

export const MAX_WRITE_DRIVES = 10;
const MAX_CHANGES = 50; // what one run changed, kept with the run
// The capabilities each grant adds to a Job's turn. A drive grant adds writeDriveFile.
export const WRITE_CAPS = {
  notes: ['writeNote'],
  reader: ['followFeed', 'unfollowFeed', 'markPostsRead'],
};

// A Job's `writes` as a form or the AI gives it, tidied: drives as hyper://<key>/ (names resolved
// first), each with `draft`. Null when it grants nothing. Throws for a bad drive.
export function normalizeWrites(input) {
  if (!input) return null;
  if (typeof input !== 'object') throw new Error('writes is { drives?, notes?, reader? }');
  const drives = [];
  for (const d of Array.isArray(input.drives) ? input.drives : []) {
    const raw = typeof d === 'string' ? { url: d } : d || {};
    const m = /^hyper:\/\/([0-9a-z]{52,64})(?:[/?#]|$)/i.exec(String(raw.url || '').trim());
    if (!m)
      throw new Error(`“${raw.url}” isn’t a drive a Job can write: give its hyper://<key>/ URL`);
    const url = `hyper://${m[1].toLowerCase()}/`;
    if (drives.some((x) => x.url === url)) continue;
    drives.push({ url, draft: !!raw.draft });
  }
  if (drives.length > MAX_WRITE_DRIVES) {
    throw new Error(`A Job can write at most ${MAX_WRITE_DRIVES} drives`);
  }
  const out = { drives, notes: !!input.notes, reader: !!input.reader };
  return drives.length || out.notes || out.reader ? out : null;
}

// The capabilities a Job's writes add to its turn, besides writeDriveFile (which a drive grant
// turns on).
export function writeCaps(writes) {
  if (!writes) return [];
  return [...(writes.notes ? WRITE_CAPS.notes : []), ...(writes.reader ? WRITE_CAPS.reader : [])];
}

// The permissions a Job's writes grant its runs: notesWrite, readerWrite, modifyDrive:<key>.
export function writePermissions(writes) {
  if (!writes) return [];
  return [
    ...(writes.notes ? ['notesWrite'] : []),
    ...(writes.reader ? ['readerWrite'] : []),
    ...(writes.drives || []).map((d) => 'modifyDrive:' + d.url.slice(8, -1)),
  ];
}

// Whether a drive's writes stage in its Draft (`base` is hyper://<key>, with or without the slash).
export function writesInDraft(writes, base) {
  const url = String(base || '').replace(/\/?$/, '/');
  return !!writes?.drives?.some((d) => d.url === url && d.draft);
}

// What `next` grants that `prev` didn't: a Job's writes the user hasn't said yes to yet.
export function addedWrites(prev, next) {
  if (!next) return null;
  // A drive is new, or went from staging in a Draft to writing live.
  const had = new Map((prev?.drives || []).map((d) => [d.url, d.draft]));
  return normalizeWrites({
    drives: next.drives.filter((d) => !had.has(d.url) || (had.get(d.url) && !d.draft)),
    notes: next.notes && !prev?.notes,
    reader: next.reader && !prev?.reader,
  });
}

// "your Notes", "your Reader", "hyper://1a2b3c…/ (in a Draft)": a Job's writes in words.
export function describeWrites(writes, driveName = null) {
  if (!writes) return [];
  return [
    ...(writes.notes ? ['your Notes'] : []),
    ...(writes.reader ? ['your Reader (follow, unfollow, mark read)'] : []),
    ...(writes.drives || []).map(
      (d) =>
        `${(driveName && driveName(d.url)) || d.url.slice(0, 16) + '…/'}${d.draft ? ' (in a Draft)' : ''}`
    ),
  ];
}

// What a run changed, tidied for its record: { drive, path, draft } for a file, { tool, summary }
// for a Note or Reader change.
function normalizeChanges(changes) {
  const out = [];
  for (const c of Array.isArray(changes) ? changes : []) {
    if (c?.path && c.drive) {
      out.push({
        drive: String(c.drive).replace(/\/?$/, '/'),
        path: String(c.path).slice(0, 300),
        draft: !!c.draft,
      });
    } else if (c?.tool) {
      out.push({ tool: String(c.tool), summary: clip(String(c.summary || ''), 200) });
    }
  }
  return out.length > MAX_CHANGES ? out.slice(0, MAX_CHANGES) : out;
}

// Jobs A to Z by title.
export function sortJobs(jobs) {
  return [...(jobs || [])]
    .filter(isJob)
    .sort((a, b) => a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt));
}

// Runs
// =

// A notification as the AI sent it, tidied: { title, body }, or null when there is nothing to say.
export function makeNotification(n, fallbackTitle = 'Nomad') {
  if (!n || typeof n !== 'object') return null;
  const body = clip(oneParagraph(n.body ?? n.text ?? n.message), MAX_NOTE_BODY);
  const title = clip(oneParagraph(n.title), MAX_NOTE_TITLE) || clip(fallbackTitle, MAX_NOTE_TITLE);
  return body || title ? { title, body } : null;
}

function oneParagraph(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Plain text from the start of a Markdown answer, for a notification's body.
export function summarize(text, max = MAX_NOTE_BODY) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(plain, max);
}

// The notification a finished run sends, or null. `notified` is what the AI sent with notify, if
// it did; `prevRun` is the Job's run before this one.
export function finalNotification(job, { status, output, error, notified = null, prevRun = null }) {
  if (!job || job.notify === 'never') return null;
  if (status === 'error') {
    if (prevRun?.status === 'error') return null; // already told: the last run failed too
    return makeNotification({
      title: `${job.title} failed`,
      body: error || 'The Job didn’t finish',
    });
  }
  if (notified) return makeNotification(notified, job.title);
  if (job.notify === 'always')
    return makeNotification({ title: job.title, body: summarize(output) || 'Done' });
  return null;
}

export function makeRun({
  id,
  job,
  device,
  trigger = 'schedule',
  startedAt,
  finishedAt,
  status,
  output,
  error,
  notification,
  changes = [],
}) {
  const changed = normalizeChanges(changes);
  return {
    type: RUN_TYPE,
    id,
    jobId: job.id,
    title: job.title,
    device: device || null,
    trigger: trigger === 'manual' ? 'manual' : 'schedule',
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    status: status === 'error' ? 'error' : 'ok',
    output: clipOutput(output),
    ...(error ? { error: clip(String(error), MAX_ERROR) } : {}),
    notification: notification || null,
    ...(changed.length ? { changes: changed } : {}),
  };
}

function clipOutput(text) {
  const s = String(text || '').trim();
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n\n[Cut at ${MAX_OUTPUT} of ${s.length} characters.]`
    : s;
}

// Runs newest first.
export function sortRuns(runs) {
  return [...(runs || [])]
    .filter(isRun)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

// The runs to delete so a Job keeps its newest `keep`.
export function runsToPrune(runs, keep = KEEP_RUNS) {
  return sortRuns(runs).slice(keep);
}

// Every Job with its newest run and when it next runs: what a list shows.
export function jobsWithRuns(jobs, runs) {
  const newest = new Map();
  for (const r of sortRuns(runs)) if (!newest.has(r.jobId)) newest.set(r.jobId, r);
  return sortJobs(jobs).map((job) => {
    const last = newest.get(job.id) || null;
    const next = dueAt(job, last?.startedAt);
    return { ...job, lastRun: last, nextRunAt: next ? next.toISOString() : null };
  });
}

// Notifications the phone hasn't shown: runs with one that finished after `since` (the newest
// finishedAt it already handled), oldest first. `since` null means the phone has never looked: it
// shows none and starts from now. Returns { notify, since } with the new mark to keep.
// Clock-safe: `since` is a run's own finishedAt, never the phone's clock.
export function pendingNotifications(runs, since) {
  const finished = (runs || []).filter((r) => isRun(r) && typeof r.finishedAt === 'string');
  const newest = finished.reduce(
    (max, r) => (r.finishedAt > max ? r.finishedAt : max),
    since || ''
  );
  if (since == null) return { notify: [], since: newest };
  const notify = finished
    .filter((r) => r.finishedAt > since && r.notification)
    .sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1));
  return { notify, since: newest };
}
