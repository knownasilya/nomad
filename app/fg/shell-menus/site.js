import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import { writeToClipboard } from '../lib/event-handlers';
import { isHyperOrPearUrl } from '../../lib/urls';
import { articleUrl } from '../../../shared/reader-articles.mjs';

class SiteMenu extends LitElement {
  static get properties() {
    return {};
  }

  constructor() {
    super();
  }

  reset() {
    this.submenu = '';
    this.url = undefined;
    this.mods = null;
    this.driveInfo = undefined;
  }

  async init(params) {
    this.url = params.url;
    this.mods = params.mods || null;
    this.requestUpdate();

    if (isHyperOrPearUrl(this.url)) {
      try {
        this.driveInfo = await bg.fs.getInfo(this.url);
      } catch (e) {
        console.debug(e);
      }
      this.requestUpdate();
    }
  }

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        ${articleUrl(this.url)
          ? html`
              <div class="section">
                <div
                  class="menu-item"
                  @click=${this.onSaveToReader}
                  title="Keep this page in Reader. The AI sorts it into topics."
                >
                  <i class="fas fa-bookmark"></i>
                  <span class="label">Save to Reader</span>
                </div>
              </div>
            `
          : ''}
        ${this.mods ? this.renderModsItem() : ''}
        ${this.driveInfo
          ? html`
              <div class="section">
                <div class="menu-item" @click=${this.onCopyDriveKey}>
                  <i class="fas fa-fingerprint"></i>
                  <span class="label">Copy Drive Key</span>
                </div>
              </div>
            `
          : ''}
        ${this.driveInfo
          ? html`
              <div class="section">
                <div class="menu-item" @click=${this.onToggleLiveReload}>
                  <i class="fas fa-bolt"></i>
                  <span class="label">Toggle Live Reloading</span>
                </div>
                ${this.driveInfo.writable
                  ? html`
                      <div class="section">
                        <div class="menu-item" @click=${this.onSync}>
                          <i class="far fa-folder-open"></i>
                          <span class="label">Sync with Local Folder</span>
                        </div>
                      </div>
                    `
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }

  // Mods (ADR-0023): opens the Mods menu in this menu's place.
  renderModsItem() {
    const { count, on } = this.mods;
    return html`
      <div class="section">
        <div
          class="menu-item"
          @click=${this.onOpenMods}
          title="Hide parts of this site, restyle it, or run your own script"
        >
          <i class="fas fa-magic ${on > 0 ? 'active' : ''}"></i>
          <span class="label">Mods</span>
          ${count ? html`<span class="detail">${on} of ${count} on</span>` : ''}
          <i class="fas fa-angle-right more"></i>
        </div>
      </div>
    `;
  }

  // events
  // =

  updated() {
    // adjust dimensions based on rendering
    var width = this.shadowRoot.querySelector('div').clientWidth | 0;
    var height = this.shadowRoot.querySelector('div').clientHeight | 0;
    bg.shellMenus.resizeSelf({ width, height });
  }

  onOpenPage(e, url) {
    bg.shellMenus.createTab(url);
    bg.shellMenus.close();
  }

  // Reader's saved articles (ADR-0033): bg reads the tab and shows a toast.
  onSaveToReader() {
    bg.shellMenus.close();
    bg.views.saveToReader('active');
  }

  onOpenMods() {
    bg.shellMenus.switchMenu('mods', { url: this.url });
  }

  onCopyDriveKey() {
    writeToClipboard(this.driveInfo.key);
    bg.shellMenus.close();
  }

  onToggleLiveReload() {
    bg.views.toggleLiveReloading('active');
    bg.shellMenus.close();
  }

  async onSync() {
    await bg.folderSync.syncDialog(this.driveInfo.url);
    await bg.beakerBrowser.refreshTabState();
  }
}
SiteMenu.styles = [
  commonCSS,
  css`
    .wrapper {
      width: 230px;
    }

    .wrapper::-webkit-scrollbar {
      display: none;
    }

    .section:last-child {
      border-bottom: 0;
    }

    .menu-item {
      height: 40px;
    }

    .menu-item i.active {
      color: #2864dc;
    }

    .menu-item .detail {
      margin-left: auto;
      padding-left: 8px;
      font-size: 12px;
      color: var(--text-color--menu-item-icon--light);
    }

    .menu-item .detail + i.more {
      margin-left: 0;
      width: 20px;
    }
  `,
];

customElements.define('site-menu', SiteMenu);
