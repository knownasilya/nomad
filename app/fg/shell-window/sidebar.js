import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import spinnerCSS from './spinner.css';
import * as bg from './bg-process-rpc';

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

const SPACE_COLORS = [
  '#6c6cff',
  '#e85d4a',
  '#e8a025',
  '#3ab36e',
  '#2b9fd4',
  '#9b59b6',
  '#e91e8c',
  '#607d8b',
];

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
      spacesPopupOpen: { type: Boolean },
      isCreatingSpace: { type: Boolean },
      newSpaceName: { type: String },
      newSpaceColor: { type: String },
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
    this.spacesPopupOpen = false;
    this.isCreatingSpace = false;
    this.newSpaceName = '';
    this.newSpaceColor = SPACE_COLORS[0];
    this._loadCollapsedGroups();
    this._boundClosePopup = this._closeSpacesPopup.bind(this);
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
    const pinnedTabs = this.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => tab.isPinned);
    const hasPinned = pinnedTabs.length > 0;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="${cls}" style=${sidebarStyle}>
        <div class="sidebar-header">
          ${isDarwin && isLeft ? html`<div class="traffic-light-spacer"></div>` : ''}
          <button class="close-btn" title="Hide sidebar" @click=${this._onClickCollapse}>
            <span class="fas fa-chevron-${isLeft ? 'left' : 'right'}"></span>
          </button>
        </div>
        <div class="sidebar-tabs">
          ${hasPinned
            ? html`
                ${repeat(
                  pinnedTabs,
                  ({ index }) => `pin:${index}`,
                  ({ tab, index }) => this._renderTab(tab, index)
                )}
                <div class="tab-separator"></div>
              `
            : ''}
          ${this._renderUngroupedTabs()}
          ${repeat(
            this.groups || [],
            (g) => g.id,
            (g) => this._renderGroup(g)
          )}
          <button class="new-tab-inline" title="New tab" @click=${this._onClickNew}>
            <span class="new-tab-icon fas fa-plus"></span>
            <span class="new-tab-label">New tab</span>
          </button>
        </div>
        ${this._renderSpacesDropdown()
          ? html` <div class="sidebar-footer">${this._renderSpacesDropdown()}</div> `
          : ''}
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
      tab.isLoading || tab.isPinned || faviconUrl || tab.url.startsWith('nomad:')
    );
    const cls = classMap({
      'sidebar-tab': true,
      current: tab.isActive,
      pinned: tab.isPinned,
      'in-group': inGroup,
      // Draft Mode (ADR-0012): this tab is previewing a Drive's unpublished Draft
      'draft-previewing': tab.draftPreviewing,
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
        <div
          class="tab-close"
          title="Close tab"
          @click=${(e) => this._onClickClose(e, index)}
        ></div>
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
    const isLeft = this.sidebarSide !== 'right';
    return html`
      ${this.spacesPopupOpen
        ? html`
            <div class="spaces-popup" style="${isLeft ? 'left:0' : 'right:0'}">
              <div class="spaces-popup-header">Spaces</div>
              <div class="spaces-popup-list">
                ${this.spaces.map(
                  (s) => html`
                    <div
                      class="spaces-popup-item ${s.id === this.activeSpace?.id ? 'active' : ''}"
                      @click=${() => this._onSwitchSpace(s.id)}
                    >
                      <span class="space-dot" style="background:${s.color}"></span>
                      <span class="spaces-popup-name">${s.name}</span>
                      ${s.id === this.activeSpace?.id
                        ? html`<span class="fas fa-check spaces-popup-check"></span>`
                        : ''}
                    </div>
                  `
                )}
              </div>
              <div class="spaces-popup-divider"></div>
              ${this.isCreatingSpace
                ? html`
                    <div class="spaces-create-form">
                      <input
                        class="spaces-name-input"
                        type="text"
                        placeholder="Space name"
                        .value=${this.newSpaceName}
                        @input=${(e) => {
                          this.newSpaceName = e.target.value;
                        }}
                        @keydown=${this._onSpaceNameKeydown}
                        @click=${(e) => e.stopPropagation()}
                      />
                      <div class="spaces-color-row">
                        ${SPACE_COLORS.map(
                          (c) => html`
                            <button
                              class="spaces-swatch ${c === this.newSpaceColor ? 'selected' : ''}"
                              style="background:${c}"
                              @click=${(e) => {
                                e.stopPropagation();
                                this.newSpaceColor = c;
                              }}
                            ></button>
                          `
                        )}
                      </div>
                      <div class="spaces-form-btns">
                        <button
                          class="spaces-cancel-btn"
                          @click=${(e) => {
                            e.stopPropagation();
                            this.isCreatingSpace = false;
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          class="spaces-create-btn"
                          ?disabled=${!this.newSpaceName.trim()}
                          @click=${(e) => {
                            e.stopPropagation();
                            this._onCreateSpace();
                          }}
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  `
                : html`
                    <div
                      class="spaces-popup-new"
                      @click=${(e) => {
                        e.stopPropagation();
                        this.isCreatingSpace = true;
                        this.newSpaceName = '';
                        this.newSpaceColor = SPACE_COLORS[0];
                      }}
                    >
                      <span class="fas fa-plus"></span> New space
                    </div>
                  `}
            </div>
          `
        : ''}
      <button class="spaces-btn" title="Switch space" @click=${this._onClickSpaces}>
        <span class="space-dot" style="background:${space?.color || '#6c6cff'}"></span>
        <span class="space-name">${space?.name || 'Spaces'}</span>
      </button>
    `;
  }

  updated(changedProperties) {
    if (this.editingGroupId) {
      const input = this.shadowRoot.querySelector('.group-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
    if (this.isCreatingSpace) {
      const input = this.shadowRoot.querySelector('.spaces-name-input');
      if (input) input.focus();
    }
  }

  // events
  // =

  _onClickCollapse() {
    bg.views.toggleSidebarCollapsed();
  }

  _onClickSpaces(e) {
    e.stopPropagation();
    if (this.spacesPopupOpen) {
      this._closeSpacesPopup();
    } else {
      this.spacesPopupOpen = true;
      this.isCreatingSpace = false;
      // Close when clicking outside
      setTimeout(() => window.addEventListener('click', this._boundClosePopup), 0);
    }
  }

  _closeSpacesPopup() {
    this.spacesPopupOpen = false;
    this.isCreatingSpace = false;
    window.removeEventListener('click', this._boundClosePopup);
  }

  async _onSwitchSpace(id) {
    await bg.spaces.setActive(id);
    this._closeSpacesPopup();
  }

  async _onCreateSpace() {
    const name = this.newSpaceName.trim();
    if (!name) return;
    await bg.spaces.create({ name, color: this.newSpaceColor });
    this._closeSpacesPopup();
  }

  _onSpaceNameKeydown(e) {
    e.stopPropagation();
    if (e.key === 'Enter') this._onCreateSpace();
    if (e.key === 'Escape') {
      this.isCreatingSpace = false;
    }
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
      const delta = isLeft ? moveE.clientX - startX : startX - moveE.clientX;
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
  ${spinnerCSS}: host {
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
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
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
    transition:
      opacity 0.15s,
      background 0.15s;
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
    min-height: 0;
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

  /* Draft Mode (ADR-0012): highlight a tab previewing a Drive's unpublished Draft. After .current so
     the tint wins even on the active tab; outline (offset inward) rings it all around. */
  .sidebar-tab.draft-previewing {
    background: rgba(40, 100, 220, 0.13);
    outline: 1.5px solid #2864dc;
    outline-offset: -1.5px;
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
    transition:
      opacity 0.1s,
      background 0.1s;
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
    transition:
      background 0.1s,
      opacity 0.1s;
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
    position: relative;
  }

  /* spaces inline popup */

  .spaces-popup {
    position: absolute;
    bottom: 100%;
    width: 200px;
    background: var(--bg-color--background);
    border: 1px solid var(--border-color--tab);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .spaces-popup-header {
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-color--tab--title);
    opacity: 0.6;
    border-bottom: 1px solid var(--border-color--tab);
  }

  .spaces-popup-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .spaces-popup-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: default;
    font-size: 12px;
    color: var(--text-color--default, var(--text-color--tab--title));
  }

  .spaces-popup-item:hover {
    background: var(--bg-color--tab--hover);
  }

  .spaces-popup-item.active {
    font-weight: 600;
  }

  .spaces-popup-name {
    flex: 1;
  }

  .spaces-popup-check {
    font-size: 10px;
    opacity: 0.7;
  }

  .spaces-popup-divider {
    height: 1px;
    background: var(--border-color--tab);
    margin: 2px 0;
  }

  .spaces-popup-new {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--text-color--link, #5c5cff);
    cursor: default;
  }

  .spaces-popup-new:hover {
    background: var(--bg-color--tab--hover);
  }

  .spaces-create-form {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .spaces-name-input {
    width: 100%;
    padding: 4px 7px;
    border: 1px solid var(--border-color--tab);
    border-radius: 3px;
    font-size: 12px;
    background: var(--bg-color--input, var(--bg-color--background));
    color: var(--text-color--default, var(--text-color--tab--title));
    outline: 0;
    box-sizing: border-box;
  }

  .spaces-color-row {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .spaces-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: default;
    outline: 0;
  }

  .spaces-swatch.selected {
    border-color: var(--text-color--default, #333);
  }

  .spaces-form-btns {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .spaces-cancel-btn,
  .spaces-create-btn {
    padding: 3px 10px;
    border-radius: 3px;
    border: 1px solid var(--border-color--tab);
    font-size: 11px;
    cursor: default;
    outline: 0;
    background: transparent;
    color: var(--text-color--default, var(--text-color--tab--title));
  }

  .spaces-create-btn {
    background: var(--color--blue, #5c5cff);
    color: #fff;
    border-color: transparent;
  }

  .spaces-create-btn:disabled {
    opacity: 0.5;
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
