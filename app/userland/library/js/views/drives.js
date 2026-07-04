import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { classMap } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/class-map.js';
import { pluralize } from 'nomad://app-stdlib/js/strings.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import drivesCSS from '../../css/views/drives.css.js';

const EXPLORER_URL = (drive) =>
  `nomad://explorer/${drive.url.slice('hyper://'.length)}`;

export class DrivesView extends LitElement {
  static get properties() {
    return {
      drives: { type: Array },
      readonly: { type: Boolean },
      filter: { type: String },
      viewMode: { type: String },
      showHeader: { type: Boolean, attribute: 'show-header' },
      hideEmpty: { type: Boolean, attribute: 'hide-empty' },
    };
  }

  static get styles() {
    return drivesCSS;
  }

  constructor() {
    super();
    this.drives = undefined;
    this.readonly = undefined;
    this.filter = undefined;
    this.viewMode = 'list';
    this.showHeader = false;
    this.hideEmpty = false;
    this.load();
  }

  async load() {
    var drives = await nomad.drives.list({ includeSystem: false });

    drives.forEach((drive) => {
      drive.isPear = drive.info?.type === 'pear-app';
    });

    drives = drives.filter((drive) => {
      // move forks onto their parents
      if (drive.forkOf) {
        let parent = drives.find((d) => d.key === drive.forkOf.key);
        if (parent) {
          parent.forks = parent.forks || [];
          parent.forks.push(drive);
          if (drive.info.writable) {
            parent.hasWritableFork = true;
          }
          return false;
        }
      }
      return true;
    });
    if (typeof this.readonly !== 'undefined') {
      drives = drives.filter((drive) => {
        if (this.readonly) {
          return !drive.info.writable;
        } else {
          return drive.info.writable || drive.hasWritableFork;
        }
      });
    }
    // Flag drives that have an unpublished Draft on this device (only writable drives can).
    await Promise.all(
      drives.map(async (drive) => {
        if (!drive.info?.writable) return;
        try {
          const ds = await nomad.fs.draftStatus(drive.url);
          drive.hasDraft = !!(ds && ds.changes && ds.changes.length);
        } catch {
          drive.hasDraft = false;
        }
      })
    );

    drives.sort((a, b) => a.info.title.localeCompare(b.info.title));
    this.drives = drives;
  }

  // A pen indicator shown on drives with unpublished Draft changes (matches the Draft Mode icon).
  renderDraftBadge(drive) {
    if (!drive.hasDraft) return '';
    return html`<span
      class="draft-indicator fas fa-pen-nib"
      title="Has unpublished draft changes"
    ></span>`;
  }

  async driveMenu(drive) {
    var items = [
      {
        label: 'Open in a New Tab',
        click: () => window.open(drive.url),
      },
      {
        label: 'Explore Files',
        click: () => window.open(EXPLORER_URL(drive)),
      },
      { type: 'separator' },
      {
        label: 'Copy Drive Link',
        click: () => {
          writeToClipboard(drive.url);
          toast.create('Copied to clipboard');
        },
      },
      { type: 'separator' },
      {
        label: 'Fork this Drive',
        click: () => this.forkDrive(drive),
      },
      {
        label: 'Diff / Merge',
        click: () => this.diffDrive(drive),
      },
      { type: 'separator' },
      {
        label: 'Drive Properties',
        click: () => this.driveProps(drive),
      },
      {
        label: drive.info.writable ? 'Remove from My Library' : 'Stop hosting',
        disabled: drive.ident.internal,
        click: () => this.removeDrive(drive),
      },
    ];
    var fns = {};
    for (let i = 0; i < items.length; i++) {
      if (items[i].id) continue;
      let id = `item=${i}`;
      items[i].id = id;
      fns[id] = items[i].click;
      delete items[i].click;
    }

    var choice = await nomad.browser.showContextMenu(items);
    if (fns[choice]) fns[choice]();
  }

  async forkDrive(drive) {
    var drive = await nomad.fs.forkDrive(drive.url);
    toast.create('Drive created');
    window.open(drive.url);
    this.load();
  }

  async diffDrive(drive) {
    window.open(`nomad://diff/?base=${drive.url}`);
  }

  async driveProps(drive) {
    await nomad.shell.drivePropertiesDialog(drive.url);
    this.load();
  }

  async removeDrive(drive) {
    await nomad.drives.remove(drive.url);
    const undo = async () => {
      await nomad.drives.configure(drive.url);
      this.drives.push(drive);
      this.requestUpdate();
    };
    toast.create('Drive removed', '', 10e3, { label: 'Undo', click: undo });
    this.load();
  }

  // rendering
  // =

