// nomad://desktop — the new tab page and the toolbar's Home button: a dashboard of the user's things.
//
// - A greeting, then the pinned pages (bookmarks marked pinned).
// - Notifications: Job results, Jobs that failed, other members' notices in a shared Space, unread
//   Messages.
// - Jobs: the ones running here now (Watch, Stop), and the ones that run next (Run now).
// - Coming up: the calendar from now on.
// - The newest Notes and files (Assets).
//
// Everything but the pins comes from one call, nomad.vault.homeDashboard() (bg/web-apis/bg/vault.ts),
// whose rules are shared/home-dashboard.mjs, the same ones the phone's home tab uses. The page loads
// it again when the Vault, a Job or the Inbox changes, and keeps its "5 min ago"s fresh.

import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { EditBookmarkPopup } from 'nomad://app-stdlib/js/com/popups/edit-bookmark.js';
import { AddLinkPopup } from './com/add-link-popup.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import { formatTime } from 'nomad://app-stdlib/js/time-of-day.js';
import * as desktop from './lib/desktop.js';
import { releaseNotesUrl, shouldShowNotice, versionId } from './lib/release.js';
import { ago, until, wallNow, longDate } from './lib/when.js';
import css from '../css/main.css.js';
import 'nomad://app-stdlib/js/com/img-fallbacks.js';

const NOTIFY_ICONS = {
  job: 'fas fa-robot',
  failed: 'fas fa-exclamation-triangle',
  space: 'fas fa-users',
  message: 'fas fa-comment',
};

class DesktopApp extends LitElement {
  static get properties() {
    return {
      pins: { type: Array },
      version: { type: String },
      dash: { type: Object },
      thumbs: { type: Object },
      tick: { type: Number },
    };
  }

  static get styles() {
    return css;
  }

  constructor() {
    super();
    this.pins = [];
    this.version = undefined;
    this.showReleaseNotice = false;
    this.dash = null; // nomad.vault.homeDashboard()
    this.thumbs = {}; // asset id -> data: URL
    this.tick = 0;
    this.reloadTimer = null;

    this.load();
    this.loadVersion();
    this.watch();

    window.addEventListener('focus', () => this.load());
    this.addEventListener('update-pins', async () => {
      this.pins = await desktop.load();
    });
    // Keep "in 5 min" and "2 h ago" true, and the calendar's "now".
    setInterval(() => {
      this.tick++;
      if (this.tick % 5 === 0) this.loadDashboard();
    }, 60e3);
  }

  async load() {
    this.pins = await desktop.load();
    this.loadDashboard();
  }

  async loadDashboard() {
    try {
      this.dash = await nomad.vault.homeDashboard({ now: wallNow() });
    } catch (e) {
      console.log('Failed to load the dashboard', e);
      if (!this.dash) this.dash = { failed: true };
      return;
    }
    this.loadThumbs();
  }

  // Thumbnails for the files shown, once each.
  async loadThumbs() {
    for (const a of this.dash?.assets || []) {
      if (!a.thumb || a.id in this.thumbs) continue;
      this.thumbs = { ...this.thumbs, [a.id]: null };
      nomad.vault
        .assetData(a.id, { thumb: true })
        .then((url) => {
          if (url) this.thumbs = { ...this.thumbs, [a.id]: url };
        })
        .catch(() => {});
    }
  }

