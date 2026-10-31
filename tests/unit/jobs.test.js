import { describe, it, expect } from 'vitest';
import {
  JOB_TYPE,
  RUN_TYPE,
  KEEP_RUNS,
  MAX_OUTPUT,
  newJobId,
  newRunId,
  jobPath,
  runPath,
  runsPrefix,
  normalizeSchedule,
  describeSchedule,
  nextRunAt,
  dueAt,
  isDue,
  makeJob,
  makeNotification,
  summarize,
  finalNotification,
  makeRun,
  sortRuns,
  runsToPrune,
  jobsWithRuns,
  pendingNotifications,
  sourceFiles,
  makeSource,
  hashSource,
  noteSourceChange,
  jobWork,
  normalizeWrites,
  writeCaps,
  writePermissions,
  writesInDraft,
  addedWrites,
  describeWrites,
  MAX_WRITE_DRIVES,
  promptWithResult,
  MAX_MODULE,
} from '../../shared/jobs.mjs';

const DEV = 'd'.repeat(64);
const DEV2 = 'e'.repeat(64);
const SPACE = '5'.repeat(64);

// Local time, so the tests hold in any time zone. Months are 0-based: 9 is October.
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m, 0, 0);

describe('paths and ids', () => {
  it('keeps a Job and its runs under their own prefixes', () => {
    const id = newJobId();
    expect(jobPath(id)).toBe(`/.vault/jobs/${id}.json`);
    const run = newRunId();
    expect(runPath(id, run)).toBe(`/.vault/job-runs/${id}/${run}.json`);
    expect(runPath(id, run).startsWith(runsPrefix(id))).toBe(true);
  });

  it('refuses ids that could leave the prefix', () => {
    expect(() => jobPath('../x')).toThrow();
    expect(() => runPath(newJobId(), 'a/b')).toThrow();
  });

  it('makes run ids that sort by start time', () => {
    const a = newRunId(new Date(2026, 0, 1));
    const b = newRunId(new Date(2026, 9, 30));
    expect(a < b).toBe(true);
  });
});

