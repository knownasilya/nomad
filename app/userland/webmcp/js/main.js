import {
  LitElement,
  html,
  css,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// nomad://webmcp — WebMCP Inspector.
// Lists the tools every open tab has registered via document.modelContext, lets you run one by
// hand, and streams a live log of every tool call (agent + inspector). Backend: bg/webmcp-devtools.

const key = (wcId, name) => wcId + ':' + name;

function skeletonArgs(schema) {
  const props = schema && schema.properties;
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const t = v && v.type;
    out[k] =
      v && Array.isArray(v.enum)
        ? v.enum[0]
        : t === 'number' || t === 'integer'
          ? 0
          : t === 'boolean'
            ? false
            : t === 'array'
              ? []
              : t === 'object'
                ? {}
                : '';
  }
  return out;
}

function prettyOrigin(o) {
  if (!o) return '';
  if (o.startsWith('hyper://')) return 'hyper://' + o.slice(8, 14) + '…' + '/';
  return o.replace(/^https?:\/\//, '');
}

// bg reports hyper origins with a trailing slash (`hyper://key/`); a page's `location.origin`
// has none. Compare without it.
const normOrigin = (o) => (o || '').replace(/\/+$/, '');

const timeFmt = (ts) => new Date(ts).toLocaleTimeString();

export class WebmcpInspector extends LitElement {
  static get properties() {
    return { tabs: { type: Array }, log: { type: Array }, _tick: { state: true } };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        height: 100vh;
        overflow: hidden;
        color: var(--text-color--default, #1d1d1f);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .wrap {
        display: grid;
        grid-template-rows: auto 1fr;
        grid-template-columns: minmax(0, 1fr) 380px;
        grid-template-areas: 'head head' 'main log';
        height: 100%;
      }
      header {
        grid-area: head;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 18px;
        border-bottom: 1px solid var(--border-color--light, #e5e5ea);
        background: var(--bg-color--default, #fff);
      }
      header h1 {
        font-size: 15px;
        margin: 0;
        flex: 1;
      }
      header .muted {
        color: var(--text-color--light, #8a8a8e);
      }
      button {
        font: inherit;
        cursor: pointer;
        border: 1px solid var(--border-color--default, #d1d1d6);
        background: var(--bg-color--default, #fff);
        color: inherit;
        border-radius: 7px;
        padding: 5px 10px;
      }
      button:hover {
        background: var(--bg-color--light, #f5f5f7);
      }
      button.primary {
        background: var(--blue, #0a84ff);
        border-color: var(--blue, #0a84ff);
        color: #fff;
      }
      main {
        grid-area: main;
        overflow-y: auto;
        padding: 16px 18px;
      }
      aside {
        grid-area: log;
        overflow-y: auto;
        border-left: 1px solid var(--border-color--light, #e5e5ea);
        background: var(--bg-color--default, #fff);
        padding: 12px 14px;
      }
      aside h2,
      .tab h2 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-color--light, #8a8a8e);
        margin: 0 0 8px;
      }
      .tab {
        border: 1px solid var(--border-color--light, #e5e5ea);
        border-radius: 10px;
        margin-bottom: 14px;
        background: var(--bg-color--default, #fff);
        overflow: hidden;
      }
      .tab-head {
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid var(--border-color--light, #e5e5ea);
      }
      .tab-title {
        flex: 1;
        min-width: 0;
      }
      .tab-title .t {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tab-title .u {
        color: var(--text-color--light, #8a8a8e);
        font-size: 11.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      select {
        font: inherit;
        border-radius: 6px;
        padding: 3px 6px;
        border: 1px solid var(--border-color--default, #d1d1d6);
        background: var(--bg-color--default, #fff);
        color: inherit;
      }
      .tool {
        border-top: 1px solid var(--border-color--light, #f0f0f2);
      }
      .tool:first-child {
        border-top: none;
      }
      .tool-head {
        padding: 9px 12px;
        display: flex;
        align-items: baseline;
        gap: 8px;
        cursor: pointer;
      }
      .tool-head:hover {
        background: var(--bg-color--light, #f7f7f9);
      }
      .tool-head code {
        font-weight: 600;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      }
      .tool-head .d {
        color: var(--text-color--light, #8a8a8e);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tool-body {
        padding: 0 12px 12px 12px;
      }
      pre {
        background: var(--bg-color--light, #f5f5f7);
        border-radius: 6px;
        padding: 8px 10px;
        overflow-x: auto;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 11.5px;
        margin: 6px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 56px;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 12px;
        border-radius: 6px;
        border: 1px solid var(--border-color--default, #d1d1d6);
        padding: 7px 9px;
        resize: vertical;
        background: var(--bg-color--default, #fff);
        color: inherit;
        scrollbar-width: thin;
        scrollbar-color: rgba(120, 120, 128, 0.4) transparent;
      }
      textarea::-webkit-scrollbar {
        width: 8px;
      }
      textarea::-webkit-scrollbar-track {
        background: transparent;
      }
      textarea::-webkit-scrollbar-thumb {
        background: rgba(120, 120, 128, 0.4);
        border-radius: 4px;
        border: 2px solid transparent;
        background-clip: content-box;
      }
      textarea::-webkit-scrollbar-thumb:hover {
        background: rgba(120, 120, 128, 0.6);
        background-clip: content-box;
      }
      .run-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
      }
      .result-ok {
        color: var(--green, #1a7f37);
      }
      .result-err {
        color: var(--red, #c0392b);
      }
      .badge {
        display: inline-block;
        font-size: 10.5px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid var(--border-color--default, #d1d1d6);
        color: var(--text-color--light, #8a8a8e);
      }
      .badge.agent {
        border-color: #b9a3f5;
        color: #7c5cd6;
      }
      .badge.devtools {
        border-color: #9dc7ff;
        color: #2b7de0;
      }
      .empty {
        color: var(--text-color--light, #8a8a8e);
        padding: 30px 0;
        text-align: center;
      }
      .log-item {
        border-bottom: 1px solid var(--border-color--light, #f0f0f2);
        padding: 8px 0;
        font-size: 12px;
      }
      .log-item .line1 {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .log-item code {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-weight: 600;
      }
      .log-item .meta {
        color: var(--text-color--light, #8a8a8e);
        font-size: 11px;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          color: #f2f2f7;
        }
        header,
        aside,
        .tab,
        button,
        select,
        textarea {
          background: #2c2c2e;
          border-color: #3a3a3c;
        }
        button:hover,
        .tool-head:hover,
        pre {
          background: #3a3a3c;
        }
      }
    `;
  }

  constructor() {
    super();
    this.tabs = [];
    this.log = [];
    this._tick = 0;
    // ?origin=<origin> (from the chat UI's "Open in WebMCP Inspector" link) scopes the list
    // to one page; the header shows a "Show all" affordance to clear it.
    this._only = new URLSearchParams(location.search).get('origin') || null;
    this._expanded = new Set();
    this._args = {};
    this._result = {};
    this._reload = this._debounce(() => this._load(), 200);

    nomad.panes.setAttachable();
    nomad.panes.attachToLastActivePane();
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._seedLog();
    try {
      const evs = nomad.webmcp.watch();
      evs.addEventListener('change', () => this._reload());
      evs.addEventListener('invoke', (e) => this._mergeLog(e));
      evs.addEventListener('result', (e) => this._mergeLog(e));
      this._evs = evs;
    } catch (err) {
      console.warn('[webmcp inspector] watch failed', err);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    try {
      this._evs?.close();
    } catch {}
  }

  _debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  async _load() {
    const tabs = await nomad.webmcp.list();
    tabs.sort((a, b) => b.tools.length - a.tools.length || a.url.localeCompare(b.url));
    this.tabs = tabs;
  }

  async _seedLog() {
    try {
      const log = await nomad.webmcp.getLog();
      this.log = log.slice().reverse();
    } catch {}
  }

  _mergeLog(entry) {
    if (!entry || !entry.id) return;
    const next = this.log.filter((x) => x.id !== entry.id);
    next.unshift(entry);
    this.log = next.slice(0, 200);
  }

  _toggle(wcId, tool) {
    const k = key(wcId, tool.name);
    if (this._expanded.has(k)) {
      this._expanded.delete(k);
    } else {
      this._expanded.add(k);
      if (this._args[k] === undefined) {
        this._args[k] = JSON.stringify(skeletonArgs(tool.inputSchema), null, 2);
      }
    }
    this._tick++;
  }

  async _run(wcId, tool) {
    const k = key(wcId, tool.name);
    this._result[k] = { running: true };
    this._tick++;
    const r = await nomad.webmcp.invoke(wcId, tool.name, this._args[k] || '{}');
    this._result[k] = r;
    this._tick++;
  }

  async _setPerm(tab, value) {
    const token = 'webmcpTools:' + tab.origin;
    if (value === '') await nomad.sitedata.clearPermission(tab.url, token);
    else await nomad.sitedata.setPermission(tab.url, token, +value);
    this._load();
  }

  render() {
    const shown = this._only
      ? this.tabs.filter((t) => normOrigin(t.origin) === normOrigin(this._only))
      : this.tabs;
    const withTools = shown.filter((t) => t.tools.length);
    const bareCount = shown.length - withTools.length;
    return html`
      <div class="wrap">
        <header>
          <h1>WebMCP Inspector</h1>
          <span class="muted"
            >${withTools.length} page${withTools.length === 1 ? '' : 's'} with tools${bareCount
              ? ` · ${bareCount} without`
              : ''}</span
          >
          ${this._only
            ? html`<span class="badge"
                >Filtered to ${prettyOrigin(this._only)} ·
                <a href="nomad://webmcp">Show all</a></span
              >`
            : ''}
          <button @click=${() => this._load()}><i class="fas fa-sync"></i> Refresh</button>
        </header>

        <main>
          ${withTools.length
            ? withTools.map((t) => this._renderTab(t))
            : html`<div class="empty">
                No open page has registered any WebMCP tools.<br />Open a drive that calls
                <code>document.modelContext.registerTool()</code>.
              </div>`}
        </main>

        <aside>
          <h2>Activity</h2>
          ${this.log.length
            ? this.log.map((e) => this._renderLog(e))
            : html`<div class="empty" style="padding:16px 0">No tool calls yet.</div>`}
        </aside>
      </div>
    `;
  }

  _renderTab(tab) {
    const permVal = tab.permission === 1 ? '1' : tab.permission === 0 ? '0' : '';
    return html`
      <div class="tab">
        <div class="tab-head">
          <div class="tab-title">
            <div class="t">${tab.title || tab.origin}</div>
            <div class="u">${tab.url}</div>
          </div>
          <label class="muted" title="AI-assistant access to this page's tools">
            <select @change=${(e) => this._setPerm(tab, e.target.value)}>
              <option value="" ?selected=${permVal === ''}>Ask</option>
              <option value="1" ?selected=${permVal === '1'}>Allow</option>
              <option value="0" ?selected=${permVal === '0'}>Deny</option>
            </select>
          </label>
        </div>
        ${tab.tools.map((tool) => this._renderTool(tab, tool))}
      </div>
    `;
  }

  _renderTool(tab, tool) {
    const k = key(tab.wcId, tool.name);
    const open = this._expanded.has(k);
    const res = this._result[k];
    return html`
      <div class="tool">
        <div class="tool-head" @click=${() => this._toggle(tab.wcId, tool)}>
          <i class="fas fa-fw fa-${open ? 'caret-down' : 'caret-right'}"></i>
          <code>${tool.name}</code>
          <span class="d">${tool.description || ''}</span>
        </div>
        ${open
          ? html`
              <div class="tool-body">
                ${tool.inputSchema
                  ? html`<pre>${JSON.stringify(tool.inputSchema, null, 2)}</pre>`
                  : html`<div class="muted">no input schema</div>`}
                <textarea
                  .value=${this._args[k] ?? '{}'}
                  @input=${(e) => (this._args[k] = e.target.value)}
                ></textarea>
                <div class="run-row">
                  <button class="primary" @click=${() => this._run(tab.wcId, tool)}>
                    <i class="fas fa-play"></i> Run
                  </button>
                  ${res?.running ? html`<span class="muted">running…</span>` : ''}
                  ${res && !res.running
                    ? html`<span class=${res.ok ? 'result-ok' : 'result-err'}
                        >${res.ok ? 'ok' : 'error'} · ${res.ms}ms</span
                      >`
                    : ''}
                </div>
                ${res && !res.running
                  ? html`<pre>${
                      res.ok ? this._fmt(res.result) : res.error
                    }</pre>`
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }

  _fmt(v) {
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  _renderLog(e) {
    const tab = this.tabs.find((t) => t.wcId === e.wcId);
    const pending = e.ok === undefined && !e.error;
    return html`
      <div class="log-item">
        <div class="line1">
          <span class="badge ${e.source}">${e.source}</span>
          <code>${e.name}</code>
          ${pending
            ? html`<span class="meta">…</span>`
            : html`<span class=${e.ok ? 'result-ok' : 'result-err'}
                >${e.ok ? 'ok' : 'err'}${e.ms != null ? ` ${e.ms}ms` : ''}</span
              >`}
        </div>
        <div class="meta">
          ${timeFmt(e.ts)} · ${tab ? tab.title || prettyOrigin(tab.origin) : 'wc ' + e.wcId}
        </div>
        ${e.args && Object.keys(e.args).length
          ? html`<div class="meta">args: ${JSON.stringify(e.args)}</div>`
          : ''}
        ${e.error ? html`<div class="meta result-err">${e.error}</div>` : ''}
      </div>
    `;
  }
}

customElements.define('webmcp-inspector', WebmcpInspector);
