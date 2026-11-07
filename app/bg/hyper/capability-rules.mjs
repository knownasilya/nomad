// Rules for capability URLs (nomad.capabilities): `hyper://<token>.cap/…` stands in for a drive, or
// for one file or folder in it, without naming the drive's key. Pure, no Electron, so it is
// unit-tested (tests/unit/capability-rules.test.js). The in-memory store and the file on disk are
// capabilities.js; nomad.fs (bg/web-apis/bg/fs.ts) and the serve path (bg/protocols/hyper.js) ask
// these rules before they read through one.
//
// A target is { key, version?, path, picked? }:
//   key     the drive's hex key (or a name a page gave, for a capability the page made itself)
//   version a drive version, or null for the latest
//   path    what it covers: '/' for the whole drive, '/notes/' for a folder and everything in it,
//           '/notes/a.md' for that one file
//   picked  true when the user chose it in the file picker (nomad.shell.selectFileDialog with
//           `capability: true`). Only a picked capability can reach the user's private drive, and
//           only picked ones are kept across restarts.

// Bytes of randomness in a token. 128 bits, so a page can't guess one that another site holds.
export const TOKEN_BYTES = 16;

// How many picked capabilities one site keeps. The oldest goes first.
export const MAX_PICKED_PER_ORIGIN = 200;

const CAP_HOST = /^([a-z0-9]+)\.cap$/i;

// Normalise a path: decoded, '/'-rooted, with no empty or '.' segments. A trailing '/' (folder) is
// kept. Returns null for anything we refuse to reason about (a '..' segment, a backslash, a NUL,
// bad percent-encoding), so it can never be covered.
export function normalizeDrivePath(raw) {
  if (typeof raw !== 'string') return null;
  let p;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (p.includes('\\') || p.includes('\0')) return null;
  const isFolder = p.endsWith('/');
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) return null;
  if (parts.length === 0) return '/';
  return '/' + parts.join('/') + (isFolder ? '/' : '');
}

// A folder ('/notes/') covers the folder itself and everything below it; '/' covers everything. A
// file covers that exact path only. Both paths must already be normalised.
export function pathCovers(scope, path) {
  if (!scope || !path) return false;
  if (scope === '/') return true;
  const p = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  if (scope.endsWith('/')) return p === scope.slice(0, -1) || p.startsWith(scope);
  return p === scope;
}

// The scope a picked file or folder gets: a folder ends in '/'.
export function scopeFor(path, isFolder) {
  const p = normalizeDrivePath(String(path || '/'));
  if (!p) return null;
  if (p === '/') return '/';
  const bare = p.endsWith('/') ? p.slice(0, -1) : p;
  return isFolder ? bare + '/' : bare;
}

// The token in a capability host or URL, or undefined.
export function capToken(hostOrUrl) {
  if (typeof hostOrUrl !== 'string') return undefined;
  let host = hostOrUrl.replace(/^hyper:\/\//i, '').split(/[/?#]/)[0];
  const plus = host.indexOf('+');
  if (plus !== -1) host = host.slice(0, plus);
  const m = CAP_HOST.exec(host);
  return m ? m[1].toLowerCase() : undefined;
}

// True when a target covers less than its whole drive.
export function isScoped(target) {
  return !!target && !!target.path && target.path !== '/';
}

// Whether a request for `rawPath` through this capability may go ahead.
export function capCovers(target, rawPath) {
  if (!target) return false;
  const path = normalizeDrivePath(rawPath || '/');
  if (!path) return false;
  return pathCovers(target.path || '/', path);
}

// The URL a page gets for a picked file or folder: the capability's host plus the item's own path,
// so relative links between the files it covers keep working.
export function capUrlFor(token, scope) {
  const path = !scope || scope === '/' ? '/' : scope;
  return `hyper://${token}.cap${path}`;
}

// What a page sees of one of its capabilities: never the drive's key.
export function publicCap(cap) {
  return {
    url: capUrlFor(cap.token, cap.target?.path),
    path: cap.target?.path || '/',
    picked: !!cap.picked,
    title: cap.title || '',
    createdAt: cap.createdAt || 0,
  };
}

const HEX_KEY = /^[0-9a-f]{64}$/i;
const TOKEN = /^[a-z0-9]{16,}$/;

// The picked capabilities worth keeping from the file on disk: well-formed, a real drive key, a
// scope we can reason about, at most MAX_PICKED_PER_ORIGIN per site (newest kept).
export function keptPicked(records) {
  if (!Array.isArray(records)) return [];
  const ok = records.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      TOKEN.test(String(r.token || '')) &&
      typeof r.owningOrigin === 'string' &&
      r.owningOrigin &&
      r.target &&
      HEX_KEY.test(String(r.target.key || '')) &&
      normalizeDrivePath(String(r.target.path || '')) === r.target.path
  );
  const byOrigin = new Map();
  for (const r of ok.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))) {
    const list = byOrigin.get(r.owningOrigin) || [];
    if (list.length < MAX_PICKED_PER_ORIGIN) list.push(r);
    byOrigin.set(r.owningOrigin, list);
  }
  return [...byOrigin.values()].flat().map((r) => ({
    token: String(r.token),
    owningOrigin: r.owningOrigin,
    target: { key: String(r.target.key).toLowerCase(), version: null, path: r.target.path },
    picked: true,
    title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
    driveTitle: typeof r.driveTitle === 'string' ? r.driveTitle.slice(0, 200) : '',
    createdAt: Number(r.createdAt) || 0,
  }));
}
