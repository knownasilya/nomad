// Every Job run on this Device can be watched as a chat in the AI Sidebar (rules in
// job-chat-messages.mjs):
//
// - A run the user watches from the start (Run with me, ADR-0038) opens its window's sidebar to
//   its chat at once.
// - Any other run can be watched while it runs, from My Library → Jobs (view()): the sidebar of
//   that window opens to the run's chat, and its page comes to the front.
//
// A run's chat is saved with the sidebar's chats, marked as a Job's, only once someone watches it,
// so a Job that runs every hour doesn't fill the chat list; the run's record names the chat
// (`chat` on the run, shared/jobs.mjs makeRun), so the Jobs page can open it later. A run nobody
// watched has its answer in the Job's history only.
//
// Each live run keeps its turn's events from the start, so a sidebar that follows it late (Watch,
// the AI page's Open, the sidebar after a reload) still draws the whole run. Following never stops
// the run; the sidebar's Stop does (stop()), as the Stop bar on the run's page does.
//
// A chat is saved with each watching window's own webContents as the sender, as the sidebar saves
// its chats, so it lands in that window's Space's hyper://private/.
//
// A run is watched while a window that follows it is open. `onWatch(true)` says someone started
// watching, `onWatch(false)` that the last such window closed: jobs.js holds the Job's time limit
// off in between, since the user can stop it.

import EventEmitter from 'events';
import * as logLib from '../logger';
import * as chatStore from './chat-store';
import { openAiSidebarChat, emitAiChatsChanged } from '../ui/tabs/manager';
import {
  jobChatStart,
  applyJobEvent,
  jobChatEnd,
  jobProgressStart,
  applyJobProgress,
} from './job-chat-messages.mjs';

const logger = logLib.get().child({ category: 'ai', subcategory: 'job-chat' });

const RELAYED = ['chunk', 'reasoning', 'tool'];

const live = new Map(); // sessionId -> entry, while the run goes on
const liveByJob = new Map(); // jobId -> entry
const lastByJob = new Map(); // jobId -> { sessionId | null, page }, the Job's last run here

// 'progress' (jobId) when a live run's progress changes, starts or ends: the Jobs page shows it
// (progress()).
export const progressEvents = new EventEmitter();
progressEvents.setMaxListeners(0);

export function isLive(sessionId) {
  return live.has(sessionId);
}

// Starts the chat of a run. `emitter` is the run's turn emitter, `stop` ends the run, `page` is its
// page (job-page.js), and `watchWin` the user's window for Run with me (its sidebar opens to the
// chat now). Returns { sessionId, end(result) }; end() is called once with { error, output } when
// the run is over, and resolves the chat's id when it was saved (someone watched), else null.
export async function open({ job, prompt, emitter, stop, page = null, watchWin = null, onWatch = (_watching) => {} }) {
  const sessionId = chatStore.newSessionId();
  const start = jobChatStart(job, prompt);
  const entry = {
    sessionId,
    job,
    start,
    messages: start.messages,
    events: [],
    bus: new EventEmitter(),
    senders: new Map(), // webContents id -> the shell window webContents it's saved with
    ended: false,
    error: null,
    stopped: false,
    stop,
    onWatch,
    unwatch: [], // removes each window's close listener when the run ends
    page,
    startedAt: new Date().toISOString(),
    progress: jobProgressStart(),
  };
  entry.bus.setMaxListeners(0);
  live.set(sessionId, entry);
  liveByJob.set(job.id, entry);
  progressEvents.emit('progress', job.id);

  const listeners = RELAYED.map((type) => {
    const fn = (e) => {
      if (entry.ended) return;
      entry.events.push([type, e]);
      entry.messages = applyJobEvent(entry.messages, type, e);
      const progress = applyJobProgress(entry.progress, type, e);
      if (progress !== entry.progress) {
        entry.progress = progress;
        progressEvents.emit('progress', job.id);
      }
      entry.bus.emit('event', type, e);
    };
    emitter.on(type, fn);
    return [type, fn];
  });

  if (watchWin) await attach(entry, watchWin);

  return {
    sessionId,
    async end({ error = null, output = '' } = {}) {
      if (entry.ended) return null;
      entry.ended = true;
      for (const [type, fn] of listeners) emitter.removeListener(type, fn);
      for (const fn of entry.unwatch) fn();
      entry.error = error && !entry.stopped ? String(error) : null;
      await saveAll(entry, jobChatEnd(entry.messages, { error, stopped: entry.stopped, output }));
      // Someone watched it, so its chat is saved.
      const saved = entry.senders.size > 0;
      live.delete(sessionId);
      if (liveByJob.get(job.id) === entry) liveByJob.delete(job.id);
      lastByJob.set(job.id, { sessionId: saved ? sessionId : null, page });
      entry.bus.emit('end');
      progressEvents.emit('progress', job.id);
      return saved ? sessionId : null;
    },
  };
}

