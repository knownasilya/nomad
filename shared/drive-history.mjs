// Version history for a drive (an Autobase's linearised Hyperbee view, shared/fs-core.mjs): what
// changed, newest first, and putting back a file or the whole drive as it was at a point.
//
// The view keeps every change: `createHistoryStream` gives each put and delete with its `seq`, and
// `checkout(v)` reads the drive as it was at version v (a Hyperbee's version is its core length, so
// the state just after the change at `seq` is version seq + 1, and just before it is version seq).
// A restore never rewrites history. It appends ordinary puts and deletes, so it is one more change
// that syncs like any other, and can itself be undone. A put reuses the old record's blob pointer:
// blob cores are append-only, so the bytes are still there and nothing is copied.
//
// The functions take the view (and, to write, an `append(ops)`), so desktop runs them on a session
// (app/bg/hyper/drive-history.js) and tests run them on a plain Autobase. Tests:
// tests/unit/drive-history.test.js.

import { makeMetadata, WRITERS_PREFIX } from './fs-core.mjs';
import { INVITES_PREFIX } from './drive-invites.mjs';

// Records nobody edits by hand: writer records are made by the drive itself when someone is added
// (apply), and invite records are cancelled, not restored. History hides them and a restore leaves
// them as they are.
const HIDDEN = [WRITERS_PREFIX, INVITES_PREFIX];

export const isHiddenPath = (path) => HIDDEN.some((p) => String(path || '').startsWith(p));

export const HISTORY_PAGE = 50;
// How many changes one page reads at most while looking for rows (hidden ones, or other files when
// the history is for one file), so a page always answers.
const SCAN_LIMIT = 2000;

const keyOf = (k) => (typeof k === 'string' ? k : k == null ? '' : new TextDecoder().decode(k));

function sizeOf(rec) {
  if (!rec) return 0;
  if (rec.blob) return rec.blob.byteLength || 0;
  if (rec.value != null) return Math.floor((String(rec.value).length * 3) / 4);
  return 0;
}

const sameContent = (a, b) =>
  !!a &&
  !!b &&
  (a.value ?? null) === (b.value ?? null) &&
  JSON.stringify(a.blob ?? null) === JSON.stringify(b.blob ?? null) &&
  !!a.metadata?.executable === !!b.metadata?.executable;

/**
 * One page of a drive's changes, newest first:
 * { rows: [{ seq, path, kind: 'added'|'changed'|'deleted', at, size, restore }], before }.
 * `at` is the change's time (ms), or null for a delete, whose record carries none; `fillTimes`
 * gives it its neighbours'. `restore` is the version to restore the file from (the file as this row
 * left it, or, for a delete, as it was just before). `before` is the seq to pass for the next page,
 * or null at the start of the drive. `path` keeps only one file's changes.
 */
export async function historyPage(view, { before = null, limit = HISTORY_PAGE, path = null } = {}) {
  const max = Math.min(Math.max(Number(limit) || HISTORY_PAGE, 1), 200);
  const opts = { reverse: true, limit: SCAN_LIMIT };
  if (before != null) opts.lt = Number(before);
  const rows = [];
  let lastSeq = null;
  let scanned = 0;
  for await (const e of view.createHistoryStream(opts)) {
    scanned++;
    lastSeq = e.seq;
    const key = keyOf(e.key);
    if (isHiddenPath(key) || (path && key !== path)) continue;
    const prev = await view.checkout(e.seq).get(key).catch(() => null);
    if (e.type === 'del') {
      if (!prev) continue; // deleting what wasn't there changes nothing
      rows.push({ seq: e.seq, path: key, kind: 'deleted', at: null, size: sizeOf(prev.value), restore: e.seq });
    } else {
      const rec = e.value || {};
      if (prev && sameContent(prev.value, rec)) continue; // re-saved with the same content
      rows.push({
        seq: e.seq,
        path: key,
        kind: prev ? 'changed' : 'added',
        at: Number(rec.metadata?.mtime) || null,
        size: sizeOf(rec),
        restore: e.seq + 1,
      });
    }
    if (rows.length >= max) break;
  }
  // Ran out of history (seq 1 is the first change; 0 is the view's header) or the scan budget.
  const done = lastSeq == null || lastSeq <= 1 || (scanned < SCAN_LIMIT && rows.length < max);
  return { rows: fillTimes(rows), before: done ? null : lastSeq };
}

// A delete has no time of its own: give it the time of the next change after it, or else the one
// before it, marked `approx`.
export function fillTimes(rows) {
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].at != null) continue;
    let at = null;
    for (let j = i - 1; j >= 0 && at == null; j--) at = out[j].at;
    for (let j = i + 1; j < out.length && at == null; j++) at = out[j].at;
    if (at != null) {
      out[i].at = at;
      out[i].approx = true;
    }
  }
  return out;
}

// The record of `path` at `version`, or null.
export async function recordAt(view, path, version) {
  const node = await view.checkout(Number(version)).get(path);
  return node?.value || null;
}

// A put op that brings back `rec` as it was, as a new change made `now`.
export function putBack(path, rec, now = Date.now()) {
  return {
    op: 'put',
    path,
    metadata: makeMetadata({
      mtime: now,
      ctime: Number(rec.metadata?.ctime) || now,
      executable: !!rec.metadata?.executable,
    }),
    blob: rec.blob || null,
    value: rec.value != null ? rec.value : null,
  };
}

/**
 * What restoring the whole drive to `version` changes: [{ path, current, old }], where `current`
 * is the record today and `old` the one at `version` (null when it didn't exist), hidden records left out.
 */
export async function restoreDiff(view, version) {
  const out = [];
  for await (const d of view.createDiffStream(Number(version))) {
    const path = keyOf(d.left?.key ?? d.right?.key);
    if (isHiddenPath(path)) continue;
    const current = d.left?.value || null;
    const old = d.right?.value || null;
    if (current && old && sameContent(current, old)) continue;
    out.push({ path, current, old });
  }
  return out;
}

// The ops for a diff from restoreDiff.
export function restoreOps(diff, now = Date.now()) {
  return diff.map(({ path, old }) => (old ? putBack(path, old, now) : { op: 'del', path }));
}

// What a restore will do, for the page to show before it asks: counts and the first paths.
export function restoreSummary(diff, max = 20) {
  const changed = [];
  const back = [];
  const removed = [];
  for (const { path, current, old } of diff) {
    if (current && old) changed.push(path);
    else if (old) back.push(path);
    else removed.push(path);
  }
  return {
    total: diff.length,
    changed: changed.length,
    back: back.length,
    removed: removed.length,
    paths: [...changed, ...back, ...removed].slice(0, max),
  };
}

// Restore one file as it was at `version` (or delete it, when it didn't exist then). Returns the op
// appended, or null when the file is already that way.
export async function restoreFile(view, append, path, version, now = Date.now()) {
  if (isHiddenPath(path)) throw new Error('That record can’t be restored');
  const then = await recordAt(view, path, version);
  const cur = (await view.get(path))?.value || null;
  if (then ? sameContent(cur, then) : !cur) return null;
  const op = then ? putBack(path, then, now) : { op: 'del', path };
  await append([op]);
  return op;
}

// Restore the whole drive to `version`. Returns the summary of what changed.
export async function restoreDrive(view, append, version, now = Date.now()) {
  const diff = await restoreDiff(view, version);
  if (diff.length) await append(restoreOps(diff, now));
  return restoreSummary(diff);
}
