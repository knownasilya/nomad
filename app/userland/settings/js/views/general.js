import {
  LitElement,
  html,
} from 'lit';
import viewCSS from '../../css/views/general.css.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';

class GeneralSettingsView extends LitElement {
  static get properties() {
    return {};
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.browserEvents = undefined;
    this.settings = undefined;
    this.browserInfo = undefined;
    this.defaultProtocolSettings = undefined;
    this.listingSelfState = undefined;
  }

  get isAutoUpdateEnabled() {
    return this.settings && +this.settings.auto_update_enabled === 1;
  }

  async load() {
    // wire up events
    this.browserEvents = nomad.browser.createEventsStream();
    this.browserEvents.addEventListener(
      'updater-state-changed',
      this.onUpdaterStateChanged.bind(this)
    );
    this.browserEvents.addEventListener(
      'updater-error',
      this.onUpdaterError.bind(this)
    );

    // fetch data
    this.browserInfo = await nomad.browser.getInfo();
    this.settings = await nomad.browser.getSettings();
    this.defaultProtocolSettings =
      await nomad.browser.getDefaultProtocolSettings();
    console.log('loaded', {
      browserInfo: this.browserInfo,
      settings: this.settings,
      defaultProtocolSettings: this.defaultProtocolSettings,
    });
    this.requestUpdate();

    this.requestUpdate();
  }

  unload() {
    this.browserEvents.close();
  }

  // rendering
  // =

