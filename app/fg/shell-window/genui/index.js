// <nomad-genui>: renders one OpenUI Lang program from an assistant answer in the AI Sidebar
// (ADR-0027). The program is parsed again on every update (app/lib/genui/parse.mjs), so it fills in
// as the answer streams. Everything is drawn with lit templates, so text from the model is never
// parsed as HTML.
//
// A click on a Button, or on a link (the map's attribution), fires `genui-action` with
// { steps: [{ type: 'continue_conversation', message } | { type: 'open_url', url }] }. The sidebar
// decides what to do with it; this element never sends or navigates itself.

import { LitElement, html, nothing } from 'lit';
import { parseGenUi } from '../../../lib/genui/parse.mjs';
import styles from './styles.js';
import './charts.js';
import './map.js';
import * as cards from './cards.js';

const GAPS = { none: 0, xs: 4, s: 8, m: 12, l: 16, xl: 24 };
const CALLOUT_ICONS = {
  info: 'fa-info-circle',
  success: 'fa-check-circle',
  warning: 'fa-exclamation-triangle',
  error: 'fa-exclamation-circle',
  neutral: 'fa-comment-alt',
};
const CHARTS = new Set([
  'BarChart',
  'HorizontalBarChart',
  'LineChart',
  'AreaChart',
  'PieChart',
  'ScatterChart',
]);

const CARDS = {
  EntityCard: cards.entityCard,
  LinkCard: cards.linkCard,
  ProductCard: cards.productCard,
  EventCard: cards.eventCard,
  QuoteCard: cards.quoteCard,
  ProsCons: cards.prosCons,
  Timeline: cards.timeline,
  CardGrid: cards.cardGrid,
};

const isEl = (v) => v && typeof v === 'object' && v.type === 'element';
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));
const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

class GenUi extends LitElement {
  static styles = styles;

  static properties = {
    source: { type: String },
    streaming: { type: Boolean },
    disabled: { type: Boolean },
    _tabs: { state: true },
    _showSource: { state: true },
  };

  constructor() {
    super();
    this.source = '';
    this.streaming = false;
    this.disabled = false;
    this._tabs = {};
    this._showSource = false;
  }

  willUpdate(changed) {
    if (changed.has('source')) this._program = parseGenUi(this.source);
  }

  render() {
    const { root } = this._program || {};
    const body = root
      ? this._node(root, 'r')
      : this.streaming
        ? html`<div class="genui-pending">
            <span class="fas fa-fw fa-spinner fa-spin"></span> Drawing…
          </div>`
        : html`<pre class="genui-source">${this.source}</pre>`;
    return html`<link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="stack" @click=${this._onClick}>${body}</div>`;
  }

  // A link anywhere inside (Leaflet's attribution) must not navigate the shell window.
  _onClick(e) {
    const a = e.composedPath().find((n) => n.tagName === 'A' && n.href);
    if (!a) return;
    e.preventDefault();
    this._fire([{ type: 'open_url', url: a.href }]);
  }

  _fire(steps) {
    this.dispatchEvent(
      new CustomEvent('genui-action', { detail: { steps }, bubbles: true, composed: true })
    );
  }

  _children(v, path) {
    return list(v).map((c, i) => this._node(c, `${path}.${i}`));
  }

