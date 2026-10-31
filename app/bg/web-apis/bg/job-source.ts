// Reading an AI Job's drive source (ADR-0030): the job.js and job.md a Job runs from a drive
// (shared/jobs.mjs sourceFiles). Used when a Job is added from a drive (the AI's saveJob, My
// Library), by each run of a live source, and to see whether someone else's drive has a newer
// version than the Job's copy.

import b4a from 'b4a';
import fsAPI from './fs';
import * as names from '../../hyper/names';
import {
  checkSourceFiles,
  hashSource,
  normalizeWrites,
  sourceFiles,
} from '../../../../shared/jobs.mjs';

const READ_TIMEOUT_MS = 30_000;

// The internal caller for these reads: no page, no tab.
const ctx = { sender: { getURL: () => 'nomad://jobs/', getURLOrigin: () => 'nomad://jobs/' } };

async function readText(url) {
  try {
    const v = await fsAPI.readFile.call(ctx, url, { encoding: 'utf8', timeout: READ_TIMEOUT_MS });
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : b4a.toString(v);
  } catch {
    return null;
  }
}

// { url, live, module, prompt, title, hash } for a source URL, a drive's name, or hyper://<name>/.
// `live` is whether this Device can write the drive: the user's own drive, whose latest files each
// run reads. module and prompt are null when missing; it throws when both are, or the drive is out
// of reach.
export async function readJobSource(input: string, space: string | null = null) {
  const raw = String(input || '').trim();
  let url = raw;
  if (!/^hyper:\/\/[0-9a-z]{52,64}(\/|$)/i.test(raw)) {
    // A name: "digest", hyper://digest/ or hyper://digest/jobs/x.js.
    const m = /^(?:hyper:\/\/)?([^/?#]+)(\/.*)?$/i.exec(raw);
    if (!m) throw new Error('A Job’s source is a hyper:// drive URL');
    const target = names.resolveDrive(m[1], space);
    url = target.replace(/\/$/, '') + (m[2] || '/');
  }
  const files = sourceFiles(url);
  const [info, module, prompt]: any[] = await Promise.all([
    fsAPI.getInfo.call(ctx, files.drive, { timeout: READ_TIMEOUT_MS }).catch(() => null),
    readText(files.drive.slice(0, -1) + files.module),
    readText(files.drive.slice(0, -1) + files.prompt),
  ]);
  if (module == null && prompt == null) {
    throw new Error(
      info
        ? `${files.url} has no ${files.module.split('/').pop()} or ${files.prompt.split('/').pop()}`
        : `Couldn’t reach ${files.drive}. Is it online?`
    );
  }
  checkSourceFiles(module, prompt);
  const heading = /^#\s+(.+)$/m.exec(prompt || '');
  return {
    url: files.url,
    live: !!info?.writable,
    module,
    prompt,
    title: heading ? heading[1].trim() : info?.title || '',
    hash: hashSource(module, prompt),
  };
}

// A Job's `writes` as the AI or My Library gives them, with drive names resolved to their keys and
// each drive checked: a Job can only be given a drive this computer can write. Null for none.
export async function resolveJobWrites(input: any, space: string | null = null) {
  if (!input) return null;
  const drives = [];
  for (const d of Array.isArray(input.drives) ? input.drives : []) {
    const raw = typeof d === 'string' ? { url: d } : d || {};
    const given = String(raw.url || '').trim();
    const url = /^hyper:\/\/[0-9a-z]{52,64}(\/|$)/i.test(given)
      ? given
      : names.resolveDrive(given.replace(/^hyper:\/\//i, '').replace(/\/.*$/, ''), space);
    drives.push({ url, draft: !!raw.draft });
  }
  const writes = normalizeWrites({ ...input, drives });
  for (const d of writes?.drives || []) {
    const info: any = await fsAPI.getInfo.call(ctx, d.url, { timeout: READ_TIMEOUT_MS }).catch(() => null);
    if (info && !info.writable) {
      throw new Error(`This computer can’t write ${d.url}${info.title ? ` (${info.title})` : ''}, so a Job can’t either`);
    }
  }
  return writes;
}

// A drive's title for the user, or null.
export async function driveTitle(url: string) {
  const info: any = await fsAPI.getInfo.call(ctx, url, { timeout: 5000 }).catch(() => null);
  return info?.title || null;
}