describe('normalizeSchedule', () => {
  it('takes none, intervals and daily times', () => {
    expect(normalizeSchedule(null)).toBe(null);
    expect(normalizeSchedule('manual')).toBe(null);
    expect(normalizeSchedule({ kind: 'interval', minutes: 120 })).toEqual({ kind: 'interval', minutes: 120 });
    expect(normalizeSchedule({ kind: 'daily', time: '8:05' })).toEqual({ kind: 'daily', times: ['08:05'] });
    expect(normalizeSchedule({ kind: 'daily', times: ['17:00', '9:00', '09:00'], days: [5, 1, 1] })).toEqual({
      kind: 'daily',
      times: ['09:00', '17:00'],
      days: [1, 5],
    });
  });

  it('treats every weekday as every day', () => {
    expect(normalizeSchedule({ kind: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({
      kind: 'daily',
      times: ['09:00'],
    });
  });

  it('reads phrases', () => {
    expect(normalizeSchedule('hourly')).toEqual({ kind: 'interval', minutes: 60 });
    expect(normalizeSchedule('every 2 hours')).toEqual({ kind: 'interval', minutes: 120 });
    expect(normalizeSchedule('every 30 minutes')).toEqual({ kind: 'interval', minutes: 30 });
    expect(normalizeSchedule('daily 07:30')).toEqual({ kind: 'daily', times: ['07:30'] });
    expect(normalizeSchedule('weekdays at 9:00')).toEqual({ kind: 'daily', times: ['09:00'], days: [1, 2, 3, 4, 5] });
    expect(normalizeSchedule('Mondays and Fridays 18:00')).toEqual({ kind: 'daily', times: ['18:00'], days: [1, 5] });
  });

  it('reads several times a day, windows, months, one-offs and cron', () => {
    const now = at(30, 10); // Friday 2026-10-30 10:00
    expect(normalizeSchedule('8am, 1pm and 5:30pm on weekdays', now)).toEqual({
      kind: 'daily',
      times: ['08:00', '13:00', '17:30'],
      days: [1, 2, 3, 4, 5],
    });
    expect(normalizeSchedule('Tuesdays and Thursdays at noon')).toEqual({ kind: 'daily', times: ['12:00'], days: [2, 4] });
    expect(normalizeSchedule('every 30 minutes from 9:00 to 17:00 on weekdays')).toEqual({
      kind: 'interval',
      minutes: 30,
      from: '09:00',
      to: '17:00',
      days: [1, 2, 3, 4, 5],
    });
    expect(normalizeSchedule('monthly on the 1st and 15th at 9am')).toEqual({ kind: 'monthly', dates: [1, 15], times: ['09:00'] });
    expect(normalizeSchedule('last day of the month 18:00')).toEqual({ kind: 'monthly', dates: [-1], times: ['18:00'] });
    expect(normalizeSchedule('tomorrow 9:00', now)).toEqual({ kind: 'once', at: at(31, 9).toISOString() });
    expect(normalizeSchedule('in 2 hours', now)).toEqual({ kind: 'once', at: at(30, 12).toISOString() });
    expect(normalizeSchedule('2026-11-02 09:00', now)).toEqual({ kind: 'once', at: new Date(2026, 10, 2, 9).toISOString() });
    expect(normalizeSchedule('Nov 5 at noon', now)).toEqual({ kind: 'once', at: new Date(2026, 10, 5, 12).toISOString() });
    expect(normalizeSchedule('0 8 * * 1-5')).toEqual({ kind: 'cron', expr: '0 8 * * 1-5' });
    expect(normalizeSchedule('cron */15 9-17 * * MON-FRI')).toEqual({ kind: 'cron', expr: '*/15 9-17 * * mon-fri' });
    expect(normalizeSchedule('@weekly')).toEqual({ kind: 'cron', expr: '@weekly' });
  });

  it('takes the new kinds as objects', () => {
    expect(normalizeSchedule({ kind: 'monthly', dates: ['last', 1], time: '9:00' })).toEqual({
      kind: 'monthly',
      dates: [1, -1],
      times: ['09:00'],
    });
    expect(normalizeSchedule({ kind: 'once', at: '2026-11-02T09:00:00Z' })).toEqual({ kind: 'once', at: '2026-11-02T09:00:00.000Z' });
    expect(normalizeSchedule({ kind: 'interval', minutes: 60, from: '9:00', to: '17:00' })).toEqual({
      kind: 'interval',
      minutes: 60,
      from: '09:00',
      to: '17:00',
    });
  });

  it('refuses too often, bad times and bad days', () => {
    expect(() => normalizeSchedule({ kind: 'interval', minutes: 5 })).toThrow(/15 minutes/);
    expect(() => normalizeSchedule({ kind: 'daily', time: '25:00' })).toThrow();
    expect(() => normalizeSchedule({ kind: 'daily', time: '08:00', days: [7] })).toThrow();
    expect(() => normalizeSchedule({ kind: 'weekly' })).toThrow();
    expect(() => normalizeSchedule('sometimes')).toThrow();
    expect(() => normalizeSchedule({ kind: 'monthly', dates: [32], times: ['09:00'] })).toThrow(/days of the month/);
    expect(() => normalizeSchedule({ kind: 'once', at: 'soon' })).toThrow(/needs `at`/);
    expect(() => normalizeSchedule({ kind: 'interval', minutes: 60, from: '17:00', to: '09:00' })).toThrow(/later/);
    expect(() => normalizeSchedule('*/5 * * * *')).toThrow(/15 minutes/);
    expect(() => normalizeSchedule('0,10 8 * * *')).toThrow(/15 minutes/);
    expect(() => normalizeSchedule('cron 0 8 * *')).toThrow(/five fields/);
    expect(() => normalizeSchedule('cron 0 25 * * *')).toThrow(/out of range/);
  });
});

describe('describeSchedule', () => {
  it('says it in words', () => {
    expect(describeSchedule(null)).toBe('By hand');
    expect(describeSchedule({ kind: 'interval', minutes: 60 })).toBe('Every hour');
    expect(describeSchedule({ kind: 'interval', minutes: 180 })).toBe('Every 3 hours');
    expect(describeSchedule({ kind: 'interval', minutes: 45 })).toBe('Every 45 minutes');
    expect(describeSchedule({ kind: 'daily', time: '08:00' })).toBe('Every day at 08:00');
    expect(describeSchedule({ kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] })).toBe('Weekdays at 09:00');
    expect(describeSchedule({ kind: 'daily', time: '07:30', days: [1, 3] })).toBe('Mon, Wed at 07:30');
    expect(describeSchedule({ kind: 'daily', times: ['08:00', '13:00', '17:00'] })).toBe('Every day at 08:00, 13:00 and 17:00');
    expect(describeSchedule({ kind: 'interval', minutes: 30, from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] })).toBe(
      'Every 30 minutes, 09:00–17:00 on weekdays'
    );
    expect(describeSchedule({ kind: 'monthly', dates: [1, 22, -1], times: ['09:00'] })).toBe(
      'Monthly on the 1st, 22nd and last day at 09:00'
    );
    expect(describeSchedule({ kind: 'once', at: new Date(2026, 10, 2, 9).toISOString() })).toBe('Once, Mon Nov 2 at 09:00');
    expect(describeSchedule({ kind: 'cron', expr: '0 8 * * 1-5' })).toBe('Cron 0 8 * * 1-5');
  });
});

describe('nextRunAt', () => {
  it('adds the interval', () => {
    expect(nextRunAt({ kind: 'interval', minutes: 90 }, at(1, 8))).toEqual(at(1, 9, 30));
  });

  it('is later today, or tomorrow once the time went by', () => {
    const daily = { kind: 'daily', time: '08:00' };
    expect(nextRunAt(daily, at(1, 7))).toEqual(at(1, 8));
    expect(nextRunAt(daily, at(1, 8))).toEqual(at(2, 8));
    expect(nextRunAt(daily, at(1, 9))).toEqual(at(2, 8));
  });

  it('skips days the schedule leaves out', () => {
    // 2026-10-30 is a Friday.
    expect(at(30, 0).getDay()).toBe(5);
    const weekdays = { kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] };
    expect(nextRunAt(weekdays, at(30, 10))).toEqual(new Date(2026, 10, 2, 9, 0));
  });

  it('has nothing to run by hand', () => {
    expect(nextRunAt(null, at(1, 8))).toBe(null);
  });

  it('takes the next of several times a day', () => {
    const twice = { kind: 'daily', times: ['08:00', '17:00'] };
    expect(nextRunAt(twice, at(1, 9))).toEqual(at(1, 17));
    expect(nextRunAt(twice, at(1, 17))).toEqual(at(2, 8));
  });

  it('keeps an interval inside its window and days', () => {
    const work = { kind: 'interval', minutes: 60, from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] };
    expect(nextRunAt(work, at(30, 10))).toEqual(at(30, 11));
    // Friday 16:30: 17:30 is past the window, so Monday 09:00.
    expect(nextRunAt(work, at(30, 16, 30))).toEqual(new Date(2026, 10, 2, 9, 0));
    expect(nextRunAt(work, at(30, 7))).toEqual(at(30, 9));
  });

  it('finds monthly dates, the last day of each month included', () => {
    const m = { kind: 'monthly', dates: [31, -1], times: ['09:00'] };
    expect(nextRunAt(m, new Date(2026, 10, 1))).toEqual(new Date(2026, 10, 30, 9)); // November has no 31st
    expect(nextRunAt(m, new Date(2027, 1, 1))).toEqual(new Date(2027, 1, 28, 9));
    expect(nextRunAt({ kind: 'monthly', dates: [15], times: ['09:00'] }, new Date(2026, 9, 15, 9))).toEqual(new Date(2026, 10, 15, 9));
  });

  it('follows cron', () => {
    const c = { kind: 'cron', expr: '30 8 * * mon-fri' };
    expect(nextRunAt(c, at(30, 9))).toEqual(new Date(2026, 10, 2, 8, 30));
    // Both day fields restricted: either matches, as in cron.
    expect(nextRunAt({ kind: 'cron', expr: '0 9 13 * 5' }, new Date(2026, 10, 1))).toEqual(new Date(2026, 10, 6, 9));
    expect(nextRunAt({ kind: 'cron', expr: '0 0 29 2 *' }, new Date(2026, 2, 1))).toEqual(new Date(2028, 1, 29, 0));
  });

  it('runs once at its time', () => {
    const once = { kind: 'once', at: at(2, 9).toISOString() };
    expect(nextRunAt(once, at(1, 9))).toEqual(at(2, 9));
    expect(nextRunAt(once, at(2, 9))).toBe(null);
  });
});

