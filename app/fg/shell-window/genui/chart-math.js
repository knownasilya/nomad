// Scales and number formats for the sidebar's charts (genui/charts.js). No DOM, so unit tests can
// run it (tests/unit/genui.test.js).

// Round tick values that cover [min, max]: 1, 2, 2.5 or 5 times a power of ten apart.
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  if (min > max) [min, max] = [max, min];
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(roundTo(v, step));
  return ticks;
}

function roundTo(v, step) {
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(v.toFixed(Math.min(digits, 10)));
}

// The value domain of a chart. Bars and areas start at zero; lines and points needn't.
export function valueDomain(values, { zero = true } = {}) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return [0, 1];
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (zero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const ticks = niceTicks(min, max);
  return [ticks[0], ticks[ticks.length - 1], ticks];
}

// Per label, the running totals of each series, for stacked bars and areas. Negative values stack
// downward from zero, apart from the positive ones.
export function stack(series, n) {
  const pos = Array.from({ length: n }, () => 0);
  const neg = Array.from({ length: n }, () => 0);
  return series.map((s) =>
    Array.from({ length: n }, (_, i) => {
      const v = num(s.values[i]);
      if (v >= 0) {
        const y0 = pos[i];
        pos[i] += v;
        return [y0, pos[i]];
      }
      const y0 = neg[i];
      neg[i] += v;
      return [neg[i], y0];
    })
  );
}

export function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

// Axis ticks: 1.2K, 3M.
export function formatTick(v) {
  return Math.abs(v) >= 1000 ? compact.format(v) : full.format(v);
}

// Tooltips and tables: the value as written, grouped.
export function formatValue(v) {
  return typeof v === 'number' && Number.isFinite(v) ? full.format(v) : String(v ?? '');
}

// Which of n labels to print on an axis with room for about `fit` of them: every k-th, always
// the first.
export function labelStride(n, fit) {
  if (fit <= 0) return n;
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(fit))));
}

export function truncate(s, max) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

// Pie slices, largest first, with everything past `max` folded into "Other".
export function pieSlices(labels, values, max = 8) {
  const slices = labels
    .map((label, i) => ({ label: String(label), value: Math.max(0, num(values[i])), index: i }))
    .filter((s) => s.value > 0);
  if (slices.length <= max) return slices;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, max - 1).sort((a, b) => a.index - b.index);
  const rest = sorted.slice(max - 1).reduce((t, s) => t + s.value, 0);
  return [...kept, { label: 'Other', value: rest, index: -1 }];
}

// — the small ones (genui/more.js): Sparkline, Progress's ring, Avatar, Calendar —

// A Sparkline's marks in a w × h box, with a little room top and bottom so a stroke isn't cut:
// { points: [[x, y]], line: 'M…', area: 'M…Z', bars: [{ x, y, w, h }] }. Empty for no numbers.
export function sparkGeometry(values, w = 100, h = 28, pad = 2) {
  const nums = (Array.isArray(values) ? values : [])
    .filter((v) => v != null && v !== '')
    .map(Number)
    .filter(Number.isFinite);
  if (!nums.length) return { points: [], line: '', area: '', bars: [] };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const y = (v) => (max === min ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2));
  const step = nums.length > 1 ? w / (nums.length - 1) : 0;
  const points = nums.map((v, i) => [nums.length > 1 ? i * step : w / 2, y(v)]);
  const r = (n) => Math.round(n * 100) / 100;
  const line = points.map(([px, py], i) => `${i ? 'L' : 'M'}${r(px)},${r(py)}`).join('');
  const area = points.length > 1 ? `${line}L${r(w)},${h}L0,${h}Z` : '';
  // Bars grow from the bottom; the smallest keeps a sliver so it still reads as a bar.
  const slot = w / nums.length;
  const bw = Math.max(1, slot * 0.7);
  const bars = nums.map((v, i) => {
    const bh = Math.max(1.5, max === min ? h / 2 : ((v - Math.min(0, min)) / (max - Math.min(0, min) || 1)) * h);
    return { x: r(i * slot + (slot - bw) / 2), y: r(h - bh), w: r(bw), h: r(bh) };
  });
  return { points, line, area, bars };
}

// The stroke-dasharray that fills `pct` (0-100) of a circle of radius r.
export function ringDash(pct, r) {
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `${(c * p) / 100} ${c}`;
}

// "Ana María Díaz" → "AD", "nomad" → "N", "" → "?". Counts letters, not UTF-16 units.
export function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => Array.from(w)[0].toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}

// "2026-11" → { year, month (0-11) }, or null.
export function parseMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? '').trim());
  if (!m) return null;
  const mo = Number(m[2]) - 1;
  return mo >= 0 && mo <= 11 ? { year: Number(m[1]), month: mo } : null;
}

// A month as weeks of days: [[null, null, 1, 2, …], …], each week 7 long. firstDay is the day a
// week starts on (0 Sunday … 6 Saturday).
export function monthGrid(year, month, firstDay = 0) {
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() - firstDay + 7) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Sort rows of a table by one column. A cell is a number, a string, or a component, which sorts
// by the text it shows. Empty cells go last either way.
export function cellSortValue(v) {
  if (v && typeof v === 'object') {
    const p = v.props || {};
    const t = p.text ?? p.label ?? p.name ?? p.title ?? p.value ?? '';
    return typeof t === 'number' ? t : String(t);
  }
  return v ?? '';
}
export function sortRows(rows, cells, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const empty = (v) => v === '' || v == null;
  return [...rows].sort((a, b) => {
    const x = cellSortValue(cells[a]);
    const y = cellSortValue(cells[b]);
    if (empty(x) || empty(y)) return empty(x) === empty(y) ? a - b : empty(x) ? 1 : -1;
    const nx = typeof x === 'number' ? x : Number(String(x).replace(/[,\s%$€£]/g, ''));
    const ny = typeof y === 'number' ? y : Number(String(y).replace(/[,\s%$€£]/g, ''));
    const cmp =
      Number.isFinite(nx) && Number.isFinite(ny)
        ? nx - ny
        : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return cmp ? cmp * sign : a - b;
  });
}
