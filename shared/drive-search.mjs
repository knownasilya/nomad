// Search inside the user's own drives (nomad://search's "In your drives", the AI's searchDrives):
// which files count, the text taken from each, and how matches rank. A search is words, as in Notes
// and Reader (app-stdlib/js/search-match.js): a file matches when its name, path, title or text has
// every word, in any order, ignoring case and accents.
//
// Pure. The index and the I/O are app/bg/hyper/drive-search.js. Tests:
// tests/unit/drive-search.test.js.

import { foldText, queryWords } from '../app/userland/app-stdlib/js/search-match.js';

export { queryWords };

// Text files only, and not big ones: a search reads every file it keeps.
export const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'html', 'htm', 'json', 'csv', 'tsv', 'xml', 'yml', 'yaml',
  'toml', 'ics', 'org', 'rst', 'tex', 'js', 'mjs', 'cjs', 'ts', 'css', 'svg', 'log',
]);
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_FILES_PER_DRIVE = 3000;
// The text a file keeps in the index.
const MAX_BODY = 64 * 1024;

const extOf = (path) => {
  const name = String(path || '').split('/').pop() || '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

// Whether a file is searched: a text file, not too big, and in no dot folder (/.data/, /.vault/,
// /.ai-chat/, …, where apps and Nomad keep their own records).
export function isSearchable(path, size = 0) {
  const p = String(path || '');
  if (!p.startsWith('/') || p.split('/').some((seg) => seg.startsWith('.'))) return false;
  if (!TEXT_EXT.has(extOf(p))) return false;
  return Number(size) <= MAX_FILE_BYTES;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// A file's words as plain text: an HTML or SVG page without its tags, scripts and styles.
export function plainText(path, text) {
  let s = String(text ?? '');
  const ext = extOf(path);
  if (ext === 'html' || ext === 'htm' || ext === 'svg' || ext === 'xml') {
    s = s
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ');
    s = decodeEntities(s);
  }
  return s.replace(/[ \t\f\v\r]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// A file's title: an HTML <title>, a Markdown first heading, a JSON record's `title`, or its name.
export function titleFor(path, text) {
  const s = String(text ?? '');
  const ext = extOf(path);
  let t = '';
  if (ext === 'html' || ext === 'htm') t = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] || '');
  else if (ext === 'md' || ext === 'markdown') t = /^#{1,3}\s+(.+)$/m.exec(s)?.[1] || '';
  else if (ext === 'json') {
    try {
      const v = JSON.parse(s);
      if (v && typeof v.title === 'string') t = v.title;
    } catch {}
  }
  t = t.replace(/\s+/g, ' ').trim().slice(0, 200);
  return t || String(path).split('/').pop() || String(path);
}

// What the index keeps for one file.
export function makeDoc({ path, text, mtime = 0, size = 0 }) {
  const body = plainText(path, text).slice(0, MAX_BODY);
  const title = titleFor(path, text);
  return {
    path,
    title,
    mtime: Number(mtime) || 0,
    size: Number(size) || 0,
    body,
    head: foldText(`${title}\n${path}`),
    folded: foldText(body),
  };
}

// The part of a file's text around the first searched word, on one line.
export function snippetFor(body, words, max = 160) {
  const s = String(body ?? '').replace(/\s+/g, ' ');
  if (!s) return '';
  const f = foldText(s);
  const hits = (words || []).map((w) => f.indexOf(w)).filter((n) => n !== -1);
  if (!hits.length) return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  // Folding can change the length (ß → ss), so the index is close, not exact; cut on a space.
  let from = Math.max(0, Math.min(...hits) - 40);
  if (from > 0) {
    const sp = s.indexOf(' ', from);
    if (sp !== -1 && sp < from + 20) from = sp + 1;
  }
  const more = from + max < s.length;
  const cut = s.slice(from, from + max - (more ? 1 : 0)).trim();
  return (from ? '…' : '') + cut + (more ? '…' : '');
}

/**
 * The docs that have every word, best first: [{ doc, score }]. A word in the title or path counts
 * more than one in the text; then the newest first.
 */
export function rankDocs(docs, words, limit = 50) {
  if (!words?.length) return [];
  const out = [];
  for (const doc of docs) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inHead = doc.head.includes(w);
      const inBody = doc.folded.includes(w);
      if (!inHead && !inBody) {
        ok = false;
        break;
      }
      score += inHead ? 3 : 1;
    }
    if (ok) out.push({ doc, score });
  }
  out.sort((a, b) => b.score - a.score || b.doc.mtime - a.doc.mtime);
  return out.slice(0, limit);
}