describe('dueAt and isDue', () => {
  const job = (over = {}) =>
    makeJob({ id: 'job-test-1', prompt: 'Sum up my Reader', schedule: { kind: 'daily', time: '08:00' }, ...over }, null, at(1, 9));

  it('never fires for a time that went by before the schedule was set', () => {
    // Made at 9:00 for 8:00: the first run is tomorrow.
    expect(dueAt(job())).toEqual(at(2, 8));
    expect(isDue(job(), null, at(1, 23))).toBe(false);
    expect(isDue(job(), null, at(2, 8))).toBe(true);
  });

  it('counts from the last run', () => {
    expect(dueAt(job(), at(2, 8).toISOString())).toEqual(at(3, 8));
  });

  it('runs a missed time once, when the Device wakes', () => {
    // Asleep for three days: due now, and once it runs, next is the following 8:00.
    expect(isDue(job(), at(2, 8).toISOString(), at(5, 12))).toBe(true);
    expect(dueAt(job(), at(5, 12).toISOString())).toEqual(at(6, 8));
  });

  it('runs a one-time Job once, even after a run by hand', () => {
    const once = job({ schedule: { kind: 'once', at: at(2, 9).toISOString() } });
    expect(dueAt(once)).toEqual(at(2, 9));
    expect(dueAt(once, at(1, 12).toISOString())).toEqual(at(2, 9)); // by hand, before its time
    expect(isDue(once, null, at(4, 0))).toBe(true); // asleep at 9:00: runs on wake
    expect(dueAt(once, at(4, 0).toISOString())).toBe(null);
  });

  it('refuses a one-time schedule already past', () => {
    expect(() => job({ schedule: { kind: 'once', at: at(1, 8).toISOString() } })).toThrow(/already passed/);
  });

  it('is never due off, or by hand', () => {
    expect(dueAt(job({ enabled: false }))).toBe(null);
    expect(dueAt(job({ schedule: null }))).toBe(null);
  });
});

