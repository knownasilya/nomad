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