  render() {
    var drives = this.drives;
    if (drives && this.filter) {
      drives = drives.filter((drive) =>
        drive.info.title.toLowerCase().includes(this.filter)
      );
    }
    const isSimple = this.hasAttribute('simple');
    const isCard = !isSimple && this.viewMode === 'card';
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      ${drives
        ? html`
            ${!isSimple && !isCard
              ? html`
                  <div class="drives-header">
                    <span class="col col-icon"></span>
                    <span class="col col-title">Name</span>
                    <span class="col col-owner">Owner</span>
                    <span class="col col-updated">Updated</span>
                    <span class="col col-peers">Peers</span>
                  </div>
                `
              : ''}
            <div class="${isCard ? 'drives card-view' : 'drives'}">
              ${repeat(drives, (drive) => this.renderDrive(drive, isSimple, isCard))}
              ${drives.length === 0
                ? this.filter
                  ? html`
                      <div class="empty">
                        <span class="fas fa-search"></span>
                        <div>No matches for "${this.filter}"</div>
                      </div>
                    `
                  : html`
                      <div class="empty">
                        <span class="fas fa-sitemap"></span>
                        <div>You have not created any Hyperdrives.</div>
                      </div>
                    `
                : ''}
            </div>
          `
        : html` <div class="loading"><span class="spinner"></span></div> `}
    `;
  }

  renderDrive(drive, isSimple = false, isCard = false) {
    var numForks = drive.forks?.length || 0;
    var driveHref = drive.url;
    if (isCard) {
      return html`
        <a href=${driveHref} class="drive" title=${drive.info.title || 'Untitled'}
           @contextmenu=${(e) => this.onContextmenuDrive(e, drive)}>
          <img class="favicon" src="asset:favicon:${drive.url}" />
          <div class="title">
            <span class="drive-name">${drive.info.title || html`<em>Untitled</em>`}</span>
            ${this.renderDraftBadge(drive)}
            ${drive.tags.map((tag) => html`<span class="tag">${tag}</span>`)}
          </div>
          <div class="card-meta">
            ${typeof drive.info.peers !== 'undefined' ? html`<span>${drive.info.peers}p</span>` : ''}
            ${drive.info.mtime ? html`<span>${new Date(drive.info.mtime).toLocaleDateString()}</span>` : ''}
          </div>
          <div class="ctrls">
            <button @click=${(e) => this.onClickDriveMenuBtn(e, drive)}>
              <span class="fas fa-fw fa-ellipsis-h"></span>
            </button>
          </div>
        </a>
      `;
    }
    if (isSimple) {
      return html`
        <a
          href=${driveHref}
          title=${drive.info.title || 'Untitled'}
          class="drive"
          @contextmenu=${(e) => this.onContextmenuDrive(e, drive)}
        >
          <img class="favicon" src="asset:favicon:${drive.url}" />
          <div class="title">
            <span class="drive-name">${drive.info.title || html`<em>Untitled</em>`}</span>
            ${this.renderDraftBadge(drive)}
          </div>
        </a>
      `;
    }
    return html`
      <a
        href=${driveHref}
        title=${drive.info.title || 'Untitled'}
        class="drive"
        @contextmenu=${(e) => this.onContextmenuDrive(e, drive)}
      >
        <img class="favicon" src="asset:favicon:${drive.url}" />
        <div class="title">
          <span class="drive-name">${drive.info.title || html`<em>Untitled</em>`}</span>
          ${this.renderDraftBadge(drive)}
          ${drive.forkOf?.label ? html`<span class="fork-label">${drive.forkOf.label}</span>` : ''}
          ${drive.tags.map((tag) => html`<span class="tag">${tag}</span>`)}
        </div>
        <div class="owner ${drive.info.writable ? 'mine' : ''}">${drive.info.writable ? 'Mine' : ''}</div>
        <div class="updated">${drive.info.mtime ? new Date(drive.info.mtime).toLocaleDateString() : '—'}</div>
        <div class="peers">
          ${drive.ident.system
            ? html`<span class="fas fa-lock"></span>`
            : typeof drive.info.peers === 'undefined'
            ? '—'
            : html`${drive.info.peers} ${pluralize(drive.info.peers, 'peer')}`}
        </div>
        <div class="ctrls">
          <button @click=${(e) => this.onClickDriveMenuBtn(e, drive)}>
            <span class="fas fa-fw fa-ellipsis-h"></span>
          </button>
        </div>
      </a>
      ${drive.showForks && numForks > 0
        ? html`
            <div class="forks-container">
              ${repeat(drive.forks, (fork) => this.renderDrive(fork))}
            </div>
          `
        : ''}
    `;
  }

  // events
  // =

  async onContextmenuDrive(e, drive) {
    e.preventDefault();
    e.stopPropagation();
    await this.driveMenu(drive);
  }

  onClickDriveMenuBtn(e, drive) {
    e.preventDefault();
    e.stopPropagation();
    this.driveMenu(drive);
  }

  onClickViewForksOf(e, drive) {
    e.preventDefault();
    drive.showForks = !drive.showForks;
    this.requestUpdate();
  }
}

customElements.define('drives-view', DrivesView);
