// The AI's saved chats: one list per Space, in the Space's Root Drive (desktop's
// hyper://private/.ai-chat/, app/bg/ai/chat-store.js). The AI Sidebar, the AI page
// (nomad://ai/chats) and the phone's AI panel (mobile/backend/lib/ai-chats.mjs) all read and write
// the same files, so a chat started on one Device can be carried on from another.
//
//   /.ai-chat/sessions/<id>.json   { id, title, messages, updatedAt, job? }
//   /.ai-chat/last-session.json    { sessionId }
//   /.ai-chat/names.json           { [id]: name }   the user's names for chats
//
// Pure, so it also runs on the phone's Bare worklet: no globals beyond Math and Date.

export const CHAT_DIR = '/.ai-chat';
export const SESSIONS_DIR = `${CHAT_DIR}/sessions/`;
export const LAST_SESSION_PATH = `${CHAT_DIR}/last-session.json`;
export const NAMES_PATH = `${CHAT_DIR}/names.json`;
export const MAX_NAME = 80;
export const MAX_TITLE = 60;

// Ids are newSessionId()'s: short and lower-case, so one can never name a path outside sessions/.
export const isSessionId = (id) =>
  typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id);
export const sessionPath = (id) => `${SESSIONS_DIR}${id}.json`;

export function newSessionId(now = Date.now()) {
  return now.toString(36) + Math.random().toString(36).slice(2, 7);
}

// The id in a sessions/ file name, or null.
export function sessionIdOf(name) {
  const base =
    String(name || '')
      .split('/')
      .pop() || '';
  if (!base.endsWith('.json')) return null;
  const id = base.slice(0, -'.json'.length);
  return isSessionId(id) ? id : null;
}

const textOf = (m) => (m && typeof m.content === 'string' ? m.content : '');
const said = (m) => m?.role === 'user' || m?.role === 'assistant';

export function searchWords(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// The start of the last thing said, on one line.
export function previewOf(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!said(m)) continue;
    const text = textOf(m).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 160);
  }
  return '';
}

// null when the session doesn't have every word (in its title or its messages, together); else a
// bit of the first message with one of the words, or '' when only the title has them.
export function matchSession(title, messages, words) {
  const texts = (messages || [])
    .filter(said)
    .map((m) => textOf(m).replace(/\s+/g, ' ').trim());
  const all = [String(title || ''), ...texts].join('\n').toLowerCase();
  if (!words.every((w) => all.includes(w))) return null;
  for (const text of texts) {
    const lower = text.toLowerCase();
    let at = -1;
    let len = 0;
    for (const w of words) {
      const i = lower.indexOf(w);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        len = w.length;
      }
    }
    if (at === -1) continue;
    const start = Math.max(0, at - 50);
    const end = Math.min(text.length, at + len + 90);
    return (
      (start > 0 ? '…' : '') +
      text.slice(start, end) +
      (end < text.length ? '…' : '')
    );
  }
  return '';
}

// A Job run's chat ({ id, title }), or null (desktop's job-chat-messages.mjs jobOf).
export function chatJobOf(data) {
  const job = data?.job;
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !job.id)
    return null;
  return {
    id: job.id,
    title: typeof job.title === 'string' ? job.title.slice(0, MAX_TITLE) : '',
  };
}

// A session's title as the sidebar saves it: the Job's for a Job run, else its first message.
export function sessionTitle(messages, job = null) {
  if (job?.title) return job.title;
  const first = (messages || []).find(
    (m) => m?.role === 'user' && textOf(m).trim(),
  );
  return first ? textOf(first).trim().slice(0, MAX_TITLE) : '';
}

// A name the user typed for a chat: one line, at most MAX_NAME characters ('' = no name).
export function cleanName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

// The user's names, from names.json's parsed value.
export function namesOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

// One row of the chats list: { id, title, named, updatedAt, messageCount, preview, job, snippet? },
// or null when `words` is given and the chat doesn't have them all.
export function sessionRow(id, data, names = {}, words = []) {
  if (!data || typeof data !== 'object') return null;
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const named = typeof names[id] === 'string' && names[id] ? names[id] : '';
  const row = {
    id,
    title: named || (typeof data.title === 'string' ? data.title : ''),
    named: !!named,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    messageCount: messages.filter(said).length,
    preview: previewOf(messages),
    job: chatJobOf(data),
  };
  if (words.length) {
    const snippet = matchSession(row.title, messages, words);
    if (snippet === null) return null;
    row.snippet = snippet;
  }
  return row;
}

// Rows, newest first.
export function sortRows(rows) {
  return rows.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
