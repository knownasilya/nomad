// nomad/shared/vault-apps.mjs
//
// The records the built-in Reader and Notes keep in the Vault (ADR-0017), so every linked Device —
// the phone too — reads and writes the same data. Shared by desktop (app/bg/web-apis/bg/vault-apps.ts)
// and mobile (mobile/backend/lib/vault-apps.mjs). Pure: no imports, no I/O. Each side stores these as
// inline Vault control records with its own helpers. Layout: docs/multi-device-protocol.md §1.2.
//
//   /.vault/reader/<space>/follows/<host>.json   { url, addedAt }       one per subscribed Feed
//   /.vault/reader/<space>/read.json             { read: [postUrl] }    posts marked read
//   /.vault/reader/<space>/imported.json         { importedAt }         the Space's old file was copied in
//   /.vault/notes/<id>.json                      { type, id, body, createdAt, updatedAt, conflictOf? }
//
// <space> is the Space's Root Drive key (hex): each Space has its own subscriptions. Notes belong to
// the user. One record per Feed and per Note, so two Devices that change different ones never
// overwrite each other. The read marks are one record; writers merge into it (mergeReadState).
//
// A Note's body is Markdown. Its first line with text is its title. Notes link to each other the
// way Obsidian does: [[Title]], [[Title|shown text]], [[Title#Heading]], or a relative Markdown link
// [text](Title.md). A link names a title (or a note id); see makeResolver.

export const READER_PREFIX = '/.vault/reader/';
export const NOTES_PREFIX = '/.vault/notes/';

export const NOTE_TYPE = 'nomad/note';
// Every save appends the whole Note to the Vault's log, so keep Notes to text.
export const MAX_NOTE_LENGTH = 100000;

// Reader
// =

export function isSpaceKey(space) {
  return typeof space === 'string' && /^[0-9a-f]{64}$/.test(space);
}

function readerPrefix(space) {
  if (!isSpaceKey(space)) throw new Error('Not a Space key: ' + space);
  return READER_PREFIX + space + '/';
}

export const followsPrefix = (space) => readerPrefix(space) + 'follows/';
export const readPath = (space) => readerPrefix(space) + 'read.json';
export const importedPath = (space) => readerPrefix(space) + 'imported.json';

// The root URL of the Drive a URL points into ('hyper://<host>/'), or null. Takes a bare 64-hex key.
export function driveRoot(url) {
  if (!url) return null;
  let s = String(url).trim();
  if (!/^hyper:\/\//i.test(s)) {
    if (/^[0-9a-f]{64}$/i.test(s)) s = 'hyper://' + s;
    else return null;
  }
  try {
    const u = new URL(s);
    if (!u.host) return null;
    return 'hyper://' + u.host.toLowerCase() + '/';
  } catch {
    return null;
  }
}

export function followPath(space, url) {
  const root = driveRoot(url);
  if (!root) throw new Error('Enter a hyper:// address');
  return followsPrefix(space) + root.slice('hyper://'.length, -1) + '.json';
}

export function followRecord(url, now = new Date().toISOString()) {
  const root = driveRoot(url);
  if (!root) throw new Error('Enter a hyper:// address');
  return { url: root, addedAt: now };
}

