// nomad/shared/note-diff.mjs
//
// Text edits between two versions of a Note, for live editing (ADR-0041). Pure: no imports, no
// globals, so it also loads on the phone's Bare worklet.
//
//   diffEdits(a, b)               the edits that turn `a` into `b`: [{ from, to, insert }], in `a`'s
//                                 positions, ascending and apart. A line diff first, then each changed
//                                 run of lines is trimmed to the characters that differ, so a changed
//                                 word is one small edit, not a rewritten paragraph.
//   rebaseEdits(base, edits, now) the same edits moved onto `now`, a later version of `base` that
//                                 someone else changed meanwhile; null when the two touch the same text.
//   applyEdits(text, edits)       `text` with the edits made.
//
// The live session uses these to put a whole-body write (the AI's writeNote, an older app or the
// phone saving the record) into the shared document as edits, so it merges with what others are
// typing instead of replacing it.

// Above this many line pairs the line diff is skipped and the middle is one edit.
const MAX_LINE_PAIRS = 4_000_000;

function splitLines(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

// The edit from a[from..to) to `insert`, without the characters both ends share.
function trimEdit(a, from, to, insert) {
  const old = a.slice(from, to);
  let p = 0;
  const max = Math.min(old.length, insert.length);
  while (p < max && old.charCodeAt(p) === insert.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    old.charCodeAt(old.length - 1 - s) === insert.charCodeAt(insert.length - 1 - s)
  )
    s++;
  return { from: from + p, to: to - s, insert: insert.slice(p, insert.length - s) };
}

/** @returns {{ from: number, to: number, insert: string }[]} */
export function diffEdits(a, b) {
  a = String(a ?? '');
  b = String(b ?? '');
  if (a === b) return [];
  // The shared start and end, by whole lines, so the line diff runs on the middle only.
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  pre = a.lastIndexOf('\n', pre - 1) + 1; // back to a line start
  let suf = 0;
  while (suf < max - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf))
    suf++;
  // Forward to just after a newline, so the middle ends on whole lines.
  while (suf > 0 && a.charCodeAt(a.length - suf - 1) !== 10) suf--;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const la = splitLines(am);
  const lb = splitLines(bm);
  if (!la.length || !lb.length || la.length * lb.length > MAX_LINE_PAIRS) {
    const e = trimEdit(a, pre, a.length - suf, bm);
    return e.from === e.to && !e.insert ? [] : [e];
  }
  // Longest common subsequence of lines.
  const n = la.length;
  const m = lb.length;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        la[i] === lb[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const edits = [];
  let i = 0;
  let j = 0;
  let pos = pre; // where line i starts in `a`
  let hunk = null; // { from, to, insert } while lines differ
  const close = () => {
    if (!hunk) return;
    const e = trimEdit(a, hunk.from, hunk.to, hunk.insert);
    if (e.from !== e.to || e.insert) edits.push(e);
    hunk = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && la[i] === lb[j]) {
      close();
      pos += la[i].length;
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      hunk = hunk || { from: pos, to: pos, insert: '' };
      hunk.insert += lb[j];
      j++;
    } else {
      hunk = hunk || { from: pos, to: pos, insert: '' };
      pos += la[i].length;
      hunk.to = pos;
      i++;
    }
  }
  close();
  return edits;
}

export function applyEdits(text, edits) {
  let out = String(text ?? '');
  for (let k = edits.length - 1; k >= 0; k--) {
    const e = edits[k];
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
}

// Where position `p` of the text before `theirs` is after them. `theirs` are ascending and apart.
// Their insert right at `p` goes before `p` when `after` (the start of our edit), else after it.
function mapPos(p, theirs, after) {
  let shift = 0;
  for (const t of theirs) {
    const pointAtP = t.from === t.to && t.from === p;
    if (t.to <= p && (!pointAtP || after)) shift += t.insert.length - (t.to - t.from);
    else break;
  }
  return p + shift;
}

// Two edits touch the same text: their ranges overlap, or one inserts inside what the other replaces.
function touches(e, t) {
  if (e.from < t.to && t.from < e.to) return true;
  if (e.from === e.to && t.from < e.from && e.from < t.to) return true;
  if (t.from === t.to && e.from < t.from && t.from < e.to) return true;
  // Both insert at the same spot: the order would be a guess.
  if (e.from === e.to && t.from === t.to && e.from === t.from) return true;
  return false;
}

/** @returns {{ from: number, to: number, insert: string }[] | null} */
export function rebaseEdits(base, edits, now) {
  base = String(base ?? '');
  now = String(now ?? '');
  if (base === now) return edits.map((e) => ({ ...e }));
  const theirs = diffEdits(base, now);
  const out = [];
  for (const e of edits) {
    if (theirs.some((t) => touches(e, t))) return null;
    out.push({
      from: mapPos(e.from, theirs, true),
      to: mapPos(e.to, theirs, false),
      insert: e.insert,
    });
  }
  return out;
}
