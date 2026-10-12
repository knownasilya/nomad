// nomad/shared/highlights.mjs
//
// Highlights: text the user marks on a web or hyper:// page, with an optional Note about it
// (ADR-0020). One set per user, kept in the Vault so every linked Device has them:
//
//   /.vault/highlights/<page>/<id>.json   { type, id, url, text, quote, title, noteId?, createdAt }
//
// `text` names the marked text with a text directive: the part of a link after '#:~:text=', the
// format Chromium uses to scroll to text and mark it ("Copy link to highlight"). So a link to a
// Highlight works in any Chromium browser, and Nomad finds the text again with the same rules.
// `url` is the page's address without its fragment. <page> is a short hash of it (pageKey), so a
// page's Highlights are one prefix to read. `noteId` names a Note (shared/vault-apps.mjs) the user
// wrote about the Highlight; that Note quotes the text and links back to it.
//
// Pure: no imports. Used by app/bg/ui/highlights.js and the webview preload.

export const HIGHLIGHTS_PREFIX = '/.vault/highlights/';
export const HIGHLIGHT_TYPE = 'nomad/highlight';

const PAGE_SCHEMES = ['http:', 'https:', 'hyper:'];
const MAX_DIRECTIVE_LENGTH = 4000;
const MAX_QUOTE = 500; // kept on the record, for a list of Highlights
const MAX_NOTE_QUOTE = 2000; // quoted in a new Note
const MAX_TITLE = 200;

// Pages
// =

// Query parameters that only say where a visit came from. A link shared with them is the same page.
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid)$/i;

// The page a URL shows, as Highlights key it: no fragment, no tracking parameters, and '(' and ')'
// unescaped, since a link in a Note escapes them (noteLinkUrl). Null for a page that can't have
// Highlights.
export function pageUrl(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (!PAGE_SCHEMES.includes(u.protocol) || !u.host) return null;
  u.hash = '';
  if (u.search) {
    // Filtered as written: URLSearchParams would re-encode the parameters that stay.
    const kept = u.search
      .slice(1)
      .split('&')
      .filter((part) => part && !TRACKING_PARAM.test(part.split('=')[0]));
    u.search = kept.length ? '?' + kept.join('&') : '';
  }
  return u.href.replace(/%28/gi, '(').replace(/%29/gi, ')');
}

// A short, stable name for a page, safe as a path segment (a 53-bit hash, as hex). Two pages that
// share one only share a prefix: each record also holds its page's url.
export function pageKey(url) {
  const page = pageUrl(url);
  if (!page) throw new Error('Highlights work on web and hyper:// pages');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < page.length; i++) {
    const ch = page.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export const highlightsPrefix = (url) => HIGHLIGHTS_PREFIX + pageKey(url) + '/';

export function highlightPath(url, id) {
  if (!isHighlightId(id)) throw new Error('Not a highlight id: ' + id);
  return highlightsPrefix(url) + id + '.json';
}

// Text directives
// =

// Escapes what a directive part can't hold as is ('-', ',' and '&' mark its parts), and '(' and ')'
// too, so the link fits in a Markdown link.
const encodePart = (s) =>
  encodeURIComponent(s).replace(
    /[-()!'*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );

// The directive for a fragment { textStart, textEnd?, prefix?, suffix? }:
// [prefix-,]textStart[,textEnd][,-suffix], each part escaped.
export function textDirective({ prefix = '', textStart = '', textEnd = '', suffix = '' } = {}) {
  if (!textStart) throw new Error('A text directive needs text');
  return (
    (prefix ? encodePart(prefix) + '-,' : '') +
    encodePart(textStart) +
    (textEnd ? ',' + encodePart(textEnd) : '') +
    (suffix ? ',-' + encodePart(suffix) : '')
  );
}

export function isTextDirective(text) {
  return typeof text === 'string' && text.length <= MAX_DIRECTIVE_LENGTH && /^[^\s#&]+$/.test(text);
}

// The URL without a ':~:' directive in its fragment. A fragment left empty goes too.
export function stripTextDirective(url) {
  const s = String(url || '');
  const hash = s.indexOf('#');
  if (hash === -1) return s;
  const at = s.indexOf(':~:', hash);
  if (at === -1) return s;
  const out = s.slice(0, at);
  return out.endsWith('#') ? out.slice(0, -1) : out;
}

// A link that opens the page and marks the text. Keeps the page's own fragment (a hash route still
// works): https://example.com/#intro:~:text=...
export function withTextDirective(url, text) {
  const base = stripTextDirective(url);
  return (base.includes('#') ? base : base + '#') + ':~:text=' + text;
}

// Records
// =

// Sorts by creation time, and is safe to use as a path segment.
export function newHighlightId(now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return now.toString(36).padStart(9, '0') + '-' + tail;
}

export function isHighlightId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

const clip = (s, max) => {
  const t = String(s || '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const oneLine = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

// The Highlight record to store. `prev` is the stored Highlight with that id, if any.
/** @param {{ id: string, url: string, text: string, quote?: string, title?: string, noteId?: string }} fields */
export function makeHighlight(
  { id, url, text, quote, title, noteId },
  prev = null,
  now = new Date().toISOString()
) {
  if (!isHighlightId(id)) throw new Error('Not a highlight id: ' + id);
  const page = pageUrl(url);
  if (!page) throw new Error('Highlights work on web and hyper:// pages');
  if (!isTextDirective(text)) throw new Error('Not a text directive');
  /** @type {any} */
  const rec = {
    type: HIGHLIGHT_TYPE,
    id,
    url: page,
    text,
    quote: clip(oneLine(quote), MAX_QUOTE),
    title: clip(oneLine(title), MAX_TITLE),
    createdAt: (prev && prev.createdAt) || now,
  };
  if (noteId) rec.noteId = noteId;
  return rec;
}

export function isHighlight(rec) {
  return (
    !!rec &&
    rec.type === HIGHLIGHT_TYPE &&
    isHighlightId(rec.id) &&
    typeof rec.url === 'string' &&
    isTextDirective(rec.text)
  );
}

// Oldest first, the order they were made.
export function sortHighlights(list) {
  return [...(list || [])].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );
}

// Notes
// =

// A URL as a Markdown link target: no spaces, brackets or parentheses to end it early.
export function noteLinkUrl(url) {
  return String(url || '').replace(
    /[\s()<>]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

// What to call the page in a Note's link: its host, or its title for a Drive (a key means nothing).
function sourceLabel(url, title) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  const label = !host || /^[0-9a-f]{64}$/i.test(host) ? oneLine(title) || 'Source' : host;
  return label.replace(/[[\]]/g, '');
}

// The body of a new Note about a Highlight: the page's title, the quoted text, and a link that
// opens the page at the text. The user writes below it.
export function highlightNoteBody({ title, quote, link }) {
  const heading = oneLine(title) || 'Highlight';
  const lines = clip(String(quote || '').replace(/\r\n?/g, '\n'), MAX_NOTE_QUOTE)
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1])) // one empty line at most between paragraphs
    .map((l) => (l ? '> ' + l : '>'));
  return `# ${heading}\n\n${lines.join('\n')}\n\nFrom [${sourceLabel(link, title)}](${noteLinkUrl(link)})\n\n`;
}
