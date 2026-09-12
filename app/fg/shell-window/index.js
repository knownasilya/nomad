import { ipcRenderer } from 'electron';
import { LitElement, html } from 'lit';
import * as bg from './bg-process-rpc';
import { fromEventStream } from '../../bg/web-apis/fg/event-target';
import './tabs';
import './sidebar';
import './ai-sidebar';
import './navbar';
import './panes';
import './resize-hackfix';
import './spaces-dropdown';
import './window-controls';

// setup
document.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('shell-window:ready');
});

class ShellWindowUI extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      showWindowControls: { type: Boolean },
      isUpdateAvailable: { type: Boolean },
      numWatchlistNotifications: { type: Number },
      isDaemonActive: { type: Boolean },
      isShellInterfaceHidden: { type: Boolean },
      isFullscreen: { type: Boolean },
      hasBgTabs: { type: Boolean },
      hasLocationExpanded: { type: Boolean },
      spaces: { type: Array },
      activeSpace: { type: Object },
      groups: { type: Array },
      tabLayout: { type: String },
      sidebarSide: { type: String },
      sidebarWidth: { type: Number },
      sidebarCollapsed: { type: Boolean },
      // aiSidebarWidth is shared/window-level; whether it's OPEN is per-tab — see this.activeTab.
      aiSidebarWidth: { type: Number },
    };
  }

  constructor() {
    super();
    this.tabs = [];
    this.isUpdateAvailable = false;
    this.numWatchlistNotifications = 0;
    this.isDaemonActive = true;
    this.isShellInterfaceHidden = false;
    this.isFullscreen = false;
    this.hasBgTabs = false;
    this.hasLocationExpanded = false;
    this.spaces = [];
    this.activeSpace = null;
    this.groups = [];
    this.activeTabIndex = -1;
    this.tabLayout = 'top-bar';
    this.sidebarSide = 'left';
    this.sidebarWidth = 220;
    this.sidebarCollapsed = false;
    this.aiSidebarWidth = 380;
    this.setup();
  }

  async setup() {
    // fetch platform information
    var browserInfo = await bg.beakerBrowser.getInfo();
    window.platform = browserInfo.platform;
    if (browserInfo.platform === 'darwin') {
      document.body.classList.add('darwin');
    }
    // Windows AND Linux have no native window buttons (the window is created with
    // titleBarStyle:'hidden'; macOS keeps its traffic lights) — render our own.
    if (browserInfo.platform === 'win32' || browserInfo.platform === 'linux') {
      document.body.classList.add(browserInfo.platform);
      this.showWindowControls = true;
    }

    // handle drag/drop of files
    window.addEventListener('drop', onDragDrop, false);
    function onDragDrop(event) {
      var files = Array.from(event.dataTransfer.files).slice(0, 10);
      var setActive = true;
      for (let file of files) {
        bg.views.createTab(`file://${file.path}`, { setActive });
        setActive = false;
      }
    }

    // listen to state updates to the window's tabs states
    var viewEvents = fromEventStream(bg.views.createEventStream());
    viewEvents.addEventListener('replace-state', (state) => {
      this.tabs = state.tabs;
      this.isFullscreen = state.isFullscreen;
      this.isShellInterfaceHidden = state.isShellInterfaceHidden;
      this.isSidebarHidden = state.isSidebarHidden;
      this.isDaemonActive = state.isDaemonActive;
      this.hasBgTabs = state.hasBgTabs;
      if (state.spaces) this.spaces = state.spaces;
      if (state.activeSpace) this.activeSpace = state.activeSpace;
      if (state.groups) this.groups = state.groups;
      if (state.tabLayout) this.tabLayout = state.tabLayout;
      if (state.sidebarSide) this.sidebarSide = state.sidebarSide;
      if (state.sidebarWidth) this.sidebarWidth = state.sidebarWidth;
      this.sidebarCollapsed = state.sidebarCollapsed || false;
      if (state.aiSidebarWidth) this.aiSidebarWidth = state.aiSidebarWidth;
      this.stateHasChanged();
    });
    viewEvents.addEventListener('update-state', ({ index, state }) => {
      if (this.tabs[index]) {
        Object.assign(this.tabs[index], state);
      }
      this.stateHasChanged();
    });
    viewEvents.addEventListener('update-panes-state', ({ index, paneLayout }) => {
      if (this.tabs[index]) {
        this.tabs[index].paneLayout = paneLayout;
      }
      this.shadowRoot.querySelector('shell-window-panes').requestUpdate();
    });

    // listen to state updates on the auto-updater
    var browserEvents = fromEventStream(bg.beakerBrowser.createEventsStream());
    browserEvents.addEventListener('updater-state-changed', this.onUpdaterStateChange.bind(this));

    // listen to state updates on the watchlist
    var wlEvents = fromEventStream(bg.watchlist.createEventsStream());
    wlEvents.addEventListener('resolved', () => {
      this.numWatchlistNotifications++;
    });

    const getDaemonStatus = async () => {
      await bg.beakerBrowser.getDaemonStatus();
    };

    // fetch initial tab state
    this.isUpdateAvailable = browserInfo.updater.state === 'downloaded';
    this.tabs = await bg.views.getState();
    this.spaces = await bg.spaces.list();
    this.activeSpace = await bg.spaces.getActive();
    this.stateHasChanged();
    getDaemonStatus();
  }

  get activeTab() {
    return this.tabs[this.activeTabIndex];
  }

  async stateHasChanged() {
    // update active index
    this.activeTabIndex = this.tabs.findIndex((tab) => tab.isActive);

    await this.requestUpdate();
    if (!this.isShellInterfaceHidden) {
      const tabsEl = this.shadowRoot.querySelector('shell-window-tabs');
      if (tabsEl) tabsEl.requestUpdate();
      const sidebarEl = this.shadowRoot.querySelector('shell-window-sidebar');
      if (sidebarEl) sidebarEl.requestUpdate();
      const aiSidebarEl = this.shadowRoot.querySelector('shell-window-ai-sidebar');
      if (aiSidebarEl) aiSidebarEl.requestUpdate();
      if (this.activeTab) {
        this.shadowRoot.querySelector('shell-window-navbar').requestUpdate();
      }
    }
    this.shadowRoot.querySelector('shell-window-panes').requestUpdate();
  }

  // rendering
  // =

  render() {
    const isSidebar = this.tabLayout === 'sidebar';
    const isDarwin = document.body.classList.contains('darwin');
    const isLeft = this.sidebarSide !== 'right';
    const sidebarOpen = isSidebar && !this.sidebarCollapsed;
    // Window-chrome clearance in the sidebar layout (no top tab strip, so the navbar spans
    // the top): macOS traffic lights need 80px on the left; our in-app window controls
    // (Linux left / Windows right, see window-controls.js) need 138px on their corner.
    // When the open sidebar is on the same side as the controls, the sidebar header
    // reserves the room instead (see sidebar.js) and the navbar needs nothing there.
    const CONTROLS_W = 138;
    const controlsSide = !this.showWindowControls
      ? null
      : document.body.classList.contains('linux')
        ? 'left'
        : 'right';
    let navMarginLeft = 0;
    let navMarginRight = 0;
    let navPadLeft = 0;
    let navPadRight = 0;
    if (isSidebar) {
      if (sidebarOpen) {
        if (isLeft) navMarginLeft = Math.max(this.sidebarWidth, isDarwin ? 80 : 0);
        else navMarginRight = this.sidebarWidth;
        if (controlsSide === 'left' && !isLeft) navPadLeft = CONTROLS_W;
        if (controlsSide === 'right' && isLeft) navPadRight = CONTROLS_W;
      } else {
        // Sidebar collapsed: use padding so the border spans full width but content
        // starts past the window chrome.
        if (isDarwin && isLeft) navPadLeft = 80;
        if (controlsSide === 'left') navPadLeft = Math.max(navPadLeft, CONTROLS_W);
        if (controlsSide === 'right') navPadRight = CONTROLS_W;
      }
    }
    // The AI sidebar always docks right, independent of tabLayout/sidebarSide — reserve its width
    // on the right for both the navbar and (in top-bar layout) the tab strip above it, the same
    // way the tab-list sidebar's own width is reserved above. Open/closed is per-tab.
    const aiOpen = this.activeTab?.aiSidebarOpen ?? false;
    const aiW = aiOpen ? this.aiSidebarWidth : 0;
    navMarginRight += aiW;
    const navbarStyle = [
      navMarginLeft ? `margin-left: ${navMarginLeft}px` : '',
      navMarginRight ? `margin-right: ${navMarginRight}px` : '',
      navPadLeft ? `padding-left: ${navPadLeft}px` : '',
      navPadRight ? `padding-right: ${navPadRight}px` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const tabsStyle = aiW && !isSidebar ? `margin-right: ${aiW}px` : '';
    return html`
      ${this.showWindowControls && !this.isFullscreen
        ? html`<shell-window-controls></shell-window-controls>`
        : ''}
      ${this.isShellInterfaceHidden
        ? ''
        : html`
            ${isSidebar && !this.sidebarCollapsed
              ? html`
                  <shell-window-sidebar
                    .tabs=${this.tabs}
                    .spaces=${this.spaces}
                    .activeSpace=${this.activeSpace}
                    .groups=${this.groups}
                    sidebar-side=${this.sidebarSide}
                    sidebar-width=${this.sidebarWidth}
                  ></shell-window-sidebar>
                `
              : !isSidebar
                ? html`
                    <shell-window-tabs
                      .tabs=${this.tabs}
                      .spaces=${this.spaces}
                      .activeSpace=${this.activeSpace}
                      .groups=${this.groups}
                      ?is-fullscreen=${this.isFullscreen}
                      ?has-bg-tabs=${this.hasBgTabs}
                      style=${tabsStyle}
                    ></shell-window-tabs>
                  `
                : ''}
            <shell-window-navbar
              .activeTabIndex=${this.activeTabIndex}
              .activeTab=${this.activeTab}
              ?is-sidebar-hidden=${this.isSidebarHidden}
              ?is-update-available=${this.isUpdateAvailable}
              ?is-daemon-active=${this.isDaemonActive}
              num-watchlist-notifications="${this.numWatchlistNotifications}"
              tab-layout=${this.tabLayout}
              ?sidebar-collapsed=${this.sidebarCollapsed}
              ?ai-open=${aiOpen}
              style=${navbarStyle}
            ></shell-window-navbar>
            ${aiOpen
              ? html`
                  <shell-window-ai-sidebar
                    .activeTab=${this.activeTab}
                    .width=${this.aiSidebarWidth}
                  ></shell-window-ai-sidebar>
                `
              : ''}
          `}
      <shell-window-panes .activeTab=${this.activeTab}></shell-window-panes>
    `;
  }

  // event handlers
  // =

  onUpdaterStateChange(e) {
    this.isUpdateAvailable = e && e.state === 'downloaded';
  }
}

customElements.define('shell-window', ShellWindowUI);