// The Feed URLs in a list of follow records: valid, unique, oldest subscription first.
export function followUrls(records) {
  const out = [];
  const sorted = [...(records || [])].sort((a, b) => {
    const ka = (a && a.addedAt) || '';
    const kb = (b && b.addedAt) || '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  for (const rec of sorted) {
    const root = driveRoot(rec && rec.url);
    if (root && !out.includes(root)) out.push(root);
  }
  return out;
}

// The read marks after adding `add`. Drops the marks that can no longer matter: posts of Feeds no
// longer followed, and posts that are gone from a Feed that just loaded. `loaded` maps a Feed root
// URL to the post URLs it has now; a Feed missing from it (offline, failed) keeps all its marks.
export function mergeReadState(current, add, follows, loaded = {}) {
  const followed = new Set(follows || []);
  const posts = new Map(Object.entries(loaded || {}).map(([root, urls]) => [root, new Set(urls)]));
  const out = new Set();
  for (const url of [...(current || []), ...(add || [])]) {
    if (typeof url !== 'string') continue;
    const root = driveRoot(url);
    if (!root || !followed.has(root)) continue;
    const now = posts.get(root);
    if (now && !now.has(url)) continue;
    out.add(url);
  }
  return [...out].sort();
}

// Notes
// =

// Sorts by creation time, and is safe to use as a path segment.
export function newNoteId(now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
  return now.toString(36).padStart(9, '0') + '-' + tail;
}

export function isNoteId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

export function notePath(id) {
  if (!isNoteId(id)) throw new Error('Not a note id: ' + id);
  return NOTES_PREFIX + id + '.json';
}

// The Note record to store for a save. `prev` is the stored Note with that id, if any.
/** @param {{ id: string, body?: string, conflictOf?: string }} fields */
export function makeNote({ id, body, conflictOf }, prev = null, now = new Date().toISOString()) {
  if (!isNoteId(id)) throw new Error('Not a note id: ' + id);
  const text = typeof body === 'string' ? body : '';
  if (text.length > MAX_NOTE_LENGTH) {
    throw new Error(`This note is too long to save (over ${MAX_NOTE_LENGTH.toLocaleString('en-US')} characters)`);
  }
  const note = {
    type: NOTE_TYPE,
    id,
    body: text,
    createdAt: (prev && prev.createdAt) || now,
    updatedAt: now,
  };
  const of = conflictOf || (prev && prev.conflictOf);
  if (of) note.conflictOf = of;
  return note;
}

export function isNote(rec) {
  return !!rec && rec.type === NOTE_TYPE && isNoteId(rec.id) && typeof rec.body === 'string';
}

// True when the stored Note changed after the editor loaded the version at `baseUpdatedAt`: saving
// over it would lose another Device's edit. A save with no base (a new note) never conflicts.
export function isConflict(stored, baseUpdatedAt) {
  return !!stored && !!baseUpdatedAt && stored.updatedAt !== baseUpdatedAt;
}

// The body for the copy saved on a conflict: the same text, with "(conflict copy)" on the title
// line, so the copy is easy to spot and links keep pointing at the original.
export function conflictBody(body) {
  const lines = String(body || '').split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i === -1) return '(conflict copy)';
  lines[i] = lines[i].replace(/\s*$/, '') + ' (conflict copy)';
  return lines.join('\n');
}

// What saving `body` does, given the stored Note `prev` (null for a new one): { note, write }, the
// Note to hand back and whether to store it. When another Device saved since `baseUpdatedAt`, the
// edit becomes a conflict copy, a new Note with conflictOf. Both apps save through this.
export function planNoteSave({ id, body, baseUpdatedAt }, prev, now = new Date().toISOString()) {
  if (!id) return { note: makeNote({ id: newNoteId(), body }, null, now), write: true };
  if (isConflict(prev, baseUpdatedAt)) {
    if (prev.body === body) return { note: prev, write: false }; // the same text arrived both ways
    const copy = makeNote({ id: newNoteId(), body: conflictBody(body), conflictOf: id }, null, now);
    return { note: copy, write: true };
  }
  if (prev && prev.body === body) return { note: prev, write: false };
  return { note: makeNote({ id, body }, prev, now), write: true };
}

const MARK = /^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*)/;

// A Note's title is its first line with text, without Markdown heading, list, or quote marks.
export function noteTitle(body) {
  for (const raw of String(body || '').split('\n')) {
    const line = raw.replace(MARK, '').trim();
    if (line) return line.length > 80 ? line.slice(0, 79) + '…' : line;
  }
  return 'New note';
}

// A line's text without inline Markdown: emphasis, strikethrough and code marks go, a link shows its
// text.
function plainInline(line) {
  return line
    .replace(WIKILINK, (_, target, heading, shown) => shown || target)
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}

