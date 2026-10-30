// AI Jobs (ADR-0030): prompts the user's AI runs by itself, on a schedule or by hand, whose result can
// notify the user's phone. Jobs and their runs are Vault records (shared/jobs.mjs), so the phone lists
// them and notifies when a new run says to. This module keeps them in memory, as ui/mods.js does,
// runs the ones this Device owns when they're due, and saves each run.
//
// - A Job runs on its schedule only on the Device it names (`device`), so two desktops never both
//   run it. Any Device with an AI Runtime runs one by hand (runNow: My Library, the AI, or the
//   phone over the AI Bridge).
// - One run at a time. A run is a turn on the `job` stage (ai.ts runJobTurn): the user's own AI,
//   reading only, with nobody to ask. It times out after RUN_TIMEOUT_MS.
// - A Job from someone else's drive runs its copy. When a run sees a newer version in the drive,
//   the Job notes it (`source.changed`) and My Library offers it; nothing changes until the user
//   takes it.
// - A time missed while the computer slept runs once when it wakes (shared/jobs.mjs dueAt).
// - Each Job keeps its newest KEEP_RUNS runs.
//
// The turn itself is passed in by setup() ({ runTurn }), as auto-names takes completeText, so this
// module doesn't import ai.ts (which imports this one through ai-vault.ts).

import { powerMonitor } from 'electron';
import { EventEmitter } from 'events';
import b4a from 'b4a';
import * as vault from '../hyper/vault';
import * as logLib from '../logger';
import * as jl from '../../../shared/jobs.mjs';

const logger = logLib.get().child({ category: 'ai', subcategory: 'jobs' });

const TICK_MS = 30_000;
const RUN_TIMEOUT_MS = 10 * 60_000;

// Emits 'changed' when a Job or a run changes, here or on another Device, and when a run starts.
export const events = new EventEmitter();

let runTurn = null;
let jobs = new Map(); // id -> record
let runs = new Map(); // jobId -> runs, newest first
let watchedBase = null;
let refreshTimer = null;
/** @type {Promise<any>} */
let writes = Promise.resolve(); // Job edits, one at a time, each on the latest record
const queue = []; // { id, trigger }
const running = new Map(); // jobId -> AbortController
// When this Device last started each Job, so a run it couldn't save (a Vault it can't write yet)
// isn't started again on every tick.
const attempted = new Map(); // jobId -> ISO time
let draining = false;

/** @param {{ runTurn: (job: any, opts: { signal: AbortSignal, notify: (n: any) => void, trigger: string, lastRun: any }) => Promise<{ output: string, sourceHash?: string | null }> }} opts */
export function setup(opts) {
  runTurn = opts.runTurn;
  refresh();
  vault.events.on('changed', () => refresh());
  setInterval(tick, TICK_MS).unref?.();
  // A laptop that slept through a Job's time runs it when it wakes.
  try {
    powerMonitor.on('resume', () => setTimeout(tick, 5000));
  } catch {}
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 300);
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
  if (!sess) return;
  const [jobRecs, runRecs, requests] = await Promise.all([
    vault.listAppRecords(jl.JOBS_PREFIX),
    vault.listAppRecords(jl.RUNS_PREFIX),
    vault.listAppRecords(jl.REQUESTS_PREFIX),
  ]);
  const nextJobs = new Map(jobRecs.filter(jl.isJob).map((j) => [j.id, j]));
  const nextRuns = new Map();
  for (const r of jl.sortRuns(runRecs)) {
    if (!nextRuns.has(r.jobId)) nextRuns.set(r.jobId, []);
    nextRuns.get(r.jobId).push(r);
  }
  const stamp = (m, f) => [...m].map(([k, v]) => k + ':' + f(v)).join();
  const same =
    stamp(nextJobs, (j) => j.updatedAt) === stamp(jobs, (j) => j.updatedAt) &&
    stamp(nextRuns, (r) => r.length + r[0].id) === stamp(runs, (r) => r.length + r[0].id);
  jobs = nextJobs;
  runs = nextRuns;
  if (!same) events.emit('changed');
  takeRequests(requests.filter(jl.isRequest));
  tick();
}

// "Run it now" from another Device (the phone's Jobs screen): this Device runs the Jobs it owns,
// and deletes the request so it runs once.
const handled = new Set(); // jobId + requestedAt, until the delete lands
async function takeRequests(requests) {
  if (!requests.length || !runTurn) return;
  const key = await ownKey().catch(() => null);
  for (const req of requests) {
    const job = jobs.get(req.jobId);
    if (!job || job.device !== key) continue; // its own Device runs it
    const mark = req.jobId + ' ' + req.requestedAt;
    if (handled.has(mark)) continue;
    handled.add(mark);
    try {
      await vault.delAppRecord(jl.requestPath(req.jobId));
    } catch (err) {
      logger.warn('Could not take a Job request', { id: req.jobId, error: err?.message });
      continue;
    }
    enqueue(job.id, 'manual');
  }
}

// This Device's key in the Vault, or null without one.
async function ownKey() {
  const sess = await vault.getVault();
  return sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
}

// Data
// =

// Every Job, A to Z, with its newest run, when it next runs, and whether it is running here now.
export function list() {
  return jl.jobsWithRuns([...jobs.values()], [...runs.values()].flat()).map((j) => ({
    ...j,
    running: running.has(j.id),
  }));
}

export function get(id) {
  return jobs.get(id) || null;
}

// A Job's runs, newest first.
export function runsOf(id) {
  return runs.get(id) || [];
}