describe('makeJob', () => {
  it('makes a new Job with defaults', () => {
    const j = makeJob({ id: 'job-abc-123', prompt: '  Summarize my unread posts\nin a few lines ', device: DEV, space: SPACE }, null, at(1, 9));
    expect(j).toMatchObject({
      type: JOB_TYPE,
      title: 'Summarize my unread posts',
      prompt: 'Summarize my unread posts\nin a few lines',
      schedule: null,
      notify: 'always',
      enabled: true,
      device: DEV,
      space: SPACE,
    });
    expect(j.scheduleFrom).toBe(at(1, 9).toISOString());
  });

  it('keeps fields left out, and restarts the schedule only when it changes', () => {
    const j = makeJob({ id: 'job-abc-123', prompt: 'x', schedule: 'daily 08:00', device: DEV }, null, at(1, 9));
    const renamed = makeJob({ title: 'Morning' }, j, at(2, 9));
    expect(renamed).toMatchObject({ title: 'Morning', prompt: 'x', schedule: j.schedule, scheduleFrom: j.scheduleFrom });
    expect(renamed.createdAt).toBe(j.createdAt);
    const moved = makeJob({ schedule: 'daily 10:00' }, j, at(2, 9));
    expect(moved.scheduleFrom).toBe(at(2, 9).toISOString());
    const otherDevice = makeJob({ device: DEV2 }, j, at(3, 9));
    expect(otherDevice.scheduleFrom).toBe(at(3, 9).toISOString());
  });

  it('restarts the schedule when it is turned back on', () => {
    const j = makeJob({ id: 'job-abc-123', prompt: 'x', schedule: 'hourly', enabled: false }, null, at(1, 9));
    expect(makeJob({ enabled: true }, j, at(4, 9)).scheduleFrom).toBe(at(4, 9).toISOString());
  });

  it('refuses a Job with no prompt or a bad field', () => {
    expect(() => makeJob({ id: 'job-abc-123', prompt: ' ' })).toThrow(/prompt/);
    expect(() => makeJob({ id: 'job-abc-123', prompt: 'x', notify: 'loud' })).toThrow(/notify/);
    expect(() => makeJob({ id: 'job-abc-123', prompt: 'x', device: 'nope' })).toThrow(/Device/);
    expect(() => makeJob({ id: '../x', prompt: 'x' })).toThrow();
  });
});

