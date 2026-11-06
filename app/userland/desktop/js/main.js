import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { EditBookmarkPopup } from 'nomad://app-stdlib/js/com/popups/edit-bookmark.js';
import { AddLinkPopup } from './com/add-link-popup.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import * as desktop from './lib/desktop.js';
import * as addressBook from './lib/address-book.js';
import { releaseNotesUrl, shouldShowNotice, versionId } from './lib/release.js';
import css from '../css/main.css.js';
import 'nomad://app-stdlib/js/com/img-fallbacks.js';

class DesktopApp extends LitElement {
  static get properties() {
    return {
      profile: { type: Object },
      pins: { type: Array },
      version: { type: String },
    };
  }

  static get styles() {
    return css;
  }

  constructor() {
    super();
    this.profile = undefined;
    this.pins = [];
    this.version = undefined;
    this.showReleaseNotice = false;

    this.load();
    this.loadVersion();

    window.addEventListener('focus', (e) => {
      this.load();
    });
    this.addEventListener('update-pins', async (e) => {
      this.pins = await desktop.load();
    });
  }

  async load({ clearCurrent } = { clearCurrent: false }) {
    [this.profile, this.pins] = await Promise.all([
      addressBook.loadProfile(),
      desktop.load(),
    ]);
  }

  // The notice names the version this app runs, and shows once per new version.
  async loadVersion() {
    let version;
    try {
      version = (await nomad.browser.getInfo()).version;
    } catch (e) {
      return;
    }
    let stored;
    try {
      stored = localStorage.lastDismissedReleaseNotice;
      localStorage.lastDismissedReleaseNotice = versionId(version);
    } catch (e) {}
    this.showReleaseNotice = shouldShowNotice(version, stored);
    this.version = version;
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div id="topright">
        <a href="#" @click=${this.onClickNewHyperdrive}>+ New Hyperdrive</a>
        <a href="nomad://library/" title="Library">My Library</a>
        <a href="https://nomad.pages.dev/docs/api/" title="Help">Help</a>
      </div>

      <main>
        <div class="onecol">
          ${this.renderReleaseNotice()} ${this.renderPins()}
        </div>
      </main>
    `;
  }

  renderReleaseNotice() {
    if (!this.version || !this.showReleaseNotice) {
      return '';
    }
    return html`
      <div class="release-notice">
        <a href=${releaseNotesUrl(this.version)} class="view-release-notes" target="_blank">
          <span class="fas fa-fw fa-rocket"></span>
          <strong>Welcome to Nomad ${this.version}!</strong>
          Click here to see what's new.
        </a>
      </div>
    `;
  }

  renderPins() {
    var pins = this.pins || [];
    return html`
      <div class="pins">
        ${repeat(
          pins,
          (pin) => pin.href,
          (pin) => html`
            <a
              class="pin"
              href=${pin.href}
              @contextmenu=${(e) => this.onContextmenuPin(e, pin)}
            >
              <div class="thumb-wrapper">
                <img src=${'asset:screenshot-180:' + pin.href} class="thumb" />
              </div>
              <div class="details">
                <div class="title">${pin.title}</div>
              </div>
            </a>
          `
        )}
        <a class="pin add" title="Add a pin" @click=${(e) => this.onClickNewBookmark(e, true)}>
          <span class="fas fa-fw fa-plus thumb"></span>
        </a>
      </div>
    `;
  }

  // events
  // =

  async onClickNewHyperdrive(e) {
    var drive = await nomad.fs.createDrive();
    toast.create('Drive created');
    nomad.browser.openUrl(drive.url, {
      setActive: true,
      addedPaneUrls: ['nomad://editor/'],
    });
  }

  async onClickNewBookmark(e, pinned) {
    try {
      await desktop.createLink(await AddLinkPopup.create(), pinned);
      toast.create('Link added', '', 10e3);
    } catch (e) {
      // ignore, user probably cancelled
      console.log(e);
      return;
    }
    this.isEmpty = false;
    this.load({ clearCurrent: true });
  }

  async onContextmenuPin(e, pin) {
    e.preventDefault();
    const items = [
      { label: 'Open Link in New Tab', click: () => window.open(pin.href) },
      { label: 'Copy Link Address', click: () => writeToClipboard(pin.href) },
      pin.isFixed ? undefined : { type: 'separator' },
      pin.isFixed
        ? undefined
        : { label: 'Edit', click: () => this.onClickEditBookmark(pin) },
      pin.isFixed
        ? undefined
        : { label: 'Unpin', click: () => this.onClickUnpinBookmark(pin) },
    ].filter(Boolean);
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

  async onClickEditBookmark(file) {
    try {
      await EditBookmarkPopup.create(file);
      this.load();
    } catch (e) {
      // ignore
      console.log(e);
    }
  }

  async onClickUnpinBookmark(bookmark) {
    await nomad.bookmarks.add(Object.assign({}, bookmark, { pinned: false }));
    toast.create('Bookmark unpinned', '', 10e3);
    this.load();
  }

}

customElements.define('desktop-app', DesktopApp);
