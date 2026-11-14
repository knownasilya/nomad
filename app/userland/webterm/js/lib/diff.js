// A line diff for the terminal's `diff`: what changed between two texts, as unified hunks.
// Pure, so tests/unit/webterm.test.js runs it.

// Above this many lines times lines in the part that differs, the diff is given as one block
// (everything old out, everything new in) instead of a line-by-line match.
const MAX_CELLS = 4_000_000;

export function splitLines(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// [{ op: ' ' | '-' | '+', text, a?, b? }]: `a` and `b` are the line's numbers (from 1) in each text.
export function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ op: ' ', text: a[i], a: i + 1, b: i + 1 });
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const n = am.length;
  const m = bm.length;
  if (n * m > MAX_CELLS) {
    am.forEach((text, i) => ops.push({ op: '-', text, a: pre + i + 1 }));
    bm.forEach((text, j) => ops.push({ op: '+', text, b: pre + j + 1 }));
  } else {
    // Longest common subsequence, from the end, then walked from the start.
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        ops.push({ op: ' ', text: am[i], a: pre + i + 1, b: pre + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || L[(i + 1) * w + j] >= L[i * w + j + 1])) {
        // Removed lines go before the lines that replace them.
        ops.push({ op: '-', text: am[i], a: pre + i + 1 });
        i++;
      } else {
        ops.push({ op: '+', text: bm[j], b: pre + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; k < suf; k++) {
    ops.push({ op: ' ', text: a[a.length - suf + k], a: a.length - suf + k + 1, b: b.length - suf + k + 1 });
  }
  return ops;
}

// The changed lines with `context` lines around them, as hunks:
// [{ header: '@@ -a,n +b,m @@', lines: ops }]. No hunks means the texts are the same.
export function hunks(ops, context = 3) {
  const changed = ops.map((o, i) => (o.op === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const ranges = [];
  for (const i of changed) {
    const s = Math.max(0, i - context);
    const e = Math.min(ops.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && s <= last.e + 1) last.e = Math.max(last.e, e);
    else ranges.push({ s, e });
  }
  return ranges.map(({ s, e }) => {
    const lines = ops.slice(s, e + 1);
    const aLines = lines.filter((o) => o.op !== '+');
    const bLines = lines.filter((o) => o.op !== '-');
    const aStart = aLines.length ? aLines[0].a : startBefore(ops, s, 'a');
    const bStart = bLines.length ? bLines[0].b : startBefore(ops, s, 'b');
    return { header: `@@ -${aStart},${aLines.length} +${bStart},${bLines.length} @@`, lines };
  });
}

function startBefore(ops, s, side) {
  for (let i = s - 1; i >= 0; i--) if (ops[i][side]) return ops[i][side];
  return 0;
}

// How many lines were added and removed.
export function stats(ops) {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.op === '+') added++;
    else if (o.op === '-') removed++;
  }
  return { added, removed };
}

// The unified diff as text (for `diff … > file`).
export function unified(ops, { from = 'a', to = 'b', context = 3 } = {}) {
  const hs = hunks(ops, context);
  if (!hs.length) return '';
  const out = [`--- ${from}`, `+++ ${to}`];
  for (const h of hs) {
    out.push(h.header);
    for (const o of h.lines) out.push(o.op + o.text);
  }
  return out.join('\n') + '\n';
}