describe('notifications', () => {
  const job = makeJob({ id: 'job-abc-123', title: 'Morning digest', prompt: 'x', notify: 'always' });

  it('tidies what the AI sends', () => {
    expect(makeNotification({ title: ' New post\n', body: 'From  Ada' })).toEqual({ title: 'New post', body: 'From Ada' });
    expect(makeNotification({ body: 'Just text' }, 'Job')).toEqual({ title: 'Job', body: 'Just text' });
    expect(makeNotification(null)).toBe(null);
    expect(makeNotification({ body: 'x'.repeat(1000) }).body.length).toBe(300);
  });

  it('summarizes Markdown as plain text', () => {
    expect(summarize('# Today\n\n- **Three** new posts on [Ada’s blog](hyper://x/)\n```js\ncode\n```')).toBe(
      'Today Three new posts on Ada’s blog'
    );
  });

  it('sends the answer when the Job always notifies', () => {
    expect(finalNotification(job, { status: 'ok', output: '## Hi\nAll quiet.' })).toEqual({
      title: 'Morning digest',
      body: 'Hi All quiet.',
    });
  });

  it('prefers what the AI sent', () => {
    expect(finalNotification(job, { status: 'ok', output: 'long', notified: { title: 'Heads up', body: 'X' } })).toEqual({
      title: 'Heads up',
      body: 'X',
    });
  });

  it('stays quiet on auto unless the AI notified', () => {
    const auto = makeJob({ notify: 'auto' }, job);
    expect(finalNotification(auto, { status: 'ok', output: 'Nothing new' })).toBe(null);
    expect(finalNotification(auto, { status: 'ok', output: '', notified: { body: 'New!' } })).toEqual({
      title: 'Morning digest',
      body: 'New!',
    });
  });

  it('tells about a failure once per streak, and never on never', () => {
    expect(finalNotification(job, { status: 'error', error: 'No AI runtime' })).toEqual({
      title: 'Morning digest failed',
      body: 'No AI runtime',
    });
    expect(finalNotification(job, { status: 'error', error: 'x', prevRun: { status: 'error' } })).toBe(null);
    expect(finalNotification(makeJob({ notify: 'never' }, job), { status: 'error', error: 'x' })).toBe(null);
  });
});

describe('runs', () => {
  const job = makeJob({ id: 'job-abc-123', title: 'Digest', prompt: 'x', schedule: 'daily 08:00', device: DEV }, null, at(1, 7));
  const run = (d, over = {}) =>
    makeRun({
      id: newRunId(at(d, 8)),
      job,
      device: DEV,
      startedAt: at(d, 8),
      finishedAt: at(d, 8, 1),
      status: 'ok',
      output: 'done',
      notification: { title: 'Digest', body: 'done' },
      ...over,
    });

  it('makes a run record and cuts a long answer', () => {
    const r = run(1, { output: 'x'.repeat(MAX_OUTPUT + 10), trigger: 'manual' });
    expect(r).toMatchObject({ type: RUN_TYPE, jobId: job.id, title: 'Digest', trigger: 'manual', status: 'ok' });
    expect(r.output.length).toBeLessThan(MAX_OUTPUT + 60);
    expect(r.output).toMatch(/Cut at/);
  });

  it('keeps the newest runs', () => {
    const runs = Array.from({ length: KEEP_RUNS + 3 }, (_, i) => run(i + 1));
    const pruned = runsToPrune(runs);
    expect(pruned).toHaveLength(3);
    expect(pruned.map((r) => r.startedAt)).toEqual(runs.slice(0, 3).reverse().map((r) => r.startedAt));
  });

  it('lists Jobs with their newest run and next time', () => {
    const [row] = jobsWithRuns([job], [run(1), run(2)]);
    expect(row.lastRun.startedAt).toBe(at(2, 8).toISOString());
    expect(row.nextRunAt).toBe(at(3, 8).toISOString());
  });

  it('sorts newest first', () => {
    expect(sortRuns([run(1), run(3), run(2)]).map((r) => new Date(r.startedAt).getDate())).toEqual([3, 2, 1]);
  });
});

