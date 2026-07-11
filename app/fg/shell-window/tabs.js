import { ipcRenderer } from 'electron';
import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import spinnerCSS from './spinner.css';
import * as bg from './bg-process-rpc';
import { isHyperOrPearUrl } from '../../lib/urls';

const ANIMATIONS_ENABLED = false;

class ShellWindowTabs extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      spaces: { type: Array },
      activeSpace: { type: Object },
      groups: { type: Array },
      isFullscreen: { type: Boolean, attribute: 'is-fullscreen' },
      hasBgTabs: { type: Boolean, attribute: 'has-bg-tabs' },
      isBackgroundTrayOpen: { type: Boolean },
      editingGroupId: { type: String },
    };
  }

  constructor() {
    super();
    this.tabs = [];
    this.spaces = [];
    this.activeSpace = null;
    this.groups = [];
    this.tabsTransitionState = undefined; // used for 'close animations'
    this.isFullscreen = false;
    this.hasBgTabs = false;
    this.draggedTabIndex = null;
    this.draggedGroupId = null;
    this.isDraggingWindow = false;
    this.isBackgroundTrayOpen = false;
    this.editingGroupId = null;
    this.faviconCache = {};

    // use mousemove to ensure that dragging stops if the mouse button isnt pressed
    // (we use this instead of mouseup because mouseup could happen outside the window)
    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingWindow && (e.buttons & 1) === 0) {
        bg.beakerBrowser.setWindowDragModeEnabled(false);
        this.isDraggingWindow = false;
      }
    });

    // listen for commands from the main process
    ipcRenderer.on('command', this.onCommand.bind(this));
    window.doMinimizeToBgAnim = this.doMinimizeToBgAnim.bind(this);
  }

  get tabsState() {
    return this.tabsTransitionState || this.tabs;
  }

  getFavicon(index) {
    var tab = this.tabsState[index];
    if (!tab) return;
    var cache;
    try {
      cache = this.faviconCache[new URL(tab.url).origin];
    } catch (e) {
      // invalid URL
    }
    if (tab.favicons && tab.favicons[0]) {
      if (cache && cache.lastTried === tab.favicons[0]) {
        return null; // this favicon has been tried and failed
      }
      return tab.favicons[0];
    }
    if (cache) return cache.url; // fallback to cache
  }

  // Build a flat list of {type:'group-header',group} and {type:'tab',tab,index} items
  buildItems(tabs) {
    const items = [];
    let lastGroupId = null;
    tabs.forEach((tab, index) => {
      if (tab.groupId && tab.groupId !== lastGroupId) {
        const group = (this.groups || []).find((g) => g.id === tab.groupId);
        if (group) items.push({ type: 'group-header', group });
      }
      const group = tab.groupId ? (this.groups || []).find((g) => g.id === tab.groupId) : null;
      if (!group?.hidden) {
        items.push({ type: 'tab', tab, index });
      }
      lastGroupId = tab.groupId || null;
    });
    return items;
  }

  render() {
    const shellCls = classMap({
      shell: true,
      [window.platform]: true,
      fullscreen: this.isFullscreen,
    });
    const items = this.buildItems(this.tabsState);
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div
        class="${shellCls}"
        @mousedown=${this.onMousedownShell}
        @dblclick=${this.onDblclickShell}
      >
        <div class="tabs">
          ${this.backgroundTrayBtn}
          ${repeat(
            items,
            (item) => (item.type === 'group-header' ? `grp:${item.group.id}` : `tab:${item.index}`),
            (item) =>
              item.type === 'group-header'
                ? this.renderGroupHeader(item.group)
                : this.renderTab(item.tab, item.index)
          )}
          <div
            class="unused-space"
            @dragover=${(e) => this.onDragoverTab(e, this.tabsState.length)}
            @dragleave=${(e) => this.onDragleaveTab(e, this.tabsState.length)}
            @drop=${(e) => this.onDropTab(e, this.tabsState.length)}
          >
            <div class="tab tab-add-btn" @click=${this.onClickNew} title="Open new tab">
              <span class="plus">+</span>
            </div>
          </div>
          <shell-window-spaces-dropdown
            .spaces=${this.spaces}
            .activeSpace=${this.activeSpace}
          ></shell-window-spaces-dropdown>
        </div>
      </div>
    `;
  }

  renderGroupHeader(group) {
    const isEditing = this.editingGroupId === group.id;
    return html`
      <div
        class="tab-group-header${group.hidden ? ' hidden-group' : ''}"
        style=${styleMap({ '--group-color': group.color })}
        draggable="true"
        @contextmenu=${(e) => this.onContextmenuGroup(e, group.id)}
        @dragstart=${(e) => this.onDragstartGroup(e, group.id)}
        @dragend=${(e) => this.onDragendGroup(e)}
        @dragover=${(e) => this.onDragoverGroup(e, group.id)}
        @dragleave=${(e) => this.onDragleaveGroup(e)}
        @drop=${(e) => this.onDropGroup(e, group.id)}
      >
        ${isEditing
          ? html`<input
              class="tab-group-name-input"
              .value=${group.name}
              @blur=${(e) => this.onGroupNameBlur(e, group.id)}
              @keydown=${(e) => this.onGroupNameKeydown(e, group.id)}
              @click=${(e) => e.stopPropagation()}
            />`
          : html`<span
              class="tab-group-name"
              @dblclick=${(e) => this.onDblclickGroupName(e, group.id)}
              >${group.name}</span
            >`}
        <button
          class="tab-group-close"
          title="Delete group"
          @click=${(e) => this.onClickGroupClose(e, group.id)}
        >
          ×
        </button>
      </div>
    `;
  }

  renderTab(tab, index) {
    const faviconUrl = this.getFavicon(index);
    const showFavicon = Boolean(
      tab.isLoading || tab.isPinned || faviconUrl || tab.url.startsWith('nomad:')
    );
    const group = tab.groupId ? (this.groups || []).find((g) => g.id === tab.groupId) : null;
    const cls = classMap({
      tab: true,
      current: tab.isActive,
      pinned: tab.isPinned,
      grouped: Boolean(group),
      'has-icon': tab.isAudioMuted || tab.isCurrentlyAudible,
      'no-hover': this.tabs.length >= 12,
      'no-favicon': !showFavicon,
      // Draft Mode (ADR-0012): this tab is previewing a Drive's unpublished Draft
      'draft-previewing': tab.draftPreviewing,
    });
    const tabStyle = styleMap(group ? { '--group-color': group.color } : {});
    return html`
      <div
        class="${cls}"
        style=${tabStyle}
        title=${tab.title || tab.url}
        draggable="true"
        @click=${(e) => this.onClickTab(e, index)}
        @contextmenu=${(e) => this.onContextmenuTab(e, index)}
        @mousedown=${(e) => this.onMousedownTab(e, index)}
        @dragstart=${(e) => this.onDragstartTab(e, index)}
        @dragend=${(e) => this.onDragendTab(e, index)}
        @dragover=${(e) => this.onDragoverTab(e, index)}
        @dragleave=${(e) => this.onDragleaveTab(e, index)}
        @drop=${(e) => this.onDropTab(e, index)}
      >
        ${showFavicon
          ? html`
              <div class="tab-favicon">
                ${tab.isLoading
                  ? tab.isReceivingAssets
                    ? html`<div class="spinner"></div>`
                    : html`<div class="spinner reverse"></div>`
                  : faviconUrl
                    ? html`
                        <img
                          src="${faviconUrl}"
                          @load=${(e) => this.onFaviconLoad(e, index)}
                          @error=${(e) => this.onFaviconError(e, index)}
                        />
                      `
                    : html`<img src="asset:favicon:${tab.url}?cache=${Date.now()}" />`}
              </div>
            `
          : ''}
        ${tab.isPinned
          ? ''
          : html`
              <div class="tab-title">${tab.title || tab.url}</div>
              ${tab.isAudioMuted
                ? html`<span class="fas fa-volume-mute"></span>`
                : tab.isCurrentlyAudible
                  ? html`<span class="fas fa-volume-up"></span>`
                  : ''}
              ${this.tabs.length < 12 || tab.isActive
                ? html`
                    <div
                      class="tab-close"
                      title="Close tab"
                      @click=${(e) => this.onClickClose(e, index)}
                    ></div>
                  `
                : ''}
            `}
      </div>
    `;
  }

  get backgroundTrayBtn() {
    if (!this.hasBgTabs) return '';
    const cls = classMap({
      'background-tray-btn': true,
      pressed: this.isBackgroundTrayOpen,
      hidden: !this.hasBgTabs,
    });
    return html`
      <button class=${cls} @click=${this.onClickBackgroundTray}>
        <span class="fas fa-caret-down"></span>
      </button>
    `;
  }

  updated(changedProperties) {
    if (ANIMATIONS_ENABLED && changedProperties.has('tabs')) {
      let oldVal = changedProperties.get('tabs') || [];
      let [oldLen, newLen] = [oldVal.length, this.tabs.length];
      if (newLen > oldLen) {
        // new tab
        let newTabIndex = this.tabs.findIndex((t1) => !oldVal.find((t2) => t2.id === t1.id));
        if (newTabIndex === -1) return;
        Array.from(this.shadowRoot.querySelectorAll('.tabs > .tab'))[newTabIndex].animate(
          [
            { transform: 'scaleX(0)', transformOrigin: 'center left' },
            { transform: 'scaleX(1)', transformOrigin: 'center left' },
          ],
          {
            duration: 100,
            iterations: 1,
          }
        );
      }
    }

    if (this.editingGroupId) {
      const input = this.shadowRoot.querySelector('.tab-group-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  async shouldUpdate(changedProperties) {
    if (ANIMATIONS_ENABLED && changedProperties.has('tabs')) {
      let oldVal = changedProperties.get('tabs') || [];
      let [oldLen, newLen] = [oldVal.length, this.tabs.length];
      if (newLen < oldLen) {
        // closed tab
        if (!this.tabsTransitionState) {
          this.tabsTransitionState = oldVal;
        }
        let closingTabIndex = this.tabsTransitionState.findIndex(
          (t1) => !this.tabs.find((t2) => t2.id === t1.id)
        );
        if (closingTabIndex === -1) return true;
        let el = Array.from(this.shadowRoot.querySelectorAll('.tabs > .tab'))[closingTabIndex];
        let rect = el.getClientRects()[0];
        el.animate([{ width: `${rect.width}px` }, { width: '0px' }], {
          duration: 100,
          iterations: 1,
        }).onfinish = () => {
          this.tabsTransitionState = undefined;
          this.requestUpdate();
        };
        return false;
      }
    }
  }

  doMinimizeToBgAnim() {
    // DISABLED
  }

  // events
  // =

  async onClickBackgroundTray(e) {
    if (Date.now() - (this.lastMenuClick || 0) < 100) return;
    this.isBackgroundTrayOpen = true;
    await bg.views.toggleMenu('background-tray');
    this.isBackgroundTrayOpen = false;
    this.lastMenuClick = Date.now();
  }

  onClickNew(e) {
    bg.views.createTab(undefined, { focusLocationBar: true, setActive: true });
  }

  onClickTab(e, index) {
    bg.views.setActiveTab(index);
  }

  onContextmenuTab(e, index) {
    bg.views.showTabContextMenu(index);
  }

  onMousedownTab(e, index) {
    // middle click
    if (e.which === 2) {
      bg.views.closeTab(index);
    }
  }

  onClickClose(e, index) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.closeTab(index);
  }

  onFaviconLoad(e, index) {
    var favicons = this.tabsState[index].favicons;
    var url = favicons && favicons[0] ? favicons[0] : null;
    var origin = new URL(this.tabsState[index].url).origin;
    this.faviconCache[origin] = { url };
  }

  onFaviconError(e, index) {
    var origin = new URL(this.tabsState[index].url).origin;
    this.faviconCache[origin] = {
      lastTried: this.tabsState[index].favicons ? this.tabsState[index].favicons[0] : null,
      url: null, // serve null from cache always
    };
    this.tabsState[index].favicons = null;
    this.requestUpdate();
  }

  onDragstartTab(e, index) {
    this.draggedTabIndex = index;
    e.dataTransfer.effectAllowed = 'move';
  }

  onDragendTab(e, index) {
    // TODO needed?
  }

  onDragoverTab(e, index) {
    if (e.dataTransfer.files.length) {
      return; // allow toplevel event-handler to handle
    }
    e.preventDefault();

    // When dragging a group, only the unused-space (index === tabsState.length) accepts the drop
    if (this.draggedGroupId !== null) {
      if (index === this.tabsState.length) {
        e.currentTarget.classList.add('drag-hover');
        e.dataTransfer.dropEffect = 'move';
      }
      return false;
    }

    if (!this.canDrop(index)) {
      return false;
    }

    e.currentTarget.classList.add('drag-hover');
    e.dataTransfer.dropEffect = 'move';
    return false;
  }

  onDragleaveTab(e, index) {
    e.currentTarget.classList.remove('drag-hover');
  }

  onDropTab(e, index) {
    if (e.dataTransfer.files.length) {
      return; // allow toplevel event-handler to handle
    }
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-hover');

    // Group dropped on unused space — move to end (beforeGroupId = null)
    if (this.draggedGroupId !== null) {
      bg.views.reorderTabGroup(this.draggedGroupId, null);
      this.draggedGroupId = null;
      return false;
    }

    const url = e.dataTransfer.getData('text');
    if (url && (url.startsWith('https://') || url.startsWith('dat://') || isHyperOrPearUrl(url))) {
      e.preventDefault();
      bg.views.createTab(url, { focusLocationBar: true, setActive: true });
      bg.views.reorderTab(this.tabsState.length, index);
      return false;
    }
    if (this.draggedTabIndex !== null && this.canDrop(index)) {
      bg.views.reorderTab(this.draggedTabIndex, index);
    }
    this.draggedTabIndex = null;
    return false;
  }

  canDrop(index) {
    if (this.draggedTabIndex === null) return false;
    var draggingTab = this.tabsState[this.draggedTabIndex];
    var targetTab = this.tabsState[index];
    if (draggingTab.isPinned !== targetTab?.isPinned) {
      // only allow tabs to drag within their own pinned/unpinned groups
      return false;
    }
    return true;
  }

  // group header drag handlers

  onContextmenuGroup(e, groupId) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.showGroupContextMenu(groupId);
  }

  onDragstartGroup(e, groupId) {
    this.draggedGroupId = groupId;
    this.draggedTabIndex = null;
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  }

  onDragendGroup(e) {
    this.draggedGroupId = null;
  }

  onDragoverGroup(e, groupId) {
    const isDraggingTab = this.draggedTabIndex !== null;
    const isDraggingGroup = this.draggedGroupId !== null && this.draggedGroupId !== groupId;
    if (!isDraggingTab && !isDraggingGroup) return;
    e.preventDefault();
    e.currentTarget.classList.add('drag-hover');
    e.dataTransfer.dropEffect = 'move';
  }

  onDragleaveGroup(e) {
    e.currentTarget.classList.remove('drag-hover');
  }

  onDropGroup(e, groupId) {
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-hover');
    if (this.draggedGroupId !== null && this.draggedGroupId !== groupId) {
      bg.views.reorderTabGroup(this.draggedGroupId, groupId);
      this.draggedGroupId = null;
    } else if (this.draggedTabIndex !== null) {
      bg.views.addTabToGroup(this.draggedTabIndex, groupId);
      this.draggedTabIndex = null;
    }
  }

  // group header name editing

  onDblclickGroupName(e, groupId) {
    e.stopPropagation();
    this.editingGroupId = groupId;
  }

  onGroupNameBlur(e, groupId) {
    const name = e.target.value.trim();
    if (name) bg.views.renameTabGroup(groupId, name);
    this.editingGroupId = null;
  }

  onGroupNameKeydown(e, groupId) {
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (name) bg.views.renameTabGroup(groupId, name);
      this.editingGroupId = null;
    } else if (e.key === 'Escape') {
      this.editingGroupId = null;
    }
  }

  onClickGroupClose(e, groupId) {
    e.stopPropagation();
    bg.views.deleteTabGroup(groupId);
  }

  onMousedownShell(e) {
    const is = (v) => e.target.classList.contains(v);
    if ((is('shell') || is('tabs') || is('unused-space')) && e.button === 0) {
      this.isDraggingWindow = true;
      bg.beakerBrowser.setWindowDragModeEnabled(true);
    }
  }

  onDblclickShell(e) {
    const is = (v) => e.target.classList.contains(v);
    if (is('shell') || is('tabs') || is('unused-space')) {
      this.isDraggingWindow = false;
      bg.beakerBrowser.setWindowDragModeEnabled(false);
      bg.beakerBrowser.toggleWindowMaximized();
    }
  }

  onCommand(e, cmd) {
    if (cmd === 'minimize-to-bg-anim') {
      this.doMinimizeToBgAnim();
    }
  }
}
ShellWindowTabs.styles = css`
  ${spinnerCSS}

  .shell {
    font-family: sans-serif;
    background: var(--bg-color--background);
    position: relative;
    height: 34px;
  }

  .shell:not(.darwin) {
    box-shadow: inset 0 2px 4px #0001;
  }

  .tabs {
    display: flex;
    padding: 0 18px 0 0;
    border-bottom: 1px solid var(--border-color--tab);
    height: 33px;
  }

  /* make room for the in-app window controls (shell-window-controls, 3 × 46px) */
  .shell.win32 .tabs,
  .shell.linux .tabs {
    margin-right: 138px;
  }

  .shell:not(.darwin) .tabs > :first-child {
    border-left: 0;
  }

  .background-tray-btn {
    flex: 0 0 38px;
    width: 38px;
    height: 30px;
    background: transparent;
    color: var(--text-color--bg-tabs-btn);
    border: 0;
    border-left: 1px solid var(--border-color--tab);
    margin-top: 3px;
    outline: 0;
  }

  .background-tray-btn:hover,
  .background-tray-btn.pressed {
    background: var(--bg-color--tab--hover);
  }

  .background-tray-btn span {
    font-size: 14px;
    line-height: 16px;
  }

  .background-tray-btn.hidden {
    display: none;
  }

  .unused-space {
    flex: 1;
    position: relative;
    top: 0px;
    height: 33px;
  }

  .tabs * {
    -webkit-user-select: none;
    cursor: default;
    font-size: 12px;
    line-height: 13px;
  }

  .tab {
    display: inline-block;
    position: relative;
    top: 3px;
    height: 30px;
    width: 200px;
    min-width: 0; /* HACK: https://stackoverflow.com/questions/38223879/white-space-nowrap-breaks-flexbox-layout */
    background: transparent;
    transition: background 0.3s;
    border-left: 1px solid var(--border-color--tab);
    border-radius: 6px 6px 0 0;
  }

  /* Draft Mode (ADR-0012): ring a tab that's previewing a Drive's unpublished Draft. Uses outline
     (not border/box-shadow) so it goes all the way around, follows the radius, and doesn't fight the
     current-tab highlight box-shadow or shift layout. */
  .tab.draft-previewing {
    outline: 1.5px solid #2864dc;
    outline-offset: -1.5px;
  }

  .tab.pinned {
    flex: 0 0 45px;
  }

  .tab-favicon {
    width: 16px;
    height: 23px;
    text-align: center;
    position: absolute;
    left: 10px;
    top: 7px;
    z-index: 3;
  }

  .tab-favicon img {
    width: 16px;
    height: 16px;
  }

  .tab-favicon .spinner {
    position: relative;
    left: 1px;
    top: 1px;
    width: 10px;
    height: 10px;
  }

  .tab.pinned .tab-favicon {
    left: 14px;
  }

  .tab.pinned .tab-favicon::after {
    content: '';
    position: absolute;
    bottom: 1px;
    right: -3px;
    width: 6px;
    height: 6px;
    background: var(--highlight-color--tab--current, #5b5ef4);
    border-radius: 50%;
    opacity: 0.7;
  }

  .tab-title {
    font-family: system-ui;
    color: var(--text-color--tab--title);
    font-size: 11.5px;
    padding: 9px 11px 9px 30px;
    height: 13px;
    line-height: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab.no-favicon .tab-title {
    padding-left: 11px;
  }

  .fa-volume-up,
  .fa-volume-mute {
    position: absolute;
    top: 6px;
    right: 10px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.6);
    background: var(--bg-color--background);
    padding: 2px 0 2px 4px;
  }

  .tab.current .fa-volume-up,
  .tab.current .fa-volume-mute {
    background: var(--bg-color--foreground);
  }

  .tab-nofavicon .tab-title {
    padding-left: 16px;
  }

  .tab-close,
  .tab-minimize {
    opacity: 0;
    position: absolute;
    top: 7px;
    width: 16px;
    height: 16px;
    z-index: 4;
    border-radius: 2px;
    text-align: center;
    color: var(--text-color--tab--close);
    background: var(--bg-color--background);
    transition: background 0.3s;
  }

  .tab-close {
    right: 8px;
  }

  .tab-close:before {
    opacity: 0;
  }

  .tab-close:before {
    display: block;
    content: '\\00D7';
    font-size: 20px;
    font-weight: 200;
    line-height: 0.71;
  }

  .tab-close:hover:before,
  .tab-close:active:before {
    opacity: 1;
  }

  .tab-close:hover,
  .tab-close:active {
    background: var(--bg-color--tab-close--hover);
  }

  .tab:not(.current):hover,
  .tab:not(.current):hover .fa-volume-up,
  .tab:not(.current):hover .fa-volume-mute {
    background: var(--bg-color--tab--hover);
  }

  .tab.has-icon .tab-title,
  .tab:hover:not(.no-hover) .tab-title {
    padding-right: 28px;
  }

  .tab:hover .tab-close {
    opacity: 1;
    background: var(--bg-color--tab--hover);
  }

  .tab:hover .tab-close:hover {
    background: var(--bg-color--tab-close--hover);
  }

  .tab.current:hover .tab-close:hover {
    background: var(--bg-color--tab-close--current--hover);
  }

  .tab:hover .tab-close:before {
    opacity: 1;
  }

  .tab.current {
    background: var(--bg-color--tab--current);
    height: 31px;
    box-shadow: inset 0 3px 0 var(--highlight-color--tab--current);
  }

  .tab.current.grouped {
    box-shadow: inset 0 3px 0 var(--group-color, #5b5ef4);
  }

  .tab.current .tab-close {
    background: var(--bg-color--tab--current);
  }

  .tab.drag-hover {
    background: var(--bg-color--tab--dragover);
  }

  .tab.tab-add-btn {
    width: 40px;
  }

  .tab-add-btn .plus {
    position: absolute;
    top: 0;
    display: block;
    font-size: 22px;
    font-weight: 300;
    color: var(--text-color--tab--add);
    margin: 3px 7px;
    width: 26px;
    height: 25px;
    text-align: center;
    line-height: 100%;
  }

  .tab-add-btn:hover .tab-close:before {
    opacity: 1;
  }

  .tab-add-btn:hover .plus {
    color: var(--text-color--tab--add--hover);
  }

  /* make room for traffic lights */
  .darwin .tabs {
    padding-left: 80px;
  }
  .darwin.fullscreen .tabs {
    padding-left: 0px; /* not during fullscreen */
  }

  .minimize-to-bg-anim-elem {
    position: fixed;
    z-index: 100;
    background: #fffc;
  }

  /* tab groups */

  .tab-group-header {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    height: 30px;
    padding: 0 8px 0 8px;
    margin-top: 3px;
    background: color-mix(in srgb, var(--group-color, #5b5ef4) 14%, transparent);
    border-radius: 6px 6px 0 0;
    border-left: 1px solid var(--border-color--tab);
    color: var(--group-color, #5b5ef4);
    cursor: default;
    transition: background 0.12s;
  }

  .tab-group-header::before {
    content: '';
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--group-color, #5b5ef4);
    flex-shrink: 0;
  }

  .tab-group-header.drag-hover {
    background: color-mix(in srgb, var(--group-color, #5b5ef4) 24%, transparent);
  }

  .tab-group-header.hidden-group {
    opacity: 0.55;
  }

  .tab-group-header.hidden-group::before {
    opacity: 0.4;
  }

  .tab-group-name {
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    letter-spacing: 0.1px;
  }

  .tab-group-name-input {
    font-size: 11px;
    line-height: 13px;
    background: rgba(255, 255, 255, 0.25);
    border: 1px solid color-mix(in srgb, var(--group-color, #5b5ef4) 45%, transparent);
    border-radius: 3px;
    color: var(--group-color, #5b5ef4);
    outline: none;
    padding: 1px 4px;
    width: 80px;
    cursor: text;
  }

  .tab-group-close {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    color: var(--group-color, #5b5ef4);
    cursor: default;
    font-size: 13px;
    line-height: 1;
    opacity: 0.5;
    padding: 0;
    margin-left: 1px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transition:
      opacity 0.12s,
      background 0.12s;
  }

  .tab-group-close:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--group-color, #5b5ef4) 18%, transparent);
  }

  .tab.grouped {
    border-left-color: var(--group-color, #5b5ef4);
  }
`;
customElements.define('shell-window-tabs', ShellWindowTabs);