  render() {
    if (!this.browserInfo) return html``;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${this.renderDaemonStatus()}
      <div class="form-group">
        <h2>Auto Updater</h2>
        ${this.renderAutoUpdater()}
      </div>
      <div class="form-group">
        <h2>Tab Settings</h2>
        ${this.renderNavLayoutSettings()}
        ${this.renderOnStartupSettings()} ${this.renderNewTabSettings()}
        ${this.renderTabSettings()} ${this.renderDefaultZoomSettings()}
      </div>
      <div class="form-group">
        <h2>Browser Settings</h2>
        ${this.renderRunBackgroundSettings()} ${this.renderStartupSettings()}
        ${this.renderProtocolSettings()} ${this.renderThemeSettings()}
      </div>
      <div class="form-group">
        <h2>Search Settings</h2>
        ${this.renderSearchSettings()}
      </div>
      <div class="form-group">
        <h2>Nomad Analytics</h2>
        ${this.renderAnalyticsSettings()}
      </div>
    `;
  }

  renderDaemonStatus() {
    if (this.browserInfo && !this.browserInfo.isDaemonActive) {
      return html`
        <div class="section warning">
          <h2>
            <span class="fas fa-exclamation-triangle"></span> The Hyperdrive
            Daemon is Not Active
          </h2>
          <p>The "daemon" runs Nomad's Hyperdrive networking.</p>
          <p>
            <button @click=${this.onClickRestartDaemon}>
              Restart the Daemon
            </button>
          </p>
        </div>
      `;
    }
  }

  renderAutoUpdater() {
    if (
      this.browserInfo &&
      !this.browserInfo.updater.isBrowserUpdatesSupported
    ) {
      return html`
        <div class="section">
          <p class="message info">
            Sorry! Nomad auto-updates are only supported on the production build
            for macOS and Windows.
          </p>

          <p>
            To get the most recent version of Nomad, you'll need to
            <a href="https://github.com/knownasilya/nomad">
              build Nomad from source</a
            >.
          </p>
        </div>
      `;
    }

    switch (this.browserInfo.updater.state) {
      default:
      case 'idle':
        return html` <div class="section">
          <h2 id="auto-updater">Auto Updater</h2>

          ${this.browserInfo.updater.error
            ? html`
                <div class="message error">
                  <i class="fa fa-exclamation-triangle"></i>
                  ${this.browserInfo.updater.error.message ||
                  this.browserInfo.updater.error}
                </div>
              `
            : ''}

          <div class="auto-updater">
            <p>
              <button
                class="btn btn-default"
                @click=${this.onClickCheckUpdates}
              >
                Check for updates
              </button>

              <span class="up-to-date">
                <span class="fa fa-check"></span>
                Nomad v${this.browserInfo.version} is up-to-date
              </span>
            </p>

            <p>${this.renderAutoUpdateCheckbox()}</p>

            <div class="prereleases">
              <h3>Advanced</h3>
              <button class="btn" @click=${this.onClickCheckPrereleases}>
                Check for beta releases
              </button>
            </div>
          </div>
        </div>`;

      case 'checking':
        return html` <div class="section">
          <h2 id="auto-updater">Auto Updater</h2>

          <div class="auto-updater">
            <p>
              <button class="btn" disabled>Checking for updates</button>
              <span class="version-info">
                <div class="spinner"></div>
                Checking for updates...
              </span>
            </p>

            <p>${this.renderAutoUpdateCheckbox()}</p>

            <div class="prereleases">
              <h3>Advanced</h3>
              <button class="btn" @click=${this.onClickCheckPrereleases}>
                Check for beta releases
              </button>
            </div>
          </div>
        </div>`;

      case 'downloading':
        return html` <div class="section">
          <h2 id="auto-updater">Auto Updater</h2>

          <div class="auto-updater">
            <p>
              <button class="btn" disabled>Updating</button>
              <span class="version-info">
                <span class="spinner"></span>
                Downloading the latest version of Nomad...
              </span>
            </p>
            <p>${this.renderAutoUpdateCheckbox()}</p>
          </div>
        </div>`;

      case 'downloaded':
        return html` <div class="section">
          <h2 id="auto-updater">Auto Updater</h2>

          <div class="auto-updater">
            <p>
              <button class="btn" @click=${this.onClickRestart}>
                Restart now
              </button>
              <span class="version-info">
                <i class="fa fa-arrow-circle-o-up"></i>
                <strong>New version available.</strong> Restart Nomad to
                install.
              </span>
            </p>
            <p>${this.renderAutoUpdateCheckbox()}</p>
          </div>
        </div>`;
    }
  }

  renderAutoUpdateCheckbox() {
    return html`<label>
      <input
        type="checkbox"
        ?checked=${this.isAutoUpdateEnabled}
        @click=${this.onToggleAutoUpdate}
      />
      Check for updates automatically
    </label>`;
  }

  renderTabSettings() {
    return html`
      <div class="section">
        <div class="radio-item">
          <input
            type="checkbox"
            id="newTabsInForeground"
            ?checked=${this.settings.new_tabs_in_foreground == 1}
            @change=${this.onNewTabsInForegroundToggle}
          />
          <label for="newTabsInForeground">
            When you open a link in a new tab, switch to it immediately
          </label>
        </div>
      </div>
    `;
  }

  renderOnStartupSettings() {
    return html`
      <div class="section">
        <p>When Nomad starts</p>

        <div class="radio-item">
          <input
            type="radio"
            id="customStartPage1"
            name="custom-start-page"
            value="blank"
            ?checked=${this.settings.custom_start_page === 'blank'}
            @change=${this.onCustomStartPageChange}
          />
          <label for="customStartPage1">Show a new tab</label>
        </div>
        <div class="radio-item">
          <input
            type="radio"
            id="customStartPage2"
            name="custom-start-page"
            value="previous"
            ?checked=${this.settings.custom_start_page === 'previous'}
            @change=${this.onCustomStartPageChange}
          />
          <label for="customStartPage2">
            Show tabs from your last session
          </label>
        </div>
      </div>
    `;
  }

  renderNavLayoutSettings() {
    const isSidebar = this.settings.tab_layout === 'sidebar';
    const width = this.settings.sidebar_width || 220;
    return html`
      <div class="section">
        <p>Navigation layout:</p>
        <div class="radio-item">
          <input
            type="radio"
            id="navLayoutTopBar"
            name="nav-layout"
            value="top-bar"
            ?checked=${!isSidebar}
            @change=${this.onNavLayoutChange}
          />
          <label for="navLayoutTopBar">Top bar (default)</label>
        </div>
        <div class="radio-item">
          <input
            type="radio"
            id="navLayoutSidebar"
            name="nav-layout"
            value="sidebar"
            ?checked=${isSidebar}
            @change=${this.onNavLayoutChange}
          />
          <label for="navLayoutSidebar">Sidebar</label>
        </div>
        ${isSidebar
          ? html`
              <div style="margin-top: 10px; padding-left: 22px;">
                <p style="margin: 0 0 6px;">Sidebar position:</p>
                <div class="radio-item">
                  <input
                    type="radio"
                    id="sidebarLeft"
                    name="sidebar-side"
                    value="left"
                    ?checked=${this.settings.sidebar_side !== 'right'}
                    @change=${this.onSidebarSideChange}
                  />
                  <label for="sidebarLeft">Left</label>
                </div>
                <div class="radio-item">
                  <input
                    type="radio"
                    id="sidebarRight"
                    name="sidebar-side"
                    value="right"
                    ?checked=${this.settings.sidebar_side === 'right'}
                    @change=${this.onSidebarSideChange}
                  />
                  <label for="sidebarRight">Right</label>
                </div>
                <p style="margin: 10px 0 4px;">Sidebar width: <strong>${width}px</strong></p>
                <input
                  type="range"
                  min="160"
                  max="480"
                  step="10"
                  .value=${String(width)}
                  @input=${this.onSidebarWidthChange}
                  @change=${this.onSidebarWidthCommit}
                  style="width: 220px;"
                />
              </div>
            `
          : ''}
      </div>
    `;
  }

  renderRunBackgroundSettings() {
    return html`
      <div class="section run-background">
        <p>
          Running in the background helps keep your data online even if you're
          not using Nomad.
        </p>

        <div class="radio-item">
          <input
            type="checkbox"
            id="runBackground"
            ?checked=${this.settings.run_background == 1}
            @change=${this.onRunBackgroundToggle}
          />
          <label for="runBackground">Let Nomad run in the background</label>
        </div>
      </div>
    `;
  }

  renderStartupSettings() {
    return html`<div class="section on-startup">
      <p>
        When running in the background it's helpful to also have the browser
        open on startup of your computer.
      </p>

      <div class="radio-item">
        <input
          type="checkbox"
          id="onStart"
          ?checked=${this.settings.launch_on_startup == 1}
          @change=${this.onLaunchOnStartupToggle}
        />
        <label for="onStart">Launch Nomad on computer startup</label>
      </div>
    </div>`;
  }

  renderNewTabSettings() {
    return html`
      <div class="section">
        <p>When you create a new tab, show</p>

        <div>
          <input
            name="new-tab"
            id="newTab"
            type="text"
            value=${this.settings.new_tab || 'nomad://desktop/'}
            @input=${this.onNewTabChange}
            style="width: 300px"
          />
          <button @click=${this.onClickBrowseNewTab}>Browse...</button>
          <button @click=${this.onClickDefaultNewTab}>Use Default</button>
        </div>
      </div>
    `;
  }

  renderSearchSettings() {
    return html`
      <div class="section">
        <div class="search-settings-list">
          ${this.settings.search_engines.map((engine, i) => {
            const url = new URL(engine.url);

            return html` <div class="radio-item">
              <input
                type="radio"
                id="engine${i}"
                name="search-engine"
                value="${i}"
                ?checked="${engine.selected}"
                @change="${this.onSearchEngineChange}"
              />
              <label for="engine${i}">
                ${engine.name} (${url.origin})
                ${this.settings.search_engines.length === 1
                  ? ''
                  : html`
                      <a
                        @click="${() => this.removeSearchEngine(i)}"
                        data-tooltip="Remove"
                        title="Remove Search Engine"
                      >
                        <span class="fas fa-fw fa-times"></span>
                      </a>
                    `}
              </label>
            </div>`;
          })}
        </div>
        <form @submit=${this.onAddSearchEngine}>
          <input
            type="text"
            placeholder="Name"
            id="custom-engine-name"
            required
          />
          <input type="url" placeholder="URL" id="custom-engine-url" required />
          <button type="submit">Add</button>
        </form>
      </div>
    `;
  }

  renderDefaultZoomSettings() {
    const opt = (v, label) => html`
      <option value=${v} ?selected=${v === this.settings.default_zoom}>
        ${label}
      </option>
    `;
    return html`
      <div class="section">
        <p>Pages should use the following "zoom" setting by default:</p>

        <div>
          <select @change=${this.onChangeDefaultZoom}>
            ${opt(-3, '25%')} ${opt(-2.5, '33%')} ${opt(-2, '50%')}
            ${opt(-1.5, '67%')} ${opt(-1, '75%')} ${opt(-0.5, '90%')}
            ${opt(0, '100%')} ${opt(0.5, '110%')} ${opt(1, '125%')}
            ${opt(1.5, '150%')} ${opt(2, '175%')} ${opt(2.5, '200%')}
            ${opt(3, '250%')} ${opt(3.5, '300%')} ${opt(4, '400%')}
            ${opt(4.5, '500%')}
          </select>
        </div>
      </div>
    `;
  }

  renderProtocolSettings() {
    const toggleRegistered = (protocol) => {
      // update and optimistically render
      this.defaultProtocolSettings[protocol] =
        !this.defaultProtocolSettings[protocol];

      if (this.defaultProtocolSettings[protocol]) {
        nomad.browser.setAsDefaultProtocolClient(protocol);
      } else {
        nomad.browser.removeAsDefaultProtocolClient(protocol);
      }
      toast.create('Setting updated');
      this.requestUpdate();
    };

    return html` <div class="section">
      <p>Set Nomad as the default browser for:</p>

      ${Object.keys(this.defaultProtocolSettings).map(
        (proto) => html`
          <div class="radio-item">
            <input
              id="proto-${proto}"
              ?checked=${this.defaultProtocolSettings[proto]}
              type="checkbox"
              @change=${() => toggleRegistered(proto)}
            />
            <label for="proto-${proto}">
              <span class="text"> ${proto}:// </span>
            </label>
          </div>
        `
      )}
    </div>`;
  }

  renderThemeSettings() {
    return html`
      <div class="section">
        <p>Browser theme:</p>

        <div class="radio-item">
          <input
            type="radio"
            id="browserTheme1"
            name="browser-theme"
            value="system"
            ?checked=${this.settings.browser_theme === 'system'}
            @change=${this.onBrowserThemeChange}
          />
          <label for="browserTheme1"> Default (use system value) </label>
        </div>
        <div class="radio-item">
          <input
            type="radio"
            id="browserTheme2"
            name="browser-theme"
            value="light"
            ?checked=${this.settings.browser_theme === 'light'}
            @change=${this.onBrowserThemeChange}
          />
          <label for="browserTheme2"> Light mode </label>
        </div>
        <div class="radio-item">
          <input
            type="radio"
            id="browserTheme3"
            name="browser-theme"
            value="dark"
            ?checked=${this.settings.browser_theme === 'dark'}
            @change=${this.onBrowserThemeChange}
          />
          <label for="browserTheme3"> Dark mode </label>
        </div>
      </div>
    `;
  }

  renderAnalyticsSettings() {
    const toggle = () => {
      // update and optimistically render
      this.settings.analytics_enabled =
        this.settings.analytics_enabled == 1 ? 0 : 1;
      nomad.browser.setSetting(
        'analytics_enabled',
        this.settings.analytics_enabled
      );
      this.requestUpdate();
      toast.create('Setting updated');
    };

    return html` <div class="section analytics">
      <div class="radio-item">
        <input
          id="enable-analytics"
          ?checked=${this.settings.analytics_enabled == 1}
          type="checkbox"
          @change=${toggle}
        />
        <label for="enable-analytics">
          <span> Enable analytics </span>
        </label>
      </div>

      <div class="message">
        <p>
          Help us know how we${"'"}re doing! Enabling analytics will send us the
          following information once a week:
        </p>

        <ul>
          <li>An anonymous ID</li>
          <li>Your Nomad version, e.g. ${this.browserInfo.version}</li>
          <li>Your operating system, e.g. Windows 10</li>
        </ul>
      </div>
    </div>`;
  }

  // events
  // =

  onUpdaterStateChanged(e) {
    console.debug('onUpdaterStateChanged', e);
    if (!this.browserInfo) {
      return;
    }
    this.browserInfo.updater.state = e.state;
    this.browserInfo.updater.error = false;
    this.requestUpdate();
  }

  async onUpdaterError(err) {
    console.debug('onUpdaterError', err);
    if (!this.browserInfo) {
      return;
    }
    this.browserInfo = await nomad.browser.getInfo();
    this.requestUpdate();
  }

  onClickCheckUpdates() {
    // trigger check
    nomad.browser.checkForUpdates();
  }

  onClickCheckPrereleases(e) {
    e.preventDefault();
    nomad.browser.checkForUpdates({ prerelease: true });
  }

  onClickRestart() {
    nomad.browser.restartBrowser();
  }

  onToggleAutoUpdate() {
    this.settings.auto_update_enabled = this.isAutoUpdateEnabled ? 0 : 1;
    this.requestUpdate();
    nomad.browser.setSetting(
      'auto_update_enabled',
      this.settings.auto_update_enabled
    );
    toast.create('Setting updated');
  }

  onCustomStartPageChange(e) {
    this.settings.custom_start_page = e.target.value;
    nomad.browser.setSetting(
      'custom_start_page',
      this.settings.custom_start_page
    );
    toast.create('Setting updated');
  }

  onBrowserThemeChange(e) {
    this.settings.browser_theme = e.target.value;
    nomad.browser.setSetting('browser_theme', this.settings.browser_theme);
    toast.create('Setting updated');
  }

  onNewTabsInForegroundToggle(e) {
    this.settings.new_tabs_in_foreground =
      this.settings.new_tabs_in_foreground == 1 ? 0 : 1;
    nomad.browser.setSetting(
      'new_tabs_in_foreground',
      this.settings.new_tabs_in_foreground
    );
    toast.create('Setting updated');
  }

  onNavLayoutChange(e) {
    this.settings.tab_layout = e.target.value;
    nomad.browser.setSetting('tab_layout', this.settings.tab_layout);
    toast.create('Setting updated');
    this.requestUpdate();
  }

  onSidebarSideChange(e) {
    this.settings.sidebar_side = e.target.value;
    nomad.browser.setSetting('sidebar_side', this.settings.sidebar_side);
    toast.create('Setting updated');
    this.requestUpdate();
  }

  onSidebarWidthChange(e) {
    this.settings.sidebar_width = Number(e.target.value);
    this.requestUpdate();
  }

  onSidebarWidthCommit(e) {
    this.settings.sidebar_width = Number(e.target.value);
    nomad.browser.setSetting('sidebar_width', this.settings.sidebar_width);
    toast.create('Setting updated');
    this.requestUpdate();
  }

  onRunBackgroundToggle(e) {
    this.settings.run_background = this.settings.run_background == 1 ? 0 : 1;
    nomad.browser.setSetting('run_background', this.settings.run_background);
    toast.create('Setting updated');
  }

  async onLaunchOnStartupToggle(e) {
    const desiredState = e.target.checked;
    nomad.browser.setSetting('launch_on_startup', desiredState ? 1 : 0);
    await nomad.browser.setRunOnStartup(desiredState);
    toast.create('Setting updated');
  }

  onNewTabChange(e) {
    this.settings.new_tab = e.target.value;
    nomad.browser.setSetting('new_tab', this.settings.new_tab);
    toast.create('Setting updated');
  }

  async onClickBrowseNewTab(e) {
    var sel = await nomad.shell.selectFileDialog({
      allowMultiple: false,
    });
    if (sel) {
      this.settings.new_tab = sel[0].url;
      nomad.browser.setSetting('new_tab', this.settings.new_tab);
      toast.create('Setting updated');
      this.requestUpdate();
    }
  }

  onClickDefaultNewTab(e) {
    this.settings.new_tab = 'nomad://desktop/';
    nomad.browser.setSetting('new_tab', this.settings.new_tab);
    toast.create('Setting updated');
    this.requestUpdate();
  }

  onSearchEngineChange(e) {
    const index = e.target.value;
    for (let se of this.settings.search_engines) {
      delete se.selected;
    }
    this.settings.search_engines[index].selected = true;
    nomad.browser.setSetting('search_engines', this.settings.search_engines);
    toast.create('Setting updated');
    this.requestUpdate();
  }

  removeSearchEngine(i) {
    // decrement selected search engine so it points to the same one if the removed index is less than current one
    let wasSelected = this.settings.search_engines[i].selected;
    this.settings.search_engines.splice(i, 1);
    if (wasSelected) {
      this.settings.search_engines[0].selected = true;
    }
    nomad.browser.setSetting('search_engines', this.settings.search_engines);
    this.requestUpdate();
  }

  onAddSearchEngine(e) {
    e.preventDefault();
    const name = this.shadowRoot.getElementById('custom-engine-name');
    const url = this.shadowRoot.getElementById('custom-engine-url');
    this.settings.search_engines.push({ name: name.value, url: url.value });
    nomad.browser.setSetting('search_engines', this.settings.search_engines);
    name.value = '';
    url.value = '';
    this.requestUpdate();
  }

  onChangeDefaultZoom(e) {
    this.settings.default_zoom = +e.currentTarget.value;
    nomad.browser.setSetting('default_zoom', this.settings.default_zoom);
    toast.create('Setting updated');
  }

  async onClickRestartDaemon(e) {
    let el = e.currentTarget;
    el.innerHTML = '<span class="spinner"></span>';
    await nomad.browser.reconnectHyperdriveDaemon();
    this.browserInfo = await nomad.browser.getInfo();
    this.requestUpdate();
  }

  async onClickAddSiteToNomadNetwork(e) {
    this.listingSelfState = 'attempting';
    this.requestUpdate();

    await nomad.browser.addProfileToNomadNetwork();
    this.isProfileListedInNomadNetwork = true;
    this.listingSelfState = 'done';
    this.requestUpdate();
  }

}
customElements.define('general-settings-view', GeneralSettingsView);