// Watch a Job's run from `win` (My Library → Jobs): while it runs, the window's sidebar opens to its
// chat and its page comes to the front. After it ended, the chat of its last run here (or `chat`,
// a run's chat the page names) opens, and its tab if it's still open.
// Resolves { running, chat, page }: what was shown.
export async function view(jobId, win, { chat = null } = {}) {
  const entry = liveByJob.get(jobId);
  if (entry && !entry.ended) {
    const ok = await attach(entry, win);
    const page = !!entry.page?.show?.();
    return { running: true, chat: ok, page };
  }
  const last = lastByJob.get(jobId);
  const sessionId = chat || last?.sessionId || null;
  if (sessionId) openAiSidebarChat(win, sessionId);
  const page = !chat || chat === last?.sessionId ? !!last?.page?.show?.() : false;
  return { running: false, chat: !!sessionId, page };
}

// Draws a live run on `emitter` (a chat stream's): every event so far, then each as it comes,
// until the run ends (resolves) or fails (throws its error). `signal` stops following.
export function follow(sessionId, emitter, signal) {
  const entry = live.get(sessionId);
  if (!entry) return Promise.resolve();
  for (const [type, e] of entry.events) emitter.emit(type, e);
  return new Promise((resolve, reject) => {
    const onEvent = (type, e) => emitter.emit(type, e);
    const done = () => {
      entry.bus.removeListener('event', onEvent);
      entry.bus.removeListener('end', onEnd);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onEnd = () => {
      done();
      if (entry.error) reject(new Error(entry.error));
      else {
        emitter.emit('done', {});
        resolve();
      }
    };
    const onAbort = () => {
      done();
      resolve();
    };
    entry.bus.on('event', onEvent);
    entry.bus.on('end', onEnd);
    signal?.addEventListener?.('abort', onAbort);
  });
}

// A Job's run going on now, as the Jobs page shows it: { startedAt, items, thinking, stopping,
// watched, page }, or null when none is. `watched`: its chat is open in a sidebar; `page`: it has a
// page to show.
export function progress(jobId) {
  const entry = liveByJob.get(jobId);
  if (!entry || entry.ended) return null;
  return {
    startedAt: entry.startedAt,
    items: entry.progress.items,
    thinking: entry.progress.thinking,
    stopping: entry.stopped,
    watched: watching(entry),
    page: !!entry.page,
  };
}

// The Jobs page's Stop: the Job's run going on now ends as it does from the sidebar's Stop, and its
// chat says it was stopped. false when none is.
export function stopJob(jobId) {
  const entry = liveByJob.get(jobId);
  if (!entry || entry.ended) return false;
  const ok = stop(entry.sessionId);
  progressEvents.emit('progress', jobId);
  return ok;
}

// The sidebar's Stop on a run's chat: the run ends as it does from its page's Stop bar.
export function stop(sessionId) {
  const entry = live.get(sessionId);
  if (!entry || entry.ended) return false;
  entry.stopped = true;
  entry.stop?.();
  return true;
}

// Save the run's chat where `win`'s sidebar reads it, and open the sidebar to it. false when the
// window is gone.
async function attach(entry, win) {
  const sender = win?.webContents;
  if (!sender || sender.isDestroyed?.()) return false;
  if (!entry.senders.has(sender.id)) {
    const was = watching(entry);
    entry.senders.set(sender.id, sender);
    // The window closing ends its watch (the chat it saved stays).
    const gone = () => {
      if (entry.ended || watching(entry, sender.id)) return;
      notifyWatch(entry, false);
    };
    sender.once?.('destroyed', gone);
    entry.unwatch.push(() => sender.removeListener?.('destroyed', gone));
    if (!was) notifyWatch(entry, true);
    await save(entry, sender, entry.messages);
    emitAiChatsChanged({});
  }
  openAiSidebarChat(win, entry.sessionId);
  return true;
}

// Whether a window that follows the run is still open (`except`: one closing now).
function watching(entry, except = null) {
  for (const [id, sender] of entry.senders) {
    if (id !== except && !sender.isDestroyed?.()) return true;
  }
  return false;
}

function notifyWatch(entry, on) {
  progressEvents.emit('progress', entry.job.id);
  try {
    entry.onWatch?.(on);
  } catch (err) {
    logger.warn('A Job’s watch hook failed', { id: entry.job?.id, error: err?.message });
  }
}

async function saveAll(entry, messages) {
  let saved = false;
  for (const sender of entry.senders.values()) {
    if (sender.isDestroyed?.()) continue;
    if (await save(entry, sender, messages)) saved = true;
  }
  if (saved) emitAiChatsChanged({});
}

async function save(entry, sender, messages) {
  try {
    await chatStore.saveSession(sender, entry.sessionId, {
      title: entry.start.title,
      job: entry.start.job,
      messages,
    });
    return true;
  } catch (err) {
    logger.warn('Could not save a Job’s chat', { id: entry.job?.id, error: err?.message });
    return false;
  }
}
