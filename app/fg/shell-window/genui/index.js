// <nomad-genui>: renders one OpenUI Lang program from an assistant answer in the AI Sidebar
// (ADR-0027). The program is parsed again on every update (app/lib/genui/parse.mjs), so it fills in
// as the answer streams. Everything is drawn with lit templates, so text from the model is never
// parsed as HTML.
//
// A click on a Button, or on a link (the map's attribution), fires `genui-action` with
// { steps: [{ type: 'continue_conversation', message } | { type: 'open_url', url }] }. The sidebar
// decides what to do with it; this element never sends or navigates itself.
//
// `standalone` draws it in a page of its own (an HTML Asset the AI saved, app/lib/genui/page.mjs,
// run by app/fg/genui-page/): there is no conversation, so a Button that only talks to the
// assistant is left out, and the icons come from `iconCss` (the page carries the font) instead of
// nomad://assets.
//
// `host` is the home page (nomad://desktop, ADR-0048): the page's layout is a program too, and its
// live parts (HomeNotes, HomeJobs, …) are drawn by the page, not here. Each one becomes a
// <slot name="home-N">, and `genui-widgets` tells the page which widget each slot wants
// ({ widgets: [{ slot, name, props }] }, with `placed`: every widget in the program, also one in a
// tab that isn't open); the page puts its own element in the slot. Anywhere else
// a widget is a placeholder that says what shows there. `framed` is a card pinned to that page: the
// page draws its frame, so a Card that is all the program draws loses its own border.
//
// `live` answers the program's Query statements (live cards, shared/home-live.mjs): a function
// (source, args) -> Promise<data>, set by the home page (nomad.vault.homeQuery) and the AI Sidebar
// (aiShell.liveQuery). lang-core's QueryManager runs them, each on its own interval, and the tree
// is evaluated again when an answer comes. `genui-live` tells the page how it went
// ({ queries, loading, updatedAt, errors }), and refresh() reads again. Without `live` a Query
// draws its defaults. A drawing with live data opens only links written in the program or carried
// by the data's own `url`s, never one built from the data.

import { LitElement, html, nothing } from 'lit';
import { createQueryManager } from '@openuidev/lang-core';
import { parseProgram, evaluateProgram } from '../../../lib/genui/parse.mjs';
import { isSource, refreshSeconds, urlsIn, VAULT_SOURCES } from '../../../../shared/home-live.mjs';
import styles from './styles.js';
import './charts.js';
import './map.js';
import * as cards from './cards.js';
import * as more from './more.js';
import { form } from './forms.js';
import { iconName } from '../../../lib/genui/icons.mjs';
import { sortRows } from './chart-math.js';
import { widgetsIn } from '../../../../shared/home-layout.mjs';

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

const MORE = {
  Grid: more.grid,
  GridItem: more.gridItem,
  Columns: more.columns,
  Accordion: more.accordion,
  Collapsible: more.collapsible,
  Carousel: more.carousel,
  Separator: more.separator,
  Header: more.header,
  Icon: more.iconNode,
  Avatar: more.avatar,
  AvatarGroup: more.avatarGroup,
  User: more.user,
  Kbd: more.kbd,
  Link: more.link,
  Breadcrumb: more.breadcrumb,
  CodeBlock: more.codeBlock,
  Empty: more.empty,
  Feature: more.feature,
  List: more.listNode,
  DataList: more.dataList,
  Steps: more.steps,
  Tree: more.tree,
  Sparkline: more.sparkline,
  Calendar: more.calendar,
  Form: form,
};

