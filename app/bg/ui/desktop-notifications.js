// Desktop (OS) notifications for Jobs, shared-Space notices, and permission prompts nobody sees.
// The rules are bg/ui/notify-rules.mjs; Messages notify from bg/hyper/inbox.js.
//
// - A Job's run with a notification shows here once its run record reaches this computer's Vault,
//   whichever Device ran it, as on the phone. A click opens the Job in My Library → Jobs.
// - Another member's notice in a shared Space ("bins go out tonight") shows once its Space Library
//   syncs. A click brings Nomad forward.
// - A permission prompt (a site's, or the AI's on a page) that opens while Nomad isn't the app in
//   front, or on a tab that isn't showing, shows a notification and bounces the dock (macOS) or
//   flashes the taskbar. A click brings its window and tab forward. Answering the prompt takes the
//   notification and the bounce away.
//
// - A calendar event's reminder (shared/calendar.mjs remindersBetween), the user's own or any of
//   their Spaces' (a shared Space's remind the whole household). Looked for each minute; one missed
//   while the computer slept still shows if it's under REMIND_LATE_MS old. A click opens its day.
//
// Settings → Notifications turns each kind off (SETTINGS in notify-rules.mjs).

import { app, BrowserWindow, Notification } from 'electron';
import * as settingsDb from '../dbs/settings';
import * as logLib from '../logger';
import * as jobs from '../ai/jobs';
import * as spaceLibrary from '../hyper/space-library';
import * as permissions from './permissions';
import * as tabManager from './tabs/manager';
import * as nr from './notify-rules.mjs';
import * as cal from '../../../shared/calendar.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'notifications' });

let openUrl = null; // (url) => open it in a tab of a shell window, making one if none is open
let reminders = null; // (from, to) => the calendar's reminders due then (bg/web-apis/bg/calendar.ts)
const live = new Set(); // shown notifications, kept so a click still reaches its handler (GC)

/** @param {{ openUrl?: (url: string) => void, reminders?: (from: string, to: string) => Promise<any[]> }} opts */
export function setup(opts = {}) {
  openUrl = opts.openUrl || null;
  reminders = opts.reminders || null;
  permissions.setPromptHook(promptWaiting);
  let jobTimer = null;
  jobs.events.on('changed', () => {
    clearTimeout(jobTimer);
    jobTimer = setTimeout(
      () =>
        checkJobs().catch((err) =>
          logger.warn('Job notifications failed', { error: err?.message })
        ),
      500
    );
  });
  checkJobs().catch(() => {});
  // Calendar reminders, on the minute.
  const remindTick = () =>
    checkReminders(reminders).catch((err) => logger.warn('Calendar reminders failed', { error: err?.message }));
  setTimeout(remindTick, 15e3);
  setInterval(remindTick, 60e3).unref?.();
  // Someone asks to join a Space this computer manages, from an invite link or a code (ADR-0040).
  spaceLibrary.events.on('join-request', ({ space, name } = {}) => {
    joinRequest(space, name).catch((err) => logger.warn('Join notification failed', { error: err?.message }));
  });
  const spaceTimers = new Map();
  spaceLibrary.events.on('changed', ({ space } = {}) => {
    if (!space) return;
    clearTimeout(spaceTimers.get(space));
    spaceTimers.set(
      space,
      setTimeout(() => {
        spaceTimers.delete(space);
        checkSpace(space).catch((err) =>
          logger.warn('Space notices failed', { error: err?.message })
        );
      }, 500)
    );
  });
}

async function enabled(kind) {
  const v = await settingsDb.get(nr.SETTINGS[kind]).catch(() => 1);
  return v === undefined || v === null || Number(v) !== 0;
}

function show({ title, body, onClick }) {
  if (!Notification.isSupported()) return null;
  try {
    const n = new Notification({ title, body, silent: false });
    live.add(n);
    const forget = () => live.delete(n);
    n.on('click', () => {
      forget();
      try {
        onClick?.();
      } catch (err) {
        logger.warn('A notification click failed', { error: err?.message });
      }
    });
    n.on('close', forget);
    n.on('failed', forget);
    n.show();
    return n;
  } catch (err) {
    logger.warn('Could not show a notification', { error: err?.message });
    return null;
  }
}

function appFocused() {
  return !!BrowserWindow.getFocusedWindow();
}

// Jobs
// =

let checkingJobs = null;
function checkJobs() {
  // One at a time, so two quick changes don't show a run twice.
  checkingJobs = (checkingJobs || Promise.resolve()).then(checkJobsOnce, checkJobsOnce);
  return checkingJobs;
}

async function checkJobsOnce() {
  const runs = jobs.allRuns();
  if (!runs.length) return; // the Vault isn't loaded yet: keep the mark for when it is
  const since = (await settingsDb.get(nr.JOB_SINCE).catch(() => null)) || null;
  const { alerts, since: next } = nr.jobAlerts(runs, since, { appFocused: appFocused() });
  if (next && next !== since) await settingsDb.set(nr.JOB_SINCE, next).catch(() => {});
  if (!alerts.length || !(await enabled('jobs'))) return;
  for (const a of alerts) {
    const url = a.jobId
      ? `nomad://library/jobs?id=${encodeURIComponent(a.jobId)}`
      : 'nomad://library/jobs';
    show({ title: a.title, body: a.body, onClick: () => openUrl?.(url) });
  }
}

