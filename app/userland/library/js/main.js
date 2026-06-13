import {
  LitElement,
  html,
} from 'beaker://app-stdlib/vendor/lit-element/lit-element.js';
import * as toast from 'beaker://app-stdlib/js/com/toast.js';
import { findParent } from 'beaker://app-stdlib/js/dom.js';
import { EditBookmarkPopup } from 'beaker://app-stdlib/js/com/popups/edit-bookmark.js';
import mainCSS from '../css/main.css.js';
import './views/drives.js';
import './views/bookmarks.js';
import './views/history.js';
import './views/downloads.js';

export class LibraryApp extends LitElement {
  static get properties() {
    return {
      view: { type: String },
      filter: { type: String },
      viewMode: { type: String },
    };
  }

  static get styles() {
    return mainCSS;
  }

  constructor() {
    super();
    beaker.panes.setAttachable();
    beaker.panes.attachToLastActivePane();

    this.view = '';
    this.viewMode = localStorage.getItem('lib-view-mode') || 'list';
    const getView = () => {
      var view = location.pathname.slice(1);
      return view === '' ? 'drives' : view;
    };
    this.setView(getView());
    window.addEventListener('popstate', (event) => {
      this.setView(getView());
    });

    this.addEventListener('click', (e) => {
      // route navigations to the attached pane if present
      var attachedPane = beaker.panes.getAttachedPane();
      if (!attachedPane) return;
      let anchor = findParent(e.path[0], (el) => el.tagName === 'A');
      if (anchor) {
        if (!e.metaKey && anchor.getAttribute('target') !== '_blank') {
          e.stopPropagation();
          e.preventDefault();
          beaker.panes.navigate(attachedPane.id, anchor.getAttribute('href'));
        }
      }
    });
  }

  setViewMode(mode) {
    this.viewMode = mode;
    localStorage.setItem('lib-view-mode', mode);
  }

  async setView(view) {
    if (this.view === view) return;
    this.view = view;

    var pathname = `/${view}`;
    if (location.pathname !== pathname) {
      window.history.pushState({}, '', pathname);
    }

    await this.requestUpdate();
    this.shadowRoot.querySelector('[loadable]').load();
  }

  // rendering
  // =

  render() {
    const pageNav = (view, label) => html`
      <a
        class="${this.view === view ? 'current' : ''}"
        @click=${(e) => this.setView(view)}
      >
        ${label}
      </a>
    `;
    return html`
      <link rel="stylesheet" href="beaker://app-stdlib/css/fontawesome.css" />
      <header>
        <div class="brand">
          <img src="asset:favicon:beaker://library/" />
          My Library
        </div>
        <div class="search-ctrl">
          <span class="fas fa-search"></span>
          <input
            placeholder="Search ${this.view.replace('-', ' ')}"
            @keyup=${(e) => {
              this.filter = e.currentTarget.value.toLowerCase();
            }}
          />
        </div>
        <div class="header-actions">
          ${this.renderViewToggle()}
          ${this.renderNewBtn()}
        </div>
      </header>
      <div class="layout">
        <nav>
          <div class="page-nav">
            ${pageNav(
              'drives',
              html`<span class="fas fa-fw fa-sitemap"></span>
                <span class="label">Hyperdrives</span>`
            )}
            ${pageNav(
              'bookmarks',
              html`<span class="far fa-fw fa-star"></span>
                <span class="label">Bookmarks</span>`
            )}
            ${pageNav(
              'history',
              html`<span class="fas fa-fw fa-history"></span>
                <span class="label">History</span>`
            )}
            ${pageNav(
              'downloads',
              html`<span class="fas fa-fw fa-arrow-down"></span>
                <span class="label">Downloads</span>`
            )}
          </div>
        </nav>
        <main>
          ${this.view === 'drives'
            ? html`
                <drives-view
                  class="full-size"
                  .filter=${this.filter}
                  .viewMode=${this.viewMode}
                  loadable
                ></drives-view>
              `
            : ''}
          ${this.view === 'bookmarks'
            ? html`
                <bookmarks-view
                  class="full-size"
                  .filter=${this.filter}
                  .viewMode=${this.viewMode}
                  loadable
                ></bookmarks-view>
              `
            : ''}
          ${this.view === 'history'
            ? html`
                <history-view
                  class="full-size"
                  .filter=${this.filter}
                  loadable
                ></history-view>
              `
            : ''}
          ${this.view === 'downloads'
            ? html`
                <downloads-view
                  class="full-size"
                  .filter=${this.filter}
                  loadable
                ></downloads-view>
              `
            : ''}
        </main>
      </div>
    `;
  }

  renderViewToggle() {
    if (this.view !== 'drives' && this.view !== 'bookmarks') return '';
    return html`
      <span class="view-toggle">
        <button
          class="${this.viewMode === 'list' ? 'active' : ''}"
          title="List view"
          @click=${() => this.setViewMode('list')}
        ><span class="fas fa-list"></span></button>
        <button
          class="${this.viewMode === 'card' ? 'active' : ''}"
          title="Card view"
          @click=${() => this.setViewMode('card')}
        ><span class="fas fa-th"></span></button>
      </span>
    `;
  }

  renderNewBtn() {
    if (this.view === 'drives') {
      return html`<button class="new-action-btn" @click=${this.onCreateDrive}>New Hyperdrive</button>`;
    }
    if (this.view === 'bookmarks') {
      return html`<button class="new-action-btn" @click=${this.onCreateBookmark}>New Bookmark</button>`;
    }
  }

  // events
  // =

  async onCreateDrive() {
    var drive = await beaker.hyperdrive.createDrive();
    toast.create('Drive created');
    beaker.browser.openUrl(drive.url, {
      setActive: true,
      addedPaneUrls: ['beaker://editor/'],
    });
    if (this.view === 'drives') {
      this.shadowRoot.querySelector('drives-view').load();
    }
  }

  async onCreateBookmark() {
    await EditBookmarkPopup.create();
    toast.create('Bookmark added');
    if (this.view === 'bookmarks') {
      this.shadowRoot.querySelector('bookmarks-view').load();
    }
  }
}

customElements.define('app-main', LibraryApp);
