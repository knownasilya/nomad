import {
  LitElement,
  html,
} from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { toNiceDomain } from '../../app-stdlib/js/strings.js';
import { writeToClipboard } from '../../app-stdlib/js/clipboard.js';
import * as contextMenu from '../../app-stdlib/js/com/context-menu.js';
import * as toast from '../../app-stdlib/js/com/toast.js';
import * as nomadPermissions from '../../../lib/permissions';
import mainCSS from '../css/main.css.js';
import { nameTarget, normalizeName } from '../../../../shared/names.mjs';
import './com/site-perms.js';
import './com/identity.js';
import './com/drive-forks.js';

const isHyperHashRegex = /^[a-z0-9]{64}/i;

class SiteInfoApp extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      view: { type: String },
      user: { type: Object },
      isLoading: { type: Boolean },
      info: { type: Object },
      cert: { type: Object },
      requestedPerms: { type: Object },
      forks: { type: Array },
      names: { type: Array }, // the user's names for this page (nomad.vault.namesForUrl)
      naming: { type: Object }, // { value, previous, error } while the name field is open
    };
  }

  static get styles() {
    return [mainCSS];
  }

  get isDrive() {
    return this.url && this.url.startsWith('hyper:');
  }

  get isHttps() {
    return this.url && this.url.startsWith('https:');
  }

  get isHttp() {
    return this.url && this.url.startsWith('http:');
  }

  get isNomad() {
    return this.url && this.url.startsWith('nomad:');
  }

  get isRootDrive() {
    return this.origin === nomad.fs.drive('hyper://private/').url;
  }

  get drive() {
    return nomad.fs.drive(this.url);
  }

  get origin() {
    let urlp = new URL(this.url);
    return urlp.origin + '/';
  }

  get hostname() {
    let urlp = new URL(this.url);
    return urlp.hostname;
  }

  get pathname() {
    let urlp = new URL(this.url);
    return urlp.pathname;
  }

  constructor() {
    super();
    this.reset();

    // global event listeners
    window.addEventListener('blur', (e) => {
      nomad.browser.toggleSiteInfo(false);
      this.reset();
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        nomad.browser.toggleSiteInfo(false);
      }
    });
    const globalAnchorClickHandler = (isPopup) => (e) => {
      e.preventDefault();
      var a = (e.composedPath ? e.composedPath() : e.path || []).reduce(
        (acc, v) => acc || (v.tagName === 'A' ? v : undefined),
        undefined
      );
      if (a) {
        var href = a.getAttribute('href');
        if (href && href !== '#' && !href.startsWith('nomad://')) {
          if (isPopup || e.metaKey || a.getAttribute('target') === '_blank') {
            nomad.browser.openUrl(href, { setActive: true });
          } else {
            nomad.browser.gotoUrl(href);
          }
          nomad.browser.toggleSiteInfo(false);
        }
      }
    };
    document.body.addEventListener('auxclick', globalAnchorClickHandler(true));
    document.body.addEventListener('click', globalAnchorClickHandler(false));

    // export interface
    window.init = this.init.bind(this);
    window.reset = this.reset.bind(this);
  }

  init(params) {
    this.url = params.url;
    this.load();
  }

  reset() {
    this.url = '';
    this.view = undefined;
    this.isLoading = true;
    this.info = undefined;
    this.cert = undefined;
    this.driveCfg = undefined;
    this.requestedPerms = undefined;
    this.forks = undefined;
    contextMenu.destroy();
  }

  async load() {
    this.isLoading = true;
    if (!this.url) return;
    try {
      this.info = {};
      this.driveCfg = undefined;
      if (this.isDrive) {
        // get drive info
        let drive = this.drive;
        [this.info, this.driveCfg, this.forks] = await Promise.all([
          drive.getInfo(),
          nomad.drives.get(this.url),
          nomad.drives.getForks(this.url),
        ]);
      } else {
        this.info = {
          title: this.hostname,
          domain: this.isHttps ? this.hostname : undefined,
        };
      }

      if (!this.view) {
        this.view = 'identity';
      }

      // The user's names for this page (bg/hyper/names.js). nomad:// pages can be named too.
      this.names = await nomad.vault.namesForUrl(this.url).catch(() => []);

      // all sites: get cert and requested perms
      var perms;
      [perms, this.cert] = await Promise.all([
        nomad.sitedata.getPermissions(this.origin),
        nomad.browser.getCertificate(this.url),
      ]);
      if (this.cert && this.cert.type === 'hyperdrive') {
        this.cert.driveInfo = this.info;
      }
      this.requestedPerms = await Promise.all(
        Object.entries(perms).map(async ([perm, value]) => {
          var opts = {};
          var permParam = nomadPermissions.getPermParam(perm);
          if (isHyperHashRegex.test(permParam)) {
            let driveInfo;
            try {
              driveInfo = await nomad.fs
                .drive(permParam)
                .getInfo();
            } catch (e) {
              /* ignore */
            }
            opts.title =
              driveInfo && driveInfo.title
                ? driveInfo.title
                : toNiceDomain(permParam);
          }
          return { perm, value, opts };
        })
      );
    } catch (e) {
      console.error(e);
    }
    this.isLoading = false;
  }

  // rendering
  // =

  render() {
    if (this.isLoading) {
      return html`<div class="loading">
        <span class="spinner"></span> Loading...
      </div>`;
    }
    if (this.isDrive && this.info && this.info.version === 0) {
      return html`
        <div class="site-info">
          <div class="details">
            <h1>Site not found</h1>
            <p class="protocol">
              Make sure the address is correct and try again
            </p>
          </div>
        </div>
      `;
    }
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div>
        ${this.renderSiteInfo()} ${this.renderNav()} ${this.renderView()}
      </div>
    `;
  }

  renderSiteInfo() {
    var writable = this.info ? this.info.writable : false;
    var isSaved = this.driveCfg ? this.driveCfg.saved : false;
    var isInternal = this.driveCfg ? this.driveCfg.ident.internal : false;
    return html`
      <div class="site-info">
        <div class="details">
          <p class="buttons">
            <button @click=${this.onCopyUrl}>
              <span class="fas fa-fw fa-link"></span> Copy URL
            </button>
            ${this.isDrive && !isInternal
              ? html`
                  ${writable
                    ? html`
                        <button @click=${this.onToggleSaveDrive}>
                          ${isSaved
                            ? html`<span class="fas fa-fw fa-trash"></span>
                                Remove From Library`
                            : html`<span
                                  class="fas fa-fw fa-trash-restore"
                                ></span>
                                Readd To Library`}
                        </button>
                      `
                    : html`
                        <button @click=${this.onToggleSaveDrive}>
                          ${isSaved
                            ? html`<span class="fas fa-fw fa-times"></span> Stop
                                Hosting`
                            : html`<span class="fas fa-fw fa-share-alt"></span>
                                Host This Site`}
                        </button>
                      `}
                `
              : ''}
            ${this.isDrive
              ? html`
                  <button @click=${this.onClickDriveTools}>
                    Tools <span class="fa-fw fa fa-caret-down"></span>
                  </button>
                `
              : ''}
          </p>
          ${this.renderName()}
        </div>
      </div>
    `;
  }

  // A short name for this page: typing it in the URL bar, or opening hyper://<name>/, comes here.
  renderName() {
    if (!this.url || !/^(hyper|https?|nomad):/.test(this.url)) return '';
    if (this.naming) {
      return html`
        <form class="name-row editing" @submit=${this.onSaveName}>
          <span class="name-prefix">hyper://</span>
          <input
            class="name-input"
            .value=${this.naming.value}
            placeholder="name"
            aria-label="Name"
            @input=${(e) => (this.naming = { ...this.naming, value: e.target.value, error: '' })}
            @keydown=${(e) => e.key === 'Escape' && this.onCancelName(e)}
          />
          <span class="name-prefix">/</span>
          <button type="submit" class="primary">Save</button>
          <button type="button" @click=${this.onCancelName}>Cancel</button>
          ${this.naming.error ? html`<div class="name-error">${this.naming.error}</div>` : ''}
        </form>
      `;
    }
    const [named] = this.names || [];
    if (named) {
      return html`
        <div class="name-row">
          <span class="fas fa-fw fa-at"></span>
          <code class="name-chip">hyper://${named.name}/</code>
          <button @click=${() => this.onStartName(named.name)}>Rename</button>
          <button @click=${() => this.onRemoveName(named.name)}>Remove</button>
        </div>
      `;
    }
    return html`
      <div class="name-row">
        <button @click=${() => this.onStartName('')}>
          <span class="fas fa-fw fa-at"></span> Give it a name
        </button>
        <span class="name-hint">Then type the name in the URL bar, or ask the AI to use it.</span>
      </div>
    `;
  }

  onStartName(previous) {
    this.naming = { value: previous || normalizeName(this.info?.title || ''), previous, error: '' };
    this.updateComplete.then(() => this.shadowRoot.querySelector('.name-input')?.focus());
  }

  onCancelName(e) {
    e?.preventDefault();
    this.naming = null;
  }

  async onSaveName(e) {
    e.preventDefault();
    const name = normalizeName(this.naming.value);
    try {
      await nomad.vault.setName({
        name,
        url: nameTarget(this.url),
        title: this.info?.title || this.hostname,
        previous: this.naming.previous || undefined,
      });
      this.naming = null;
      this.names = await nomad.vault.namesForUrl(this.url);
      toast.create(`Named hyper://${name}/`, 'success');
    } catch (err) {
      this.naming = { ...this.naming, error: err.message || String(err) };
    }
  }

  async onRemoveName(name) {
    try {
      await nomad.vault.removeName(name);
      this.names = await nomad.vault.namesForUrl(this.url);
    } catch (err) {
      toast.create(err.message || String(err), 'error');
    }
  }

  renderNav() {
    return html`
      <div class="nav">
        <div class="tabs">
          <a
            class=${classMap({ active: this.view === 'identity' })}
            @click=${(e) => this.onSetView(e, 'identity')}
          >
            <span class="fas fa-fw fa-user"></span>
            Identity
          </a>
          <a
            class=${classMap({ active: this.view === 'permissions' })}
            @click=${(e) => this.onSetView(e, 'permissions')}
          >
            <span class="fas fa-fw fa-key"></span>
            Permissions
          </a>
          ${this.isDrive
            ? html`
                <a
                  class=${classMap({ active: this.view === 'forks' })}
                  @click=${(e) => this.onSetView(e, 'forks')}
                >
                  <span class="fas fa-fw fa-code-branch"></span>
                  Forks
                </a>
                ${
                  '' /* TODO <a class=${classMap({active: this.view === 'peers'})} @click=${e => this.onSetView(e, 'peers')}>
              <span class="fas fa-fw fa-share-alt"></span>
              ${this.info.peers} ${pluralize(this.info.peers, 'peer')}
            </a>*/
                }
              `
            : ''}
        </div>
      </div>
    `;
  }

  renderView() {
    return html`
      <div class="inner">
        ${this.view === 'identity'
          ? html`
              <identity-signals
                url=${this.url}
                .cert=${this.cert}
                @change-url=${this.onChangeUrl}
              ></identity-signals>
            `
          : ''}
        ${this.view === 'permissions'
          ? html`
              <site-perms
                origin=${this.origin}
                .requestedPerms=${this.requestedPerms}
              ></site-perms>
            `
          : ''}
        ${this.view === 'forks'
          ? html`
              <drive-forks
                url=${this.url}
                origin=${this.origin}
                .info=${this.info}
                .forks=${this.forks}
                @change-url=${this.onChangeUrl}
              ></drive-forks>
            `
          : ''}
        ${this.isHttp
          ? html`
              <div class="notice">
                <p class="warning">
                  <span class="fas fa-exclamation-triangle"></span> Your
                  connection to this site is not secure.
                </p>
                <p>
                  You should not enter any sensitive information on this site
                  (for example, passwords or credit cards) because it could be
                  stolen by attackers.
                </p>
              </div>
            `
          : ''}
      </div>
    `;
  }

  async updated() {
    setTimeout(() => {
      // adjust height based on rendering
      var height = this.shadowRoot.querySelector('div').clientHeight;
      if (!height) return;
      nomad.browser.resizeSiteInfo({ height });
    }, 50);
  }

  // events
  // =

  onSetView(e, view) {
    e.preventDefault();
    this.view = view;
  }

  onChangeUrl(e) {
    this.url = e.detail.url;
    nomad.browser.gotoUrl(this.url);
    this.load();
  }

  onCopyUrl(e) {
    writeToClipboard(this.url);
    toast.create('URL Copied', '', 2e3);
  }

  async onClickDriveProperties(e) {
    await nomad.shell.drivePropertiesDialog(this.url);
    this.load();
  }

  async onToggleSaveDrive(e) {
    if (this.driveCfg && this.driveCfg.saved) {
      await nomad.drives.remove(this.origin);
    } else {
      await nomad.drives.configure(this.origin);
    }
    this.load();
  }

  async onClickDriveTools(e) {
    e.preventDefault();
    e.stopPropagation();
    let rect = e.currentTarget.getClientRects()[0];
    return contextMenu.create({
      x: rect.right,
      y: rect.bottom,
      right: true,
      roomy: false,
      noBorders: true,
      fontAwesomeCSSUrl: 'nomad://assets/font-awesome.css',
      style: `padding: 4px 0`,
      items: [
        {
          icon: 'fas fa-fw fa-code-branch',
          label: 'Fork Drive',
          click: () => this.onForkDrive(),
        },
        this.info && this.info.writable
          ? {
              icon: 'far fa-fw fa-folder-open',
              label: 'Sync with local folder',
              click: async () => {
                await nomad.folderSync.syncDialog(this.info.url);
                await nomad.browser.refreshTabState();
              },
            }
          : undefined,
        {
          icon: 'far fa-fw fa-list-alt',
          label: 'Hyperdrive Properties',
          click: () => this.onDriveProps(),
        },
      ].filter(Boolean),
    });
  }

  async onForkDrive() {
    var drive = await nomad.fs.forkDrive(this.url, {
      detached: false,
    });
    nomad.browser.openUrl(drive.url, { setActive: true });
  }

  async onDriveProps() {
    await nomad.shell.drivePropertiesDialog(this.url);
    this.load();
  }
}

customElements.define('site-info-app', SiteInfoApp);
