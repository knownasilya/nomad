// The AI sorts Notes into topics (ADR-0035), as it sorts Reader's saved articles (reader-articles.ts).
// Rules: shared/note-topics.mjs. Runs in the background, one Note at a time, on this Device's
// runtime only (ai.ts completeText, passed in by main.js as auto-names and Reader get it).
//
// - A Note is looked at once it has a few lines and nobody has edited it for two minutes
//   (notesToTag), on any of this user's Devices: a Note written on the phone is sorted here too.
// - A pass runs a moment after the Vault changes (a save here, or another Device's), and when a
//   Note waiting for topics settles. It covers the user's own Notes and every Space's.
// - Topics the user set are never changed. The AI's answer is kept even when it is empty, so a Note
//   is asked about once; "Suggest topics" in nomad://notes asks again.
// - The AI page’s setup (nomad://ai/setup) → "Sort my notes into topics" (`ai_note_topics`) turns
//   the automatic pass off; "Suggest topics" still asks.
// - Writing the topics keeps the Note's updatedAt, so it is never taken for an edit.

import { EventEmitter } from 'events';
import * as settingsDb from '../../dbs/settings';
import * as logLib from '../../logger';
import * as nt from '../../../../shared/note-topics.mjs';
import * as vaultApps from './vault-apps';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'note-topics' });

export const TOPICS_SETTING = 'ai_note_topics';
const PASS_DELAY = 5e3; // after the Vault changes, so a burst of saves makes one pass

// 'changed' when tagging starts or ends, for an open Notes page (vault.ts watchAppData).
export const events = new EventEmitter();

type Complete = (messages: any[], opts?: any) => Promise<string | null>;
let complete: Complete | null = null;
let queue: Promise<void> = Promise.resolve();
const tagging = new Set<string>(); // Note ids queued or running
let noRuntime = false; // the last try found no AI runtime on this Device
let passTimer: any = null;
let settleTimer: any = null;
let watcher: any = null;

// `complete` is passed in by main.js: importing the AI stack here would loop back to the tabs.
export function setup(opts: { complete?: Complete } = {}) {
  complete = opts.complete || null;
  if (!complete || watcher) return;
  watcher = vaultApps.watch();
  watcher.on('changed', () => soon());
  soon(30e3); // once after start, for Notes written while this Device was off
}

// What Notes shows about the AI: whether it sorts Notes by itself, which it is on now, and whether
// the last try found no runtime.
export async function aiState() {
  return {
    autoTopics: !!(await settingsDb.get(TOPICS_SETTING)),
    tagging: [...tagging],
    noRuntime,
  };
}

// A pass in a moment.
export function soon(delay = PASS_DELAY) {
  if (!complete) return;
  clearTimeout(passTimer);
  passTimer = setTimeout(() => {
    pass().catch((err) =>
      logger.warn('Could not sort notes into topics', { error: err?.message || String(err) })
    );
  }, delay);
}

// Where Notes are: the user's own (null) and each Space's.
async function places(): Promise<(string | null)[]> {
  return [null, ...(await vaultApps.knownSpaceKeys())];
}

async function pass() {
  if (!complete || noRuntime || !(await settingsDb.get(TOPICS_SETTING))) return;
  if (!(await vaultApps.vaultInfo()).writable) return; // a Device that just joined waits for the Vault
  let wait = null;
  for (const space of await places()) {
    // A viewer of a shared Space can't write its Notes (ADR-0029).
    if (space && !(await vaultApps.canWriteNotesIn(space))) continue;
    const notes = await vaultApps.notesIn(space).catch(() => []);
    for (const n of nt.notesToTag(notes)) queueTopics(space, n.id);
    const next = nt.nextSettle(notes);
    if (next !== null && (wait === null || next < wait)) wait = next;
  }
  // A Note being written is looked at once it settles.
  clearTimeout(settleTimer);
  if (wait !== null) settleTimer = setTimeout(() => soon(0), wait + 1000);
}

// Ask the AI now: for `ids` (even ones the user tagged: they asked), or else for every Note the
// caller's Space sees that has no topics yet. Returns how many were queued.
export async function suggest(ctx, ids: string[] | null = null) {
  const space = await vaultApps.spaceKey(ctx).catch(() => null);
  const notes = await vaultApps.allNotes(space);
  const todo = ids?.length
    ? notes.filter((n) => ids.includes(n.id))
    : notes.filter((n) => !n.topicsBy && n.body.trim());
  noRuntime = false;
  for (const n of todo) queueTopics(n.space || null, n.id, { force: !!ids?.length });
  return todo.length;
}

function queueTopics(space: string | null, id: string, { force = false } = {}) {
  if (tagging.has(id) || !complete) return;
  tagging.add(id);
  events.emit('changed');
  queue = queue
    .then(() => pickTopics(space, id, force))
    .catch((err) => {
      logger.warn('Could not pick topics for a note', { id, error: err?.message || String(err) });
    })
    .finally(() => {
      tagging.delete(id);
      events.emit('changed');
    });
}

async function pickTopics(space: string | null, id: string, force: boolean) {
  if (noRuntime) return; // the rest of this batch would fail the same way
  const note = await vaultApps.getNote(space, id);
  if (!note || (note.topicsBy && !force)) return;
  const known = nt.knownNoteTopics(await vaultApps.allNotes(space));
  const reply = await complete(nt.noteTopicMessages(note, known), { maxTokens: 120 });
  if (reply === null) {
    noRuntime = true;
    events.emit('changed');
    return;
  }
  const topics = nt.pickNoteTopics(reply, known);
  // The Note as it is now: the user may have set topics, or edited it, while the AI was thinking.
  const now = await vaultApps.getNote(space, id);
  if (!now) return;
  if (now.topicsBy === 'user' && !force) return;
  if (!force && now.updatedAt !== note.updatedAt) return; // edited since: the next pass looks again
  await vaultApps.putNote(space, nt.withNoteTopics(now, topics, 'ai', known));
  logger.info('Picked topics for a note', { id, topics });
}
