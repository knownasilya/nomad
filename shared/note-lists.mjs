// nomad/shared/note-lists.mjs
//
// Lists in Notes: a Note's task lines ("- [ ] milk") work like a shopping list.
//
// - Ticking an item moves it down, to the top of its list's done items, so what's left to get stays
//   together at the top. Unticking moves it back up, to the end of the open items (planTick).
// - "Clear done" removes every ticked item (clearDoneChanges).
// - In a shared Space (ADR-0029) the Note records who ticked each item and when: `ticks` on the Note
//   record, keyed by the item's words (tickKey). Setting a tick doesn't change updatedAt, the way
//   topics don't (ADR-0035), so it never turns another person's edit into a conflict copy. Every save
//   keeps the ticks of items that are still ticked (keepTicks, from makeNote).
//
//   { type: 'nomad/note', id, body, …, ticks: { 'milk': { by: 'Sam', at: '2026-11-05T17:42:00.000Z' } } }
//
// The editor changes are CodeMirror change specs ({ from, to, insert } in the text as it was), so a
// live Note (ADR-0041) moves one item instead of retyping the whole text. Shared by desktop
// (nomad://notes) and the phone (its editor page, and mobile/backend/lib/vault-apps.mjs). Pure.

// "- [ ] text", "* [x] text", "  + [X] text": the indent, the mark and the item's words.
const TASK = /^(\s*)[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;

export const MAX_TICKS = 300; // per Note
export const MAX_TICK_NAME = 60;

// One task line: { indent, checked, text }, or null for any other line.
export function parseTask(line) {
  const m = TASK.exec(String(line ?? ''));
  if (!m) return null;
  return { indent: m[1].length, checked: m[2] !== ' ', text: (m[3] || '').trim() };
}

// The words a tick is filed under: the item's text, lowercased, spaces squeezed. '' for no words.
export function tickKey(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

// The text as lines, each with its offset.
function linesOf(text) {
  const out = [];
  let from = 0;
  for (const line of String(text ?? '').split('\n')) {
    out.push({ from, text: line });
    from += line.length + 1;
  }
  return out;
}

const indentOf = (line) => /^\s*/.exec(line)[0].length;

// The items of the list that line `n` is in: consecutive task lines at its indent, each with the
// lines indented under it. [{ start, end, task }] with `end` exclusive, as line indexes.
function listAround(lines, n) {
  const task = parseTask(lines[n]?.text);
  if (!task) return null;
  const at = task.indent;
  // Where an item that starts at line `i` ends: after the lines indented deeper than it.
  const itemEnd = (i) => {
    let j = i + 1;
    while (j < lines.length && lines[j].text.trim() && indentOf(lines[j].text) > at) j++;
    return j;
  };
  // Back to the first item of the list.
  let first = n;
  for (let i = n - 1; i >= 0; i--) {
    const t = lines[i].text;
    if (!t.trim()) break;
    const p = parseTask(t);
    if (p && p.indent === at) {
      first = i;
      continue;
    }
    if (indentOf(t) > at) continue; // a child of the item above
    break;
  }
  const items = [];
  for (let i = first; i < lines.length; ) {
    const p = parseTask(lines[i].text);
    if (!p || p.indent !== at) break;
    const end = itemEnd(i);
    items.push({ start: i, end, task: p });
    i = end;
  }
  return items;
}

// The change that ticks (or unticks) the task on the line starting at offset `lineFrom`, and moves
// it within its list: { changes, checked, text } with the item's words, or null when that line isn't
// a task. Two changes at most (take the item out, put it back elsewhere), so the lines it passes
// over aren't retyped.
export function planTick(doc, lineFrom) {
  const text = String(doc ?? '');
  const lines = linesOf(text);
  const n = lines.findIndex((l) => l.from === lineFrom);
  if (n === -1) return null;
  const task = parseTask(lines[n].text);
  if (!task) return null;
  const checked = !task.checked;
  const markAt = lines[n].from + lines[n].text.indexOf('[') + 1;
  const toggle = { from: markAt, to: markAt + 1, insert: checked ? 'x' : ' ' };
  const done = { changes: [toggle], checked, text: task.text };

  const items = listAround(lines, n);
  const i = items.findIndex((it) => it.start === n);
  const others = items.filter((_, k) => k !== i);
  // Ticked: to the top of the done items. Unticked: to the end of the open ones. Either way, in
  // front of the first done item among the others, or last when there is none.
  const firstDone = others.findIndex((it) => it.task.checked);
  const at = firstDone === -1 ? others.length : firstDone;
  if (at === i) return done; // already there

  const from = (it) => lines[it.start].from;
  const to = (it) => lines[it.end - 1].from + lines[it.end - 1].text.length;
  const item = items[i];
  const body = text.slice(from(item), markAt) + toggle.insert + text.slice(markAt + 1, to(item));
  const last = i === items.length - 1;
  const remove = last
    ? { from: to(items[i - 1]), to: to(item), insert: '' } // the newline before it, and it
    : { from: from(item), to: from(items[i + 1]), insert: '' }; // it, and the newline after it
  const put =
    at === others.length
      ? { from: to(others[others.length - 1]), to: to(others[others.length - 1]), insert: '\n' + body }
      : { from: from(others[at]), to: from(others[at]), insert: body + '\n' };
  return { changes: [remove, put], checked, text: task.text };
}

// The changes that remove every ticked item (with the lines indented under it). [] when none.
export function clearDoneChanges(doc) {
  const text = String(doc ?? '');
  const lines = linesOf(text);
  const ranges = [];
  for (let i = 0; i < lines.length; ) {
    const p = parseTask(lines[i].text);
    if (!p || !p.checked) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < lines.length && lines[end].text.trim() && indentOf(lines[end].text) > p.indent) end++;
    const to = end < lines.length ? lines[end].from : text.length;
    const prev = ranges[ranges.length - 1];
    if (prev && prev.to === lines[i].from) prev.to = to;
    else ranges.push({ from: lines[i].from, to, insert: '' });
    i = end;
  }
  // Items that end the text take the newline before them, so no empty line is left behind.
  const last = ranges[ranges.length - 1];
  if (last && last.to === text.length && last.from > 0 && !text.endsWith('\n')) last.from -= 1;
  return ranges;
}

// Apply change specs (in the text as it was) to a string, the way CodeMirror does.
export function applyChanges(doc, changes) {
  let text = String(doc ?? '');
  const sorted = [...(changes || [])].map((c, i) => ({ ...c, i })).sort((a, b) => b.from - a.from || b.i - a.i);
  for (const c of sorted) text = text.slice(0, c.from) + (c.insert || '') + text.slice(c.to ?? c.from);
  return text;
}

// How many items are ticked.
export function doneCount(doc) {
  let n = 0;
  for (const line of String(doc ?? '').split('\n')) if (parseTask(line)?.checked) n++;
  return n;
}

// The words of every ticked item, as tick keys.
export function doneKeys(doc) {
  const keys = new Set();
  for (const line of String(doc ?? '').split('\n')) {
    const p = parseTask(line);
    if (p?.checked) {
      const k = tickKey(p.text);
      if (k) keys.add(k);
    }
  }
  return keys;
}

function isTick(t) {
  return !!t && typeof t === 'object' && typeof t.by === 'string' && typeof t.at === 'string';
}

// The ticks of items that `body` still has ticked; null when none are left.
export function keepTicks(ticks, body) {
  if (!ticks || typeof ticks !== 'object') return null;
  const done = doneKeys(body);
  const out = {};
  let n = 0;
  for (const [k, t] of Object.entries(ticks)) {
    if (n >= MAX_TICKS) break;
    if (done.has(k) && isTick(t)) {
      out[k] = { by: t.by, at: t.at };
      n++;
    }
  }
  return n ? out : null;
}

// The Note with one item's tick set (ticked) or taken off (unticked). `by` is the person's name in
// the Space. The text isn't checked here: the tick may arrive before the save that ticks it.
export function withTick(note, { text, checked, by }, now = new Date().toISOString()) {
  const key = tickKey(text);
  const ticks = { ...(note?.ticks && typeof note.ticks === 'object' ? note.ticks : {}) };
  if (key) {
    if (checked) ticks[key] = { by: String(by || 'Someone').slice(0, MAX_TICK_NAME), at: now };
    else delete ticks[key];
  }
  const entries = Object.entries(ticks)
    .filter(([, t]) => isTick(t))
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, MAX_TICKS);
  const next = { ...note };
  if (entries.length) next.ticks = Object.fromEntries(entries);
  else delete next.ticks;
  return next;
}

