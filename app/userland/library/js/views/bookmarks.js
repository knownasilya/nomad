import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import { emit } from 'nomad://app-stdlib/js/dom.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { EditBookmarkPopup } from 'nomad://app-stdlib/js/com/popups/edit-bookmark.js';
import bookmarksCSS from '../../css/views/bookmarks.css.js';

export class BookmarksView extends LitElement {
  static get properties() {
    return {
      bookmarks: { type: Array },
      filter: { type: String },
      viewMode: { type: String },
      showHeader: { type: Boolean, attribute: 'show-header' },
      hideEmpty: { type: Boolean, attribute: 'hide-empty' },
    };
  }

  static get styles() {
    return bookmarksCSS;
  }

  constructor() {
    super();
    this.bookmarks = undefined;
    this.filter = undefined;
    this.viewMode = 'list';
    this.showHeader = false;
    this.hideEmpty = false;
    this.load();
  }

  async load() {
    var bookmarks = await nomad.bookmarks.list();
    bookmarks.sort((a, b) => a.title.localeCompare(b.title));
    this.bookmarks = bookmarks;
  }

  async bookmarkMenu(bookmark) {
    var items = [
      {
        label: 'Open Link in New Tab',
        click: () => window.open(bookmark.href),
      },
      {
        label: 'Copy Link Address',
        click: () => writeToClipboard(bookmark.href),
      },
      { type: 'separator' },
      { label: 'Edit', click: () => this.onClickEdit(bookmark) },
      {
        type: 'checkbox',
        checked: bookmark.pinned,
        label: 'Pin to start page',
        click: () => this.onToggleBookmarkPinned(null, bookmark),
      },
      { type: 'separator' },
      { label: 'Delete', click: () => this.onClickRemove(bookmark) },
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

  // rendering
  // =

  render() {
    var bookmarks = this.bookmarks;
    if (bookmarks && this.filter) {
      bookmarks = bookmarks.filter(
        (bookmark) =>
          bookmark.href.toLowerCase().includes(this.filter) ||
          bookmark.title.toLowerCase().includes(this.filter)
      );
    }
    const isCard = this.viewMode === 'card';
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      ${bookmarks
        ? html`
            ${!isCard
              ? html`
                  <div class="bookmarks-header">
                    <span class="col col-icon"></span>
                    <span class="col col-title">Name</span>
                    <span class="col col-url">URL</span>
                  </div>
                `
              : ''}
            <div class="${isCard ? 'bookmarks card-view' : 'bookmarks'}">
              ${repeat(bookmarks, (bookmark) => this.renderBookmark(bookmark, isCard))}
              ${bookmarks.length === 0
                ? this.filter
                  ? html`
                      <div class="empty">
                        <span class="fas fa-search"></span>
                        <div>No matches for "${this.filter}"</div>
                      </div>
                    `
                  : html`
                      <div class="empty">
                        <span class="far fa-star"></span>
                        <div>No bookmarks yet.</div>
                      </div>
                    `
                : ''}
            </div>
          `
        : html` <div class="loading"><span class="spinner"></span></div> `}
    `;
  }

  renderBookmark(bookmark, isCard = false) {
    var { href, title } = bookmark;
    let domain = '';
    try { domain = new URL(href).hostname; } catch (e) {}
    return html`
      <a
        class="bookmark"
        href=${href}
        title=${title || ''}
        @contextmenu=${(e) => this.onContextmenuBookmark(e, bookmark)}
      >
        <img class="favicon" src="asset:favicon:${href}" />
        <div class="title">${title || html`<em>Untitled</em>`}</div>
        <div class="href">${isCard ? domain : href}</div>
        <div class="ctrls">
          <button @click=${(e) => this.onClickBookmarkMenuBtn(e, bookmark)}>
            <span class="fas fa-fw fa-ellipsis-h"></span>
          </button>
        </div>
      </a>
    `;
  }

  // events
  // =

  async onContextmenuBookmark(e, bookmark) {
    e.preventDefault();
    e.stopPropagation();
    await this.bookmarkMenu(bookmark);
  }

  onClickBookmarkMenuBtn(e, bookmark) {
    e.preventDefault();
    e.stopPropagation();
    this.bookmarkMenu(bookmark);
  }

  async onToggleBookmarkPinned(e, bookmark) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (bookmark.pinned) {
      await nomad.bookmarks.add(
        Object.assign({}, bookmark, { pinned: false })
      );
    } else {
      await nomad.bookmarks.add(Object.assign({}, bookmark, { pinned: true }));
    }
    this.load();
    emit(this, 'update-pins');
  }

  async onClickEdit(bookmark) {
    try {
      await EditBookmarkPopup.create(bookmark);
      this.load();
    } catch (e) {
      // ignore
    }
  }

  async onClickRemove(bookmark) {
    if (!confirm('Are you sure?')) return;
    await nomad.bookmarks.remove(bookmark.href);
    toast.create('Bookmark removed', '', 10e3);
    this.load();
  }
}

customElements.define('bookmarks-view', BookmarksView);
