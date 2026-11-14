// The terminal's command history: what's kept, `!!` and friends, the suggestion as you type, and
// Ctrl+R. Pure (the list comes in and goes out), so tests/unit/webterm.test.js runs it.

export const HISTORY_MAX = 1000;

// The list after running `entry`: blank lines and lines that start with a space aren't kept (as in
// bash's ignorespace), and running the same line twice keeps it once.
export function addEntry(list, entry) {
  const line = String(entry || '');
  if (!line.trim() || /^\s/.test(line)) return list;
  const out = list.filter((x) => x !== line);
  out.push(line);
  return out.length > HISTORY_MAX ? out.slice(out.length - HISTORY_MAX) : out;
}

const lastArg = (line) => {
  const words = String(line || '').trim().split(/\s+/);
  return words.length > 1 ? words[words.length - 1] : '';
};

// `!!` the last line, `!$` its last word, `!n` line n of `history`, `!-n` n lines back, `!word`
// the newest line that starts with it. Returns { line, expanded }; an event that isn't there throws.
export function expandBang(line, list) {
  let expanded = false;
  const out = String(line).replace(/(^|\s)!(!|\$|-?\d+|[A-Za-z@?][\w./-]*)(?=\s|$)/g, (all, pre, ev) => {
    let hit;
    if (ev === '!') hit = list[list.length - 1];
    else if (ev === '$') hit = lastArg(list[list.length - 1]);
    else if (/^-\d+$/.test(ev)) hit = list[list.length + Number(ev)];
    else if (/^\d+$/.test(ev)) hit = list[Number(ev) - 1];
    else hit = [...list].reverse().find((x) => x.startsWith(ev));
    if (hit == null || hit === '') throw new Error(`!${ev}: no such command in your history`);
    expanded = true;
    return pre + hit;
  });
  return { line: out, expanded };
}

// The newest line that starts with what's typed, to show greyed after the caret (fish's
// autosuggestion). Only for a typed start, and only a longer line.
export function suggest(list, typed) {
  if (!typed || !typed.trim()) return '';
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].length > typed.length && list[i].startsWith(typed)) return list[i];
  }
  return '';
}

// Ctrl+R: the index of the newest line before `from` that has `query` in it, or -1.
export function searchBack(list, query, from = list.length) {
  const q = String(query || '').toLowerCase();
  for (let i = Math.min(from, list.length) - 1; i >= 0; i--) {
    if (!q || list[i].toLowerCase().includes(q)) return i;
  }
  return -1;
}

// Up and Down: like a shell, but when something is typed, only the lines that start with it.
export function step(list, { index, prefix }, dir) {
  let i = index;
  for (;;) {
    i += dir;
    if (i < 0) return null;
    if (i >= list.length) return { index: list.length, value: prefix };
    if (!prefix || list[i].startsWith(prefix)) return { index: i, value: list[i] };
  }
}