// The home page's live widgets, and what a placeholder calls each (ADR-0048).
export const HOME_WIDGETS = {
  HomeGreeting: 'Greeting',
  HomePins: 'Pinned pages',
  HomeNeedsYou: 'Needs you',
  HomeNotifications: 'Notifications',
  HomeJobs: 'Jobs',
  HomeEvents: 'Coming up',
  HomeNotes: 'Latest notes',
  HomeFiles: 'Latest files',
  HomeCards: 'Pinned cards',
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
    standalone: { type: Boolean },
    host: { type: Boolean },
    framed: { type: Boolean },
    iconCss: { attribute: false },
    live: { attribute: false },
    _tabs: { state: true },
    _ui: { state: true },
    _showSource: { state: true },
  };

  constructor() {
    super();
    this.source = '';
    this.streaming = false;
    this.disabled = false;
    this.standalone = false;
    this.host = false;
    this.framed = false;
    this.iconCss = '';
    this.live = null;
    this._parsed = null;
    this._qm = null; // lang-core's QueryManager, while the program has live Queries and `live` is set
    this._unsub = null;
    this._liveSent = '';
    this._liveAt = 0;
    this._tabs = {};
    this._ui = {}; // what is open, which page, which slide, a form's values, by a path
    this._widgets = [];
    this._placed = [];
    this._widgetsSent = '';
    this._showSource = false;
  }

  willUpdate(changed) {
    if (changed.has('source') || !this._parsed) this._parsed = parseProgram(this.source);
    if (changed.has('source') || changed.has('live') || changed.has('streaming')) this._runQueries();
    const qm = this._qm;
    this._program = {
      root: evaluateProgram(this._parsed, qm ? (id) => qm.getResult(id) ?? undefined : null),
      meta: this._parsed.meta,
    };
    if (changed.has('source')) this._placed = this.host ? widgetsIn(this._program.root) : [];
  }

  // Live data
  // =

  // The program's Queries the page can answer.
  _liveQueries() {
    return (this._parsed?.queries || []).filter((q) => isSource(q.tool));
  }

  _runQueries() {
    const queries = this.live ? this._liveQueries() : [];
    if (!queries.length) return this._stopQueries();
    if (!this._qm) {
      const live = (source, args) => (typeof this.live === 'function' ? this.live(source, args) : Promise.reject(new Error('Not live here')));
      this._qm = createQueryManager({ callTool: live });
    }
    if (!this._unsub) this._unsub = this._qm.subscribe(() => this._onLive());
    this._qm.evaluateQueries(
      queries.map((q) => ({
        statementId: q.id,
        toolName: q.tool,
        args: q.args,
        defaults: q.defaults,
        deps: null,
        refreshInterval: refreshSeconds(q.tool, q.refresh),
        complete: q.complete && !this.streaming,
      }))
    );
  }

  _stopQueries() {
    this._unsub?.();
    this._unsub = null;
    this._qm?.dispose();
    this._qm = null;
    this._sendLive();
  }

  _onLive() {
    const snap = this._qm?.getSnapshot();
    if (snap && !snap.__openui_loading.length) this._liveAt = Date.now();
    this.requestUpdate();
    this._sendLive();
  }

  // The page's frame shows when a card last read its data, and its errors.
  _sendLive() {
    const snap = this._qm?.getSnapshot();
    const detail = snap
      ? {
          queries: this._liveQueries().length,
          loading: snap.__openui_loading.length > 0,
          updatedAt: this._liveAt || null,
          errors: snap.__openui_errors.map((e) => String(e.message || '').replace(/^Query "[^"]*" failed: /, '')),
        }
      : { queries: 0, loading: false, updatedAt: null, errors: [] };
    const sent = JSON.stringify(detail);
    if (sent === this._liveSent) return;
    this._liveSent = sent;
    this.dispatchEvent(new CustomEvent('genui-live', { detail, bubbles: true, composed: true }));
  }

  // Read the live data again: every Query, or only those on these sources.
  refresh(sources = null) {
    if (!this._qm) return false;
    const ids = this._liveQueries()
      .filter((q) => !sources || sources.includes(q.tool))
      .map((q) => q.id);
    if (ids.length) this._qm.invalidate(ids);
    return ids.length > 0;
  }

  // After the Vault or a Job changed: the Queries that read them (a drive waits for its interval).
  refreshVault() {
    return this.refresh(VAULT_SOURCES);
  }

  get isLive() {
    return this._liveQueries().length > 0;
  }

  connectedCallback() {
    super.connectedCallback();
    // Back on the page after a move: its intervals start again, and it reads once more.
    if (this._qm || !this._parsed || !this.live) return;
    this._runQueries();
    this.refresh();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopQueries();
  }

  // Whether a step may open `url`. A drawing without live data opens what linkOf allows. With
  // live data, a link must be written in the program, or be one the data carries (a Note's, an
  // event's): a link put together from the data could carry it to a site.
  _mayOpen(url) {
    if (!this._qm) return true;
    const u = String(url || '');
    if (/^nomad:/i.test(u)) return true; // rebuilt from an id by linkOf
    if (this.source.includes(u)) return true;
    const results = this._liveQueries().map((q) => this._qm.getResult(q.id));
    return urlsIn(results).has(u);
  }

  // The widgets the program places, once they change (the home page fills their slots).
  updated() {
    if (!this.host) return;
    const sent = JSON.stringify([this._widgets, this._placed]);
    if (sent === this._widgetsSent) return;
    this._widgetsSent = sent;
    this.dispatchEvent(
      new CustomEvent('genui-widgets', {
        detail: { widgets: this._widgets, placed: this._placed },
        bubbles: true,
        composed: true,
      })
    );
  }

  // The widgets of the last render: [{ slot, name, props }].
  get widgets() {
    return this._widgets;
  }

  // A url the caller may open for an `open_url` step (shared/item-links.mjs), or null.
  static safeUrl(url) {
    return cards.linkOf(url)?.href || null;
  }

  _state(key, dflt) {
    return key in this._ui ? this._ui[key] : dflt;
  }

  _setState(key, value) {
    this._ui = { ...this._ui, [key]: value };
  }

  _gap(name, dflt = 12) {
    return GAPS[name] ?? dflt;
  }

  firstUpdated() {
    if (!this.iconCss || !this.shadowRoot) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(this.iconCss);
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, sheet];
  }

  render() {
    this._widgets = [];
    const { root } = this._program || {};
    const body = root
      ? this._node(root, 'r')
      : this.streaming
        ? html`<div class="genui-pending">
            <span class="fas fa-fw fa-spinner fa-spin"></span> Drawing…
          </div>`
        : html`<pre class="genui-source">${this.source}</pre>`;
    const errors = this._qm ? this._qm.getSnapshot().__openui_errors : [];
    return html`${this.standalone
        ? nothing
        : html`<link rel="stylesheet" href="nomad://assets/font-awesome.css" />`}
      <div class="stack" @click=${this._onClick}>${body}</div>
      ${errors.length
        ? html`<div class="live-error" role="status">
            <span class="fas fa-fw fa-exclamation-triangle" aria-hidden="true"></span>
            ${String(errors[0].message || '').replace(/^Query "[^"]*" failed: /, '')}
          </div>`
        : nothing}`;
  }

  // A link anywhere inside (Leaflet's attribution) must not navigate the shell window.
  _onClick(e) {
    const a = e.composedPath().find((n) => n.tagName === 'A' && n.href);
    if (!a) return;
    e.preventDefault();
    this._fire([{ type: 'open_url', url: a.href }]);
  }

  _fire(steps) {
    // A Refresh button: Button("Refresh", Action([@Run(today)])) reads those Queries again.
    const runs = steps.filter((st) => st.type === 'run' && st.refType === 'query').map((st) => st.statementId);
    if (runs.length && this._qm) this._qm.invalidate(runs);
    steps = steps.filter((st) => st.type !== 'run' && (st.type !== 'open_url' || this._mayOpen(st.url)));
    if (!steps.length) return;
    this.dispatchEvent(
      new CustomEvent('genui-action', { detail: { steps }, bubbles: true, composed: true })
    );
  }

  _children(v, path) {
    return list(v).map((c, i) => this._node(c, `${path}.${i}`));
  }

  // What a slot holds: a component, or text. A slot sits in a line, so text is a span, not a block.
  _slot(v, path) {
    if (v == null || v === false) return nothing;
    if (Array.isArray(v)) return v.map((c, i) => this._slot(c, `${path}.${i}`));
    if (!isEl(v)) return typeof v === 'object' ? nothing : html`<span class="slot-text">${String(v)}</span>`;
    return this._node(v, path);
  }

  // Whether the node at `path` is all the program draws: the root, or the root Stack's one child.
  _onlyChild(path) {
    const root = this._program?.root;
    if (path === 'r') return true;
    return path === 'r.0' && root?.typeName === 'Stack' && list(root.props?.children).length === 1;
  }

  // A live part of the home page: the page's own element there, a placeholder anywhere else.
  _widget(n) {
    if (this.host) {
      const slot = `home-${this._widgets.length}`;
      const props = {};
      const limit = Math.round(Number(n.props?.limit));
      if (limit > 0) props.limit = Math.min(limit, 50);
      this._widgets.push({ slot, name: n.typeName, props });
      return html`<slot name=${slot}></slot>`;
    }
    if (this.standalone) return nothing;
    return html`<div class="home-widget">
      <span class="fas fa-fw fa-home" aria-hidden="true"></span>
      <span class="hw-name">${HOME_WIDGETS[n.typeName]}</span>
      <span class="hw-note">shows live on your home page</span>
    </div>`;
  }

  // One node of the tree. Strings and numbers in a children array show as text.
  _node(n, path) {
    if (n == null || n === false) return nothing;
    if (!isEl(n)) {
      return typeof n === 'object' ? nothing : html`<div class="text">${String(n)}</div>`;
    }
    const p = n.props || {};
    if (n.typeName in HOME_WIDGETS) return this._widget(n);
    switch (n.typeName) {
      case 'Stack': {
        const row = p.direction === 'row';
        const gap = GAPS[p.gap] ?? 12;
        const align = oneOf(p.align, ['start', 'center', 'end', 'stretch'], '');
        const justify = oneOf(p.justify, ['start', 'center', 'end', 'between'], '');
        return html`<div
          class="stack ${row ? 'row' : ''} ${row && p.wrap ? 'wrap' : ''} ${justify ? 'packed' : ''}"
          style="gap:${gap}px;${align
            ? `align-items:${align === 'start' || align === 'end' ? 'flex-' + align : align};`
            : ''}${justify
            ? `justify-content:${justify === 'between' ? 'space-between' : justify === 'center' ? 'center' : 'flex-' + justify}`
            : ''}"
        >
          ${this._children(p.children, path)}
        </div>`;
      }
      case 'Card': {
        const variant = oneOf(p.variant, ['sunk', 'clear', 'soft'], '');
        const color = more.colorClass(p.color, variant === 'soft' ? 'neutral' : '');
        const footer = list(p.footer);
        // A card pinned to the home page sits in the page's own frame: one more border inside
        // it would be a box in a box.
        const bare = this.framed && !variant && !color && this._onlyChild(path);
        return html`<div class="card ${bare ? 'clear' : variant} ${color} ${color && variant !== 'soft' ? 'striped' : ''}">
          ${this._children(p.children, path)}
          ${footer.length
            ? html`<div class="card-footer">
                ${footer.map((f, i) => this._slot(f, `${path}.f${i}`))}
              </div>`
            : nothing}
        </div>`;
      }
      case 'CardHeader': {
        const glyph = iconName(p.icon);
        return html`<div class="card-header ${glyph || p.trailing != null ? 'row' : ''}">
          ${glyph ? html`<span class="card-header-icon">${more.icon(glyph)}</span>` : nothing}
          <div class="card-header-text">
            ${p.title ? html`<div class="title">${str(p.title)}</div>` : nothing}
            ${p.subtitle ? html`<div class="subtitle">${str(p.subtitle)}</div>` : nothing}
          </div>
          ${p.trailing != null
            ? html`<div class="trailing">${this._slot(p.trailing, `${path}.tr`)}</div>`
            : nothing}
        </div>`;
      }
      case 'Tabs':
        return this._tabsNode(p, path);
      case 'TextContent': {
        // The text is pre-wrapped, so no space may sit between the tag and it.
        const size = oneOf(p.size, ['small', 'large', 'small-heavy', 'large-heavy'], '');
        const color = oneOf(p.color, ['muted', 'primary', 'success', 'warning', 'error'], '');
        const cls = `text ${size} ${color ? `t-${color}` : ''}`;
        return html`<div class=${cls}>${str(p.text)}</div>`;
      }
      case 'Callout': {
        const v = oneOf(p.variant, Object.keys(CALLOUT_ICONS), 'info');
        const glyph = iconName(p.icon);
        const actions = list(p.actions).filter(isEl);
        return html`<div
          class="callout ${v} ${oneOf(p.style, ['outline', 'solid'], '')}"
          role=${v === 'error' ? 'alert' : 'note'}
        >
          <span class="fas fa-fw ${glyph ? `fa-${glyph}` : CALLOUT_ICONS[v]}" aria-hidden="true"></span>
          <div class="callout-body">
            <div class="title">${str(p.title)}</div>
            ${p.description ? html`<div class="description">${str(p.description)}</div>` : nothing}
            ${actions.length
              ? html`<div class="buttons">${actions.map((b) => this._button(b.props || {}))}</div>`
              : nothing}
          </div>
        </div>`;
      }
      case 'Tag':
        return this._tag(p);
      case 'TagBlock':
        return html`<div class="tags">
          ${list(p.tags).map((t) => html`<span class="tag neutral">${str(t)}</span>`)}
        </div>`;
      case 'Stat': {
        const trend = oneOf(p.trend, ['up', 'down', 'flat'], '');
        const icon = trend === 'up' ? 'fa-arrow-up' : trend === 'down' ? 'fa-arrow-down' : '';
        const glyph = iconName(p.icon);
        const color = more.colorClass(p.color);
        const spark = list(p.spark).length > 1;
        return html`<div class="stat ${color}">
          <div class="stat-head">
            <div class="label" title=${str(p.label)}>${str(p.label)}</div>
            ${glyph ? html`<span class="stat-icon">${more.icon(glyph)}</span>` : nothing}
          </div>
          <div class="value">${str(p.value)}</div>
          ${p.change
            ? html`<div class="change ${trend}">
                ${icon ? html`<span class="fas fa-fw ${icon}"></span>` : nothing}${str(p.change)}
              </div>`
            : nothing}
          ${p.caption ? html`<div class="caption">${str(p.caption)}</div>` : nothing}
          ${spark
            ? html`<div class="stat-spark">
                ${more.sparkline(this, {
                  values: p.spark,
                  color: color || (trend === 'up' ? 'success' : trend === 'down' ? 'error' : ''),
                  variant: 'area',
                })}
              </div>`
            : nothing}
        </div>`;
      }
      case 'Progress': {
        const max = Number(p.max) > 0 ? Number(p.max) : 100;
        const value = Number(p.value) || 0;
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        const shown = max === 100 ? `${Math.round(pct)}%` : `${value} / ${max}`;
        if (p.variant === 'ring') return more.progressRing(this, p, pct, `${Math.round(pct)}%`);
        return html`<div
          class="progress ${more.colorClass(p.color)}"
          role="progressbar"
          aria-label=${str(p.label)}
          aria-valuenow=${value}
          aria-valuemax=${max}
        >
          <div class="head">
            <span>${str(p.label)}</span>
            <span class="v">${shown}</span>
          </div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          ${p.caption ? html`<div class="caption">${str(p.caption)}</div>` : nothing}
        </div>`;
      }
      case 'Table':
        return this._table(p, path);
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
    const card = CARDS[n.typeName] || MORE[n.typeName];
    if (card) return card(this, p, path);
    if (CHARTS.has(n.typeName)) {
      return html`<nomad-genui-chart .kind=${n.typeName} .props=${p}></nomad-genui-chart>`;
    }
    return nothing;
  }

  _tag(p) {
    const v = oneOf(p.variant, ['neutral', 'info', 'success', 'warning', 'danger'], 'neutral');
    return html`<span class="tag ${v} ${oneOf(p.style, ['outline', 'solid'], '')}" title=${str(p.text)}
      >${more.icon(p.icon)}${str(p.text)}</span
    >`;
  }

  _tabsNode(p, path) {
    const items = list(p.items).filter(isEl);
    if (!items.length) return nothing;
    const current = this._tabs[path] ?? str(items[0].props?.value);
    const active = items.find((t) => str(t.props?.value) === current) || items[0];
    return html`<div class="tabs ${p.variant === 'pill' ? 'pill' : ''}">
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
            ${more.icon(t.props?.icon)}${str(t.props?.trigger) || value}
          </button>`;
        })}
      </div>
      <div class="stack" role="tabpanel">
        ${this._children(active.props?.content, `${path}.${items.indexOf(active)}`)}
      </div>
    </div>`;
  }

  // A cell is a number, text, or a component that sits in a line (a Tag, an Avatar, a Sparkline…).
  _cell(v, path) {
    if (isEl(v)) return v.typeName === 'Tag' ? this._tag(v.props || {}) : this._node(v, path);
    return typeof v === 'number' ? v.toLocaleString() : str(v);
  }

  _table(p, path = 't') {
    const cols = list(p.columns)
      .filter(isEl)
      .map((c) => c.props || {});
    if (!cols.length) return nothing;
    const count = Math.max(0, ...cols.map((c) => list(c.data).length));
    let rows = Array.from({ length: count }, (_, r) => r);
    const sortKey = `sort:${path}`;
    const sort = this._state(sortKey, null);
    if (sort && cols[sort.col]) rows = sortRows(rows, list(cols[sort.col].data), sort.dir);
    const size = Math.round(Number(p.pageSize));
    const paged = size > 0 && count > size;
    const pages = paged ? Math.ceil(count / size) : 1;
    const pageKey = `page:${path}`;
    const page = Math.min(pages - 1, this._state(pageKey, 0));
    if (paged) rows = rows.slice(page * size, page * size + size);
    const onSort = (col) => {
      const dir = sort?.col === col && sort.dir === 'asc' ? 'desc' : 'asc';
      this._ui = { ...this._ui, [sortKey]: { col, dir }, [pageKey]: 0 };
    };
    return html`<div class="genui-table-wrap">
        <table class="genui-table ${p.variant === 'striped' ? 'striped' : ''}">
          ${p.caption ? html`<caption>${str(p.caption)}</caption>` : nothing}
          <thead>
            <tr>
              ${cols.map((c, i) => {
                const on = sort?.col === i;
                return html`<th
                  class=${c.type === 'number' ? 'num' : ''}
                  aria-sort=${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : nothing}
                >
                  <button class="th-sort" title="Sort by this column" @click=${() => onSort(i)}>
                    ${str(c.label)}${on
                      ? html`<span
                          class="fas ${sort.dir === 'asc' ? 'fa-caret-up' : 'fa-caret-down'}"
                          aria-hidden="true"
                        ></span>`
                      : nothing}
                  </button>
                </th>`;
              })}
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr>
                ${cols.map(
                  (c, i) =>
                    html`<td class=${c.type === 'number' ? 'num' : ''}>
                      ${this._cell(list(c.data)[r], `${path}.${i}.${r}`)}
                    </td>`
                )}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      ${paged
        ? html`<div class="pager">
            <span class="pager-text"
              >${page * size + 1}–${Math.min(count, page * size + size)} of ${count}</span
            >
            <button
              class="icon-btn"
              title="Previous page"
              aria-label="Previous page"
              ?disabled=${page === 0}
              @click=${() => this._setState(pageKey, page - 1)}
            >
              <span class="fas fa-chevron-left" aria-hidden="true"></span>
            </button>
            <button
              class="icon-btn"
              title="Next page"
              aria-label="Next page"
              ?disabled=${page >= pages - 1}
              @click=${() => this._setState(pageKey, page + 1)}
            >
              <span class="fas fa-chevron-right" aria-hidden="true"></span>
            </button>
          </div>`
        : nothing}`;
  }

  _button(p) {
    const label = str(p.label);
    const steps = (Array.isArray(p.action?.steps) ? p.action.steps : []).filter(
      (s) =>
        (s?.type === 'continue_conversation' && typeof s.message === 'string') ||
        (s?.type === 'open_url' && typeof s.url === 'string') ||
        (s?.type === 'run' && s.refType === 'query' && typeof s.statementId === 'string')
    );
    // A Button with no action sends its label (OpenUI's rule).
    const run = steps.length ? steps : [{ type: 'continue_conversation', message: label }];
    const opens = run.some((s) => s.type === 'open_url');
    const reads = run.some((s) => s.type === 'run');
    // A page of its own has no assistant to ask, and no live data to read again.
    if (this.standalone && !opens) return nothing;
    // Refresh with nothing live to read draws nothing.
    if (reads && !opens && !run.some((s) => s.type === 'continue_conversation') && !this._qm) return nothing;
    const variant = oneOf(p.variant, ['primary', 'secondary', 'tertiary'], 'secondary');
    return html`<button
      class="btn ${variant} ${oneOf(p.size, ['s', 'l'], '')}"
      title=${opens ? run.find((s) => s.type === 'open_url').url : ''}
      ?disabled=${this.disabled || this.streaming}
      @click=${() => this._fire(run)}
    >
      ${more.icon(p.icon, 'lead')}${label}${opens
        ? html`<span class="fas fa-external-link-alt"></span>`
        : nothing}
    </button>`;
  }
}

customElements.define('nomad-genui', GenUi);
