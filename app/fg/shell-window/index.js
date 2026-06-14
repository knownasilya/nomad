import { ipcRenderer } from 'electron';
import { LitElement, html } from 'lit';
import * as bg from './bg-process-rpc';
import { fromEventStream } from '../../bg/web-apis/fg/event-target';
import './tabs';
import './sidebar';
import './navbar';
import './panes';
import './resize-hackfix';
import './spaces-dropdown';

// setup
document.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('shell-window:ready');
});

class ShellWindowUI extends LitElement {
  static get properties() {
    return {
      tabs: { type: Array },
      isWindows: { type: Boolean },
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
    this.setup();
  }

  async setup() {
    // fetch platform information
    var browserInfo = await bg.beakerBrowser.getInfo();
    window.platform = browserInfo.platform;
    if (browserInfo.platform === 'darwin') {
      document.body.classList.add('darwin');
    }
    if (browserInfo.platform === 'win32') {
      document.body.classList.add('win32');
      this.isWindows = true;
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
      this.stateHasChanged();
    });
    viewEvents.addEventListener('update-state', ({ index, state }) => {
      if (this.tabs[index]) {
        Object.assign(this.tabs[index], state);
      }
      this.stateHasChanged();
    });
    viewEvents.addEventListener(
      'update-panes-state',
      ({ index, paneLayout }) => {
        if (this.tabs[index]) {
          this.tabs[index].paneLayout = paneLayout;
        }
        this.shadowRoot.querySelector('shell-window-panes').requestUpdate();
      }
    );

    // listen to state updates on the auto-updater
    var browserEvents = fromEventStream(bg.beakerBrowser.createEventsStream());
    browserEvents.addEventListener(
      'updater-state-changed',
      this.onUpdaterStateChange.bind(this)
    );

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
    const sidebarW = this.sidebarCollapsed ? 48 : this.sidebarWidth;
    const isDarwin = document.body.classList.contains('darwin');
    const isLeft = this.sidebarSide !== 'right';
    // Expanded macOS left: sidebar starts at top:0, need 80px margin to clear traffic lights.
    // Collapsed macOS left: sidebar starts at top:34px, margin just matches the 48px rail width,
    // but we still need inner padding to push buttons past the traffic lights (80 - 48 = 32px).
    const isCollapsedDarwinLeft = isSidebar && isDarwin && isLeft && this.sidebarCollapsed;
    const needsTrafficLightClearance = isDarwin && isLeft && !this.sidebarCollapsed;
    const navbarMargin = isSidebar
      ? Math.max(sidebarW, needsTrafficLightClearance ? 80 : 0)
      : 0;
    const navbarInnerPadding = isCollapsedDarwinLeft ? 80 - sidebarW : 0;
    const navbarStyle = [
      navbarMargin ? `margin-${isLeft ? 'left' : 'right'}: ${navbarMargin}px` : '',
      navbarInnerPadding ? `padding-${isLeft ? 'left' : 'right'}: ${navbarInnerPadding}px` : '',
    ].filter(Boolean).join('; ');
    return html`
      ${this.isWindows ? html`<shell-window-win32></shell-window-win32>` : ''}
      ${this.isShellInterfaceHidden
        ? ''
        : html`
            ${isSidebar
              ? html`
                  <shell-window-sidebar
                    .tabs=${this.tabs}
                    .spaces=${this.spaces}
                    .activeSpace=${this.activeSpace}
                    .groups=${this.groups}
                    sidebar-side=${this.sidebarSide}
                    sidebar-width=${this.sidebarWidth}
                    ?sidebar-collapsed=${this.sidebarCollapsed}
                  ></shell-window-sidebar>
                `
              : html`
                  <shell-window-tabs
                    .tabs=${this.tabs}
                    .spaces=${this.spaces}
                    .activeSpace=${this.activeSpace}
                    .groups=${this.groups}
                    ?is-fullscreen=${this.isFullscreen}
                    ?has-bg-tabs=${this.hasBgTabs}
                  ></shell-window-tabs>
                `}
            <shell-window-navbar
              .activeTabIndex=${this.activeTabIndex}
              .activeTab=${this.activeTab}
              ?is-sidebar-hidden=${this.isSidebarHidden}
              ?is-update-available=${this.isUpdateAvailable}
              ?is-daemon-active=${this.isDaemonActive}
              num-watchlist-notifications="${this.numWatchlistNotifications}"
              style=${navbarStyle}
            ></shell-window-navbar>
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
