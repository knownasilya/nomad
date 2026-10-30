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
    expect(normalizeSchedule({ kind: 'daily', time: '8:05' })).toEqual({ kind: 'daily', time: '08:05' });
    expect(normalizeSchedule({ kind: 'daily', time: '09:00', days: [5, 1, 1] })).toEqual({
      kind: 'daily',
      time: '09:00',
      days: [1, 5],
    });
  });

  it('treats every weekday as every day', () => {
    expect(normalizeSchedule({ kind: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({
      kind: 'daily',
      time: '09:00',
    });
  });

  it('reads phrases', () => {
    expect(normalizeSchedule('hourly')).toEqual({ kind: 'interval', minutes: 60 });
    expect(normalizeSchedule('every 2 hours')).toEqual({ kind: 'interval', minutes: 120 });
    expect(normalizeSchedule('every 30 minutes')).toEqual({ kind: 'interval', minutes: 30 });
    expect(normalizeSchedule('daily 07:30')).toEqual({ kind: 'daily', time: '07:30' });
    expect(normalizeSchedule('weekdays at 9:00')).toEqual({ kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] });
    expect(normalizeSchedule('Mondays and Fridays 18:00')).toEqual({ kind: 'daily', time: '18:00', days: [1, 5] });
  });

  it('refuses too often, bad times and bad days', () => {
    expect(() => normalizeSchedule({ kind: 'interval', minutes: 5 })).toThrow(/15 minutes/);
    expect(() => normalizeSchedule({ kind: 'daily', time: '25:00' })).toThrow();
    expect(() => normalizeSchedule({ kind: 'daily', time: '08:00', days: [7] })).toThrow();
    expect(() => normalizeSchedule({ kind: 'weekly' })).toThrow();
    expect(() => normalizeSchedule('sometimes')).toThrow();
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