export { ownKey };

// Save a Job: a new one (no id) or changes to one. Fields left out keep their values. A new Job
// runs on this Device and reads the Reader of `space`; `runHere` moves a Job's schedule to this
// Device.
// `source` is what job-source.ts read from a drive (shared/jobs.mjs makeSource), null to drop it.
/** @param {{ id?: string, title?: string, prompt?: string, source?: any, schedule?: any, notify?: string, enabled?: boolean, space?: string, runHere?: boolean }} fields */
export function save(fields) {
  const run = writes.then(async () => {
    const { runHere, ...rest } = fields;
    const prev = rest.id ? jobs.get(rest.id) : null;
    if (rest.id && !prev) throw new Error('No Job with that id');
    await vault.ensureVault();
    const device = !prev || runHere ? await ownKey() : undefined;
    const rec = jl.makeJob({ ...rest, id: prev?.id || jl.newJobId(), device }, prev);
    await vault.putAppRecord(jl.jobPath(rec.id), rec);
    jobs.set(rec.id, rec);
    events.emit('changed');
    return rec;
  });
  writes = run.catch(() => {});
  return run;
}

// Delete a Job and its runs. A run in progress is stopped.
export function remove(id) {
  const run = writes.then(async () => {
    running.get(id)?.abort();
    for (const r of runsOf(id)) await vault.delAppRecord(jl.runPath(id, r.id)).catch(() => {});
    if (await vault.readAppRecord(jl.requestPath(id)).catch(() => null)) {
      await vault.delAppRecord(jl.requestPath(id)).catch(() => {});
    }
    await vault.delAppRecord(jl.jobPath(id));
    jobs.delete(id);
    runs.delete(id);
    events.emit('changed');
  });
  writes = run.catch(() => {});
  return run;
}

// Running
// =

// Run a Job now, on this Device, after any run already going. Resolves once it is queued.
export function runNow(id) {
  if (!jobs.has(id)) throw new Error('No Job with that id');
  enqueue(id, 'manual');
}

async function tick() {
  if (!runTurn || !jobs.size) return;
  let key;
  try {
    key = await ownKey();
  } catch {
    return;
  }
  if (!key) return;
  const now = new Date();
  for (const job of jobs.values()) {
    if (job.device !== key) continue;
    const last = [runsOf(job.id)[0]?.startedAt, attempted.get(job.id)].filter(Boolean).sort().pop();
    if (jl.isDue(job, last, now)) enqueue(job.id, 'schedule');
  }
}

function enqueue(id, trigger) {
  if (running.has(id) || queue.some((q) => q.id === id)) return;
  queue.push({ id, trigger });
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const { id, trigger } = queue.shift();
      const job = jobs.get(id);
      if (job) await runOne(job, trigger);
    }
  } finally {
    draining = false;
  }
}

async function runOne(job, trigger) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  running.set(job.id, controller);
  events.emit('changed');
  const startedAt = new Date();
  attempted.set(job.id, startedAt.toISOString());
  // The Job's runs before this one: the newest says whether the last run failed too.
  const prevRun = runsOf(job.id)[0] || null;
  let notified = null;
  let output = '';
  let error = null;
  logger.info('Running a Job', { id: job.id, trigger });
  try {
    if (!runTurn) throw new Error('The AI isn’t ready yet');
    const res = await runTurn(job, {
      signal: controller.signal,
      notify: (n) => {
        notified = jl.makeNotification(n, job.title);
      },
      trigger,
      lastRun: prevRun,
    });
    output = res?.output || '';
    if (res?.sourceHash) noteSourceChange(job.id, res.sourceHash);
    if (controller.signal.aborted) error = 'The Job took longer than 10 minutes and was stopped';
  } catch (err) {
    error = err?.message || String(err);
  } finally {
    clearTimeout(timer);
    running.delete(job.id);
  }
  // Deleted while it ran: nothing to save.
  if (!jobs.has(job.id)) return;
  const status = error ? 'error' : 'ok';
  const run = jl.makeRun({
    id: jl.newRunId(startedAt),
    job,
    device: await ownKey().catch(() => null),
    trigger,
    startedAt,
    finishedAt: new Date(),
    status,
    output,
    error,
    notification: jl.finalNotification(job, { status, output, error, notified, prevRun }),
  });
  if (error) logger.warn('A Job failed', { id: job.id, error });
  try {
    await vault.putAppRecord(jl.runPath(job.id, run.id), run);
    const all = [run, ...runsOf(job.id)];
    const prune = jl.runsToPrune(all);
    for (const old of prune) await vault.delAppRecord(jl.runPath(job.id, old.id)).catch(() => {});
    runs.set(job.id, jl.sortRuns(all).slice(0, jl.KEEP_RUNS));
  } catch (err) {
    logger.warn('Could not save a Job’s run', { id: job.id, error: err?.message });
  }
  events.emit('changed');
}

// Someone else's drive has a newer version of a Job's source than its copy: note it on the Job, once.
function noteSourceChange(id, hash) {
  writes = writes
    .then(async () => {
      const job = jobs.get(id);
      const source = jl.noteSourceChange(job?.source, hash);
      if (!source) return;
      const rec = { ...job, source, updatedAt: new Date().toISOString() };
      await vault.putAppRecord(jl.jobPath(id), rec);
      jobs.set(id, rec);
      events.emit('changed');
    })
    .catch((err) => logger.warn('Could not note a Job’s newer source', { id, error: err?.message }));
}
