import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import spinnerCSS from './spinner.css';
import * as bg from './bg-process-rpc';

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

class ShellWindowSidebar extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      spaces: { type: Array },
      activeSpace: { type: Object },
      groups: { type: Array },
      sidebarSide: { type: String, attribute: 'sidebar-side' },
      sidebarWidth: { type: Number, attribute: 'sidebar-width' },
      collapsedGroups: { type: Object },
      editingGroupId: { type: String },
    };
  }

  constructor() {
    super();
    this.tabs = [];
    this.spaces = [];
    this.activeSpace = null;
    this.groups = [];
    this.sidebarSide = 'left';
    this.sidebarWidth = 220;
    this.collapsedGroups = new Set();
    this.editingGroupId = null;
    this.faviconCache = {};
    this._resizing = false;
    this._loadCollapsedGroups();
  }

  async _loadCollapsedGroups() {
    try {
      const ids = await bg.beakerBrowser.getSetting('sidebar_collapsed_groups');
      this.collapsedGroups = new Set(Array.isArray(ids) ? ids : []);
      this.requestUpdate();
    } catch (e) {
      // ignore — defaults to empty set
    }
  }

  async _persistCollapsedGroups() {
    await bg.views.setSidebarCollapsedGroups([...this.collapsedGroups]);
  }

  getFavicon(index) {
    const tab = this.tabs[index];
    if (!tab) return;
    let cache;
    try {
      cache = this.faviconCache[new URL(tab.url).origin];
    } catch (e) {
      // invalid URL
    }
    if (tab.favicons && tab.favicons[0]) {
      if (cache && cache.lastTried === tab.favicons[0]) return null;
      return tab.favicons[0];
    }
    if (cache) return cache.url;
  }

  toggleGroup(groupId) {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId);
    } else {
      this.collapsedGroups.add(groupId);
    }
    this.collapsedGroups = new Set(this.collapsedGroups);
    this._persistCollapsedGroups();
  }

  // rendering
  // =

  render() {
    const isLeft = this.sidebarSide !== 'right';
    const isDarwin = document.body.classList.contains('darwin');
    const sidebarStyle = styleMap({
      width: `${this.sidebarWidth}px`,
      [isLeft ? 'left' : 'right']: '0',
    });
    const cls = classMap({
      sidebar: true,
      'side-right': !isLeft,
      darwin: isDarwin,
    });
    const pinnedTabs = this.tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => tab.isPinned);
    const hasPinned = pinnedTabs.length > 0;
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      <div class="${cls}" style=${sidebarStyle}>
        <div class="sidebar-header">
          ${isDarwin && isLeft ? html`<div class="traffic-light-spacer"></div>` : ''}
          <button class="close-btn" title="Hide sidebar" @click=${this._onClickCollapse}>
            <span class="fas fa-chevron-${isLeft ? 'left' : 'right'}"></span>
          </button>
        </div>
        <div class="sidebar-tabs">
          ${hasPinned ? html`
            ${repeat(pinnedTabs, ({ index }) => `pin:${index}`, ({ tab, index }) => this._renderTab(tab, index))}
            <div class="tab-separator"></div>
          ` : ''}
          ${this._renderUngroupedTabs()}
          ${repeat(this.groups || [], (g) => g.id, (g) => this._renderGroup(g))}
          <button class="new-tab-inline" title="New tab" @click=${this._onClickNew}>
            <span class="new-tab-icon fas fa-plus"></span>
            <span class="new-tab-label">New tab</span>
          </button>
        </div>
        ${this._renderSpacesDropdown() ? html`
          <div class="sidebar-footer">${this._renderSpacesDropdown()}</div>
        ` : ''}
        ${this._renderResizeHandle(isLeft)}
      </div>
    `;
  }

  _renderUngroupedTabs() {
    const ungrouped = this.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => !tab.groupId && !tab.isPinned);
    if (!ungrouped.length) return '';
    return repeat(
      ungrouped,
      ({ index }) => `tab:${index}`,
      ({ tab, index }) => this._renderTab(tab, index)
    );
  }

  _renderGroup(group) {
    const isCollapsed = this.collapsedGroups.has(group.id);
    const groupTabs = this.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => tab.groupId === group.id);
    const isEditing = this.editingGroupId === group.id;
    return html`
      <div class="group">
        <div
          class="group-header"
          style=${styleMap({ '--group-color': group.color })}
          @click=${() => this.toggleGroup(group.id)}
          @contextmenu=${(e) => this._onContextmenuGroup(e, group.id)}
        >
          <span class="group-dot"></span>
          ${isEditing
            ? html`<input
                class="group-name-input"
                .value=${group.name}
                @blur=${(e) => this._onGroupNameBlur(e, group.id)}
                @keydown=${(e) => this._onGroupNameKeydown(e, group.id)}
                @click=${(e) => e.stopPropagation()}
              />`
            : html`<span
                class="group-name"
                @dblclick=${(e) => this._onDblclickGroupName(e, group.id)}
                >${group.name}</span
              >`}
          <span class="group-chevron fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></span>
        </div>
        ${isCollapsed
          ? ''
          : repeat(
              groupTabs,
              ({ index }) => `tab:${index}`,
              ({ tab, index }) => this._renderTab(tab, index, true)
            )}
      </div>
    `;
  }

  _renderTab(tab, index, inGroup = false) {
    const faviconUrl = this.getFavicon(index);
    const showFavicon = Boolean(
      tab.isLoading || tab.isPinned || faviconUrl || tab.url.startsWith('beaker:')
    );
    const cls = classMap({
      'sidebar-tab': true,
      current: tab.isActive,
      pinned: tab.isPinned,
      'in-group': inGroup,
    });
    return html`
      <div
        class="${cls}"
        title=${tab.title || tab.url}
        @click=${() => bg.views.setActiveTab(index)}
        @contextmenu=${(e) => this._onContextmenuTab(e, index)}
        @mousedown=${(e) => this._onMousedownTab(e, index)}
      >
        <div class="tab-favicon">
          ${tab.isLoading
            ? tab.isReceivingAssets
              ? html`<div class="spinner"></div>`
              : html`<div class="spinner reverse"></div>`
            : faviconUrl
            ? html`<img
                src="${faviconUrl}"
                @load=${(e) => this._onFaviconLoad(e, index)}
                @error=${(e) => this._onFaviconError(e, index)}
              />`
            : html`<img src="asset:favicon:${tab.url}?cache=${Date.now()}" />`}
        </div>
        <div class="tab-title">${tab.title || tab.url}</div>
        ${tab.isAudioMuted
          ? html`<span class="fas fa-volume-mute tab-audio"></span>`
          : tab.isCurrentlyAudible
          ? html`<span class="fas fa-volume-up tab-audio"></span>`
          : ''}
        <div class="tab-close" title="Close tab" @click=${(e) => this._onClickClose(e, index)}></div>
      </div>
    `;
  }

  _renderResizeHandle(isLeft) {
    const side = isLeft ? 'right' : 'left';
    return html`
      <div
        class="resize-handle"
        style=${styleMap({ [side]: '0' })}
        @mousedown=${this._onResizeMousedown}
      ></div>
    `;
  }

  _renderSpacesDropdown() {
    if (!this.spaces || this.spaces.length <= 1) return '';
    const space = this.activeSpace;
    return html`
      <button
        class="spaces-btn"
        title="Switch space"
        @click=${(e) => this._onClickSpaces(e)}
      >
        <span class="space-dot" style="background:${space?.color || '#6c6cff'}"></span>
        <span class="space-name">${space?.name || 'Spaces'}</span>
      </button>
    `;
  }

  updated(changedProperties) {
    if (this.editingGroupId) {
      const input = this.shadowRoot.querySelector('.group-name-input');
      if (input) { input.focus(); input.select(); }
    }
  }

  // events
  // =

  _onClickCollapse() {
    bg.views.toggleSidebarCollapsed();
  }

  _onClickSpaces(e) {
    const isLeft = this.sidebarSide !== 'right';
    const menuW = 200;
    const menuH = 300;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = isLeft ? rect.left : Math.max(0, rect.right - menuW);
    const top = Math.max(0, rect.top - menuH);
    bg.views.toggleMenu('spaces', { bounds: { left, top } });
  }

  _onClickNew() {
    bg.views.createTab(undefined, { focusLocationBar: true, setActive: true });
  }

  _onClickClose(e, index) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.closeTab(index);
  }

  _onContextmenuTab(e, index) {
    bg.views.showTabContextMenu(index);
  }

  _onMousedownTab(e, index) {
    if (e.which === 2) bg.views.closeTab(index);
  }

  _onContextmenuGroup(e, groupId) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.showGroupContextMenu(groupId);
  }

  _onDblclickGroupName(e, groupId) {
    e.stopPropagation();
    this.editingGroupId = groupId;
  }

  _onGroupNameBlur(e, groupId) {
    const name = e.target.value.trim();
    if (name) bg.views.renameTabGroup(groupId, name);
    this.editingGroupId = null;
  }

  _onGroupNameKeydown(e, groupId) {
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (name) bg.views.renameTabGroup(groupId, name);
      this.editingGroupId = null;
    } else if (e.key === 'Escape') {
      this.editingGroupId = null;
    }
  }

  _onFaviconLoad(e, index) {
    const tab = this.tabs[index];
    const url = tab.favicons && tab.favicons[0] ? tab.favicons[0] : null;
    try {
      const origin = new URL(tab.url).origin;
      this.faviconCache[origin] = { url };
    } catch (e) {}
  }

  _onFaviconError(e, index) {
    const tab = this.tabs[index];
    try {
      const origin = new URL(tab.url).origin;
      this.faviconCache[origin] = {
        lastTried: tab.favicons ? tab.favicons[0] : null,
        url: null,
      };
    } catch (e) {}
    this.tabs[index].favicons = null;
    this.requestUpdate();
  }

  _onResizeMousedown(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.sidebarWidth;
    const isLeft = this.sidebarSide !== 'right';

    const onMove = (moveE) => {
      const delta = isLeft
        ? moveE.clientX - startX
        : startX - moveE.clientX;
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + delta));
      this.sidebarWidth = newW;
      bg.views.setSidebarWidth(newW);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      bg.beakerBrowser.setSetting('sidebar_width', this.sidebarWidth);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}

ShellWindowSidebar.styles = css`
  ${spinnerCSS}

  :host {
    display: block;
  }

  .sidebar {
    position: fixed;
    top: 0;
    height: 100vh;
    background: var(--bg-color--background);
    border-right: 1px solid var(--border-color--tab);
    display: flex;
    flex-direction: column;
    z-index: 10;
    box-sizing: border-box;
    overflow: hidden;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }

  .sidebar.side-right {
    border-right: none;
    border-left: 1px solid var(--border-color--tab);
  }

  /* header */

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 6px 6px 4px;
    height: 34px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }

  /* On macOS left sidebar, reserve 80px for traffic lights */
  .sidebar.darwin:not(.side-right) .sidebar-header {
    padding-left: 80px;
  }

  .traffic-light-spacer {
    flex: 1;
    -webkit-app-region: drag;
  }

  .close-btn {
    -webkit-app-region: no-drag;
    background: transparent;
    border: 0;
    color: var(--text-color--tab--title);
    cursor: default;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    opacity: 0.4;
    transition: opacity 0.15s, background 0.15s;
  }

  .close-btn:hover {
    opacity: 1;
    background: var(--bg-color--tab--hover);
  }

  /* tab list */

  .sidebar-tabs {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 6px;
  }

  .tab-separator {
    height: 1px;
    background: var(--border-color--tab);
    margin: 4px 2px 4px;
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 34px;
    padding: 0 8px;
    border-radius: 6px;
    cursor: default;
    position: relative;
    transition: background 0.1s;
    -webkit-user-select: none;
    user-select: none;
  }

  .sidebar-tab:hover {
    background: var(--bg-color--tab--hover);
  }

  .sidebar-tab.current {
    background: var(--bg-color--tab--current);
    box-shadow: inset 2px 0 0 var(--highlight-color--tab--current, #5b5ef4);
  }

  .sidebar-tab.in-group {
    padding-left: 22px;
  }

  .tab-favicon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-favicon img {
    width: 16px;
    height: 16px;
  }

  .tab-favicon .spinner {
    width: 11px;
    height: 11px;
  }

  .tab-title {
    flex: 1;
    font-size: 13px;
    color: var(--text-color--default, var(--text-color--tab--title));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-audio {
    font-size: 10px;
    color: var(--text-color--tab--title);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .tab-close {
    opacity: 0;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
    color: var(--text-color--tab--close);
    transition: opacity 0.1s, background 0.1s;
  }

  .tab-close::before {
    content: '\\00D7';
    font-weight: 300;
  }

  .sidebar-tab:hover .tab-close {
    opacity: 0.6;
  }

  .tab-close:hover {
    opacity: 1 !important;
    background: var(--bg-color--tab-close--hover);
  }

  /* groups */

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px;
    border-radius: 6px;
    cursor: default;
    -webkit-user-select: none;
    user-select: none;
    transition: background 0.1s;
    margin-top: 6px;
  }

  .group-header:hover {
    background: var(--bg-color--tab--hover);
  }

  .group-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--group-color, #5b5ef4);
    flex-shrink: 0;
  }

  .group-name {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--default, var(--text-color--tab--title));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-name-input {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--group-color, #5b5ef4) 45%, transparent);
    border-radius: 3px;
    color: var(--text-color--default, var(--text-color--tab--title));
    outline: none;
    padding: 1px 4px;
    cursor: text;
  }

  .group-chevron {
    font-size: 9px;
    opacity: 0.4;
    flex-shrink: 0;
  }

  /* new tab inline */

  .new-tab-inline {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 34px;
    padding: 0 8px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    cursor: default;
    width: 100%;
    font-size: 13px;
    color: var(--text-color--tab--add, var(--text-color--tab--title));
    opacity: 0.5;
    -webkit-user-select: none;
    user-select: none;
    transition: background 0.1s, opacity 0.1s;
    margin-top: 2px;
  }

  .new-tab-inline:hover {
    background: var(--bg-color--tab--hover);
    opacity: 1;
  }

  .new-tab-icon {
    font-size: 11px;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .new-tab-label {
    text-align: left;
  }

  /* footer (spaces only) */

  .sidebar-footer {
    flex-shrink: 0;
    padding: 4px 6px;
    border-top: 1px solid var(--border-color--tab);
  }

  .spaces-btn {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 34px;
    padding: 0 8px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    cursor: default;
    color: var(--text-color--tab--title);
    font-size: 13px;
    width: 100%;
    -webkit-user-select: none;
    user-select: none;
    transition: background 0.1s;
  }

  .spaces-btn:hover {
    background: var(--bg-color--tab--hover);
  }

  .space-dot {
    flex-shrink: 0;
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .space-name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* resize handle */

  .resize-handle {
    position: absolute;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    z-index: 1;
  }

  .resize-handle:hover,
  .resize-handle:active {
    background: var(--highlight-color--tab--current, #5b5ef4);
    opacity: 0.3;
  }

`;

customElements.define('shell-window-sidebar', ShellWindowSidebar);
