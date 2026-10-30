// nomad/shared/jobs.mjs
//
// AI Jobs (ADR-0030): a saved prompt the user's AI runs by itself, on demand or on a schedule, whose
// result can notify the user's phone. A Job and each of its runs are Vault records, so every linked
// Device sees them:
//
//   /.vault/jobs/<id>.json                { type, id, title, prompt, source?, schedule, notify, enabled, device,
//                                           space, createdAt, updatedAt, scheduleFrom }
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
// A schedule is null (by hand only), { kind: 'interval', minutes }, or { kind: 'daily', time: 'HH:MM',
// days? } where days are weekdays, 0 = Sunday, and none means every day. Times are the running
// Device's local time.
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

// A schedule as the AI or a form gives it, checked and tidied. Also takes words: "hourly",
// "daily 08:00", "weekdays 9:00", "every 30 minutes". Null for none (by hand only). Throws for
// anything else.
export function normalizeSchedule(input) {
  if (input == null || input === '' || input === 'manual' || input === 'none') return null;
  if (typeof input === 'string') return parseSchedule(input);
  if (typeof input !== 'object')
    throw new Error('A schedule is an object, a phrase like "daily 08:00", or null');
  if (input.kind === 'interval') {
    const minutes = Math.round(Number(input.minutes));
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL) {
      throw new Error(`A Job can run at most every ${MIN_INTERVAL} minutes`);
    }
    if (minutes > MAX_INTERVAL)
      throw new Error('An interval can be at most a week; use a daily schedule');
    return { kind: 'interval', minutes };
  }
  if (input.kind === 'daily') {
    const time = normalizeTime(input.time);
    const days = normalizeDays(input.days);
    return days ? { kind: 'daily', time, days } : { kind: 'daily', time };
  }
  throw new Error('A schedule\'s kind is "interval" or "daily"');
}

function normalizeTime(t) {
  const m = TIME_RE.exec(String(t || '').trim());
  if (!m) throw new Error('A time is HH:MM, 24-hour, like 08:00');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
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

const DAY_WORDS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseSchedule(text) {
  const s = text.trim().toLowerCase();
  const interval = /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(s);
  if (interval) {
    const n = Number(interval[1]);
    return normalizeSchedule({
      kind: 'interval',
      minutes: interval[2].startsWith('h') ? n * 60 : n,
    });
  }
  if (s === 'hourly' || s === 'every hour') return { kind: 'interval', minutes: 60 };
  const time = /(\d{1,2}:\d{2})/.exec(s);
  if (!time)
    throw new Error(
      `“${text}” isn’t a schedule. Try "daily 08:00", "weekdays 09:00" or "every 2 hours"`
    );
  if (/weekdays?/.test(s))
    return normalizeSchedule({ kind: 'daily', time: time[1], days: [1, 2, 3, 4, 5] });
  if (/weekends?/.test(s)) return normalizeSchedule({ kind: 'daily', time: time[1], days: [0, 6] });
  const days = [...s.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g)].map(
    (m) => DAY_WORDS[m[1]]
  );
  return normalizeSchedule({ kind: 'daily', time: time[1], days: days.length ? days : null });
}

// "Every 2 hours", "Every day at 08:00", "Weekdays at 09:00", "Mon, Wed at 07:30", "By hand".
export function describeSchedule(schedule) {
  if (!schedule) return 'By hand';
  if (schedule.kind === 'interval') {
    const m = schedule.minutes;
    if (m % (24 * 60) === 0)
      return m === 24 * 60 ? 'Every 24 hours' : `Every ${m / (24 * 60)} days`;
    if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} hours`;
    return `Every ${m} minutes`;
  }
  const days = schedule.days;
  let when = 'Every day';
  if (days?.join() === '1,2,3,4,5') when = 'Weekdays';
  else if (days?.join() === '0,6') when = 'Weekends';
  else if (days?.length) when = days.map((d) => DAY_NAMES[d]).join(', ');
  return `${when} at ${schedule.time}`;
}

// The first time the schedule runs strictly after `after`, or null for none.
export function nextRunAt(schedule, after) {
  if (!schedule) return null;
  const from = new Date(after);
  if (Number.isNaN(from.getTime())) return null;
  if (schedule.kind === 'interval') return new Date(from.getTime() + schedule.minutes * 60_000);
  const [h, m] = schedule.time.split(':').map(Number);
  for (let d = 0; d <= 7; d++) {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, h, m, 0, 0);
    if (at <= from) continue;
    if (schedule.days && !schedule.days.includes(at.getDay())) continue;
    return at;
  }
  return null;
}

// When the Job next runs on its schedule: the first time after its last run, or after the schedule
// was set (so a new schedule never fires for a time that already went by). A time missed while the
// Device was asleep is due at once, and runs once, however many were missed.
export function dueAt(job, lastRunAt = null) {
  if (!job || !job.enabled || !job.schedule) return null;
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
    f.schedule !== undefined ? normalizeSchedule(f.schedule) : prev?.schedule || null;
  const notify = f.notify !== undefined ? f.notify : prev?.notify || 'always';
  if (!NOTIFY.includes(notify)) throw new Error('notify is "always", "auto" or "never"');
  const enabled = f.enabled !== undefined ? !!f.enabled : prev ? prev.enabled : true;

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
}) {
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
