// @ts-nocheck
//
// Version history for nomad://versions: a drive's changes, an old version of one file, and restoring
// a file or the whole drive. The rules are shared/drive-history.mjs; this opens the drive's session
// and writes through it. Only Autobase drives (every drive made since ADR-0010) have a history to
// show; an old Hyperdrive answers null.

import b4a from 'b4a';
import * as autobases from './autobases';
import { isKey } from '../../../shared/drive-writers.mjs';
import * as rules from '../../../shared/drive-history.mjs';

// Text files bigger than this aren't shown in the page; restoring still works.
const VIEW_MAX = 1024 * 1024;

async function sessionFor(key, { write = false } = {}) {
  if (!isKey(key) || !(await autobases.isKnownAutobase(key))) return null;
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  if (!sess) return null;
  await sess.base.update().catch(() => {});
  if (write && !sess.writable) throw new Error('Only a device that can edit this drive can restore it');
  return sess;
}

const appendTo = (sess) => async (ops) => {
  for (const op of ops) await sess.base.append(op);
  await sess.base.update();
};

// { title, writable, version, rows, before } for drive `key`, or null when it has no history to show.
export async function history(key, opts = {}) {
  const sess = await sessionFor(key);
  if (!sess) return null;
  const page = await rules.historyPage(sess.drive, {
    before: opts.before ?? null,
    limit: opts.limit,
    path: typeof opts.path === 'string' && opts.path.startsWith('/') ? opts.path : null,
  });
  const manifest = await autobases.readJson(sess, '/index.json').catch(() => null);
  const title = (manifest && typeof manifest.title === 'string' && manifest.title.trim()) || '';
  return { title, writable: !!sess.writable, version: sess.drive.version, ...page };
}

// One file as it was at `version`: { exists, size, text } with text only for a text file that isn't
// too big (null otherwise).
export async function fileAt(key, path, version) {
  const sess = await sessionFor(key);
  if (!sess) throw new Error('This drive has no version history');
  const rec = await rules.recordAt(sess.drive, path, version);
  if (!rec) return { exists: false, size: 0, text: null };
  const size = autobases.recordByteLength(rec);
  if (size > VIEW_MAX) return { exists: true, size, text: null };
  const buf = await autobases.resolveRecordContent(rec);
  const bytes = buf ? b4a.from(buf) : b4a.alloc(0);
  // Binary: a NUL byte in the first few KB.
  if (bytes.subarray(0, 8000).includes(0)) return { exists: true, size, text: null };
  return { exists: true, size, text: b4a.toString(bytes, 'utf8') };
}

export async function restoreFile(key, path, version) {
  const sess = await sessionFor(key, { write: true });
  if (!sess) throw new Error('This drive has no version history');
  const op = await rules.restoreFile(sess.drive, appendTo(sess), path, version);
  return { changed: !!op };
}

// What restoring the drive to `version` would change, without changing it.
export async function restorePreview(key, version) {
  const sess = await sessionFor(key);
  if (!sess) throw new Error('This drive has no version history');
  return rules.restoreSummary(await rules.restoreDiff(sess.drive, version));
}

export async function restoreDrive(key, version) {
  const sess = await sessionFor(key, { write: true });
  if (!sess) throw new Error('This drive has no version history');
  return rules.restoreDrive(sess.drive, appendTo(sess), version);
}