// The tick to show beside an item's words, or null.
export function tickFor(ticks, text) {
  const t = ticks && typeof ticks === 'object' ? ticks[tickKey(text)] : null;
  return isTick(t) ? t : null;
}

// A list shown outside the editor (the home page's HomeList, shared/home-dashboard.mjs)
// =
//
// The home page ticks and adds items by their words, not by where they are, because the Note may
// have changed since the page loaded it: the change is planned again on the Note as it is now.

export const MAX_ITEM = 200;

// Every task line with words, in order: [{ text, checked, indent }].
export function taskItems(doc) {
  const out = [];
  for (const line of String(doc ?? '').split('\n')) {
    const p = parseTask(line);
    if (p && p.text) out.push(p);
  }
  return out;
}

// Where the first task line with these words (and, when `checked` is given, that state) starts, or
// -1. Words match the way ticks are filed (tickKey).
export function findTaskLine(doc, text, checked = undefined) {
  const key = tickKey(text);
  if (!key) return -1;
  for (const { from, text: line } of linesOf(doc)) {
    const p = parseTask(line);
    if (p && tickKey(p.text) === key && (checked === undefined || p.checked === checked)) return from;
  }
  return -1;
}

// The change that adds an open item with these words: after the last open item of the Note's first
// list (so it lands among what's left to do, above the done ones), or into an empty item that is
// waiting for words ("- [ ] "), or at the end of the Note. Null for no words.
export function addItemChange(doc, text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM);
  if (!words) return null;
  const body = String(doc ?? '');
  const lines = linesOf(body);
  const first = lines.findIndex((l) => parseTask(l.text));
  if (first === -1) {
    const sep = !body ? '' : body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
    return { from: body.length, to: body.length, insert: `${sep}- [ ] ${words}\n` };
  }
  const items = listAround(lines, first);
  const at = items[0].task.indent;
  const pad = ' '.repeat(at);
  const empty = items.find((it) => !it.task.checked && !it.task.text);
  if (empty) {
    const l = lines[empty.start];
    return { from: l.from, to: l.from + l.text.length, insert: `${pad}- [ ] ${words}` };
  }
  const open = items.filter((it) => !it.task.checked);
  if (!open.length) {
    const l = lines[items[0].start];
    return { from: l.from, to: l.from, insert: `${pad}- [ ] ${words}\n` };
  }
  const last = open[open.length - 1];
  const end = lines[last.end - 1];
  const to = end.from + end.text.length;
  return { from: to, to, insert: `\n${pad}- [ ] ${words}` };
}
