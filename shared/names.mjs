// nomad/shared/names.mjs
//
// Names: short words the user gives to drives, to apps inside a private drive, and to any URL. Typing
// a name in the URL bar, or opening hyper://<name>/ in a tab, goes to what it names; the AI can look
// names up and read or write a named drive. One set per user, kept in the Vault so every Device has it:
//
//   /.vault/names/<name>.json                    { name, url, title, auto?, createdAt, updatedAt }
//   /.vault/space-lib/<space>/names/<name>.json  the same record, a name only in that Space
//
// A Space's names (ADR-0029) work only in that Space's tabs. Where a Space's name and one of the
// user's own are the same word, the user's own wins (pickName), so a name in a Space someone shared
// can't take over a word the user already uses.
//
// `auto` marks a name the AI gave a site the user keeps coming back to (see "Auto-names" below).
// Saving the name again from the UI drops it: the name is the user's from then on.
//
// hyper://<name>/ is a shortcut, not a second address: a tab that opens it lands on the real URL, so
// a drive keeps one origin (its storage and permissions), and a web page can't probe your names by
// loading hyper://<name>/ itself. Pure: no imports. Used by app/bg/hyper/names.js and the AI tools.

export const NAMES_PREFIX = '/.vault/names/';

// Words that already mean something in a hyper:// host, or that would read as a command.
export const RESERVED_NAMES = ['private', 'localhost', 'nomad', 'about', 'new'];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Hosts Chromium reads as an IPv4 number, because hyper:// is a standard scheme: hyper://123/
// becomes hyper://0.0.0.123/ (and 0x1f, 0777 likewise) before a tab or link ever sees the name.
const NUMBER = /^(?:[0-9]+|0x[0-9a-f]*)$/;

// A name as the user might type it, tidied: lowercase, words joined by hyphens. A dot stays, so
// nameError can say why it isn't allowed instead of quietly making it a different name.
export function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
}

// A name to offer for a page with this title ("example.com" gives "example-com").
export function suggestName(title) {
  return normalizeName(String(title || '').replace(/\./g, ' '));
}

// Why a name can't be used, or null when it can. A name is a lowercase DNS label (letters, digits,
// hyphens, up to 63), so hyper://<name>/ is a valid address; it can't look like a drive key or a
// number. Dots are kept for later (DNS names such as blog.example.com, or names inside a Space), and
// a Device skips a record whose name it can't use (isNameRecord), so a later rule can allow them.
export function nameError(name) {
  if (!name) return 'Enter a name';
  if (/^[0-9a-f]{64}$/.test(name)) return 'That looks like a drive key';
  if (name.includes('.')) return 'Names can’t contain dots';
  if (!LABEL.test(name)) return 'Use lowercase letters, digits and hyphens (up to 63)';
  if (NUMBER.test(name)) return 'That reads as a number (an IP address). Add a letter';
  if (RESERVED_NAMES.includes(name)) return `“${name}” is reserved`;
  return null;
}

// Where a Space's names are (`space` a Space's Root Drive key), or the user's (`space` null).
export function namesPrefix(space = null) {
  if (!space) return NAMES_PREFIX;
  if (!/^[0-9a-f]{64}$/.test(space)) throw new Error('Not a Space key: ' + space);
  return '/.vault/space-lib/' + space + '/names/';
}

export function namePath(name, space = null) {
  const err = nameError(name);
  if (err) throw new Error(err);
  return namesPrefix(space) + name + '.json';
}

// The names one Space sees, A to Z: the user's own (`space: null`) and the Space's (`space`: its
// key). A Space's name that the user's own name hides is still listed, with `hidden: true`, so the
// UI can say why it doesn't work.
export function namesInSpace(own, spaceNames = [], space = null) {
  const mine = new Set(own.map((r) => r.name));
  return [
    ...own.map((r) => ({ ...r, space: null })),
    ...(space ? spaceNames.map((r) => ({ ...r, space, ...(mine.has(r.name) ? { hidden: true } : {}) })) : []),
  ].sort((a, b) => a.name.localeCompare(b.name) || (a.space ? 1 : 0) - (b.space ? 1 : 0));
}

// The record `name` means in a Space: the user's own, else the Space's. `lookup(name, space)`
// returns the stored record or null.
export function pickName(name, space, lookup) {
  return lookup(name, null) || (space ? lookup(name, space) : null) || null;
}

