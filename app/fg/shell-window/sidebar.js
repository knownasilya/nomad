import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import spinnerCSS from './spinner.css';
import * as bg from './bg-process-rpc';
import { pinTiles, pinTooltipUrl } from '../../../shared/pins.mjs';
import { personaAvatar, personaAvatarCSS } from './spaces-dropdown';
import {
  startTabDrag,
  endTabDrag,
  canSplitWith,
  tabDropZone,
  isSplit,
  tabTooltip,
} from './split-drop';

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
// How long the pointer rests on a pin tile before its tooltip shows (ms)
const PIN_TIP_DELAY = 400;

class ShellWindowSidebar extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      // The active Space's pinned pages, [{ href, title }] (bg/ui/space-pins.js)
      pins: { type: Array },
      pinsWritable: { type: Boolean },
      spaces: { type: Array },
      activeSpace: { type: Object },
      activePersona: { type: Object }, // the Space's Persona (ADR-0031), on the Spaces button
      groups: { type: Array },
      sidebarSide: { type: String, attribute: 'sidebar-side' },
      sidebarWidth: { type: Number, attribute: 'sidebar-width' },
      collapsedGroups: { type: Object },
      editingGroupId: { type: String },
      spacesMenuOpen: { type: Boolean },
      // The hovered pin tile's tooltip, { href, title, url }, while it shows
      _pinTip: { state: true },
      // The tab list is scrolled down: a line marks where it slides under the pinned tiles
      _tabsScrolled: { state: true },
    };
  }

  constructor() {
    super();
    this.tabs = [];
    this.pins = [];
    this.pinsWritable = true;
    // The pin tile being dragged (its href), while one is.
    this.draggedPinHref = null;
    this._pinTip = null;
    this._pinTipTimer = null;
    this._tabsScrolled = false;
    this.spaces = [];
    this.activeSpace = null;
    this.groups = [];
    this.sidebarSide = 'left';
    this.sidebarWidth = 220;
    this.collapsedGroups = new Set();
    this.editingGroupId = null;
    // The index of the tab being dragged, while one is.
    this.draggedTabIndex = null;
    this.faviconCache = {};
    this._resizing = false;
    this.spacesMenuOpen = false;
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
      // in-app window controls overlay this corner (Linux left / Windows right) —
      // the header reserves room for them below, like darwin's traffic lights
      linux: document.body.classList.contains('linux'),
      win32: document.body.classList.contains('win32'),
    });
    const tiles = pinTiles(this.pins, this.tabs);
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="${cls}" style=${sidebarStyle}>
        <div class="sidebar-header">
          ${isDarwin && isLeft ? html`<div class="traffic-light-spacer"></div>` : ''}
          <button class="close-btn" title="Hide sidebar" @click=${this._onClickCollapse}>
            <span class="fas fa-chevron-${isLeft ? 'left' : 'right'}"></span>
          </button>
        </div>
        <div class="sidebar-top">
          ${this._renderPins(tiles)}
          <button
            class="new-tab-inline"
            title="New tab"
            @click=${this._onClickNew}
            @dragover=${(e) => this._onDragoverUngroup(e)}
            @dragleave=${this._onDragleave}
            @drop=${(e) => this._onDropUngroup(e)}
          >
            <span class="new-tab-icon fas fa-plus"></span>
            <span class="new-tab-label">New tab</span>
          </button>
        </div>
        <div
          class="sidebar-tabs ${this._tabsScrolled ? 'scrolled' : ''}"
          @scroll=${this._onScrollTabs}
        >
          ${repeat(
            this._buildItems(),
            (item) => (item.group ? `grp:${item.group.id}` : `tab:${item.index}`),
            (item) =>
              item.group ? this._renderGroup(item.group) : this._renderTab(item.tab, item.index)
          )}
        </div>
        ${this._renderSpacesDropdown()
          ? html` <div class="sidebar-footer">${this._renderSpacesDropdown()}</div> `
          : ''}
        ${this._renderResizeHandle(isLeft)} ${this._renderPinTip()}
      </div>
    `;
  }

  // The Space's pinned pages as icon tiles, like the phone's home shortcuts and Arc's favorites.
  // A tile opens its pinned tab (opening it again if it was closed); drag tiles to reorder them, or
  // drag a tab onto them to pin it.
  _renderPins(tiles) {
    const draggingTab =
      this.draggedTabIndex !== null &&
      !this.tabs[this.draggedTabIndex]?.isPinned &&
      this.pinsWritable;
    if (!tiles.length && !draggingTab) return '';
    return html`
      <div
        class="pins ${tiles.length ? '' : 'empty'}"
        @scroll=${this._hidePinTip}
        @dragover=${(e) => this._onDragoverPins(e)}
        @dragleave=${this._onDragleave}
        @drop=${(e) => this._onDropPins(e, tiles.length)}
      >
        ${tiles.length
          ? repeat(
              tiles,
              (t) => `pin:${t.href}`,
              (t, i) => this._renderPin(t, i)
            )
          : html`<div class="pins-hint">Drop a tab here to pin it</div>`}
      </div>
      <div class="tab-separator"></div>
    `;
  }

  _renderPin(tile, position) {
    const tab = tile.index >= 0 ? this.tabs[tile.index] : null;
    const showSpinner = tab && tab.isLoading && !tab.isQuietLoading;
    const faviconUrl = tab ? this.getFavicon(tile.index) : null;
    const cls = classMap({
      pin: true,
      open: Boolean(tab),
      current: Boolean(tab?.isActive),
      'draft-previewing': Boolean(tab?.draftPreviewing),
    });
    return html`
      <div
        class="${cls}"
        role="button"
        aria-label=${tile.title}
        draggable=${this.pinsWritable ? 'true' : 'false'}
        @mouseenter=${(e) => this._onMouseenterPin(e, tile)}
        @mouseleave=${this._hidePinTip}
        @click=${() => this._onClickPin(tile)}
        @mousedown=${(e) => this._onMousedownPin(e, tile)}
        @contextmenu=${(e) => this._onContextmenuPin(e, tile)}
        @dragstart=${(e) => this._onDragstartPin(e, tile)}
        @dragend=${this._onDragendTab}
        @dragover=${(e) => this._onDragoverPin(e, tile)}
        @dragleave=${this._onDragleave}
        @drop=${(e) => this._onDropPin(e, tile, position)}
      >
        ${showSpinner
          ? html`<div class="spinner ${tab.isReceivingAssets ? '' : 'reverse'}"></div>`
          : faviconUrl
            ? html`<img
                src="${faviconUrl}"
                @load=${(e) => this._onFaviconLoad(e, tile.index)}
                @error=${(e) => this._onFaviconError(e, tile.index)}
              />`
            : html`<img src="asset:favicon:${tab ? tab.url : tile.href}" />`}
        ${tab && (tab.isCurrentlyAudible || tab.isAudioMuted)
          ? this._renderAudioBtn(tab, tile.index, 'pin-audio')
          : ''}
      </div>
    `;
  }

  // The hovered pin's name and address. A title attribute's native tooltip doesn't show here: the
  // page's view has focus, not the shell window. The tip stays inside the sidebar, since the page's
  // view covers the window beside it.
  _renderPinTip() {
    const tip = this._pinTip;
    if (!tip) return '';
    return html`
      <div
        class="pin-tip"
        role="tooltip"
        style=${styleMap({ maxWidth: `${this.sidebarWidth - 12}px` })}
      >
        <div class="pin-tip-title">${tip.title}</div>
        ${tip.url ? html`<div class="pin-tip-url">${tip.url}</div>` : ''}
      </div>
    `;
  }

  // Ungrouped tabs and groups in tab order, so a new tab (added at the top, under "New tab") shows
  // above the groups below it. A group sits where its first tab is; a group with no tabs goes at the end.
  _buildItems() {
    const groups = this.groups || [];
    const items = [];
    const placed = new Set();
    this.tabs.forEach((tab, index) => {
      if (tab.isPinned) return;
      const group = tab.groupId && groups.find((g) => g.id === tab.groupId);
      if (!group) {
        items.push({ tab, index });
      } else if (!placed.has(group.id)) {
        placed.add(group.id);
        items.push({ group });
      }
    });
    for (const group of groups) {
      if (!placed.has(group.id)) items.push({ group });
    }
    return items;
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
          @dragover=${(e) => this._onDragoverGroup(e)}
          @dragleave=${this._onDragleave}
          @drop=${(e) => this._onDropGroup(e, group.id)}
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
    // no spinner for a restored tab loading in the background at startup
    const showSpinner = tab.isLoading && !tab.isQuietLoading;
    const showFavicon = Boolean(
      showSpinner || tab.isPinned || faviconUrl || tab.url.startsWith('nomad:')
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
        title=${tabTooltip(tab)}
        @click=${() => bg.views.setActiveTab(index)}
        @contextmenu=${(e) => this._onContextmenuTab(e, index)}
        @mousedown=${(e) => this._onMousedownTab(e, index)}
        draggable=${tab.isPinned ? 'false' : 'true'}
        @dragstart=${(e) => this._onDragstartTab(e, index)}
        @dragend=${this._onDragendTab}
        @dragover=${(e) => this._onDragoverTab(e, tab, index)}
        @dragleave=${this._onDragleave}
        @drop=${(e) => this._onDropTab(e, tab, index)}
      >
        <div class="tab-favicon">
          ${showSpinner
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
        ${isSplit(tab)
          ? html`<span class="fas fa-columns tab-split" title="Split view"></span>`
          : ''}
        ${tab.isAudioMuted
          ? this._renderAudioBtn(tab, index, 'tab-audio')
          : tab.isCurrentlyAudible
            ? this._renderAudioBtn(tab, index, 'tab-audio')
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
    return html`
      <button
        class="spaces-btn ${this.spacesMenuOpen ? 'pressed' : ''}"
        title="Switch space"
        @click=${this._onClickSpaces}
      >
        <span class="space-dot" style="background:${space?.color || '#6c6cff'}"></span>
        <span class="space-name">${space?.name || 'Spaces'}</span>
        ${personaAvatar(this.activePersona, (e) => this._onClickPersona(e))}
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
  }

  // events
  // =

  _onClickCollapse() {
    bg.views.toggleSidebarCollapsed();
  }

  // The Spaces menu (fg/shell-menus/spaces.js) above the button: the same menu as the top bar's,
  // so it closes the same way and has the Persona row. The menu view has a 10px margin, so the
  // bounds step back by it.
  async _onClickSpaces(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getClientRects()[0];
    this.spacesMenuOpen = true;
    await bg.views.toggleMenu('spaces', {
      bounds: { left: (rect.left | 0) - 10, bottom: (rect.top | 0) + 6 },
    });
    this.spacesMenuOpen = false;
  }

  // The Persona picture opens the Persona menu (fg/shell-menus/persona.js) above the button, not
  // the Spaces popup. The menu view has a 10px margin, so the bounds step back by it.
  async _onClickPersona(e) {
    e.stopPropagation();
    // A click that just closed the menu (by blurring it) shouldn't open it again.
    if (Date.now() - (this.lastPersonaMenuClose || 0) < 100) return;
    const rect = e.currentTarget.closest('.spaces-btn').getClientRects()[0];
    await bg.views.toggleMenu('persona', {
      bounds: { left: (rect.left | 0) - 10, bottom: (rect.top | 0) + 6 },
    });
    this.lastPersonaMenuClose = Date.now();
  }

  _onClickNew() {
    bg.views.createTab(undefined, { focusLocationBar: true, setActive: true });
  }

  // The speaker on a tab playing sound, or crossed out on a muted one; a click mutes or unmutes it.
  _renderAudioBtn(tab, index, cls) {
    const muted = tab.isAudioMuted;
    return html`
      <span
        class="${cls} fas ${muted ? 'fa-volume-mute' : 'fa-volume-up'}"
        role="button"
        title=${muted ? 'Unmute tab' : 'Mute tab'}
        aria-label=${muted ? 'Unmute tab' : 'Mute tab'}
        @click=${(e) => this._onClickAudio(e, index)}
        @mousedown=${(e) => e.stopPropagation()}
      ></span>
    `;
  }

  _onClickAudio(e, index) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.toggleTabMuted(index);
  }

  _onClickClose(e, index) {
    e.preventDefault();
    e.stopPropagation();
    bg.views.closeTab(index);
  }

  _onContextmenuTab(e, index) {
    e.preventDefault();
    bg.views.showTabContextMenu(index);
  }

  _onMousedownTab(e, index) {
    if (e.which === 2) bg.views.closeTab(index);
  }

  async _onContextmenuGroup(e, groupId) {
    e.preventDefault();
    e.stopPropagation();
    const picked = await bg.views.showGroupContextMenu(groupId);
    if (picked === 'rename') {
      this.editingGroupId = groupId;
    } else if (picked === 'new-tab' && this.collapsedGroups.has(groupId)) {
      this.toggleGroup(groupId);
    }
  }

  // Drag a tab onto a group's header to put it in that group, onto the top of another tab to move
  // it there (joining that tab's group, or leaving its own), onto the rest of another tab or onto
  // the page to open the two in a split (split-drop.js), or onto "New tab" to take it out of its
  // group. Pinned tabs stay where they are.

  _onDragstartTab(e, index) {
    this.draggedTabIndex = index;
    if (!(this.pins || []).length) this.requestUpdate();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.tabs[index]?.url || '');
    startTabDrag(index, this.tabs[index]);
  }

  _onDragendTab() {
    const wasDraggingTab = this.draggedTabIndex !== null;
    this.draggedTabIndex = null;
    this.draggedPinHref = null;
    // the empty pin drop zone shows only while a tab is dragged
    if (wasDraggingTab) this.requestUpdate();
    for (const el of this.shadowRoot.querySelectorAll('.drop-before, .drop-into, .drop-split')) {
      el.classList.remove('drop-before', 'drop-into', 'drop-split');
    }
    endTabDrag();
  }

  _acceptDrop(e, className) {
    if (this.draggedTabIndex === null) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add(className);
    return true;
  }

  _onDragleave(e) {
    e.currentTarget.classList.remove('drop-before', 'drop-into', 'drop-split');
  }

  // The top of a row moves the dragged tab in front of it; the rest opens the two in a split.
  _tabDropZone(e, tab) {
    const from = this.tabs[this.draggedTabIndex];
    if (!canSplitWith(from, tab)) return 'before';
    const rect = e.currentTarget.getBoundingClientRect();
    return tabDropZone(rect, e.clientX, e.clientY, { vertical: true });
  }

  _onDragoverTab(e, tab, index) {
    if (tab.isPinned || index === this.draggedTabIndex) return;
    const zone = this._tabDropZone(e, tab);
    e.currentTarget.classList.remove(zone === 'split' ? 'drop-before' : 'drop-split');
    this._acceptDrop(e, zone === 'split' ? 'drop-split' : 'drop-before');
  }

  _onDropTab(e, tab, index) {
    const from = this.draggedTabIndex;
    if (from === null || tab.isPinned || index === from) return;
    e.preventDefault();
    const zone = this._tabDropZone(e, tab);
    this._onDragendTab();
    if (zone === 'split') bg.views.moveTabIntoSplit(from, index);
    else bg.views.moveTabToGroup(from, tab.groupId || null, index);
  }

  _onDragoverGroup(e) {
    this._acceptDrop(e, 'drop-into');
  }

  _onDropGroup(e, groupId) {
    const from = this.draggedTabIndex;
    if (from === null) return;
    e.preventDefault();
    this._onDragendTab();
    if (this.tabs[from]?.groupId === groupId) return;
    bg.views.moveTabToGroup(from, groupId);
    if (this.collapsedGroups.has(groupId)) this.toggleGroup(groupId);
  }

  _onDragoverUngroup(e) {
    if (this.draggedTabIndex === null || !this.tabs[this.draggedTabIndex]?.groupId) return;
    this._acceptDrop(e, 'drop-into');
  }

  _onDropUngroup(e) {
    const from = this.draggedTabIndex;
    if (from === null) return;
    e.preventDefault();
    this._onDragendTab();
    // "New tab" is at the top of the list, so the tab goes there, above the Space's other tabs
    if (!this.tabs[from]?.groupId) return;
    const top = this.tabs.findIndex((t, i) => !t.isPinned && i !== from);
    bg.views.moveTabToGroup(from, null, top === -1 ? null : top);
  }

  // pins

  _onMouseenterPin(e, tile) {
    this._hidePinTip();
    const el = e.currentTarget;
    this._pinTipTimer = setTimeout(() => this._showPinTip(el, tile), PIN_TIP_DELAY);
  }

  async _showPinTip(el, tile) {
    this._pinTipTimer = null;
    if (!el.isConnected || this.draggedPinHref || this.draggedTabIndex !== null) return;
    const tab = tile.index >= 0 ? this.tabs[tile.index] : null;
    const title = tile.title || tab?.title || '';
    let url = pinTooltipUrl(tab?.url || tile.href);
    if (url === title) url = '';
    this._pinTip = {
      href: tile.href,
      title: title || url,
      url: title ? url : '',
    };
    await this.updateComplete;
    this._placePinTip(el);
  }

  // Below the tile (above it near the bottom of the window), centered on it but kept 6px inside the
  // sidebar's edges.
  _placePinTip(el) {
    const tipEl = this.shadowRoot.querySelector('.pin-tip');
    const sidebarEl = this.shadowRoot.querySelector('.sidebar');
    if (!tipEl || !sidebarEl || !el.isConnected) return;
    const tile = el.getBoundingClientRect();
    const bar = sidebarEl.getBoundingClientRect();
    const tip = tipEl.getBoundingClientRect();
    const left = Math.max(
      bar.left + 6,
      Math.min(tile.left + tile.width / 2 - tip.width / 2, bar.right - 6 - tip.width)
    );
    let top = tile.bottom + 6;
    if (top + tip.height > window.innerHeight - 6) top = tile.top - 6 - tip.height;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    tipEl.classList.add('shown');
  }

  _onScrollTabs(e) {
    this._hidePinTip();
    const scrolled = e.currentTarget.scrollTop > 0;
    if (scrolled !== this._tabsScrolled) this._tabsScrolled = scrolled;
  }

  _hidePinTip() {
    clearTimeout(this._pinTipTimer);
    this._pinTipTimer = null;
    if (this._pinTip) this._pinTip = null;
  }

  _onClickPin(tile) {
    if (tile.index >= 0) bg.views.setActiveTab(tile.index);
    else bg.views.openPin(tile.href);
  }

  // Middle-click closes a pin's tab; the tile stays.
  _onMousedownPin(e, tile) {
    this._hidePinTip();
    if (e.which === 2 && tile.index >= 0) bg.views.closeTab(tile.index);
  }

  _onContextmenuPin(e, tile) {
    e.preventDefault();
    if (tile.index >= 0) bg.views.showTabContextMenu(tile.index);
    else bg.views.showPinContextMenu(tile.href);
  }

  _onDragstartPin(e, tile) {
    this._hidePinTip();
    this.draggedPinHref = tile.href;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tile.href);
  }

  _canDropOnPins() {
    if (!this.pinsWritable) return false;
    if (this.draggedPinHref) return true;
    return this.draggedTabIndex !== null && !this.tabs[this.draggedTabIndex]?.isPinned;
  }

  _onDragoverPin(e, tile) {
    if (!this._canDropOnPins() || tile.href === this.draggedPinHref) return;
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drop-before');
  }

  // `position` is the tile's place in the grid; a pin moves to where that tile is now.
  _onDropPin(e, tile, position) {
    if (!this._canDropOnPins()) return;
    e.stopPropagation();
    e.preventDefault();
    this._dropOnPins(position, tile);
  }

  _onDragoverPins(e) {
    if (!this._canDropOnPins()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drop-into');
  }

  _onDropPins(e, count) {
    if (!this._canDropOnPins()) return;
    e.preventDefault();
    this._dropOnPins(count, null);
  }

  _dropOnPins(position, tile) {
    const href = this.draggedPinHref;
    const from = this.draggedTabIndex;
    this._onDragendTab();
    const order = (this.pins || []).map((p) => p.href);
    if (href) {
      if (tile && tile.href === href) return;
      // the target's index once the dragged pin is out of the list
      const rest = order.filter((h) => h !== href);
      const to = tile ? rest.indexOf(tile.href) : rest.length;
      bg.views.movePin(href, to === -1 ? rest.length : to);
    } else if (from !== null) {
      const to = tile ? order.indexOf(tile.href) : order.length;
      bg.views.pinTab(from, to === -1 ? order.length : to);
    }
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

  /* In-app window controls (138px, see window-controls.js) overlay the sidebar header
     when it sits on their side: Linux = left, Windows = right */
  .sidebar.linux:not(.side-right) .sidebar-header {
    padding-left: 138px;
  }
  .sidebar.win32.side-right .sidebar-header {
    padding-right: 138px;
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

  /* The pinned tiles and New tab stay put at the top; only the tab list below them scrolls. */

  .sidebar-top {
    flex-shrink: 0;
    padding: 4px 6px 0;
  }

  /* tab list */

  .sidebar-tabs {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 6px 4px;
    min-height: 0;
    border-top: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .sidebar-tabs.scrolled {
    border-top-color: var(--border-color--tab);
  }

  /* Thin scrollbars in the chrome's colors (design-tokens.css), so they follow light and dark. */
  .sidebar-tabs,
  .pins {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  /* pinned pages: icon tiles, like the phone's home shortcuts (mobile/components/Shortcuts.tsx) */

  .pins {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
    gap: 6px;
    padding: 2px 0 4px;
    border-radius: 10px;
    /* a long list of pins scrolls on its own, so the tabs below always have room */
    max-height: 40vh;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .pins.drop-into {
    background: var(--bg-color--tab--hover);
  }

  .pins.empty {
    display: block;
    border: 1.5px dashed var(--border-color--tab);
    padding: 10px 8px;
  }

  .pins-hint {
    font-size: 12px;
    text-align: center;
    color: var(--text-color--tab--title);
    opacity: 0.7;
  }

  .pin {
    position: relative;
    height: 42px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(
      --bg-color--pin,
      color-mix(in srgb, var(--text-color--tab--title) 6%, transparent)
    );
    border: 1px solid var(--border-color--tab);
    box-sizing: border-box;
    cursor: default;
    transition:
      background 0.1s,
      border-color 0.1s;
    -webkit-user-select: none;
    user-select: none;
  }

  .pin:hover {
    background: var(--bg-color--tab--hover);
  }

  .pin img {
    width: 20px;
    height: 20px;
    border-radius: 4px;
  }

  /* a pin whose tab isn't open: the tile stays, a little quieter */
  .pin:not(.open) img {
    opacity: 0.6;
    filter: saturate(0.6);
  }

  .pin:not(.open):hover img {
    opacity: 1;
    filter: none;
  }

  /* the open tab's tile: lifted, like the current tab row below */
  .pin.current {
    background: var(--bg-color--tab--current);
    border-color: color-mix(in srgb, var(--highlight-color--tab--current, #5b5ef4) 70%, transparent);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .pin.draft-previewing {
    outline: 1.5px solid #2864dc;
    outline-offset: -1.5px;
  }

  .pin.drop-before {
    box-shadow: inset 2px 0 0 var(--highlight-color--tab--current, #5b5ef4);
  }

  .pin .spinner {
    width: 14px;
    height: 14px;
  }

  /* the hovered pin's tooltip (_renderPinTip): lifted like the current tab */
  .pin-tip {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 200;
    box-sizing: border-box;
    padding: 6px 9px;
    background: var(--bg-color--tab--current);
    border: 1px solid var(--border-color--tab);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    pointer-events: none;
    visibility: hidden;
  }

  .pin-tip.shown {
    visibility: visible;
  }

  .pin-tip-title,
  .pin-tip-url {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pin-tip-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-color--default, var(--text-color--tab--title));
  }

  .pin-tip-url {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-color--tab--title);
    opacity: 0.7;
  }

  /* a pin playing sound: a small speaker badge at its corner, a button that mutes it */
  .pin-audio {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 14px;
    height: 14px;
    line-height: 14px;
    text-align: center;
    border-radius: 50%;
    font-size: 8px;
    color: var(--text-color--tab--title);
    background: var(--bg-color--background);
    box-shadow: 0 0 0 1px var(--border-color--tab, rgba(0, 0, 0, 0.1));
  }

  .pin-audio:hover {
    background: var(--bg-color--tab-close--hover);
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

  /* drag and drop: a line above the tab it will land in front of, a tint on the group it joins */
  .sidebar-tab.drop-before {
    box-shadow: inset 0 2px 0 var(--highlight-color--tab--current, #5b5ef4);
  }

  /* the rest of a tab: the dragged tab opens beside it in a split */
  .sidebar-tab.drop-split {
    background: var(--bg-color--split-drop);
    box-shadow: inset 0 0 0 2px var(--border-color--split-drop);
  }

  .sidebar-tab .tab-split {
    flex-shrink: 0;
    font-size: 10px;
    opacity: 0.55;
  }

  .group-header.drop-into {
    background: color-mix(in srgb, var(--group-color, #5b5ef4) 22%, transparent);
  }

  .new-tab-inline.drop-into {
    background: var(--bg-color--tab--hover);
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

  /* the speaker on a tab playing sound: a button that mutes it */
  .tab-audio {
    font-size: 10px;
    width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    border-radius: 3px;
    color: var(--text-color--tab--title);
    opacity: 0.75;
    flex-shrink: 0;
  }

  .tab-audio.fa-volume-mute {
    opacity: 0.55;
  }

  .tab-audio:hover {
    opacity: 1;
    background: var(--bg-color--tab-close--hover);
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
    margin-bottom: 2px;
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

  .spaces-btn:hover,
  .spaces-btn.pressed {
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

ShellWindowSidebar.styles = [ShellWindowSidebar.styles, personaAvatarCSS];

customElements.define('shell-window-sidebar', ShellWindowSidebar);
