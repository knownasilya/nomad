// The sidebar's charts (ADR-0027): bar, horizontal bar, line, area, pie and scatter, drawn as SVG
// at the width they get. Colors are the --genui-c* slots in genui/styles.js, in a fixed order.
// Every chart has a hover tooltip and a Data toggle that shows the numbers as a table.

import { LitElement, html, svg, nothing } from 'lit';
import {
  formatTick,
  formatValue,
  labelStride,
  niceTicks,
  num,
  pieSlices,
  stack,
  truncate,
  valueDomain,
} from './chart-math.js';

const SLOTS = 8;
const color = (i) => `var(--genui-c${(i % SLOTS) + 1})`;
const CHAR = 6.3; // average width of an 11px axis character
const PLOT_H = 190;

const propsOf = (node) => (node && node.type === 'element' ? node.props : node) || {};
const arr = (v) => (Array.isArray(v) ? v : []);

function seriesOf(props) {
  return arr(props.series)
    .map(propsOf)
    .filter((s) => s && Array.isArray(s.values))
    .map((s) => ({ name: String(s.category ?? ''), values: s.values.map(num) }));
}

// A bar with its data end rounded (4px), the other end square on the baseline.
function barPath(x, y, w, h, end) {
  if (w <= 0 || h <= 0) return '';
  const r = Math.min(4, w / 2, h / 2);
  if (end === 'top')
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  if (end === 'bottom')
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  if (end === 'right')
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  if (end === 'left')
    return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  return `M${x},${y}h${w}v${h}h${-w}Z`;
}

export class GenUiChart extends LitElement {
  static properties = {
    kind: { type: String },
    props: { attribute: false },
    _width: { state: true },
    _tip: { state: true },
    _hover: { state: true },
    _table: { state: true },
  };

  constructor() {
    super();
    this.kind = '';
    this.props = {};
    this._width = 0;
    this._tip = null;
    this._hover = null;
    this._table = false;
  }

