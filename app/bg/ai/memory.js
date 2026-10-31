// AI memory (ADR-0032): what the user's own assistant keeps about them across chats. Records live
// in the Vault (shared/ai-memory.mjs), so the user's other Devices have them; this module keeps them
// in memory, as mods.js does, so every personal turn gets them without a Vault read.
//
// Writers: the assistant's remember / forget capabilities (web-apis/bg/ai-vault.ts) and the AI
// page, nomad://ai/memory (nomad.vault.listMemories / saveMemory / deleteMemory). Readers: ai.ts,
// which adds memoryPrompt() to a personal turn's system prompt while the `ai_memory` setting is on.

import { EventEmitter } from 'events';
import * as vault from '../hyper/vault';
import * as settingsDb from '../dbs/settings';
import * as mem from '../../../shared/ai-memory.mjs';

// The setting that turns memory on and off, on nomad://ai/memory.
export const SETTING = 'ai_memory';

// Emits 'changed' when any memory changes, here or on another Device.
export const events = new EventEmitter();

let cache = new Map(); // id -> record
let watchedBase = null;
let timer = null;
/** @type {Promise<any>} */
let writes = Promise.resolve(); // one write at a time, so two quick saves don't race

export function setup() {
  refresh();
  vault.events.on('changed', () => refresh());
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 300);
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
  const records = sess ? (await vault.listAppRecords(mem.MEMORY_PREFIX)).filter(mem.isMemory) : [];
  const next = new Map(records.map((r) => [r.id, r]));
  const same =
    next.size === cache.size &&
    [...next].every(([k, r]) => cache.get(k)?.updatedAt === r.updatedAt);
  if (same) return;
  cache = next;
  events.emit('changed');
}

// Is memory on? On by default; the AI page turns it off.
export async function isEnabled() {
  try {
    return (await settingsDb.get(SETTING)) !== 0;
  } catch {
    return true;
  }
}

// Every memory, newest change first.
export function list() {
  return mem.sortMemories([...cache.values()]);
}

export function get(id) {
  return cache.get(id) || null;
}

// The system prompt block for a personal turn with memory on, or '' when there are none.
export function memoryPromptText() {
  return mem.memoryPrompt(list());
}

// Save a memory: a new one (no id) or new text for one. A new memory that says what another
// already says returns that one instead of making a second.
/** @param {{ id?: string, text: string, by?: 'ai' | 'user' }} fields */
export function save(fields) {
  const run = writes.then(async () => {
    const text = mem.cleanMemoryText(fields?.text);
    if (fields?.id && !cache.has(fields.id)) throw new Error('No memory with that id');
    if (!fields?.id) {
      const same = mem.findSameMemory([...cache.values()], text);
      if (same) return { ...same, existed: true };
      if (cache.size >= mem.MAX_MEMORIES) {
        throw new Error(
          `There are already ${mem.MAX_MEMORIES} memories. Forget some, or change one, before adding more.`
        );
      }
    }
    const id = fields?.id || mem.newMemoryId();
    const prev = cache.get(id) || null;
    const rec = mem.makeMemory({ id, text, by: fields?.by || 'ai' }, prev);
    await vault.putAppRecord(mem.memoryPath(id), rec);
    cache.set(id, rec);
    events.emit('changed');
    return rec;
  });
  writes = run.catch(() => {});
  return run;
}

export function remove(id) {
  const run = writes.then(async () => {
    await vault.delAppRecord(mem.memoryPath(id));
    if (cache.delete(id)) events.emit('changed');
  });
  writes = run.catch(() => {});
  return run;
}

// Forget everything.
export function clear() {
  const run = writes.then(async () => {
    const ids = [...cache.keys()];
    for (const id of ids) await vault.delAppRecord(mem.memoryPath(id));
    cache = new Map();
    if (ids.length) events.emit('changed');
    return ids.length;
  });
  writes = run.catch(() => {});
  return run;
}
