import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import { splitCandidates } from '../shell-window/split-drop.js';

// The split picker, opened from the Split button in a pane's status bar (fg/shell-window/panes.js).
// It lists the Space's other open tabs; the one picked moves into a split right of that pane
// (bg tabs/manager.js moveTabIntoSplit). "New tab" and "This page" open a new pane there instead.
class SplitMenu extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      query: { type: String },
      selected: { type: Number },
    };
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.tabs = [];
    this.query = '';
    this.selected = 0;
    this.paneId = undefined;
  }

  async init(params) {
    this.paneId = params?.paneId;
    this.tabs = (await bg.views.getState().catch(() => [])) || [];
    await this.updateComplete;
    this.shadowRoot.querySelector('input')?.focus();
  }

  get candidates() {
    return splitCandidates(this.tabs, this.query);
  }

  render() {
    const items = this.candidates;
    const sel = Math.min(this.selected, Math.max(items.length - 1, 0));
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <div class="title"><i class="fas fa-columns"></i> Open beside this page</div>
        <div class="search">
          <input
            type="text"
            placeholder="Find an open tab"
            .value=${this.query}
            @input=${this.onInput}
            @keydown=${this.onKeydown}
          />
        </div>
        <div class="list">
          ${items.length
            ? items.map(
                (item, i) => html`
                  <div
                    class=${classMap({ 'menu-item': true, tab: true, selected: i === sel })}
                    title=${item.tab.url}
                    @click=${() => this.pick(item)}
                    @mouseenter=${() => (this.selected = i)}
                  >
                    <img class="favicon" src=${this.favicon(item.tab)} alt="" />
                    <span class="text">
                      <span class="label">${item.tab.title || item.tab.url}</span>
                      <span class="url">${shortUrl(item.tab.url)}</span>
                    </span>
                  </div>
                `
              )
            : html`<div class="empty">
                ${this.query ? 'No open tab matches.' : 'No other tabs are open in this space.'}
              </div>`}
        </div>
        <div class="section actions">
          <div class="menu-item" @click=${() => this.splitWith('new-tab')}>
            <i class="fas fa-plus"></i>
            <span class="label">New tab</span>
          </div>
          <div class="menu-item" @click=${() => this.splitWith('same')}>
            <i class="far fa-clone"></i>
            <span class="label">This page again</span>
          </div>
        </div>
        <div class="hint">Or drag a tab onto the page</div>
      </div>
    `;
  }

  favicon(tab) {
    return tab.favicons?.[0] || `asset:favicon:${tab.url}`;
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.shellMenus.resizeSelf({ width: el.clientWidth | 0, height: el.clientHeight | 0 });
    this.shadowRoot.querySelector('.menu-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  onInput(e) {
    this.query = e.target.value;
    this.selected = 0;
  }

  onKeydown(e) {
    const items = this.candidates;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selected = Math.min(this.selected + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selected = Math.max(this.selected - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[Math.min(this.selected, items.length - 1)];
      if (item) this.pick(item);
    }
  }

  async pick(item) {
    bg.shellMenus.close();
    await bg.views.moveTabIntoSplit(item.index, 'active', { paneId: this.paneId, edge: 'right' });
  }

  async splitWith(which) {
    bg.shellMenus.close();
    await bg.views.splitPaneWithUrl(this.paneId, which);
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'hyper:' && u.hostname.length > 20) {
      return `hyper://${u.hostname.slice(0, 6)}…${u.pathname === '/' ? '' : u.pathname}`;
    }
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}` || url;
  } catch (e) {
    return url;
  }
}

SplitMenu.styles = [
  commonCSS,
  css`
    .wrapper {
      width: 300px;
      color: var(--text-color--menus-wrapper);
    }
    .title {
      padding: 10px 14px 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .title i {
      margin-right: 4px;
      color: var(--text-color--menu-item-icon--light);
    }
    .search {
      padding: 0 10px 6px;
    }
    .search input {
      box-sizing: border-box;
      width: 100%;
      height: 26px;
      padding: 0 8px;
      font: inherit;
      font-size: 12px;
      color: var(--text-color--menus-wrapper);
      background: transparent;
      border: 1px solid var(--border-color--default);
      border-radius: 4px;
      outline: 0;
    }
    .search input:focus {
      border-color: #4d82e4;
      box-shadow: 0 0 0 2px rgba(77, 130, 228, 0.25);
    }
    .list {
      max-height: 228px;
      overflow-y: auto;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-color--default);
    }
    .menu-item.tab {
      height: 38px;
      padding: 0 12px;
    }
    .menu-item.tab:hover {
      background: none;
    }
    .menu-item.selected,
    .menu-item.selected:hover {
      background: var(--bg-color--menu-item--hover);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.3;
    }
    .label {
      font-size: 12px;
    }
    .url {
      font-size: 11px;
      color: var(--text-color--menus-wrapper--light);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      padding: 8px 14px 4px;
      font-size: 12px;
      color: var(--text-color--menus-wrapper--light);
    }
    .actions {
      border-bottom: 0;
      padding-bottom: 2px;
    }
    .hint {
      padding: 2px 14px 8px;
      font-size: 11px;
      color: var(--text-color--menus-wrapper--light);
    }
  `,
];

customElements.define('split-menu', SplitMenu);
