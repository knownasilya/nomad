// The command palette (Cmd/Ctrl+K, window-menu.js `commandPalette`): type to open an address,
// switch to an open tab, reopen a recent page or open one of Nomad's own pages, all from the
// window's current Space. The rows are app/lib/command-palette.ts; the data comes from
// bg/ui/subwindows/shell-menus.js (`getPalette`, `searchPaletteHistory`).

import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import * as bg from './bg-process-rpc';
import { spaceDot } from '../lib/space-mark.js';
import { paletteResults, moveSelection, isNamesOnly } from '../../lib/command-palette';

const WIDTH = 620;
const HISTORY_DEBOUNCE = 120;
const DRIVE_KEY_REGEX = /([0-9a-f]{64})/gi;

class CommandPaletteMenu extends LitElement {
  static get properties() {
    return {
      query: { type: String },
      selected: { type: Number },
      data: { type: Object },
      history: { type: Array },
    };
  }

  constructor() {
    super();
    this.isDarwin = window.platform === 'darwin';
    this.reset();
  }

  reset() {
    this.query = '';
    this.selected = 0;
    this.data = null;
    this.history = [];
    this.results = [];
    this.historyQueryId = 0;
    this.pointerAt = null;
    clearTimeout(this.historyTimer);
  }

  async init() {
    this.isDarwin = window.platform === 'darwin';
    this.focusInput();
    this.data = await bg.shellMenus.getPalette();
    this.focusInput();
  }

  focusInput() {
    this.updateComplete.then(() => {
      const input = this.shadowRoot.querySelector('input');
      if (input) input.focus();
    });
  }

  willUpdate(changed) {
    if (changed.has('query') || changed.has('data') || changed.has('history')) {
      this.results = this.data
        ? paletteResults({
            query: this.query,
            tabs: this.data.tabs,
            recent: this.data.recent,
            history: this.history,
            searchEngine: this.data.searchEngine,
            names: this.data.names,
          })
        : [];
      if (this.selected >= this.results.length) this.selected = this.results.length ? 0 : -1;
      if (this.selected < 0 && this.results.length) this.selected = 0;
    }
  }

