// nomad/shared/names.mjs
//
// Names: short words the user gives to drives, to apps inside a private drive, and to any URL. Typing
// a name in the URL bar, or opening hyper://<name>/ in a tab, goes to what it names; the AI can look
// names up and read or write a named drive. One set per user, kept in the Vault so every Device has it:
//
//   /.vault/names/<name>.json   { name, url, title, createdAt, updatedAt }
//
// hyper://<name>/ is a shortcut, not a second address: a tab that opens it lands on the real URL, so
// a drive keeps one origin (its storage and permissions), and a web page can't probe your names by
// loading hyper://<name>/ itself. Pure: no imports. Used by app/bg/hyper/names.js and the AI tools.

export const NAMES_PREFIX = '/.vault/names/';

// Words that already mean something in a hyper:// host, or that would read as a command.
export const RESERVED_NAMES = ['private', 'localhost', 'nomad', 'about', 'new'];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// A name as the user might type it, made into a valid one: lowercase, words joined by hyphens.
export function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
}

// Why a name can't be used, or null when it can. A name is a lowercase DNS label (letters, digits,
// hyphens, up to 63), so hyper://<name>/ is a valid address; it can't look like a drive key.
export function nameError(name) {
  if (!name) return 'Enter a name';
  if (/^[0-9a-f]{64}$/.test(name)) return 'That looks like a drive key';
  if (!LABEL.test(name)) return 'Use lowercase letters, digits and hyphens (up to 63)';
  if (RESERVED_NAMES.includes(name)) return `“${name}” is reserved`;
  return null;
}

export function namePath(name) {
  const err = nameError(name);
  if (err) throw new Error(err);
  return NAMES_PREFIX + name + '.json';
}

export function makeNameRecord({ name, url, title }, prev = null, now = new Date().toISOString()) {
  namePath(name); // validates
  const target = String(url || '').trim();
  if (!/^(hyper|https?|nomad):\/\//i.test(target)) throw new Error('A name points to a hyper://, http(s):// or nomad:// address');
  return {
    name,
    url: target,
    title: String(title || '').trim().slice(0, 200),
    createdAt: (prev && prev.createdAt) || now,
    updatedAt: now,
  };
}

export function isNameRecord(rec) {
  return !!rec && !nameError(rec.name) && typeof rec.url === 'string' && rec.url.length > 0;
}

// What naming the page at `url` should point to. In a hyper:// drive that's the folder (a page's file
// name is dropped, so hyper://<key>/index.html names the drive and .../apps/todo/index.html the app);
// any other URL is kept whole.
export function nameTarget(url) {
  const s = String(url || '').trim();
  const m = /^(hyper:\/\/[^/?#]+)(\/[^?#]*)?/i.exec(s);
  if (!m) return s;
  let path = m[2] || '/';
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (last.includes('.')) path = path.slice(0, path.length - last.length);
  if (!path.endsWith('/')) path += '/';
  return m[1].toLowerCase() + path;
}

// `target` with a path (and query, hash) from the short address appended: hyper://blog/posts/ with
// blog → hyper://<key>/ gives hyper://<key>/posts/.
export function joinTarget(target, path = '/', search = '', hash = '') {
  let out = target;
  if (path && path !== '/') {
    const base = target.replace(/[?#].*$/, '').replace(/\/+$/, '');
    out = base + path;
  }
  if (search && !/[?]/.test(out)) out += search;
  if (hash) out = out.replace(/#.*$/, '') + hash;
  return out;
}

// The URL hyper://<name>/… goes to, or null when `url` isn't a short address for a known name.
// `lookup(name)` returns the name's record or null.
export function resolveNamedUrl(url, lookup) {
  const m = /^hyper:\/\/([a-z0-9-]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(String(url || ''));
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (nameError(name)) return null; // drive keys, reserved words (private), and other hosts
  const rec = lookup(name);
  if (!rec) return null;
  return joinTarget(rec.url, m[2] || '/', m[3] || '', m[4] || '');
}

// The names that match what's typed in the URL bar, best first: the exact name, then names that
// start with it, then names or titles that contain it. "hyper://blog/" counts as "blog".
export function matchNames(query, records, limit = 5) {
  const q = String(query || '')
    .trim()
    .toLowerCase()
    .replace(/^hyper:\/\//, '')
    .replace(/\/.*$/, '');
  if (!q) return [];
  const scored = [];
  for (const r of records || []) {
    if (!isNameRecord(r)) continue;
    const title = (r.title || '').toLowerCase();
    const score = r.name === q ? 3 : r.name.startsWith(q) ? 2 : r.name.includes(q) || title.includes(q) ? 1 : 0;
    if (score) scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
  return scored.slice(0, limit).map((s) => s.r);
}
