// The terminal's command line: readline's editing keys, splitting a line into commands, and the
// word under the caret. Pure (no DOM, no nomad.*), so tests/unit/webterm.test.js runs them.

// The line's state: its text and the selection (start === end is a caret).
// Every edit returns a new { value, start, end }.

const isSpace = (c) => c === ' ' || c === '\t';

// Ctrl+W, Alt+Backspace: the word before the caret, and the spaces after it.
export function deleteWordBack({ value, start, end }) {
  if (start !== end) return { value: value.slice(0, start) + value.slice(end), start, end: start };
  let i = start;
  while (i > 0 && isSpace(value[i - 1])) i--;
  while (i > 0 && !isSpace(value[i - 1]) && value[i - 1] !== '/') i--;
  // A run of slashes goes as one word, so `cd a/b/` then Ctrl+W leaves `cd a/`.
  if (i === start) while (i > 0 && value[i - 1] === '/') i--;
  return { value: value.slice(0, i) + value.slice(start), start: i, end: i };
}

// Alt+D: the word after the caret.
export function deleteWordForward({ value, start, end }) {
  if (start !== end) return { value: value.slice(0, start) + value.slice(end), start, end: start };
  let i = end;
  while (i < value.length && isSpace(value[i])) i++;
  while (i < value.length && !isSpace(value[i])) i++;
  return { value: value.slice(0, start) + value.slice(i), start, end: start };
}

// Ctrl+U: everything before the caret.
export function deleteToStart({ value, end }) {
  return { value: value.slice(end), start: 0, end: 0 };
}

// Ctrl+K: everything after the caret.
export function deleteToEnd({ value, start }) {
  return { value: value.slice(0, start), start, end: start };
}

// Alt+B / Alt+F: the caret one word back or forward.
export function wordLeft(value, at) {
  let i = at;
  while (i > 0 && isSpace(value[i - 1])) i--;
  while (i > 0 && !isSpace(value[i - 1])) i--;
  return i;
}

export function wordRight(value, at) {
  let i = at;
  while (i < value.length && isSpace(value[i])) i++;
  while (i < value.length && !isSpace(value[i])) i++;
  return i;
}

// Splits a line on `;` and `&&` outside quotes: [{ line, and }], where `and` says the command runs
// only when the one before it worked. A backslash keeps the next character as it is.
export function splitCommands(input) {
  const out = [];
  let cur = '';
  let quote = null;
  let and = false;
  const push = (nextAnd) => {
    if (cur.trim()) out.push({ line: cur.trim(), and });
    cur = '';
    and = nextAnd;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && i + 1 < input.length) {
      cur += c + input[i + 1];
      i++;
    } else if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';') {
      push(false);
    } else if (c === '&' && input[i + 1] === '&') {
      push(true);
      i++;
    } else {
      cur += c;
    }
  }
  push(false);
  return out;
}

// `cmd args > path` or `>> path` (outside quotes, at the end): { line, redirect: { path, append } }.
export function splitRedirect(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      i++;
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      const append = line[i + 1] === '>';
      const path = unquote(line.slice(i + (append ? 2 : 1)).trim());
      if (!path) throw new Error('Write the output where? Add a file after >, like `ls > files.txt`');
      return { line: line.slice(0, i).trim(), redirect: { path, append } };
    }
  }
  return { line, redirect: null };
}

function unquote(s) {
  if (s.length > 1 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) return s.slice(1, -1);
  return s.replace(/\\(.)/g, '$1');
}

// The word the caret is in (or right after): { start, end, word, index } where `index` is which
// word of the line it is (0 is the command). Quotes and escaped spaces stay inside a word.
export function wordAt(value, caret) {
  const words = [];
  let quote = null;
  let start = null;
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (i === value.length || (!quote && isSpace(c))) {
      if (start != null) words.push({ start, end: i });
      start = null;
      continue;
    }
    if (start == null) start = i;
    if (c === '\\') {
      i++;
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    }
  }
  let index = words.findIndex((w) => caret >= w.start && caret <= w.end);
  if (index === -1) {
    // Between words, or after the last one: a new, empty word there.
    index = words.filter((w) => w.end < caret).length;
    return { start: caret, end: caret, word: '', index, words: words.map((w) => value.slice(w.start, w.end)) };
  }
  const w = words[index];
  return {
    start: w.start,
    end: w.end,
    word: value.slice(w.start, caret),
    index,
    words: words.map((x) => value.slice(x.start, x.end)),
  };
}

// The longest start every name shares.
export function commonPrefix(names) {
  if (!names.length) return '';
  let p = names[0];
  for (const n of names) {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    p = p.slice(0, i);
  }
  return p;
}

// A word with its spaces escaped, to put back in the line.
export const escapeWord = (s) => String(s).replace(/([ "'\\])/g, '\\$1');

// How far apart two words are (Levenshtein), for "Did you mean…?".
export function distance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// The closest names to a mistyped one, best first (at most `max`).
export function closest(word, names, max = 3) {
  const w = String(word || '').toLowerCase();
  if (!w) return [];
  const limit = Math.max(1, Math.floor(w.length / 3) + 1);
  return names
    .map((name) => ({ name, d: name.startsWith(w) ? 0 : distance(w, name.toLowerCase()) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || a.name.length - b.name.length)
    .slice(0, max)
    .map((x) => x.name);
}
