// Live data for the home page's programs (ADR-0048 amendment, "Live cards"): the answer to each
// Query("source", {args}) in a card or a layout, read from the caller's own things in the caller's
// Space. The sources, their arguments and the shape of each result are shared/home-live.mjs; this
// is the reading. Callers: nomad.vault.homeQuery (nomad://desktop) and aiShell.liveQuery (the AI
// Sidebar, drawing a card before it is pinned). Both are trusted nomad:// senders, and the data
// goes to their screen only, never to the model.
//
// Every source only reads. A drive file is read through nomad.fs as the caller, so
// `hyper://private/` is the caller's Space's private drive, as on the page itself.

import b4a from 'b4a';
import fsAPI from './fs';
import * as vaultApps from './vault-apps';
import * as calendar from './calendar';
import * as jobs from '../../ai/jobs';
import * as live from '../../../../shared/home-live.mjs';
import { localWallTime, addDays } from '../../../../shared/calendar.mjs';

const DRIVE_TIMEOUT = 15e3;

// The newest answer per source and arguments for a moment, so a page with three cards on the
// calendar reads it once.
const recent = new Map(); // key -> { at, value: Promise }
const FRESH_MS = 5e3;

export async function query(ctx, source: string, args: any = {}) {
  const clean = live.liveArgs(String(source), args);
  const space = await vaultApps.spaceKey(ctx).catch(() => null);
  const key = JSON.stringify([space, source, clean]);
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value;
  const value = read(ctx, source, clean);
  recent.set(key, { at: Date.now(), value });
  value.catch(() => recent.delete(key));
  if (recent.size > 100) recent.delete(recent.keys().next().value);
  return value;
}

async function read(ctx, source: string, args: any) {
  switch (source) {
    case 'events': {
      const now = localWallTime();
      const today = now.slice(0, 10);
      const cal: any = await calendar.listCalendar(ctx, { from: today, to: addDays(today, args.days) });
      return live.eventsResult(cal?.occurrences || [], now, args);
    }
    case 'jobs':
      return live.jobsResult(jobs.list(), args);
    case 'jobRuns':
      return live.jobRunsResult(jobs.list(), jobs.allRuns(), args);
    case 'notes': {
      const res: any = await vaultApps.listNotes(ctx);
      return live.notesResult(res?.notes || [], args);
    }
    case 'driveFile':
      return readFile(ctx, args.url);
    case 'driveFolder': {
      const entries = await fsAPI.readdir.call(ctx, args.url, { includeStats: true, timeout: DRIVE_TIMEOUT, draft: false });
      return live.folderResult(args.url, entries, args);
    }
  }
  throw new Error('Unknown source');
}

async function readFile(ctx, url: string) {
  if (url.endsWith('/')) throw new Error('That is a folder: use driveFolder');
  let stat: any = null;
  try {
    stat = await fsAPI.stat.call(ctx, url, { timeout: DRIVE_TIMEOUT, draft: false });
  } catch {
    throw new Error('Couldn’t find that file. Is the drive online?');
  }
  if (live.isFolderStat(stat)) throw new Error('That is a folder: use driveFolder');
  if (Number(stat?.size) > live.MAX_FILE_BYTES) {
    throw new Error(`That file is ${live.sizeText(stat.size)}; a card reads up to ${live.sizeText(live.MAX_FILE_BYTES)}`);
  }
  const v = await fsAPI.readFile.call(ctx, url, { encoding: 'utf8', timeout: DRIVE_TIMEOUT, draft: false });
  const text = typeof v === 'string' ? v : v == null ? '' : b4a.toString(v);
  const mtime = Number(stat?.mtime) || Date.parse(stat?.mtime);
  return live.fileResult(url, text, { updated: Number.isFinite(mtime) && mtime > 0 ? new Date(mtime).toISOString() : null });
}