describe('pendingNotifications', () => {
  const job = makeJob({ id: 'job-abc-123', title: 'Digest', prompt: 'x' });
  const run = (min, notification = { title: 'Digest', body: 'b' }) =>
    makeRun({ id: newRunId(at(1, 8, min)), job, startedAt: at(1, 8, min), finishedAt: at(1, 8, min), status: 'ok', output: '', notification });

  it('shows nothing the first time, and starts from the newest run', () => {
    const runs = [run(1), run(2)];
    expect(pendingNotifications(runs, null)).toEqual({ notify: [], since: runs[1].finishedAt });
    expect(pendingNotifications([], null)).toEqual({ notify: [], since: '' });
  });

  it('shows runs that finished since, oldest first, and skips quiet ones', () => {
    const runs = [run(3), run(1), run(2, null), run(4)];
    const { notify, since } = pendingNotifications(runs, runs[1].finishedAt);
    expect(notify.map((r) => r.finishedAt)).toEqual([runs[0].finishedAt, runs[3].finishedAt]);
    expect(since).toBe(runs[3].finishedAt);
  });

  it('shows every run after an empty mark', () => {
    expect(pendingNotifications([run(1)], '').notify).toHaveLength(1);
  });
});

describe('drive sources', () => {
  const KEY = 'a'.repeat(64);
  const DRIVE = `hyper://${KEY}`;
  const MOD = "import { nomad } from 'nomad:runtime'\nexport default async function main() { return 1 }";
  const at = new Date('2026-10-30T10:00:00Z');

  it('finds a folder’s job.js and job.md, or a file and its sibling', () => {
    expect(sourceFiles(DRIVE)).toEqual({ url: `${DRIVE}/`, drive: `${DRIVE}/`, module: '/job.js', prompt: '/job.md' });
    expect(sourceFiles(`${DRIVE}/jobs/digest`)).toMatchObject({ url: `${DRIVE}/jobs/digest/`, module: '/jobs/digest/job.js' });
    expect(sourceFiles(`${DRIVE}/x.js`)).toMatchObject({ module: '/x.js', prompt: '/x.md' });
    expect(sourceFiles(`${DRIVE}/x.md`)).toMatchObject({ module: '/x.js', prompt: '/x.md' });
    expect(sourceFiles(`HYPER://${KEY.toUpperCase()}//a//`).url).toBe(`${DRIVE}/a/`);
  });

  it('takes only hyper:// URLs with a key', () => {
    expect(() => sourceFiles('https://example.com/job.js')).toThrow(/hyper:\/\//);
    expect(() => sourceFiles('hyper://blog/')).toThrow(/hyper:\/\//);
    expect(() => sourceFiles(`${DRIVE}/../x/`)).toThrow(/\.\./);
  });

  it('keeps only the URL of a live source and copies anyone else’s', () => {
    expect(makeSource({ url: DRIVE, live: true, module: MOD })).toEqual({ url: `${DRIVE}/`, live: true });
    const copy = makeSource({ url: DRIVE, live: false, module: MOD, prompt: ' Sum it up ' }, null, at);
    expect(copy).toEqual({
      url: `${DRIVE}/`,
      live: false,
      module: MOD,
      prompt: 'Sum it up',
      hash: hashSource(MOD, 'Sum it up'),
      copiedAt: at.toISOString(),
    });
    expect(() => makeSource({ url: DRIVE, live: false })).toThrow(/no job\.js or job\.md/);
    expect(() => makeSource({ url: DRIVE, module: 'x'.repeat(MAX_MODULE + 1) })).toThrow(/at most/);
  });

  it('notes a newer version once, and taking it clears the note', () => {
    const copy = makeSource({ url: DRIVE, prompt: 'v1' }, null, at);
    const newer = hashSource(null, 'v2');
    const noted = noteSourceChange(copy, newer);
    expect(noted.changed).toBe(newer);
    expect(noteSourceChange(noted, newer)).toBeNull();
    expect(noteSourceChange(copy, copy.hash)).toBeNull();
    expect(noteSourceChange({ url: DRIVE, live: true }, newer)).toBeNull();
    const taken = makeSource({ url: DRIVE, prompt: 'v2' }, noted, new Date('2026-10-31T00:00:00Z'));
    expect(taken.changed).toBeUndefined();
    expect(taken.prompt).toBe('v2');
    // Adding the same version again keeps the copy, and its note of a newer one.
    expect(makeSource({ url: DRIVE, prompt: 'v1' }, noted)).toBe(noted);
  });

  it('makes a Job from a source without a prompt, named by job.md’s heading', () => {
    const job = makeJob(
      { id: 'job-src-1', source: { url: `${DRIVE}/jobs/digest/`, prompt: '# Morning digest\nSum up my Reader.' } },
      null,
      at
    );
    expect(job.prompt).toBe('');
    expect(job.title).toBe('Morning digest');
    expect(job.source.url).toBe(`${DRIVE}/jobs/digest/`);
    expect(makeJob({ id: 'job-src-2', source: { url: `${DRIVE}/jobs/digest/`, live: true } }).title).toBe('digest');
    expect(makeJob({ id: 'job-src-3', source: { url: DRIVE, live: true, title: 'Status' } }).title).toBe('Status');
    expect(() => makeJob({ id: 'job-src-4' })).toThrow(/prompt/);
    // An edit that leaves source out keeps it; null drops it.
    expect(makeJob({ notify: 'never' }, job).source).toEqual(job.source);
    expect(() => makeJob({ source: null }, job)).toThrow(/prompt/);
    expect(makeJob({ source: null, prompt: 'x' }, job).source).toBeUndefined();
  });

  it('works out what a run does', () => {
    const copied = { prompt: 'Extra', source: makeSource({ url: DRIVE, module: MOD, prompt: 'Main' }) };
    expect(jobWork(copied)).toEqual({ module: MOD, prompt: 'Main\n\nExtra' });
    const live = { prompt: '', source: { url: `${DRIVE}/`, live: true } };
    expect(jobWork(live, { module: MOD, prompt: null })).toEqual({ module: MOD, prompt: null });
    expect(() => jobWork(live, { module: null, prompt: null })).toThrow(/no job\.js or job\.md/);
    expect(jobWork({ prompt: 'Just a prompt' })).toEqual({ module: null, prompt: 'Just a prompt' });
    expect(promptWithResult('Sum it up', '{"n":2}')).toContain('```\n{"n":2}\n```');
  });
});

describe('write grants', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);

  it('tidies drives to hyper://<key>/ and drops the empty grant', () => {
    expect(normalizeWrites(null)).toBe(null);
    expect(normalizeWrites({ drives: [], notes: false })).toBe(null);
    expect(
      normalizeWrites({
        drives: [`hyper://${A.toUpperCase()}/posts/x.md`, { url: `hyper://${B}`, draft: true }, `hyper://${A}/`],
        notes: 1,
      })
    ).toEqual({
      drives: [
        { url: `hyper://${A}/`, draft: false },
        { url: `hyper://${B}/`, draft: true },
      ],
      notes: true,
      reader: false,
    });
  });

  it('takes only drives by key, and only so many', () => {
    expect(() => normalizeWrites({ drives: ['https://example.com/'] })).toThrow(/hyper:\/\/<key>/);
    expect(() => normalizeWrites({ drives: ['blog'] })).toThrow(/isn’t a drive/);
    expect(() => normalizeWrites('everything')).toThrow(/drives\?, notes\?, reader\?/);
    const many = Array.from({ length: MAX_WRITE_DRIVES + 1 }, (_, i) => `hyper://${String(i).padStart(64, 'c')}/`);
    expect(() => normalizeWrites({ drives: many })).toThrow(/at most/);
  });

  it('turns grants into capabilities and permissions, and nothing else', () => {
    const w = normalizeWrites({ drives: [{ url: `hyper://${A}/`, draft: true }], notes: true });
    expect(writeCaps(w)).toEqual(['writeNote']);
    expect(writeCaps(normalizeWrites({ reader: true }))).toEqual(['followFeed', 'unfollowFeed', 'markPostsRead']);
    expect(writeCaps(null)).toEqual([]);
    expect(writePermissions(w)).toEqual(['notesWrite', `modifyDrive:${A}`]);
    expect(writePermissions(null)).toEqual([]);
  });

  it('stages only the drives granted in a Draft', () => {
    const w = normalizeWrites({ drives: [{ url: `hyper://${A}/`, draft: true }, `hyper://${B}/`] });
    expect(writesInDraft(w, `hyper://${A}`)).toBe(true);
    expect(writesInDraft(w, `hyper://${A}/`)).toBe(true);
    expect(writesInDraft(w, `hyper://${B}`)).toBe(false);
    expect(writesInDraft(null, `hyper://${A}`)).toBe(false);
  });

  it('finds what a change adds: a new grant, or a drive moved from its Draft to live', () => {
    const prev = normalizeWrites({ drives: [{ url: `hyper://${A}/`, draft: true }], notes: true });
    expect(addedWrites(prev, prev)).toBe(null);
    expect(addedWrites(prev, normalizeWrites({ notes: true }))).toBe(null);
    expect(addedWrites(prev, normalizeWrites({ drives: [`hyper://${A}/`], notes: true }))).toEqual({
      drives: [{ url: `hyper://${A}/`, draft: false }],
      notes: false,
      reader: false,
    });
    expect(addedWrites(null, normalizeWrites({ reader: true }))).toEqual({ drives: [], notes: false, reader: true });
  });

  it('says what a Job can change in words', () => {
    const w = normalizeWrites({ drives: [{ url: `hyper://${A}/`, draft: true }, `hyper://${B}/`], reader: true });
    expect(describeWrites(w, (url) => (url.includes(A) ? 'My blog' : null))).toEqual([
      'your Reader (follow, unfollow, mark read)',
      'My blog (in a Draft)',
      `hyper://${B.slice(0, 8)}…/`,
    ]);
    expect(describeWrites(null)).toEqual([]);
  });

  it('keeps a Job’s grants until it is given new ones or none', () => {
    const job = makeJob({ id: 'job-w-1', title: 'Blog', prompt: 'Write it', writes: { drives: [`hyper://${A}/`] } });
    expect(job.writes).toEqual({ drives: [{ url: `hyper://${A}/`, draft: false }], notes: false, reader: false });
    expect(makeJob({ title: 'Blog 2' }, job).writes).toEqual(job.writes);
    expect(makeJob({ writes: null }, job).writes).toBe(undefined);
    expect(makeJob({ id: 'job-w-2', title: 'Read only', prompt: 'x' }).writes).toBe(undefined);
  });

  it('records what a run changed', () => {
    const job = makeJob({ id: 'job-w-1', title: 'Blog', prompt: 'Write it' });
    const run = makeRun({
      id: 'r1',
      job,
      startedAt: 0,
      finishedAt: 1,
      status: 'ok',
      output: 'Done',
      changes: [
        { drive: `hyper://${A}`, path: '/posts/x/post.md', draft: true },
        { tool: 'writeNote', summary: 'Wrote “Digest”' },
        { nonsense: true },
      ],
    });
    expect(run.changes).toEqual([
      { drive: `hyper://${A}/`, path: '/posts/x/post.md', draft: true },
      { tool: 'writeNote', summary: 'Wrote “Digest”' },
    ]);
    expect(makeRun({ id: 'r2', job, startedAt: 0, finishedAt: 1, status: 'ok', output: '' }).changes).toBe(undefined);
  });
});