// Shared-Space notices
// =

const checkingSpaces = new Map();
function checkSpace(space) {
  const prev = checkingSpaces.get(space) || Promise.resolve();
  const next = prev.then(
    () => checkSpaceOnce(space),
    () => checkSpaceOnce(space)
  );
  checkingSpaces.set(space, next);
  next.finally(() => {
    if (checkingSpaces.get(space) === next) checkingSpaces.delete(space);
  });
  return next;
}

async function checkSpaceOnce(space) {
  const got = await spaceLibrary.notices(space).catch(() => null);
  if (!got?.library) return;
  const marks = nr.parseMarks(await settingsDb.get(nr.SPACE_SINCE).catch(() => null));
  const { alerts, since } = nr.spaceAlerts(got.list, marks[got.library] ?? null, {
    spaceName: got.name,
    memberId: got.memberId,
  });
  if (since && since !== marks[got.library]) {
    await settingsDb
      .set(nr.SPACE_SINCE, JSON.stringify({ ...marks, [got.library]: since }))
      .catch(() => {});
  }
  if (!alerts.length || !(await enabled('spaces'))) return;
  for (const a of alerts) show({ title: a.title, body: a.body, onClick: () => openUrl?.(null) });
}

async function joinRequest(space, name) {
  if (!(await enabled('spaces'))) return;
  const info = space ? await spaceLibrary.notices(space).catch(() => null) : null;
  const where = info?.name || 'your Space';
  show({
    title: `${String(name || 'Someone').slice(0, 60)} asks to join ${where}`,
    body: 'Approve or deny them in My Library → Sharing, in that Space.',
    onClick: () => openUrl?.('nomad://library/sharing'),
  });
}

// Calendar reminders
// =

let checkingReminders = null;
// Exported for tests, which pass their own source.
export function checkReminders(source = reminders) {
  const once = () => checkRemindersOnce(source);
  checkingReminders = (checkingReminders || Promise.resolve()).then(once, once);
  return checkingReminders;
}

async function checkRemindersOnce(source) {
  if (!source) return;
  // Wall times on this computer's clock, to the minute: [since, now + 1 minute).
  const now = cal.localWallTime();
  const to = cal.addWallMs(now, 60e3);
  const late = cal.addWallMs(now, -cal.REMIND_LATE_MS);
  const stored = await settingsDb.get(nr.CALENDAR_SINCE).catch(() => null);
  const since = cal.isDateTime(stored) && stored > late && stored <= to ? stored : late;
  if (since >= to) return;
  const due = await source(since, to);
  await settingsDb.set(nr.CALENDAR_SINCE, to).catch(() => {});
  if (!due.length || !(await enabled('calendar'))) return;
  const shown = due.slice(-nr.MAX_AT_ONCE);
  for (const r of shown) {
    const { title, body } = cal.reminderText(r);
    show({
      title: title.slice(0, 80),
      body: r.spaceName ? `${body} · ${r.spaceName}` : body,
      onClick: () => openUrl?.(`nomad://calendar/?day=${cal.dayOf(r.start)}`),
    });
  }
}

// Permission prompts
// =

// Call as a prompt opens; returns { done() } to call once it's answered. Shows nothing when the
// user can see the prompt already.
export async function promptWaiting({ win, tab, url, desc, ai }) {
  const none = { done() {} };
  if (!win || win.isDestroyed()) return none;
  const needs = nr.promptNeedsAlert({
    winFocused: win.isFocused(),
    winVisible: win.isVisible(),
    winMinimized: win.isMinimized(),
    tabActive: !!tab?.isActive,
  });
  if (!needs || !(await enabled('prompts'))) return none;
  const { title, body } = nr.promptAlert({ url, desc, ai });
  const n = show({
    title,
    body,
    onClick: () => bringForward(win, tab),
  });
  const attention = requestAttention(win);
  let ended = false;
  return {
    done() {
      if (ended) return;
      ended = true;
      attention.stop();
      try {
        n?.close();
      } catch {}
      if (n) live.delete(n);
    },
  };
}

function bringForward(win, tab) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (tab && !tab.isActive) tabManager.setActive(win, tab);
}

// The dock bounces (macOS) or the taskbar flashes (Windows, Linux) until the prompt is answered or
// the window comes to the front.
function requestAttention(win) {
  let bounceId = null;
  let flashing = false;
  try {
    if (process.platform === 'darwin' && app.dock) bounceId = app.dock.bounce('critical');
    else if (!win.isFocused()) {
      win.flashFrame(true);
      flashing = true;
    }
  } catch {}
  const stop = () => {
    try {
      if (bounceId !== null) app.dock.cancelBounce(bounceId);
      if (flashing && !win.isDestroyed()) win.flashFrame(false);
    } catch {}
    bounceId = null;
    flashing = false;
    if (!win.isDestroyed()) win.removeListener('focus', stop);
  };
  win.on('focus', stop);
  return { stop };
}
