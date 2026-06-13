// @ts-nocheck
import { basename } from 'path';
import * as hyperDns from '../hyper/dns';
import { joinPath } from '../../lib/strings';
import { HYPERDRIVE_HASH_REGEX } from '../../lib/const';
import * as auditLog from '../dbs/audit-log';

/**
 * @typedef {Object} FSQueryOpts
 * @prop {string|string[]} path
 * @prop {string} [type]        - 'file' | 'directory' (mounts removed in v11)
 * @prop {Object} [metadata]
 * @prop {string} [sort]        - 'name' | 'ctime' | 'mtime'
 * @prop {boolean} [reverse]
 * @prop {number} [limit]
 * @prop {number} [offset]
 *
 * @typedef {Object} FSQueryResult
 * @prop {string} type
 * @prop {string} path
 * @prop {string} url
 * @prop {Object} stat          - {metadata, size, ctime, mtime}
 * @prop {string} drive
 * @prop {Object} origin
 * @prop {string} origin.path
 * @prop {string} origin.drive
 * @prop {string} origin.url
 */

/**
 * Query a drive for entries matching path patterns.
 * Mount-based traversal is not supported in Hyperdrive v11.
 *
 * @param {Object} root - DriveSession object with .drive (Hyperdrive v11)
 * @param {FSQueryOpts} opts
 * @returns {Promise<FSQueryResult[]>}
 */
export async function query(root, opts) {
  if (!opts || !opts.path) throw new Error('The `path` parameter is required');
  if (
    !(typeof opts.path === 'string' ||
      (Array.isArray(opts.path) && opts.path.every((v) => typeof v === 'string')))
  ) {
    throw new Error('The `path` parameter must be a string or array of strings');
  }
  if (opts.metadata && typeof opts.metadata !== 'object') {
    throw new Error('The `metadata` parameter must be an object');
  }

  const patterns = Array.isArray(opts.path) ? opts.path : [opts.path];
  const driveUrl = root.url;

  // Collect all matching entries
  let results = [];
  for (const pattern of patterns) {
    const entries = await _expandPattern(root.drive, pattern, driveUrl);
    results = results.concat(entries);
  }

  // Deduplicate by path
  const seen = new Set();
  results = results.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  // Filter by type
  if (opts.type) {
    results = results.filter((r) => r.type === opts.type);
  }

  // Filter by metadata
  if (opts.metadata) {
    results = results.filter((r) => {
      const meta = r.stat?.metadata || {};
      for (const k in opts.metadata) {
        if (meta[k] !== opts.metadata[k]) return false;
      }
      return true;
    });
  }

  // Sort
  if (opts.sort === 'name') {
    results.sort((a, b) =>
      opts.reverse
        ? basename(b.path).toLowerCase().localeCompare(basename(a.path).toLowerCase())
        : basename(a.path).toLowerCase().localeCompare(basename(b.path).toLowerCase())
    );
  } else if (opts.sort === 'mtime') {
    results.sort((a, b) =>
      opts.reverse ? (b.stat?.mtime || 0) - (a.stat?.mtime || 0) : (a.stat?.mtime || 0) - (b.stat?.mtime || 0)
    );
  } else if (opts.sort === 'ctime') {
    results.sort((a, b) =>
      opts.reverse ? (b.stat?.ctime || 0) - (a.stat?.ctime || 0) : (a.stat?.ctime || 0) - (b.stat?.ctime || 0)
    );
  }

  // Paginate
  if (opts.offset && opts.limit) results = results.slice(opts.offset, opts.offset + opts.limit);
  else if (opts.offset) results = results.slice(opts.offset);
  else if (opts.limit) results = results.slice(0, opts.limit);

  return results;
}

// internal
// =

/**
 * Expand a path pattern (possibly with * globs) against a v11 drive.
 * Returns FSQueryResult[] for all matching entries.
 */
async function _expandPattern(drive, pattern, driveUrl) {
  const segments = pattern.split('/').filter((s, i) => i > 0 || s !== '');

  // Walk through segments, expanding globs at each level
  let candidates = [{ prefix: '/', depth: 0 }];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const newCandidates = [];

    for (const candidate of candidates) {
      if (seg.includes('*')) {
        // Glob: list this directory level and match
        const re = new RegExp(`^${seg.replace(/\*/g, '[^/]*')}$`, 'i');
        try {
          for await (const entry of drive.list(candidate.prefix, { recursive: false })) {
            const name = basename(entry.key);
            if (!re.test(name)) continue;
            const entryPath = (candidate.prefix.endsWith('/') ? candidate.prefix : candidate.prefix + '/') + name;
            if (isLast) {
              newCandidates.push({ prefix: entryPath, entry, isLeaf: true });
            } else {
              newCandidates.push({ prefix: entryPath, entry, isLeaf: false });
            }
          }
        } catch {}
      } else if (seg === '**') {
        // Recursive glob: include everything below
        try {
          for await (const entry of drive.list(candidate.prefix, { recursive: true })) {
            newCandidates.push({ prefix: entry.key, entry, isLeaf: true });
          }
        } catch {}
        break; // ** consumes all remaining segments
      } else {
        // Exact segment
        const exactPath = (candidate.prefix.endsWith('/') ? candidate.prefix : candidate.prefix + '/') + seg;
        const exactPathNorm = exactPath.replace(/\/+/g, '/');
        if (isLast) {
          const entry = await drive.entry(exactPathNorm).catch(() => null);
          if (entry) {
            newCandidates.push({ prefix: exactPathNorm, entry, isLeaf: true });
          } else {
            // Check if it's a directory (has children)
            let hasChildren = false;
            const dirPrefix = exactPathNorm.endsWith('/') ? exactPathNorm : exactPathNorm + '/';
            // eslint-disable-next-line no-unreachable-loop
            for await (const _ of drive.list(dirPrefix, { recursive: false })) {
              hasChildren = true;
              break;
            }
            if (hasChildren) {
              newCandidates.push({ prefix: exactPathNorm, entry: null, isLeaf: true, isDir: true });
            }
          }
        } else {
          newCandidates.push({ prefix: exactPathNorm, entry: null, isLeaf: false });
        }
      }
    }

    candidates = newCandidates;
  }

  // Convert candidates to results
  const results = [];
  for (const c of candidates) {
    if (!c.isLeaf) continue;
    const path = c.prefix;
    const entry = c.entry;
    const isDir = c.isDir || (entry && !entry.value?.blob);

    results.push({
      type: isDir ? 'directory' : 'file',
      path,
      url: joinPath(driveUrl, path),
      drive: driveUrl,
      stat: entry ? {
        size: entry.value?.blob?.byteLength || 0,
        metadata: entry.value?.metadata || {},
        mtime: 0,
        ctime: 0,
      } : {
        size: 0,
        metadata: {},
        mtime: 0,
        ctime: 0,
      },
      origin: {
        path,
        drive: driveUrl,
        url: joinPath(driveUrl, path),
      },
    });
  }

  return results;
}
