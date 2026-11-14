// @ts-nocheck
//
// Search inside the user's own drives: the drives in a Space's library (the ones My Library lists),
// read file by file into an index kept in memory. The rules (which files, their text, the ranking)
// are shared/drive-search.mjs.
//
// The index for a drive is rebuilt only where it changed: each search compares the drive's view
// version with the one indexed, and then each file's mtime and size, so only new and changed files
// are read again. A file that can't be read in time (its bytes are on a peer that is away) is left
// out and tried on the next search. Only Autobase drives (every drive made since ADR-0010) are
// searched; an old Hyperdrive is counted in `skipped`.

import b4a from 'b4a';
import * as autobases from './autobases';
import * as spacesDb from '../dbs/spaces';
import { listDrivesForSpace } from '../filesystem/index';
import { isKey } from '../../../shared/drive-writers.mjs';
import {
  isSearchable,
  makeDoc,
  rankDocs,
  snippetFor,
  queryWords,
  MAX_FILES_PER_DRIVE,
} from '../../../shared/drive-search.mjs';

const FILE_TIMEOUT = 3000;
const SEARCH_BUDGET = 12000;
const PARALLEL = 4;

// key -> { version, title, docs: Map<path, doc> }
const indexes = new Map();

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(undefined), ms))]);

// The Space (id) whose root drive is `spaceKey`, or 1 (Personal).
export async function spaceIdForKey(spaceKey) {
  if (!spaceKey) return 1;
  for (const s of await spacesDb.list().catch(() => [])) {
    if (String(s.root_drive_url || '').includes(spaceKey)) return s.id;
  }
  return 1;
}

async function driveTitle(sess, key) {
  const manifest = await autobases.readJson(sess, '/index.json').catch(() => null);
  return (manifest && typeof manifest.title === 'string' && manifest.title.trim()) || `${key.slice(0, 6)}…`;
}

// Bring drive `key`'s index up to date. Returns it, or null for a drive that isn't an Autobase.
export async function indexDrive(key, { deadline = Date.now() + SEARCH_BUDGET } = {}) {
  if (!isKey(key) || !(await autobases.isKnownAutobase(key))) return null;
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  if (!sess) return null;
  await withTimeout(sess.base.update(), 2000);
  let idx = indexes.get(key);
  const version = sess.drive.version;
  if (idx && idx.version === version && !idx.missing) return idx;
  const docs = new Map();
  let missing = false;
  let count = 0;
  for await (const node of sess.drive.createReadStream()) {
    const path = typeof node.key === 'string' ? node.key : b4a.toString(node.key);
    const rec = node.value;
    const size = autobases.recordByteLength(rec);
    if (!rec || !isSearchable(path, size)) continue;
    if (++count > MAX_FILES_PER_DRIVE) break;
    const mtime = Number(rec.metadata?.mtime) || 0;
    const old = idx?.docs.get(path);
    if (old && old.mtime === mtime && old.size === size) {
      docs.set(path, old);
      continue;
    }
    if (Date.now() > deadline) {
      missing = true;
      continue;
    }
    const buf = await withTimeout(autobases.resolveRecordContent(rec).catch(() => null), FILE_TIMEOUT);
    if (buf === undefined || buf === null) {
      missing = true;
      continue;
    }
    docs.set(path, makeDoc({ path, text: b4a.toString(b4a.from(buf), 'utf8'), mtime, size }));
  }
  idx = { version, title: await driveTitle(sess, key), docs, missing };
  indexes.set(key, idx);
  return idx;
}

/**
 * Search `query` in the drives of Space `spaceId` (or only in `driveKeys`):
 * { results: [{ driveKey, driveTitle, url, path, title, snippet, mtime }], searched, skipped, partial }.
 */
export async function search(query, { spaceId = 1, driveKeys = null, limit = 50 } = {}) {
  const words = queryWords(query);
  const empty = { results: [], searched: 0, skipped: 0, partial: false };
  if (!words.length) return empty;
  let keys = driveKeys;
  if (!keys) {
    const list = await listDrivesForSpace(spaceId, { includeSystem: false }).catch(() => []);
    keys = list.map((d) => d.key).filter(isKey);
  }
  keys = [...new Set(keys)];
  const deadline = Date.now() + SEARCH_BUDGET;
  const found = [];
  let searched = 0;
  let skipped = 0;
  let partial = false;
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const idx = await withTimeout(indexDrive(key, { deadline }).catch(() => null), Math.max(0, deadline - Date.now()) + 500);
      if (idx === undefined) {
        partial = true;
        continue;
      }
      if (!idx) {
        skipped++;
        continue;
      }
      searched++;
      if (idx.missing) partial = true;
      for (const { doc, score } of rankDocs(idx.docs.values(), words, limit)) {
        found.push({ key, title: idx.title, doc, score });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, keys.length) }, worker));
  found.sort((a, b) => b.score - a.score || b.doc.mtime - a.doc.mtime);
  return {
    results: found.slice(0, limit).map(({ key, title, doc }) => ({
      driveKey: key,
      driveTitle: title,
      url: `hyper://${key}${doc.path}`,
      path: doc.path,
      title: doc.title,
      snippet: snippetFor(doc.body, words),
      mtime: doc.mtime,
    })),
    searched,
    skipped,
    partial,
  };
}