  // Load again, once, after a burst of changes.
  queueReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.loadDashboard(), 400);
  }

  watch() {
    const on = (fn) => {
      try {
        fn().addEventListener('changed', () => this.queueReload());
      } catch (e) {}
    };
    on(() => nomad.vault.watchAppData());
    on(() => nomad.vault.watchJobs());
    on(() => nomad.inbox.watch());
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
    const d = this.dash;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div id="topright">
        <a href="#" @click=${this.onClickNewHyperdrive}>+ New Hyperdrive</a>
        <a href="nomad://library/" title="Library">My Library</a>
        <a href="https://nomad.pages.dev/docs/api/" title="Help">Help</a>
      </div>

      <main>
        <header class="hello">
          <h1>${d?.greeting || 'Hello'}</h1>
          <div class="sub">
            ${longDate()}${d?.spaceName ? html` · <span class="space">${d.spaceName}</span>` : ''}
          </div>
        </header>
        ${this.renderReleaseNotice()} ${this.renderPins()}
        ${d && !d.failed
          ? html`
              <div class="board">
                ${this.renderNotifications(d)} ${this.renderJobs(d)} ${this.renderEvents(d)}
                ${this.renderNotes(d)} ${this.renderFiles(d)}
              </div>
            `
          : d?.failed
            ? html`<div class="board-failed">The dashboard didn’t load. Try reloading the page.</div>`
            : html`<div class="board-loading"><span class="spinner"></span></div>`}
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
              title=${pin.title}
              @contextmenu=${(e) => this.onContextmenuPin(e, pin)}
            >
              <div class="thumb-wrapper">
                <img src=${'asset:screenshot-180:' + pin.href} class="thumb" alt="" />
              </div>
              <div class="details">
                <div class="title">${pin.title}</div>
              </div>
            </a>
          `
        )}
        <a
          class="pin add"
          href="#"
          title="Add a pin"
          aria-label="Add a pin"
          @click=${(e) => this.onClickNewBookmark(e, true)}
        >
          <span class="fas fa-fw fa-plus thumb"></span>
        </a>
      </div>
    `;
  }

  // One card: an icon and title, a link to the whole list, and its rows.
  card({ id, icon, title, count, href, linkLabel, wide = false }, body) {
    return html`
      <section class="card ${wide ? 'wide' : ''}" id=${id} aria-labelledby=${id + '-title'}>
        <header>
          <span class=${'icon ' + icon} aria-hidden="true"></span>
          <h2 id=${id + '-title'}>${title}</h2>
          ${count ? html`<span class="count">${count}</span>` : ''}
          <span class="spacer"></span>
          ${href ? html`<a class="see-all" href=${href}>${linkLabel || 'See all'}</a>` : ''}
        </header>
        ${body}
      </section>
    `;
  }

  renderNotifications(d) {
    const list = d.notifications || [];
    return this.card(
      {
        id: 'notifications',
        icon: 'fas fa-bell',
        title: 'Notifications',
        count: d.unreadMessages ? `${d.unreadMessages} unread` : '',
        href: d.unreadMessages ? 'nomad://messages/' : '',
        linkLabel: 'Messages',
      },
      list.length
        ? html`<ul class="rows">
            ${list.map((n) => {
              const inner = html`
                <span class="lead ${n.kind}"><span class=${NOTIFY_ICONS[n.kind] || 'fas fa-bell'}></span></span>
                <span class="main">
                  <span class="title">${n.title}</span>
                  ${n.body || n.from
                    ? html`<span class="snippet">${n.from ? `${n.from}: ` : ''}${n.body}</span>`
                    : ''}
                </span>
                <span class="meta" title=${new Date(n.at).toLocaleString()}>${ago(n.at)}</span>
              `;
              return html`<li>
                ${n.url
                  ? html`<a class="row" href=${n.url}>${inner}</a>`
                  : html`<div class="row">${inner}</div>`}
              </li>`;
            })}
          </ul>`
        : html`<p class="empty">You’re all caught up. Job results and new messages show up here.</p>`
    );
  }

  renderJobs(d) {
    const { running = [], next = [], total = 0, paused = 0 } = d.jobs || {};
    const body =
      !running.length && !next.length
        ? html`<p class="empty">
            ${total
              ? `No Job is scheduled to run${paused ? ` (${paused} paused)` : ''}.`
              : 'Your AI can run Jobs for you on a schedule.'}
            <a href="nomad://library/jobs">${total ? 'Open Jobs' : 'Make a Job'}</a>
          </p>`
        : html`
            ${running.length
              ? html`<div class="sublabel">Running now</div>
                  <ul class="rows">
                    ${running.map(
                      (j) => html`<li>
                        <div class="row">
                          <span class="lead running">
                            ${j.queued
                              ? html`<span class="fas fa-hourglass-half"></span>`
                              : html`<span class="spinner small"></span>`}
                          </span>
                          <a class="main" href=${j.url}>
                            <span class="title">${j.title}</span>
                            <span class="snippet">${j.queued ? 'Waiting to run' : 'Running on this computer'}</span>
                          </a>
                          ${j.queued
                            ? ''
                            : html`<button
                                class="icon-btn"
                                title="Watch in the AI Sidebar"
                                aria-label="Watch ${j.title} in the AI Sidebar"
                                @click=${() => this.onWatchJob(j)}
                              >
                                <span class="fas fa-eye"></span>
                              </button>`}
                          <button
                            class="icon-btn danger"
                            title="Stop"
                            aria-label="Stop ${j.title}"
                            @click=${() => this.onStopJob(j)}
                          >
                            <span class="fas fa-stop"></span>
                          </button>
                        </div>
                      </li>`
                    )}
                  </ul>`
              : ''}
            ${next.length
              ? html`<div class="sublabel">Up next</div>
                  <ul class="rows">
                    ${next.map(
                      (j) => html`<li>
                        <div class="row">
                          <span class="lead"><span class="far fa-clock"></span></span>
                          <a class="main" href=${j.url}>
                            <span class="title">${j.title}</span>
                            <span class="snippet">${[j.when, j.deviceName && `on ${j.deviceName}`]
                              .filter(Boolean)
                              .join(' · ')}</span>
                          </a>
                          <span class="meta" title=${new Date(j.at).toLocaleString()}>${until(j.at)}</span>
                          <button
                            class="icon-btn"
                            title="Run now"
                            aria-label="Run ${j.title} now"
                            @click=${() => this.onRunJob(j)}
                          >
                            <span class="fas fa-play"></span>
                          </button>
                        </div>
                      </li>`
                    )}
                  </ul>`
              : ''}
          `;
    return this.card(
      { id: 'jobs', icon: 'fas fa-robot', title: 'Jobs', href: 'nomad://library/jobs', linkLabel: 'All Jobs' },
      body
    );
  }

  renderEvents(d) {
    const list = d.events || [];
    let lastDay = null;
    return this.card(
      { id: 'events', icon: 'far fa-calendar-alt', title: 'Coming up', href: 'nomad://calendar/', linkLabel: 'Calendar' },
      list.length
        ? html`<ul class="rows events">
            ${list.map((e) => {
              const head = e.day !== lastDay ? e.dayLabel : null;
              lastDay = e.day;
              return html`
                ${head ? html`<li class="day">${head}</li>` : ''}
                <li>
                  <a class="row" href=${e.url}>
                    <span class="time ${e.ongoing ? 'now' : ''}">
                      ${e.allDay ? 'All day' : formatTime(e.start.slice(11, 16))}
                    </span>
                    <span class="bar" style=${e.color ? `background:${e.color}` : ''}></span>
                    <span class="main">
                      <span class="title">${e.title}</span>
                      ${e.location || e.feed || e.ongoing
                        ? html`<span class="snippet">
                            ${[e.ongoing && !e.allDay ? 'Now' : '', e.location, e.feed].filter(Boolean).join(' · ')}
                          </span>`
                        : ''}
                    </span>
                  </a>
                </li>
              `;
            })}
          </ul>`
        : html`<p class="empty">Nothing on the calendar for the next two weeks.
            <a href="nomad://calendar/">Add an event</a></p>`
    );
  }

  renderNotes(d) {
    const list = d.notes || [];
    return this.card(
      { id: 'notes', icon: 'far fa-sticky-note', title: 'Latest notes', href: 'nomad://notes/', linkLabel: 'Notes' },
      list.length
        ? html`<ul class="rows">
            ${list.map(
              (n) => html`<li>
                <a class="row" href=${n.url}>
                  <span class="main">
                    <span class="title">${n.title}</span>
                    ${n.snippet ? html`<span class="snippet">${n.snippet}</span>` : ''}
                  </span>
                  <span class="meta" title=${new Date(n.updatedAt).toLocaleString()}>${ago(n.updatedAt)}</span>
                </a>
              </li>`
            )}
          </ul>`
        : html`<p class="empty">No notes yet. <a href="nomad://notes/">Write one</a></p>`
    );
  }

  renderFiles(d) {
    const list = d.assets || [];
    return this.card(
      { id: 'files', icon: 'far fa-folder-open', title: 'Latest files', href: 'nomad://assets/', linkLabel: 'Assets' },
      list.length
        ? html`<div class="files">
            ${list.map(
              (a) => html`<a class="file" href=${a.url} title=${`${a.name}\nAdded ${ago(a.addedAt)}${a.by ? ` by ${a.by}` : ''}`}>
                <span class="file-thumb">
                  ${this.thumbs[a.id]
                    ? html`<img src=${this.thumbs[a.id]} alt="" />`
                    : html`<span class=${'fas fa-' + a.icon}></span>`}
                </span>
                <span class="file-name">${a.name}</span>
              </a>`
            )}
          </div>`
        : html`<p class="empty">Photos, PDFs and other files you keep show up here.
            <a href="nomad://assets/">Open Assets</a></p>`
    );
  }

  // events
  // =

  async onWatchJob(j) {
    try {
      await nomad.vault.viewJob(j.id);
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
  }

  async onStopJob(j) {
    try {
      await nomad.vault.stopJob(j.id);
      toast.create(`Stopped ${j.title}`);
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  async onRunJob(j) {
    try {
      await nomad.vault.runJob(j.id);
      toast.create(`Running ${j.title}`);
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  async onClickNewHyperdrive(e) {
    e.preventDefault();
    var drive = await nomad.fs.createDrive();
    toast.create('Drive created');
    nomad.browser.openUrl(drive.url, {
      setActive: true,
      addedPaneUrls: ['nomad://editor/'],
    });
  }

  async onClickNewBookmark(e, pinned) {
    e.preventDefault();
    try {
      await desktop.createLink(await AddLinkPopup.create(), pinned);
      toast.create('Link added', '', 10e3);
    } catch (e) {
      // ignore, user probably cancelled
      console.log(e);
      return;
    }
    this.load();
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
