// A Job run the user watches (Run with me, ADR-0038) is also a chat in their AI Sidebar. These are
// the pure rules for that chat: the session it starts as, how each event of the run's turn adds to
// its messages, and how it ends. app/bg/ai/job-chat.js keeps the live runs and saves them.
//
// A Job's chat is an ordinary sidebar session (chat-store.js) with a `job` field, { id, title }, so
// the sidebar's history and the AI page's chat list mark it as automated. Its first message is the
// prompt the Job sent, marked `fromJob`, since the user didn't type it. The answer has no `files`:
// the run records what it changed itself, and a Job's writes can be staged in a Draft, which the
// sidebar's Revert doesn't know about.

import { applyToolEvent, finishSteps, savedSteps } from '../../../shared/ai-steps.mjs';

const MAX_TITLE = 80;

// { id, title } for a session's `job`, or null when it isn't one.
export function jobOf(data) {
  const job = data?.job;
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !job.id) return null;
  return { id: job.id, title: typeof job.title === 'string' ? job.title.slice(0, MAX_TITLE) : '' };
}

// The session a watched run starts as: the Job's prompt as the first message.
export function jobChatStart(job, prompt) {
  const title =
    String(job?.title || '')
      .trim()
      .slice(0, MAX_TITLE) || 'Job';
  const text = String(prompt || '').trim() || `Run the Job “${title}”`;
  return {
    title,
    job: { id: String(job?.id || ''), title },
    messages: [{ role: 'user', content: text, fromJob: true }],
  };
}

// The answer the run is writing: the last message when it's an assistant's, else a new one.
function withAnswer(messages) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant') return [messages.slice(0, -1), last];
  return [messages, { role: 'assistant', content: '', reasoning: '' }];
}

// One event of the run's turn ('chunk', 'reasoning' or 'tool', as the chat stream sends them) on
// the session's messages. Returns new messages, or the same array when the event adds nothing.
export function applyJobEvent(messages, type, e) {
  if (type === 'chunk' || type === 'reasoning') {
    const text = typeof e?.text === 'string' ? e.text : '';
    if (!text) return messages;
    const [rest, answer] = withAnswer(messages);
    const key = type === 'chunk' ? 'content' : 'reasoning';
    return [...rest, { ...answer, [key]: (answer[key] || '') + text }];
  }
  if (type === 'tool' && e?.phase === 'private') {
    const [rest, answer] = withAnswer(messages);
    return answer.privateData ? messages : [...rest, { ...answer, privateData: true }];
  }
  if (type === 'tool' && e?.phase === 'screenshot' && typeof e.imageDataUrl === 'string') {
    const [rest, answer] = withAnswer(messages);
    return [...rest, { ...answer, images: [...(answer.images || []), e.imageDataUrl] }];
  }
  if (type === 'tool') {
    // A step the run took: the answer keeps it, as the sidebar's own turns do (shared/ai-steps.mjs).
    const [rest, answer] = withAnswer(messages);
    const steps = applyToolEvent(answer.steps || [], e);
    return steps === (answer.steps || []) ? messages : [...rest, { ...answer, steps }];
  }
  return messages;
}

// The session's messages once the run ended: an error takes the answer's place, a stopped run with
// no answer says so, and a Job with no prompt (only job.js) answers with its module's result.
export function jobChatEnd(messages, { error = null, stopped = false, output = '' } = {}) {
  const [rest, live] = withAnswer(messages);
  const { steps: liveSteps, ...settled } = live;
  const steps = savedSteps(finishSteps(liveSteps || []));
  const answer = steps.length ? { ...settled, steps } : settled;
  const content = (answer.content || '').trim();
  if (error && !stopped) {
    return [...rest, { role: 'error', content: `Error: ${error}`, ...(steps.length ? { steps } : {}) }];
  }
  if (!content) {
    const text = stopped ? '_Stopped._' : String(output || '').trim();
    if (!text && !answer.reasoning && !answer.images?.length && !steps.length) return rest;
    return [...rest, { ...answer, content: text }];
  }
  return [...rest, answer];
}

// A live run as the Jobs page shows it while it goes on (My Library → Jobs, opened on a running
// Job): what it said and each step it took, in order, newest last. A step is
// { kind: 'step', id, summary, child, state: 'running' | 'done' | 'error', error? }; what it said
// is { kind: 'text', text }. `thinking` is true while the model reasons and hasn't said anything
// since. Only the newest MAX_ITEMS items are kept, and the newest MAX_TEXT characters of each text.
const MAX_ITEMS = 60;
const MAX_TEXT = 2000;

export function jobProgressStart() {
  return { items: [], thinking: false };
}

// One event of the run's turn on its progress, as applyJobEvent does on its chat. Returns a new
// progress, or the same object when the event changes nothing shown.
export function applyJobProgress(progress, type, e) {
  const items = progress?.items || [];
  if (type === 'reasoning') {
    if (progress.thinking || typeof e?.text !== 'string' || !e.text) return progress;
    return { ...progress, thinking: true };
  }
  if (type === 'chunk') {
    const text = typeof e?.text === 'string' ? e.text : '';
    if (!text) return progress;
    const last = items[items.length - 1];
    const next =
      last?.kind === 'text'
        ? [...items.slice(0, -1), { kind: 'text', text: tail(last.text + text) }]
        : [...items, { kind: 'text', text: tail(text) }];
    return { items: cap(next), thinking: false };
  }
  if (type !== 'tool') return progress;
  if (e?.phase === 'start') {
    const summary = String(e.summary || e.name || 'Working').slice(0, 200);
    // An older Provider sends no ids: its step is done once the next one starts.
    const done = items.map((it) =>
      it.kind === 'step' && it.state === 'running' && !it.id ? { ...it, state: 'done' } : it
    );
    const step = {
      kind: 'step',
      id: typeof e.id === 'string' ? e.id : null,
      summary,
      child: !!e.parentId,
      state: 'running',
    };
    return { items: cap([...done, step]), thinking: false };
  }
  if (e?.phase === 'end' && typeof e.id === 'string') {
    const i = items.findIndex((it) => it.kind === 'step' && it.id === e.id);
    if (i < 0) return progress;
    const step = e.error
      ? { ...items[i], state: 'error', error: String(e.error).slice(0, 300) }
      : { ...items[i], state: 'done' };
    return { ...progress, items: [...items.slice(0, i), step, ...items.slice(i + 1)] };
  }
  return progress;
}

function tail(text) {
  return text.length > MAX_TEXT ? '…' + text.slice(-MAX_TEXT) : text;
}

function cap(items) {
  return items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
}