  updated() {
    // fit the view to what's listed
    const el = this.shadowRoot.querySelector('.palette');
    if (el) bg.shellMenus.resizeSelf({ width: WIDTH, height: (el.offsetHeight | 0) + 2 });
    const sel = this.shadowRoot.querySelector('.row.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  render() {
    const space = this.data?.space;
    let lastGroup = null;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="palette" role="dialog" aria-label="Command palette">
        <div class="input-row">
          <span class="fas fa-search lead" aria-hidden="true"></span>
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="Search tabs, names, pages and history, or type an address"
            aria-label="Search tabs, names, pages and history, or type an address"
            aria-controls="palette-results"
            aria-activedescendant=${this.selected >= 0 ? `palette-row-${this.selected}` : ''}
            .value=${this.query}
            @input=${this.onInput}
            @keydown=${this.onKeydown}
          />
          ${space
            ? html`<span class="space" title="Tabs and history from the ${space.name} Space">
                ${spaceDot(space)}<span class="space-name">${space.name}</span>
              </span>`
            : ''}
        </div>
        <div class="results" id="palette-results" role="listbox" aria-label="Results">
          ${!this.data
            ? html`<div class="empty">Loading…</div>`
            : !this.results.length
              ? html`<div class="empty">
                  ${isNamesOnly(this.query) ? 'None of your names match.' : 'Nothing in this Space matches.'}
                </div>`
              : repeat(
                  this.results,
                  (r) => `${r.kind}:${r.tabIndex ?? ''}:${r.url}`,
                  (r, i) => {
                    const heading = r.group && r.group !== lastGroup ? r.group : null;
                    if (r.group) lastGroup = r.group;
                    return html`
                      ${heading ? html`<div class="group" role="presentation">${heading}</div>` : ''}
                      ${this.renderRow(r, i)}
                    `;
                  }
                )}
        </div>
        <div class="footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⇧</kbd><kbd>↵</kbd> open in this tab</span>
          <span><kbd>#</kbd> names only</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    `;
  }

  renderRow(r, i) {
    const switching = r.kind === 'tab' || r.tabIndex !== undefined;
    const hint = switching ? 'Switch to tab' : r.kind === 'search' ? 'Search' : 'Open';
    return html`
      <div
        id="palette-row-${i}"
        class="row ${i === this.selected ? 'selected' : ''}"
        role="option"
        aria-selected=${i === this.selected ? 'true' : 'false'}
        @mousemove=${(e) => this.onHover(e, i)}
        @click=${(e) => this.choose(r, { here: e.shiftKey })}
      >
        <span class="icon">${this.renderIcon(r)}</span>
        <span class="text">
          <span class="title">${r.title}</span>
          ${r.subtitle ? html`<span class="subtitle">${niceUrl(r.subtitle)}</span>` : ''}
        </span>
        ${r.isPinned ? html`<span class="fas fa-thumbtack pin" title="Pinned"></span>` : ''}
        <span class="hint">${hint}</span>
      </div>
    `;
  }

  renderIcon(r) {
    if (r.kind === 'goto') return html`<span class="fas fa-arrow-right" aria-hidden="true"></span>`;
    if (r.kind === 'search') return html`<span class="fas fa-search" aria-hidden="true"></span>`;
    if (r.kind === 'name') return html`<span class="fas fa-tag" aria-hidden="true"></span>`;
    if (r.kind === 'page' && r.icon) return html`<span class="${r.icon}" aria-hidden="true"></span>`;
    if (r.kind === 'page' && r.app) return html`<img src="asset:favicon:nomad://${r.app}/" alt="" />`;
    return html`<img src=${'asset:favicon-32:' + r.url} alt="" />`;
  }

  // events
  // =

  onInput(e) {
    this.query = e.currentTarget.value;
    this.selected = 0;
    this.fetchHistory();
  }

  // Older history for what's typed; the newest visits are already in `data.recent`.
  fetchHistory() {
    clearTimeout(this.historyTimer);
    const q = this.query.trim();
    const id = ++this.historyQueryId;
    if (!q || isNamesOnly(q)) {
      this.history = [];
      return;
    }
    this.historyTimer = setTimeout(async () => {
      const rows = await bg.shellMenus.searchPaletteHistory(q).catch(() => []);
      if (id === this.historyQueryId) this.history = rows || [];
    }, HISTORY_DEBOUNCE);
  }

  onKeydown(e) {
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'ArrowDown' || (ctrlOnly && e.key === 'n')) {
      e.preventDefault();
      this.selected = moveSelection(this.selected, 1, this.results.length);
    } else if (e.key === 'ArrowUp' || (ctrlOnly && e.key === 'p')) {
      e.preventDefault();
      this.selected = moveSelection(this.selected, -1, this.results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.results[this.selected];
      if (r) this.choose(r, { here: e.shiftKey });
    }
  }

  // Hovering selects a row, but only once the pointer really moves: the palette opens under a
  // resting pointer, and that shouldn't take the selection off the first row.
  onHover(e, i) {
    const at = `${e.screenX},${e.screenY}`;
    if (this.pointerAt === null || this.pointerAt === at) {
      this.pointerAt = at;
      return;
    }
    this.pointerAt = at;
    if (this.selected !== i) this.selected = i;
  }

  choose(r, { here = false } = {}) {
    if (r.tabIndex !== undefined && !here) {
      bg.shellMenus.switchToTab(r.tabIndex);
    } else {
      bg.shellMenus.openFromPalette(r.url, { here });
    }
  }
}

CommandPaletteMenu.styles = css`
  :host {
    display: block;
    --palette-selected: #105de8;
    --palette-subtle: var(--text-color--menus-wrapper--light);
    --palette-kbd-bg: rgba(0, 0, 0, 0.06);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --palette-selected: #2f6fe4;
      --palette-kbd-bg: rgba(255, 255, 255, 0.1);
    }
  }

  .palette {
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 52px;
    border-bottom: 1px solid var(--border-color--light);
  }
  .input-row .lead {
    color: var(--palette-subtle);
    font-size: 14px;
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 17px;
    user-select: text;
  }
  input::placeholder {
    color: var(--palette-subtle);
  }
  .space {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    max-width: 160px;
    padding: 3px 9px;
    border-radius: 12px;
    border: 1px solid var(--border-color--light);
    color: var(--palette-subtle);
    font-size: 11.5px;
  }
  .space .dot {
    display: inline-block;
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .space svg.dot {
    border-radius: 0;
    width: 11px;
    height: 11px;
    flex-basis: 11px;
  }
  .space-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .results {
    max-height: 380px;
    overflow-y: auto;
    padding: 4px 6px 6px;
  }
  .results::-webkit-scrollbar {
    width: 8px;
  }
  .results::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: var(--border-color--default);
  }
  .group {
    padding: 8px 10px 3px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--palette-subtle);
  }
  .empty {
    padding: 18px 12px;
    color: var(--palette-subtle);
    text-align: center;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: default;
  }
  .row .icon {
    flex: 0 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color--menu-item-icon);
  }
  .row .icon img {
    width: 16px;
    height: 16px;
  }
  .row .text {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .row .title,
  .row .subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .title {
    flex: 0 1 auto;
  }
  .row .subtitle {
    flex: 1 1 0;
    min-width: 60px;
    font-size: 11.5px;
    color: var(--palette-subtle);
  }
  .row .pin {
    font-size: 10px;
    color: var(--palette-subtle);
  }
  .row .hint {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--palette-subtle);
    visibility: hidden;
  }
  .row.selected {
    background: var(--palette-selected);
    color: #fff;
  }
  .row.selected .icon,
  .row.selected .subtitle,
  .row.selected .pin,
  .row.selected .hint {
    color: rgba(255, 255, 255, 0.85);
  }
  .row.selected .hint {
    visibility: visible;
  }

  .footer {
    display: flex;
    gap: 14px;
    padding: 7px 14px;
    border-top: 1px solid var(--border-color--light);
    color: var(--palette-subtle);
    font-size: 11px;
  }
  kbd {
    display: inline-block;
    min-width: 10px;
    margin-right: 2px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--palette-kbd-bg);
    font: inherit;
    font-size: 10.5px;
    text-align: center;
  }
`;

customElements.define('command-palette-menu', CommandPaletteMenu);

function niceUrl(str) {
  if (typeof str !== 'string') return str;
  return str.replace(DRIVE_KEY_REGEX, (_, m) => `${m.slice(0, 6)}..${m.slice(-2)}`);
}
