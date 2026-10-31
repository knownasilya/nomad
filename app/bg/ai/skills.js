// AI skills (ADR-0034): instructions the user gives their own assistant for kinds of tasks. Records
// live in the Vault (shared/ai-skills.mjs), so the user's other Devices have them; this module keeps
// them in memory, as memory.js does, so every personal turn lists them without a Vault read.
//
// Writer: the AI page, nomad://ai/skills (nomad.vault.listSkills / saveSkill / deleteSkill). The AI
// never changes them. Readers: ai.ts, which lists the enabled ones in a personal turn's system prompt
// (skillsPrompt) and in search's `skill` domain, where the model opens one to read its instructions.

import { EventEmitter } from 'events';
import * as vault from '../hyper/vault';
import * as sk from '../../../shared/ai-skills.mjs';

// Emits 'changed' when any skill changes, here or on another Device.
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
  const records = sess ? (await vault.listAppRecords(sk.SKILL_PREFIX)).filter(sk.isSkill) : [];
  const next = new Map(records.map((r) => [r.id, r]));
  const same =
    next.size === cache.size &&
    [...next].every(([k, r]) => cache.get(k)?.updatedAt === r.updatedAt);
  if (same) return;
  cache = next;
  events.emit('changed');
}

// Every skill, by name.
export function list() {
  return sk.sortSkills([...cache.values()]);
}

// The skills a turn may use: the ones the user turned on.
export function enabledList() {
  return list().filter((s) => s.enabled !== false);
}

export function get(id) {
  return cache.get(id) || null;
}

// The system prompt block for a personal turn, or '' when no skill is on.
export function promptText() {
  return sk.skillsPrompt(list());
}

// Save a skill: a new one (no id) or changes to one. Only the fields given change, so
// { id, enabled } turns one on or off. Two skills can't share a name.
/** @param {{ id?: string, name?: string, description?: string, instructions?: string, enabled?: boolean }} fields */
export function save(fields) {
  const run = writes.then(async () => {
    const id = fields?.id || null;
    if (id && !cache.has(id)) throw new Error('No skill with that id');
    if (!id && cache.size >= sk.MAX_SKILLS) {
      throw new Error(
        `There are already ${sk.MAX_SKILLS} skills. Delete one before adding another.`
      );
    }
    const prev = id ? cache.get(id) : null;
    const rec = sk.makeSkill(
      {
        id: id || sk.newSkillId(),
        name: fields?.name,
        description: fields?.description,
        instructions: fields?.instructions,
        enabled: typeof fields?.enabled === 'boolean' ? fields.enabled : undefined,
      },
      prev
    );
    if (sk.findSkillByName([...cache.values()], rec.name, rec.id)) {
      throw new Error(`There is already a skill named ${rec.name}`);
    }
    await vault.putAppRecord(sk.skillPath(rec.id), rec);
    cache.set(rec.id, rec);
    events.emit('changed');
    return rec;
  });
  writes = run.catch(() => {});
  return run;
}

export function remove(id) {
  const run = writes.then(async () => {
    await vault.delAppRecord(sk.skillPath(id));
    if (cache.delete(id)) events.emit('changed');
  });
  writes = run.catch(() => {});
  return run;
}