// The lines after the title, without Markdown marks, on one line, for a list preview.
export function noteSnippet(body, max = 140) {
  const lines = String(body || '').split('\n');
  const first = lines.findIndex((l) => l.trim());
  const rest = lines
    .slice(first + 1)
    .filter((l) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) // a rule, ---
    .map((l) => plainInline(l.replace(MARK, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
  return rest.length > max ? rest.slice(0, max - 1) + '…' : rest;
}

// Newest first.
export function sortNotes(notes) {
  return [...(notes || [])].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
  );
}

// Links
// =

// [[target]], [[target#heading]], [[target|text]], [[target#heading|text]]. Groups: target, heading,
// shown text. A target can't hold [ ] | # or a line break (Obsidian's rule for names).
export const WIKILINK = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;
// [text](href). hrefTarget decides whether the href names a note.
const MDLINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;

// The note a relative Markdown link href names ('Seed%20order.md', './Seed order.md', or an id),
// or null for anything that isn't a note link (a URL, '#anchor', '/path').
export function hrefTarget(href) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null;
  let s = href.replace(/#.*$/, '').replace(/^\.\//, '');
  try {
    s = decodeURIComponent(s);
  } catch {}
  s = s.replace(/\.md$/i, '').trim();
  return s && !s.includes('/') ? s : null;
}

// Every note link in a body, in order: { target, heading, text, from, to, kind } (from/to: offsets).
export function findLinks(body) {
  const text = String(body || '');
  const out = [];
  for (const m of text.matchAll(WIKILINK)) {
    out.push({ target: m[1].trim(), heading: m[2] || '', text: m[3] || '', from: m.index, to: m.index + m[0].length, kind: 'wiki' });
  }
  for (const m of text.matchAll(MDLINK)) {
    const target = hrefTarget(m[2]);
    if (target) out.push({ target, heading: '', text: m[1], from: m.index, to: m.index + m[0].length, kind: 'md' });
  }
  return out.sort((a, b) => a.from - b.from);
}

const linkKey = (s) => String(s || '').trim().toLowerCase();

// A function from a link target to the Note it names, or null. A target matches a title (ignoring
// case) and then an id. When two Notes share a title, the newest wins.
export function makeResolver(notes) {
  const byTitle = new Map();
  const byId = new Map();
  for (const n of sortNotes(notes)) {
    const k = linkKey(noteTitle(n.body));
    if (!byTitle.has(k)) byTitle.set(k, n);
    byId.set(n.id, n);
  }
  return (target) => byTitle.get(linkKey(target)) || byId.get(String(target || '').trim()) || null;
}

// The ids of the Notes a body links to, each once.
export function linkedIds(body, resolve) {
  const ids = [];
  for (const { target } of findLinks(body)) {
    const n = resolve(target);
    if (n && !ids.includes(n.id)) ids.push(n.id);
  }
  return ids;
}

// The body with links to the title `from` pointed at `to` instead. Keeps each link's heading and
// shown text. Used when a Note's title changes. Returns the body unchanged when there is nothing to do.
export function renameLinks(body, from, to) {
  const text = String(body || '');
  const old = linkKey(from);
  if (!old || !to || /[[\]|#\n]/.test(to) || old === linkKey(to)) return text;
  let out = text.replace(WIKILINK, (all, target, heading, shown) => {
    if (linkKey(target) !== old) return all;
    return '[[' + to + (heading != null ? '#' + heading : '') + (shown != null ? '|' + shown : '') + ']]';
  });
  out = out.replace(MDLINK, (all, shown, href) => {
    const target = hrefTarget(href);
    if (!target || linkKey(target) !== old) return all;
    const anchor = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    return '[' + shown + '](' + encodeURI(to) + '.md' + anchor + ')';
  });
  return out;
}

// What changing a Note's title from `from` to `to` rewrites: [{ note, body }] for every other Note
// that linked to it. Skips the rename when another Note still has the old title, since the links
// then still name that one.
export function linkRenames(notes, id, from, to) {
  const old = linkKey(from);
  if (!old || old === linkKey(to)) return [];
  if ((notes || []).some((n) => n.id !== id && linkKey(noteTitle(n.body)) === old)) return [];
  const out = [];
  for (const n of notes || []) {
    if (n.id === id) continue;
    const body = renameLinks(n.body, from, to);
    if (body !== n.body) out.push({ note: n, body });
  }
  return out;
}