export function makeNameRecord({ name, url, title, auto }, prev = null, now = new Date().toISOString()) {
  namePath(name); // validates
  const target = String(url || '').trim();
  if (!/^(hyper|https?|nomad):\/\//i.test(target)) throw new Error('A name points to a hyper://, http(s):// or nomad:// address');
  return {
    name,
    url: target,
    title: String(title || '').trim().slice(0, 200),
    ...(auto ? { auto: true } : {}),
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

// The user's own name for the hyper:// page at `url`, for the location bar to show in place of the
// drive key: the record whose folder holds the page (the deepest one, when an app folder in a drive
// is named too). A name the AI gave (`auto`) doesn't count until the user keeps it. A version
// (hyper://<key>+12/) is the same drive. Null for other URLs, or when nothing the user named covers it.
export function approvedNameFor(url, records) {
  const m = /^hyper:\/\/([^/?#]+)/i.exec(String(url || '').trim());
  if (!m) return null;
  const page = nameTarget(String(url).trim().replace(m[0], 'hyper://' + m[1].replace(/\+[^/]*$/, '')));
  let best = null;
  for (const r of records || []) {
    if (!isNameRecord(r) || r.auto || !/^hyper:\/\//i.test(r.url)) continue;
    const target = nameTarget(r.url.replace(/[?#].*$/, ''));
    if (!page.startsWith(target)) continue;
    const longer = !best || target.length > best.target.length;
    if (longer || (target.length === best.target.length && r.name < best.r.name)) best = { r, target };
  }
  return best ? best.r : null;
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

// Auto-names
// =
//
// When the user keeps coming back to a site, the AI gives it a name from its title and description
// (app/bg/hyper/auto-names.js). These are the rules it follows.

// Visits, in different hours, before a site gets a name: "more than twice".
export const AUTO_NAME_MIN_VISITS = 3;

// The site a page belongs to: an http(s) origin, or a hyper:// drive's root. null for what isn't
// a site to name: nomad:// pages, hyper://private/, localhost, an intranet host, an IP address.
export function siteOf(url) {
  const m = /^(https?|hyper):\/\/([^/?#]+)/i.exec(String(url || '').trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(/^[^@]*@/, '');
  const hostname = host.replace(/:\d+$/, '');
  if (!hostname || hostname === 'localhost' || hostname.startsWith('[')) return null;
  if (/^\d+(\.\d+){3}$/.test(hostname)) return null;
  if (scheme === 'hyper') {
    if (hostname === 'private') return null;
    if (!/^[0-9a-f]{64}$/.test(hostname) && !hostname.includes('.')) return null; // a name, not a drive
    return `hyper://${hostname}/`;
  }
  if (!hostname.includes('.')) return null;
  return `${scheme}://${host}/`;
}

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// The words a site's auto-name must be made from. For a web site that's its own host, without
// "www" and the last label (docs.google.com gives docs, google): a page can't take "gmail" by
// putting it in its title, because its host doesn't spell it. A drive key spells nothing, so a
// drive's anchor is its title.
export function nameAnchors(site, title = '') {
  const m = /^[a-z]+:\/\/([^/:]+)/i.exec(String(site || ''));
  if (!m) return [];
  const host = m[1].toLowerCase();
  if (/^[0-9a-f]{64}$/.test(host)) return words(title).slice(0, 12);
  const labels = host.split('.');
  if (labels.length > 1) labels.pop();
  return labels.filter((l) => l !== 'www').flatMap(words);
}

function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

// Why `name` can't be a site's auto-name, or null when it can. On top of the usual rules: 2 to 24
// characters, starting with the first letter of an anchor word, and spelled from the anchor words'
// letters in order, read forwards or with the words reversed (gh from github, gdocs from
// docs.google, hn from Hacker News).
export function autoNameError(name, anchors) {
  const err = nameError(name);
  if (err) return err;
  if (name.length < 2 || name.length > 24) return 'An auto-name is 2 to 24 characters';
  const list = (anchors || []).filter(Boolean);
  if (!list.length) return 'Nothing to make a name from';
  const letters = name.replace(/-/g, '');
  if (!list.some((w) => w[0] === letters[0])) return 'Doesn’t start like the site';
  const fwd = list.join('');
  const rev = [...list].reverse().join('');
  if (!isSubsequence(letters, fwd) && !isSubsequence(letters, rev)) return 'Isn’t spelled from the site’s name';
  return null;
}

// The chat messages that ask the AI for a site's name. `description` and `heading` come from the
// page, so they are only hints: the reply is checked with autoNameError whatever it says.
export function autoNameMessages({ site, title, description, heading, anchors }) {
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const system = [
    'You give short names to web sites and drives the user visits often, like browser keywords.',
    'Reply with one name and nothing else: lowercase letters and digits, optionally two short parts joined by a hyphen, 2 to 24 characters.',
    'Spell the name only from letters of the given words, in order, starting with the first letter of one of them (gh from github, gdocs from docs google, hn from hacker news).',
    'Prefer what people already call the site. If no short name fits, reply: none',
  ].join('\n');
  const user = [
    `Site: ${site}`,
    title ? `Title: ${clip(title, 200)}` : '',
    heading ? `Heading: ${clip(heading, 200)}` : '',
    description ? `Description: ${clip(description, 400)}` : '',
    `Words: ${(anchors || []).join(' ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// The name in the AI's reply, checked against the site's anchors; null when there isn't a usable
// one. Tolerates a reasoning block, quotes, backticks, and "hyper://name/".
export function pickAutoName(reply, anchors) {
  const text = String(reply || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const line = (text.split('\n').find((l) => l.trim()) || '')
    .trim()
    .replace(/^(name|answer)\s*:\s*/i, '')
    .replace(/^hyper:\/\//i, '')
    .replace(/[`"'*.]/g, ' ')
    .replace(/\/+$/, '')
    .trim();
  if (!line || /^none\b/i.test(line)) return null;
  const name = normalizeName(line);
  return autoNameError(name, anchors) ? null : name;
}