  // Light DOM: the chart is styled by the <nomad-genui> it sits in.
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this._ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w && w !== this._width) this._width = w;
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
  }

  render() {
    const w = this._width || 300;
    let body;
    try {
      body = this._renderKind(w);
    } catch (err) {
      console.warn('[genui] chart failed', err);
      body = null;
    }
    if (!body) return html`<div class="genui-empty">No data to chart</div>`;
    return html`
      <div class="genui-chart" @mouseleave=${this._clearTip}>
        ${this._legend()} ${body} ${this._renderTip(w)}
      </div>
      <button class="genui-data-toggle" @click=${() => (this._table = !this._table)}>
        <span class="fas fa-fw ${this._table ? 'fa-chart-bar' : 'fa-table'}"></span>
        ${this._table ? 'Hide data' : 'Data'}
      </button>
      ${this._table ? this._dataTable() : nothing}
    `;
  }

  _renderKind(w) {
    const p = this.props || {};
    switch (this.kind) {
      case 'BarChart':
        return this._bars(w, p, false);
      case 'HorizontalBarChart':
        return this._bars(w, p, true);
      case 'LineChart':
        return this._lines(w, p, false);
      case 'AreaChart':
        return this._lines(w, p, true);
      case 'PieChart':
        return this._pie(w, p);
      case 'ScatterChart':
        return this._scatter(w, p);
    }
    return null;
  }

  // — legend: one swatch per series, from two series up (one series is named by its card) —

  _legendItems() {
    const p = this.props || {};
    if (this.kind === 'PieChart') return [];
    if (this.kind === 'ScatterChart')
      return arr(p.datasets).map((d, i) => ({ name: String(propsOf(d).name ?? ''), i }));
    return seriesOf(p).map((s, i) => ({ name: s.name, i }));
  }

  _legend() {
    const items = this._legendItems();
    if (items.length < 2) return nothing;
    return html`<div class="genui-legend">
      ${items.map(
        (it) =>
          html`<span class="genui-legend-item"
            ><span class="genui-swatch" style="background:${color(it.i)}"></span>${it.name}</span
          >`
      )}
    </div>`;
  }

  // — tooltip —

  _showTip(e, title, rows) {
    const box = this.querySelector('.genui-chart')?.getBoundingClientRect();
    if (!box) return;
    this._tip = { x: e.clientX - box.left, y: e.clientY - box.top, title, rows };
  }

  _clearTip() {
    this._tip = null;
    this._hover = null;
  }

  _renderTip(w) {
    const t = this._tip;
    if (!t) return nothing;
    const left = Math.max(4, Math.min(t.x + 12, w - 170));
    return html`<div class="genui-tip" style="left:${left}px;top:${Math.max(0, t.y - 10)}px">
      ${t.title ? html`<div class="genui-tip-title">${t.title}</div>` : nothing}
      ${t.rows.map(
        (r) => html`<div class="genui-tip-row">
          ${r.color
            ? html`<span class="genui-swatch" style="background:${r.color}"></span>`
            : nothing}
          <span class="genui-tip-name">${r.name}</span>
          <span class="genui-tip-value">${r.value}</span>
        </div>`
      )}
    </div>`;
  }

  // — axes —

  _yAxis(ticks, y, left, right, label) {
    return svg`
      ${ticks.map(
        (t) => svg`
          <line class="genui-grid" x1=${left} x2=${right} y1=${y(t)} y2=${y(t)}></line>
          <text class="genui-axis" x=${left - 6} y=${y(t) + 3.5} text-anchor="end">${formatTick(t)}</text>`
      )}
      ${
        label
          ? svg`<text class="genui-axis-title" transform="translate(10 ${(y(ticks[0]) + y(ticks[ticks.length - 1])) / 2}) rotate(-90)" text-anchor="middle">${truncate(label, 30)}</text>`
          : nothing
      }`;
  }

  _yAxisWidth(ticks, label) {
    const longest = Math.max(...ticks.map((t) => formatTick(t).length));
    return Math.ceil(longest * CHAR) + 10 + (label ? 16 : 0);
  }

  // `edges`: the first and last labels sit on the plot's ends (lines), so they align inward.
  _xLabels(labels, xAt, bandW, baseY, plotLeft, plotRight, edges = false) {
    const longest = Math.max(1, ...labels.map((l) => String(l).length));
    const fit = (plotRight - plotLeft) / (Math.min(longest, 14) * CHAR + 10);
    const stride = labelStride(labels.length, fit);
    const maxChars = Math.max(3, Math.floor((bandW * stride) / CHAR) - 1);
    return labels.map((l, i) =>
      i % stride
        ? nothing
        : svg`<text class="genui-axis" x=${xAt(i)} y=${baseY + 14}
            text-anchor=${edges && labels.length > 1 && i === 0 ? 'start' : edges && labels.length > 1 && i === labels.length - 1 ? 'end' : 'middle'}
            >${truncate(l, Math.min(14, maxChars))}<title>${l}</title></text>`
    );
  }

  // — bars, vertical or horizontal —

  _bars(w, p, horizontal) {
    const labels = arr(p.labels).map(String);
    const series = seriesOf(p);
    const n = labels.length;
    if (!n || !series.length) return null;
    const stacked = p.variant === 'stacked';
    const k = series.length;
    const values = stacked
      ? stack(series, n).flatMap((s) => s.flat())
      : series.flatMap((s) => s.values);
    const [min, max, ticks] = valueDomain(values);
    const hover = this._hover;

    const tipRows = (i) =>
      series.map((s, si) => ({ color: color(si), name: s.name, value: formatValue(s.values[i]) }));
    const onBand = (i) => (e) => {
      this._hover = i;
      this._showTip(e, labels[i], tipRows(i));
    };

    if (!horizontal) {
      const left = this._yAxisWidth(ticks, p.yLabel);
      const top = 8;
      const bottom = 22 + (p.xLabel ? 16 : 0);
      const right = w - 6;
      const plotH = PLOT_H;
      const h = top + plotH + bottom;
      const y = (v) => top + ((max - v) / (max - min || 1)) * plotH;
      const band = (right - left) / n;
      const inner = Math.min(band * 0.75, stacked ? 40 : 30 * k);
      const barW = stacked ? inner : Math.max(1, (inner - 2 * (k - 1)) / k);
      const x0 = (i) => left + i * band + (band - inner) / 2;
      const marks = stacked
        ? stack(series, n).map((segs, si) =>
            segs.map(([a, b], i) => {
              const outer = si === k - 1 || series.slice(si + 1).every((s) => !num(s.values[i]));
              return svg`<path class="genui-mark genui-seg" fill=${color(si)}
                d=${barPath(x0(i), y(b), barW, y(a) - y(b), outer ? (b > 0 ? 'top' : 'bottom') : '')}></path>`;
            })
          )
        : series.map((s, si) =>
            s.values.slice(0, n).map((v, i) => {
              const yv = y(v);
              const y0 = y(0);
              return svg`<path class="genui-mark" fill=${color(si)}
                d=${barPath(x0(i) + si * (barW + 2), Math.min(yv, y0), barW, Math.abs(y0 - yv), v >= 0 ? 'top' : 'bottom')}></path>`;
            })
          );
      return html`<svg width=${w} height=${h} role="img" aria-label=${this._aria(labels, series)}>
        ${this._yAxis(ticks, y, left, right, p.yLabel)}
        ${labels.map(
          (_, i) =>
            svg`<rect class="genui-band ${hover === i ? 'on' : ''}" x=${left + i * band} y=${top} width=${band} height=${plotH} @mousemove=${onBand(i)}></rect>`
        )}
        <g class="genui-marks">${marks}</g>
        <line class="genui-baseline" x1=${left} x2=${right} y1=${y(0)} y2=${y(0)}></line>
        ${this._xLabels(labels, (i) => left + i * band + band / 2, band, top + plotH, left, right)}
        ${p.xLabel
          ? svg`<text class="genui-axis-title" x=${(left + right) / 2} y=${h - 3} text-anchor="middle">${truncate(p.xLabel, 50)}</text>`
          : nothing}
      </svg>`;
    }

    // Horizontal: one row per label, the labels down the left.
    const direct = k === 1 && !stacked;
    const longest = Math.max(...labels.map((l) => l.length));
    const labelW = Math.min(Math.round(w * 0.38), Math.ceil(longest * CHAR) + 10);
    const barH = stacked ? 16 : Math.max(8, Math.min(16, 26 / k));
    const rowH = (stacked ? barH : k * barH + 2 * (k - 1)) + 10;
    const top = 2;
    const left = labelW;
    const right = w - (direct ? 44 : 10);
    const plotH = n * rowH;
    const bottom = 20 + (p.xLabel ? 16 : 0);
    const h = top + plotH + bottom;
    const x = (v) => left + ((v - min) / (max - min || 1)) * (right - left);
    const yRow = (i) => top + i * rowH + 5;
    const maxChars = Math.max(4, Math.floor((labelW - 8) / CHAR));
    const marks = stacked
      ? stack(series, n).map((segs, si) =>
          segs.map(([a, b], i) => {
            const outer = si === k - 1 || series.slice(si + 1).every((s) => !num(s.values[i]));
            return svg`<path class="genui-mark genui-seg" fill=${color(si)}
              d=${barPath(x(a), yRow(i), x(b) - x(a), barH, outer ? (b > 0 ? 'right' : 'left') : '')}></path>`;
          })
        )
      : series.map((s, si) =>
          s.values.slice(0, n).map((v, i) => {
            const xv = x(v);
            const x0 = x(0);
            return svg`<path class="genui-mark" fill=${color(si)}
              d=${barPath(Math.min(xv, x0), yRow(i) + si * (barH + 2), Math.abs(xv - x0), barH, v >= 0 ? 'right' : 'left')}></path>
              ${direct ? svg`<text class="genui-value" x=${Math.max(xv, x0) + 5} y=${yRow(i) + barH / 2 + 4}>${formatTick(v)}</text>` : nothing}`;
          })
        );
    return html`<svg width=${w} height=${h} role="img" aria-label=${this._aria(labels, series)}>
      ${ticks.map(
        (t) => svg`
          <line class="genui-grid" x1=${x(t)} x2=${x(t)} y1=${top} y2=${top + plotH}></line>
          <text class="genui-axis" x=${x(t)} y=${top + plotH + 14} text-anchor="middle">${formatTick(t)}</text>`
      )}
      ${labels.map(
        (l, i) => svg`
          <rect class="genui-band ${hover === i ? 'on' : ''}" x="0" y=${top + i * rowH} width=${w} height=${rowH} @mousemove=${onBand(i)}></rect>
          <text class="genui-axis genui-row-label" x=${left - 8} y=${yRow(i) + (rowH - 10) / 2 + 4} text-anchor="end">${truncate(l, maxChars)}<title>${l}</title></text>`
      )}
      <g class="genui-marks">${marks}</g>
      <line class="genui-baseline" x1=${x(0)} x2=${x(0)} y1=${top} y2=${top + plotH}></line>
      ${p.xLabel
        ? svg`<text class="genui-axis-title" x=${(left + right) / 2} y=${h - 3} text-anchor="middle">${truncate(p.xLabel, 50)}</text>`
        : nothing}
    </svg>`;
  }

  // — lines and areas —

  _lines(w, p, area) {
    const labels = arr(p.labels).map(String);
    const series = seriesOf(p);
    const n = labels.length;
    if (!n || !series.length) return null;
    const stacked = area && p.variant === 'stacked';
    const step = !area && p.variant === 'step';
    const stacks = stacked ? stack(series, n) : null;
    const values = stacked ? stacks.flatMap((s) => s.flat()) : series.flatMap((s) => s.values);
    const [min, max, ticks] = valueDomain(values, { zero: area });
    const left = this._yAxisWidth(ticks, p.yLabel);
    const top = 8;
    const bottom = 22 + (p.xLabel ? 16 : 0);
    const right = w - 10;
    const h = top + PLOT_H + bottom;
    const y = (v) => top + ((max - v) / (max - min || 1)) * PLOT_H;
    const x = (i) => (n === 1 ? (left + right) / 2 : left + (i * (right - left)) / (n - 1));
    const hover = this._hover;

    const linePath = (pts) =>
      pts
        .map(([px, py], i) => {
          if (!i) return `M${px},${py}`;
          return step ? `H${px}V${py}` : `L${px},${py}`;
        })
        .join('');

    const shapes = series.map((s, si) => {
      const top_ = Array.from({ length: n }, (_, i) => [
        x(i),
        y(stacked ? stacks[si][i][1] : num(s.values[i])),
      ]);
      const base = Array.from({ length: n }, (_, i) => [
        x(i),
        y(stacked ? stacks[si][i][0] : Math.max(min, Math.min(0, max))),
      ]);
      const back = [...base]
        .reverse()
        .map(([px, py]) => `L${px},${py}`)
        .join('');
      const fill = area
        ? svg`<path class="genui-area ${stacked ? 'stacked' : ''}" fill=${color(si)}
            d=${linePath(top_) + back + 'Z'}></path>`
        : nothing;
      return svg`${fill}<path class="genui-line" stroke=${color(si)} d=${linePath(top_)}></path>`;
    });

    const dots = (i) =>
      series.map((s, si) => {
        const v = stacked ? stacks[si][i][1] : num(s.values[i]);
        return svg`<circle class="genui-dot" cx=${x(i)} cy=${y(v)} r="4" fill=${color(si)}></circle>`;
      });

    const onMove = (e) => {
      const box = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - box.left + left;
      const i = Math.max(
        0,
        Math.min(n - 1, Math.round(((px - left) / (right - left || 1)) * (n - 1)))
      );
      this._hover = i;
      this._showTip(
        e,
        labels[i],
        series.map((s, si) => ({ color: color(si), name: s.name, value: formatValue(s.values[i]) }))
      );
    };

    const showDots = n <= 16;
    return html`<svg width=${w} height=${h} role="img" aria-label=${this._aria(labels, series)}>
      ${this._yAxis(ticks, y, left, right, p.yLabel)}
      ${hover != null
        ? svg`<line class="genui-crosshair" x1=${x(hover)} x2=${x(hover)} y1=${top} y2=${top + PLOT_H}></line>`
        : nothing}
      <g class="genui-marks">${shapes}</g>
      ${showDots && !stacked
        ? labels.map((_, i) => dots(i))
        : hover != null
          ? dots(hover)
          : nothing}
      ${this._xLabels(
        labels,
        x,
        (right - left) / Math.max(1, n - 1),
        top + PLOT_H,
        left,
        right,
        true
      )}
      ${p.xLabel
        ? svg`<text class="genui-axis-title" x=${(left + right) / 2} y=${h - 3} text-anchor="middle">${truncate(p.xLabel, 50)}</text>`
        : nothing}
      <rect
        class="genui-hit"
        x=${left}
        y=${top}
        width=${Math.max(1, right - left)}
        height=${PLOT_H}
        @mousemove=${onMove}
      ></rect>
    </svg>`;
  }

  // — pie and donut —

  _pie(w, p) {
    const slices = pieSlices(arr(p.labels), arr(p.values));
    if (!slices.length) return null;
    const total = slices.reduce((t, s) => t + s.value, 0);
    const size = Math.min(170, w);
    const r = size / 2 - 4;
    const donut = p.variant === 'donut';
    const ir = donut ? r * 0.6 : 0;
    const c = size / 2;
    let a0 = -Math.PI / 2;
    const hover = this._hover;
    const pct = (v) => `${Math.round((v / total) * 1000) / 10}%`;
    const arcs = slices.map((s, i) => {
      const a1 = a0 + (s.value / total) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (rad, a) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
      const d =
        slices.length === 1
          ? donut
            ? `M${c - r},${c}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0M${c - ir},${c}a${ir},${ir} 0 1,1 ${2 * ir},0a${ir},${ir} 0 1,1 ${-2 * ir},0`
            : `M${c - r},${c}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
          : donut
            ? `M${pt(r, a0)}A${r},${r} 0 ${big},1 ${pt(r, a1)}L${pt(ir, a1)}A${ir},${ir} 0 ${big},0 ${pt(ir, a0)}Z`
            : `M${c},${c}L${pt(r, a0)}A${r},${r} 0 ${big},1 ${pt(r, a1)}Z`;
      a0 = a1;
      return svg`<path class="genui-slice ${hover === i ? 'on' : ''}" fill-rule="evenodd" fill=${color(i)} d=${d}
        @mousemove=${(e) => {
          this._hover = i;
          this._showTip(e, s.label, [
            { color: color(i), name: formatValue(s.value), value: pct(s.value) },
          ]);
        }}></path>`;
    });
    return html`<div class="genui-pie ${w >= 330 ? 'side' : ''}">
      <svg
        width=${size}
        height=${size}
        role="img"
        aria-label=${slices.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}
      >
        ${arcs}
        ${donut
          ? svg`<text class="genui-pie-total" x=${c} y=${c + 6} text-anchor="middle">${formatTick(total)}</text>`
          : nothing}
      </svg>
      <div class="genui-pie-legend">
        ${slices.map(
          (s, i) => html`<div class="genui-pie-row ${hover === i ? 'on' : ''}">
            <span class="genui-swatch" style="background:${color(i)}"></span>
            <span class="genui-pie-label">${s.label}</span>
            <span class="genui-pie-value">${pct(s.value)}</span>
          </div>`
        )}
      </div>
    </div>`;
  }

  // — scatter —

  _scatter(w, p) {
    const sets = arr(p.datasets)
      .map(propsOf)
      .map((d) => ({
        name: String(d?.name ?? ''),
        points: arr(d?.points)
          .map(propsOf)
          .filter((pt) => pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))),
      }))
      .filter((d) => d.points.length);
    if (!sets.length) return null;
    const all = sets.flatMap((d) => d.points);
    const [ymin, ymax, yt] = valueDomain(
      all.map((pt) => num(pt.y)),
      { zero: false }
    );
    const xt = niceTicks(
      Math.min(...all.map((pt) => num(pt.x))),
      Math.max(...all.map((pt) => num(pt.x)))
    );
    const [xmin, xmax] = [xt[0], xt[xt.length - 1]];
    const left = this._yAxisWidth(yt, p.yLabel);
    const top = 8;
    const right = w - 10;
    const bottom = 22 + (p.xLabel ? 16 : 0);
    const h = top + PLOT_H + bottom;
    const x = (v) => left + ((v - xmin) / (xmax - xmin || 1)) * (right - left);
    const y = (v) => top + ((ymax - v) / (ymax - ymin || 1)) * PLOT_H;
    return html`<svg
      width=${w}
      height=${h}
      role="img"
      aria-label=${`Scatter plot of ${all.length} points`}
    >
      ${this._yAxis(yt, y, left, right, p.yLabel)}
      ${xt.map(
        (t) =>
          svg`<text class="genui-axis" x=${x(t)} y=${top + PLOT_H + 14} text-anchor="middle">${formatTick(t)}</text>`
      )}
      <line
        class="genui-baseline"
        x1=${left}
        x2=${right}
        y1=${top + PLOT_H}
        y2=${top + PLOT_H}
      ></line>
      <g class="genui-marks">
        ${sets.map((d, si) =>
          d.points.map(
            (
              pt
            ) => svg`<circle class="genui-point" cx=${x(num(pt.x))} cy=${y(num(pt.y))} r="4.5" fill=${color(si)}
              @mousemove=${(e) =>
                this._showTip(e, pt.label || d.name, [
                  { color: color(si), name: p.xLabel || 'x', value: formatValue(num(pt.x)) },
                  { name: p.yLabel || 'y', value: formatValue(num(pt.y)) },
                ])}></circle>`
          )
        )}
      </g>
      ${p.xLabel
        ? svg`<text class="genui-axis-title" x=${(left + right) / 2} y=${h - 3} text-anchor="middle">${truncate(p.xLabel, 50)}</text>`
        : nothing}
    </svg>`;
  }

  _aria(labels, series) {
    return series
      .map(
        (s) => `${s.name}: ${labels.map((l, i) => `${l} ${formatValue(s.values[i])}`).join(', ')}`
      )
      .join('; ');
  }

  // The numbers behind the chart.
  _dataTable() {
    const p = this.props || {};
    let head = [];
    let rows = [];
    if (this.kind === 'PieChart') {
      head = ['', 'Value'];
      rows = arr(p.labels).map((l, i) => [l, formatValue(num(arr(p.values)[i]))]);
    } else if (this.kind === 'ScatterChart') {
      head = ['', p.xLabel || 'x', p.yLabel || 'y'];
      rows = arr(p.datasets)
        .map(propsOf)
        .flatMap((d) =>
          arr(d?.points)
            .map(propsOf)
            .map((pt) => [pt.label || d.name, formatValue(num(pt.x)), formatValue(num(pt.y))])
        );
    } else {
      const series = seriesOf(p);
      head = ['', ...series.map((s) => s.name)];
      rows = arr(p.labels).map((l, i) => [l, ...series.map((s) => formatValue(s.values[i]))]);
    }
    return html`<div class="genui-table-wrap">
      <table class="genui-table">
        <thead>
          <tr>
            ${head.map((h, i) => html`<th class=${i ? 'num' : ''}>${h}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr>
              ${r.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }
}

customElements.define('nomad-genui-chart', GenUiChart);
