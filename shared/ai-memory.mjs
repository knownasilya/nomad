// nomad/shared/ai-memory.mjs
//
// AI memory (ADR-0032): short things the user's own assistant keeps about them across chats, like
// "Prefers metric units" or "Their blog is the drive named blog". One set per user, kept in the
// Vault so every linked Device has them:
//
//   /.vault/ai-memory/<id>.json   { type, id, text, by, createdAt, updatedAt }
//
// `by` is who wrote it last: 'ai' (the assistant's remember capability) or 'user' (the AI page).
// A personal turn gets every memory in its system prompt (memoryPrompt); the assistant adds one with
// remember and drops one with forget. The user sees, edits and deletes them on nomad://ai/memory.
//
// Pure: no imports. Used by app/bg/ai/memory.js, ai.ts and the tests.

export const MEMORY_PREFIX = '/.vault/ai-memory/';
export const MEMORY_TYPE = 'nomad/ai-memory';

// One memory is a sentence or two, not a document.
export const MAX_MEMORY_TEXT = 500;
// More than this and the assistant should be told to tidy up rather than keep adding.
export const MAX_MEMORIES = 200;
// The part of every personal turn's system prompt memories may take, in characters.
export const MAX_PROMPT_CHARS = 8000;

export function newMemoryId(now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return 'm' + now.toString(36).padStart(9, '0') + '-' + tail;
}

export function isMemoryId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

export function memoryPath(id) {
  if (!isMemoryId(id)) throw new Error('Not a memory id: ' + id);
  return MEMORY_PREFIX + id + '.json';
}

// The text as stored: one line, trimmed. Throws when there's nothing left or it's too long.
export function cleanMemoryText(text) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) throw new Error('A memory needs some text');
  if (s.length > MAX_MEMORY_TEXT) {
    throw new Error(
      `A memory is at most ${MAX_MEMORY_TEXT} characters. Keep it to one short fact.`
    );
  }
  return s;
}

// A new memory (prev null) or changes to one. Fields left undefined keep their values.
export function makeMemory(fields, prev = null, now = new Date().toISOString()) {
  const f = {
    ...prev,
    ...Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined)),
  };
  if (!isMemoryId(f.id)) throw new Error('Not a memory id: ' + f.id);
  return {
    type: MEMORY_TYPE,
    id: f.id,
    text: cleanMemoryText(f.text),
    by: f.by === 'user' ? 'user' : 'ai',
    createdAt: (prev && prev.createdAt) || now,
    updatedAt: now,
  };
}

export function isMemory(rec) {
  return (
    !!rec &&
    rec.type === MEMORY_TYPE &&
    isMemoryId(rec.id) &&
    typeof rec.text === 'string' &&
    rec.text.trim().length > 0
  );
}

// Newest change first, the order the AI page lists them in.
export function sortMemories(list) {
  return [...(list || [])].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : a.id < b.id ? -1 : 1
  );
}

const key = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// A memory that already says the same thing, ignoring case and punctuation, or null.
export function findSameMemory(list, text) {
  const k = key(text);
  if (!k) return null;
  return (list || []).find((m) => key(m.text) === k) || null;
}

// Memories whose text has every word of `query`, newest first.
export function searchMemories(list, query) {
  const words = key(query).split(' ').filter(Boolean);
  const rows = sortMemories((list || []).filter(isMemory));
  if (!words.length) return rows;
  return rows.filter((m) => {
    const k = key(m.text);
    return words.every((w) => k.includes(w));
  });
}

// The block a personal turn's system prompt gets: every memory, newest first, each with the id
// forget takes, up to MAX_PROMPT_CHARS. '' when there are none.
export function memoryPrompt(list, { maxChars = MAX_PROMPT_CHARS } = {}) {
  const rows = sortMemories((list || []).filter(isMemory));
  if (!rows.length) return '';
  const lines = [];
  let used = 0;
  let left = 0;
  for (const m of rows) {
    const line = `- [${m.id}] ${m.text}`;
    if (used + line.length + 1 > maxChars) {
      left++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const more = left
    ? `\n(${left} older ${left === 1 ? 'memory is' : 'memories are'} not shown. Use forget on ones that no longer matter.)`
    : '';
  return (
    'What you remember about the user, from earlier chats. Use it when it helps, without reciting it. ' +
    'The user sees and edits these on the AI page.\n' +
    lines.join('\n') +
    more
  );
}