  // One node of the tree. Strings and numbers in a children array show as text.
  _node(n, path) {
    if (n == null || n === false) return nothing;
    if (!isEl(n)) {
      return typeof n === 'object' ? nothing : html`<div class="text">${String(n)}</div>`;
    }
    const p = n.props || {};
    switch (n.typeName) {
      case 'Stack': {
        const row = p.direction === 'row';
        const gap = GAPS[p.gap] ?? 12;
        const align = oneOf(p.align, ['start', 'center', 'end', 'stretch'], '');
        return html`<div
          class="stack ${row ? 'row' : ''} ${row && p.wrap ? 'wrap' : ''}"
          style="gap:${gap}px;${align
            ? `align-items:${align === 'start' || align === 'end' ? 'flex-' + align : align}`
            : ''}"
        >
          ${this._children(p.children, path)}
        </div>`;
      }
      case 'Card':
        return html`<div class="card ${oneOf(p.variant, ['sunk', 'clear'], '')}">
          ${this._children(p.children, path)}
        </div>`;
      case 'CardHeader':
        return html`<div class="card-header">
          ${p.title ? html`<div class="title">${str(p.title)}</div>` : nothing}
          ${p.subtitle ? html`<div class="subtitle">${str(p.subtitle)}</div>` : nothing}
        </div>`;
      case 'Tabs':
        return this._tabsNode(p, path);
      case 'Separator':
        return html`<hr />`;
      case 'TextContent':
        return html`<div
          class="text ${oneOf(p.size, ['small', 'large', 'small-heavy', 'large-heavy'], '')}"
        >
          ${str(p.text)}
        </div>`;
      case 'Callout': {
        const v = oneOf(p.variant, Object.keys(CALLOUT_ICONS), 'info');
        return html`<div class="callout ${v}" role=${v === 'error' ? 'alert' : 'note'}>
          <span class="fas fa-fw ${CALLOUT_ICONS[v]}"></span>
          <div>
            <div class="title">${str(p.title)}</div>
            ${p.description ? html`<div class="description">${str(p.description)}</div>` : nothing}
          </div>
        </div>`;
      }
      case 'Tag':
        return this._tag(p);
      case 'TagBlock':
        return html`<div class="tags">
          ${list(p.tags).map((t) => html`<span class="tag neutral">${str(t)}</span>`)}
        </div>`;
      case 'Steps':
        return html`<ol class="steps">
          ${list(p.items)
            .filter(isEl)
            .map(
              (s, i) => html`<li>
                <span class="n">${i + 1}</span>
                <div>
                  <div class="title">${str(s.props?.title)}</div>
                  ${s.props?.details
                    ? html`<div class="details">${str(s.props.details)}</div>`
                    : nothing}
                </div>
              </li>`
            )}
        </ol>`;
      case 'Stat': {
        const trend = oneOf(p.trend, ['up', 'down', 'flat'], '');
        const icon = trend === 'up' ? 'fa-arrow-up' : trend === 'down' ? 'fa-arrow-down' : '';
        return html`<div class="stat">
          <div class="label" title=${str(p.label)}>${str(p.label)}</div>
          <div class="value">${str(p.value)}</div>
          ${p.change
            ? html`<div class="change ${trend}">
                ${icon ? html`<span class="fas fa-fw ${icon}"></span>` : nothing}${str(p.change)}
              </div>`
            : nothing}
          ${p.caption ? html`<div class="caption">${str(p.caption)}</div>` : nothing}
        </div>`;
      }
      case 'Progress': {
        const max = Number(p.max) > 0 ? Number(p.max) : 100;
        const value = Number(p.value) || 0;
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        return html`<div
          class="progress"
          role="progressbar"
          aria-label=${str(p.label)}
          aria-valuenow=${value}
          aria-valuemax=${max}
        >
          <div class="head">
            <span>${str(p.label)}</span>
            <span class="v">${max === 100 ? `${Math.round(pct)}%` : `${value} / ${max}`}</span>
          </div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        </div>`;
      }
      case 'Table':
        return this._table(p);
      case 'Map':
        return html`<nomad-genui-map .props=${p}></nomad-genui-map>`;
      case 'Button':
        return html`<div class="buttons">${this._button(p)}</div>`;
      case 'Buttons':
        return html`<div class="buttons ${p.direction === 'column' ? 'column' : ''}">
          ${list(p.buttons)
            .filter(isEl)
            .map((b) => this._button(b.props || {}))}
        </div>`;
    }
    const card = CARDS[n.typeName];
    if (card) return card(this, p, path);
    if (CHARTS.has(n.typeName)) {
      return html`<nomad-genui-chart .kind=${n.typeName} .props=${p}></nomad-genui-chart>`;
    }
    return nothing;
  }

  _tag(p) {
    const v = oneOf(p.variant, ['neutral', 'info', 'success', 'warning', 'danger'], 'neutral');
    return html`<span class="tag ${v}" title=${str(p.text)}>${str(p.text)}</span>`;
  }

  _tabsNode(p, path) {
    const items = list(p.items).filter(isEl);
    if (!items.length) return nothing;
    const current = this._tabs[path] ?? str(items[0].props?.value);
    const active = items.find((t) => str(t.props?.value) === current) || items[0];
    return html`<div class="tabs">
      <div class="tab-bar" role="tablist">
        ${items.map((t) => {
          const value = str(t.props?.value);
          const on = t === active;
          return html`<button
            class="tab ${on ? 'on' : ''}"
            role="tab"
            aria-selected=${on ? 'true' : 'false'}
            @click=${() => (this._tabs = { ...this._tabs, [path]: value })}
          >
            ${str(t.props?.trigger) || value}
          </button>`;
        })}
      </div>
      <div class="stack" role="tabpanel">
        ${this._children(active.props?.content, `${path}.${items.indexOf(active)}`)}
      </div>
    </div>`;
  }

  _table(p) {
    const cols = list(p.columns)
      .filter(isEl)
      .map((c) => c.props || {});
    if (!cols.length) return nothing;
    const rows = Math.max(0, ...cols.map((c) => list(c.data).length));
    const cell = (v) =>
      isEl(v) && v.typeName === 'Tag'
        ? this._tag(v.props || {})
        : isEl(v)
          ? nothing
          : typeof v === 'number'
            ? v.toLocaleString()
            : str(v);
    return html`<div class="genui-table-wrap">
      <table class="genui-table">
        <thead>
          <tr>
            ${cols.map(
              (c) => html`<th class=${c.type === 'number' ? 'num' : ''}>${str(c.label)}</th>`
            )}
          </tr>
        </thead>
        <tbody>
          ${Array.from(
            { length: rows },
            (_, r) => html`<tr>
              ${cols.map(
                (c) =>
                  html`<td class=${c.type === 'number' ? 'num' : ''}>${cell(list(c.data)[r])}</td>`
              )}
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  _button(p) {
    const label = str(p.label);
    const steps = (Array.isArray(p.action?.steps) ? p.action.steps : []).filter(
      (s) =>
        (s?.type === 'continue_conversation' && typeof s.message === 'string') ||
        (s?.type === 'open_url' && typeof s.url === 'string')
    );
    // A Button with no action sends its label (OpenUI's rule).
    const run = steps.length ? steps : [{ type: 'continue_conversation', message: label }];
    const opens = run.some((s) => s.type === 'open_url');
    const variant = oneOf(p.variant, ['primary', 'secondary', 'tertiary'], 'secondary');
    return html`<button
      class="btn ${variant}"
      title=${opens ? run.find((s) => s.type === 'open_url').url : ''}
      ?disabled=${this.disabled || this.streaming}
      @click=${() => this._fire(run)}
    >
      ${label}${opens ? html`<span class="fas fa-external-link-alt"></span>` : nothing}
    </button>`;
  }
}

customElements.define('nomad-genui', GenUi);
