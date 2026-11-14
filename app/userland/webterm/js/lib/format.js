// Small formatting and matching rules for the terminal's commands. Pure, so
// tests/unit/webterm.test.js runs them.

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v;
  let u = -1;
  do {
    x /= 1024;
    u++;
  } while (x >= 1024 && u < units.length - 1);
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)} ${units[u]}`;
}

// "just now", "5 min ago", "3 h ago", "Yesterday 14:05", "Mar 3 14:05", "Mar 3 2024".
export function formatWhen(at, now = Date.now()) {
  const t = at instanceof Date ? at.getTime() : Number(at);
  if (!t) return '';
  const d = new Date(t);
  const diff = now - t;
  if (diff >= 0 && diff < 45_000) return 'just now';
  if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  const today = new Date(now);
  const sameDay = (x, y) =>
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, today)) return diff >= 0 && diff < 6 * 3_600_000 ? `${Math.round(diff / 3_600_000)} h ago` : hm;
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(d, yesterday)) return `Yesterday ${hm}`;
  const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (d.getFullYear() === today.getFullYear()) return `${md} ${hm}`;
  return `${md} ${d.getFullYear()}`;
}

// A shell glob (`*.md`, `post-?.html`, `{a,b}.js`) as a RegExp on a file name. A pattern without
// any glob character matches names that contain it, ignoring case.
export function globToRegExp(pattern) {
  const p = String(pattern || '');
  if (!/[*?[{]/.test(p)) return new RegExp(escapeRegExp(p), 'i');
  let re = '';
  let inBrace = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const close = p.indexOf(']', i + 1);
      if (close === -1) re += '\\[';
      else {
        re += '[' + p.slice(i + 1, close).replace(/\\/g, '\\\\') + ']';
        i = close;
      }
    } else if (c === '{') {
      inBrace = true;
      re += '(?:';
    } else if (c === '}' && inBrace) {
      inBrace = false;
      re += ')';
    } else if (c === ',' && inBrace) re += '|';
    else re += escapeRegExp(c);
  }
  return new RegExp(`^${re}$`, 'i');
}

export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Is this text (not binary)? A NUL in the first few KB means binary, as version history decides.
export const looksBinary = (text) => typeof text === 'string' && text.slice(0, 8000).includes('\u0000');

// The lines of `text` that match, with their numbers: [{ n, line, parts }] where `parts` splits the
// line around each match ([text, match, text, …]) so the terminal can mark them.
export function grepLines(text, re, { max = 200 } = {}) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i];
    re.lastIndex = 0;
    if (!re.test(line)) continue;
    const parts = [];
    let last = 0;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(line)) && parts.length < 40) {
      if (!m[0]) {
        g.lastIndex++;
        continue;
      }
      parts.push(line.slice(last, m.index), m[0]);
      last = m.index + m[0].length;
    }
    parts.push(line.slice(last));
    out.push({ n: i + 1, line, parts });
  }
  return out;
}

// What `grep` searches for: the words as typed (a literal), or a /regex/ when written so.
export function grepPattern(pattern, { ignoreCase = false } = {}) {
  const p = String(pattern || '');
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(p);
  if (m) return new RegExp(m[1], m[2].replace('g', '') + (ignoreCase && !m[2].includes('i') ? 'i' : ''));
  return new RegExp(escapeRegExp(p), ignoreCase ? 'i' : '');
}

// Text files the terminal reads for grep, by extension (the rest are skipped).
const TEXT_EXT =
  /\.(md|markdown|txt|html?|css|js|mjs|cjs|ts|tsx|jsx|json|xml|svg|csv|tsv|ya?ml|toml|ini|sh|py|rb|go|rs|java|c|h|cpp|hpp|lua|php|sql|vue|svelte|astro|mdx|log|env|gitignore|webmanifest)$/i;

export const isTextPath = (path) => TEXT_EXT.test(String(path || '')) || !/\.[^/]+$/.test(String(path || '').split('/').pop());
