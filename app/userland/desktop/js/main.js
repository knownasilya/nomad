// nomad://desktop — the new tab page and the toolbar's Home button: a dashboard of the user's things.
//
// - A greeting, then the pinned pages (bookmarks marked pinned).
// - Needs you, only when something waits on the user: a prompt open on a tab (Show brings it
//   forward), someone asking to write to a drive, edit a drive or join the shared Space (Allow,
//   Deny), a new Device or a stranger's first Message (a link), a Job that wanted sites (Run with me).
// - Notifications: Job results, Jobs that failed, other members' notices in a shared Space, unread
//   Messages. Each can be dismissed, or Clear all; that is a Vault record, so it holds on every Device.
// - Jobs: the ones running here now (Watch, Stop), and the ones that run next (Run now).
// - Coming up: the calendar from now on.
// - The newest Notes and files (Assets).
//
// Everything but the pins comes from one call, nomad.vault.homeDashboard() (bg/web-apis/bg/vault.ts),
// whose rules are shared/home-dashboard.mjs, the same ones the phone's home tab uses. The page loads
// it again when the Vault, a Job or the Inbox changes, and keeps its "5 min ago"s fresh.
//
// The page is a document (ADR-0048, shared/home-layout.mjs). Where each part goes is the layout, an
// openui-lang program drawn by <nomad-genui host> (nomad://app-stdlib/js/genui.build.js): it leaves
// a slot for every Home* widget it places and says which is which (`genui-widgets`), and this page
// puts the part above in that slot. With no layout of the user's own, that is the dashboard as it
// always was. Cards the user pinned (the AI Sidebar's Pin to Home, or their AI's pinDashboardCard)
// are programs too, each drawn by itself where the layout places HomeCards(). Customize, and each
// card's menu, hand the change to the AI Sidebar as a draft the user sends.

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

// A Job in My Library (shared/item-links.mjs jobLink).
const jobUrl = (id) => `nomad://library/jobs?id=${encodeURIComponent(id)}`;
import 'nomad://app-stdlib/js/com/img-fallbacks.js';

const WAITING_ICONS = {
  prompt: 'fas fa-question',
  drive: 'fas fa-pen',
  edit: 'fas fa-pen',
  join: 'fas fa-user-plus',
  device: 'fas fa-laptop',
  'message-request': 'fas fa-comment-dots',
  'job-needs': 'fas fa-globe',
};

// The rows a layout can ask for in a part: HomeNotes(10). The name homeDashboard knows each by.
const SIZED = {
  HomeNotifications: 'notifications',
  HomeJobs: 'next',
  HomeEvents: 'events',
  HomeNotes: 'notes',
  HomeFiles: 'assets',
};

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
      widgets: { type: Array },
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
    this.answering = null; // the Needs you row being answered
    this.widgets = null; // the parts the layout draws now: [{ slot, name, props }]
    this.placed = []; // every part the layout places, also in a tab that isn't open: [{ name, limit? }]
    this.limits = ''; // the rows the layout asks for, as sent to homeDashboard

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
      this.dash = await nomad.vault.homeDashboard({ now: wallNow(), limits: this.limits ? JSON.parse(this.limits) : undefined });
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
    on(() => nomad.vault.watchHome());
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
        <button
          class="link-btn customize"
          title="Change what your home page shows"
          aria-haspopup="menu"
          @click=${this.onCustomize}
        >
          <span class="fas fa-sliders-h" aria-hidden="true"></span> Customize
        </button>
        <a href="#" @click=${this.onClickNewHyperdrive}>+ New Hyperdrive</a>
        <a href="nomad://library/" title="Library">My Library</a>
        <a href="https://nomad.pages.dev/docs/api/" title="Help">Help</a>
      </div>

      <main>
        ${d && !d.failed
          ? this.renderPage(d)
          : html`
              ${this.renderGreeting(d)} ${this.renderPins()}
              ${d?.failed
                ? html`<div class="board-failed">The dashboard didn’t load. Try reloading the page.</div>`
                : html`<div class="board-loading"><span class="spinner"></span></div>`}
            `}
      </main>
    `;
  }

  // The page as its layout places it (shared/home-layout.mjs). A part the layout places twice shows
  // once, where it comes first.
  renderPage(d) {
    const layout = d.layout || {};
    const cards = d.cards || [];
    const drawn = new Map();
    for (const w of this.widgets || []) if (!drawn.has(w.name)) drawn.set(w.name, w);
    const part = (name, fn) => (drawn.has(name) ? fn(drawn.get(name)) : '');
    // Before the layout has said what it places, nothing of the page's is added around it. Needs
    // you is added whenever it isn't on screen (the layout left it out, or put it in a tab that
    // isn't open); the cards only when the layout places them nowhere.
    const known = !!this.widgets;
    return html`
      ${layout.broken
        ? html`<div class="layout-note" role="status">
            <span class="fas fa-fw fa-exclamation-triangle" aria-hidden="true"></span>
            Your layout can’t be drawn by this version of Nomad, so this is the default one.
            ${layout.canRestore
              ? html`<button class="link-btn" @click=${() => this.onRestoreLayout()}>Restore the layout before it</button>`
              : ''}
          </div>`
        : ''}
      ${known && !drawn.has('HomeNeedsYou') ? this.renderWaiting(d) : ''}
      <nomad-genui
        host
        class="layout"
        .source=${layout.source || ''}
        @genui-widgets=${this.onWidgets}
        @genui-action=${this.onGenUiAction}
      >
        ${part('HomeGreeting', (w) => this.renderGreeting(d, w.slot))}
        ${part('HomePins', (w) => this.renderPins(w.slot))}
        ${part('HomeNeedsYou', (w) => this.renderWaiting(d, w.slot))}
        ${part('HomeNotifications', (w) => this.renderNotifications(d, w.slot))}
        ${part('HomeJobs', (w) => this.renderJobs(d, w.slot))}
        ${part('HomeEvents', (w) => this.renderEvents(d, w.slot))}
        ${part('HomeNotes', (w) => this.renderNotes(d, w.slot))}
        ${part('HomeFiles', (w) => this.renderFiles(d, w.slot))}
        ${part('HomeCards', (w) => this.renderCards(cards, w.slot))}
      </nomad-genui>
      ${known && !this.placed.some((w) => w.name === 'HomeCards') && cards.length
        ? html`<div class="board extra">${this.renderCards(cards)}</div>`
        : ''}
    `;
  }

  renderGreeting(d, slot) {
    return html`
      <div class="greeting" slot=${slot || ''}>
        <header class="hello">
          <h1>${d?.greeting || 'Hello'}</h1>
          <div class="sub">
            ${longDate()}${d?.spaceName ? html` · <span class="space">${d.spaceName}</span>` : ''}
          </div>
        </header>
        ${this.renderReleaseNotice()}
      </div>
    `;
  }

  // The cards pinned to the page, each a program of its own drawn in the page's frame. With none,
  // one quiet tile says how they get there.
  renderCards(cards, slot) {
    if (!cards.length) {
      return html`<button class="card add-card" slot=${slot || ''} @click=${() => this.onAskAi('card')}>
        <span class="fas fa-fw fa-plus" aria-hidden="true"></span>
        <span>Add a card with AI</span>
      </button>`;
    }
    return repeat(
      cards,
      (c) => c.id,
      (c, i) => html`
        <section class="card pinned ${c.wide ? 'wide' : ''}" slot=${slot || ''} aria-label=${c.title}>
          <button
            class="icon-btn card-menu"
            title="Card options"
            aria-label="Options for the card ${c.title}"
            aria-haspopup="menu"
            @click=${() => this.onCardMenu(c, i, cards.length)}
          >
            <span class="fas fa-ellipsis-h"></span>
          </button>
          ${c.broken
            ? html`<p class="empty">
                <strong>${c.title}</strong> can’t be drawn by this version of Nomad. Remove it from its menu, or
                ask your AI to make it again.
              </p>`
            : html`<nomad-genui framed .source=${c.source} @genui-action=${this.onGenUiAction}></nomad-genui>`}
          ${c.job ? this.renderJobCardFooter(c) : ''}
        </section>
      `
    );
  }

  // Under a Job's card (ADR-0048 amendment): which Job keeps it, when it last drew it, and Run now.
  renderJobCardFooter(c) {
    const j = c.job;
    const when = j.running ? 'Updating now…' : j.at ? `Updated ${ago(j.at)}` : '';
    return html`
      <footer class="card-job ${j.failed ? 'failed' : ''}">
        <span class="fas fa-fw fa-robot" aria-hidden="true"></span>
        ${j.gone
          ? html`<span class="job-name">From a Job that was deleted</span>`
          : html`<a class="job-name" href=${jobUrl(j.id)} title="Open the Job in My Library">${j.title}</a>`}
        ${when ? html`<span class="when">· ${when}</span>` : ''}
        ${j.failed && !j.running
          ? html`<span class="when err" title="The Job’s last run failed, so this is from the run before">· Last run failed</span>`
          : ''}
        ${j.gone
          ? ''
          : j.running
            ? html`<span class="spinner small" role="status" aria-label="The Job is running"></span>`
            : html`<button
                class="icon-btn"
                title="Run the Job now to update this card"
                aria-label="Run the Job ${j.title} now"
                @click=${() => this.onRunJob(j)}
              >
                <span class="fas fa-redo"></span>
              </button>`}
      </footer>
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

  renderPins(slot) {
    var pins = this.pins || [];
    return html`
      <div class="pins" slot=${slot || ''}>
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
  card({ id, icon, title, count, href, linkLabel, extra = '', wide = false, slot = '' }, body) {
    return html`
      <section class="card ${wide ? 'wide' : ''}" id=${id} slot=${slot} aria-labelledby=${id + '-title'}>
        <header>
          <span class=${'icon ' + icon} aria-hidden="true"></span>
          <h2 id=${id + '-title'}>${title}</h2>
          ${count ? html`<span class="count">${count}</span>` : ''}
          <span class="spacer"></span>
          ${extra}
          ${href ? html`<a class="see-all" href=${href}>${linkLabel || 'See all'}</a>` : ''}
        </header>
        ${body}
      </section>
    `;
  }

  // What waits on the user, with the answer right there where it can be.
  renderWaiting(d, slot) {
    const list = d.waiting || [];
    if (!list.length) return '';
    return html`
      <section class="card needs" id="needs" slot=${slot || ''} aria-labelledby="needs-title">
        <header>
          <span class="icon fas fa-hand-paper" aria-hidden="true"></span>
          <h2 id="needs-title">Needs you</h2>
          <span class="count">${list.length}</span>
        </header>
        <ul class="rows">
          ${repeat(
            list,
            (w) => w.id,
            (w) => html`<li>
              <div class="row">
                <span class="lead waiting ${w.ai ? 'ai' : ''}">
                  <span class=${w.ai ? 'fas fa-robot' : WAITING_ICONS[w.kind] || 'fas fa-bell'}></span>
                </span>
                ${w.url && w.kind !== 'drive'
                  ? html`<a class="main" href=${w.url}>${this.waitingText(w)}</a>`
                  : html`<span class="main">${this.waitingText(w)}</span>`}
                ${w.at
                  ? html`<span class="meta" title=${new Date(w.at).toLocaleString()}>${ago(w.at)}</span>`
                  : ''}
                <span class="actions">${this.waitingActions(w)}</span>
              </div>
            </li>`
          )}
        </ul>
      </section>
    `;
  }

  waitingText(w) {
    const sub = [w.body, w.kind === 'prompt' && w.tabTitle ? `In “${w.tabTitle}”` : ''].filter(Boolean).join(' · ');
    return html`
      <span class="title">${w.title}</span>
      ${sub ? html`<span class="snippet">${sub}</span>` : ''}
    `;
  }

  waitingActions(w) {
    const busy = this.answering === w.id;
    switch (w.kind) {
      case 'prompt':
        return html`<button class="btn primary" @click=${() => this.onShowPrompt(w)}>Answer</button>`;
      case 'drive':
        return html`
          <button class="btn" ?disabled=${busy} @click=${() => this.onAnswer(w, false)}>Deny</button>
          <button class="btn primary" ?disabled=${busy} @click=${() => this.onAnswer(w, true)}>Allow</button>
        `;
      case 'edit':
        return w.canApprove
          ? html`
              <button class="btn" ?disabled=${busy} @click=${() => this.onAnswer(w, false)}>Deny</button>
              <button class="btn primary" ?disabled=${busy} @click=${() => this.onAnswer(w, true)}>Approve</button>
            `
          : html`<a class="btn" href=${w.url}>Open</a>`;
      case 'join':
        return html`
          <button class="btn" ?disabled=${busy} @click=${() => this.onAnswer(w, false)}>Deny</button>
          <button class="btn primary" ?disabled=${busy} @click=${() => this.onAnswer(w, true)}>Let in</button>
        `;
      case 'job-needs':
        return html`<button class="btn primary" @click=${() => this.onRunJob({ id: w.jobId, title: 'the Job' }, true)}>
          Run with me
        </button>`;
      case 'device':
        return html`<a class="btn primary" href=${w.url}>Review</a>`;
      default:
        return w.url ? html`<a class="btn" href=${w.url}>Open</a>` : '';
    }
  }

  renderNotifications(d, slot) {
    const list = d.notifications || [];
    const keys = d.notificationKeys || [];
    return this.card(
      {
        id: 'notifications',
        slot,
        icon: 'fas fa-bell',
        title: 'Notifications',
        count: keys.length ? String(keys.length) : '',
        href: d.unreadMessages ? 'nomad://messages/' : '',
        linkLabel: d.unreadMessages ? `Messages (${d.unreadMessages})` : 'Messages',
        extra: keys.length
          ? html`<button class="link-btn" title="Clear every notification, on all your devices" @click=${() => this.onClearAll(keys)}>
              Clear all
            </button>`
          : '',
      },
      list.length
        ? html`<ul class="rows">
            ${repeat(
              list,
              (n) => n.id,
              (n) => {
                const text = html`
                  <span class="title">${n.title}</span>
                  ${n.body || n.from
                    ? html`<span class="snippet">${n.from ? `${n.from}: ` : ''}${n.body}</span>`
                    : ''}
                `;
                return html`<li>
                  <div class="row notice">
                    <span class="lead ${n.kind}"><span class=${NOTIFY_ICONS[n.kind] || 'fas fa-bell'}></span></span>
                    ${n.url ? html`<a class="main" href=${n.url}>${text}</a>` : html`<span class="main">${text}</span>`}
                    <span class="meta" title=${new Date(n.at).toLocaleString()}>${ago(n.at)}</span>
                    <button
                      class="icon-btn dismiss"
                      title="Dismiss"
                      aria-label="Dismiss ${n.title}"
                      @click=${() => this.onDismiss([{ id: n.id, at: n.at }])}
                    >
                      <span class="fas fa-times"></span>
                    </button>
                  </div>
                </li>`;
              }
            )}
          </ul>`
        : html`<p class="empty">You’re all caught up. Job results and new messages show up here.</p>`
    );
  }

  renderJobs(d, slot) {
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
      { id: 'jobs', slot, icon: 'fas fa-robot', title: 'Jobs', href: 'nomad://library/jobs', linkLabel: 'All Jobs' },
      body
    );
  }

  renderEvents(d, slot) {
    const list = d.events || [];
    let lastDay = null;
    return this.card(
      { id: 'events', slot, icon: 'far fa-calendar-alt', title: 'Coming up', href: 'nomad://calendar/', linkLabel: 'Calendar' },
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

  renderNotes(d, slot) {
    const list = d.notes || [];
    return this.card(
      { id: 'notes', slot, icon: 'far fa-sticky-note', title: 'Latest notes', href: 'nomad://notes/', linkLabel: 'Notes' },
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

  renderFiles(d, slot) {
    const list = d.assets || [];
    return this.card(
      { id: 'files', slot, icon: 'far fa-folder-open', title: 'Latest files', href: 'nomad://assets/', linkLabel: 'Assets' },
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

  // Clear notifications here and on the user's other Devices (a Vault record).
  async onDismiss(items) {
    const ids = new Set(items.map((i) => i.id));
    // Gone at once; the reload confirms it.
    this.dash = {
      ...this.dash,
      notifications: (this.dash.notifications || []).filter((n) => !ids.has(n.id)),
      notificationKeys: (this.dash.notificationKeys || []).filter((n) => !ids.has(n.id)),
    };
    try {
      await nomad.vault.dismissHomeNotifications(items);
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  onClearAll(keys) {
    this.onDismiss(keys);
  }

  async onShowPrompt(w) {
    try {
      if (!(await nomad.vault.showWaitingPrompt(w.promptId))) toast.create('That was answered already');
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  // Allow or deny someone asking to write to a drive, edit a drive in the Space, or join it.
  async onAnswer(w, yes) {
    this.answering = w.id;
    this.requestUpdate();
    try {
      if (w.kind === 'drive') {
        const url = `hyper://${w.drive}/`;
        if (yes) await nomad.fs.approveRequest(url, w.writerKey);
        else await nomad.fs.denyRequest(url, w.writerKey);
      } else if (w.kind === 'edit') {
        await nomad.vault.answerSpaceRequest({ drive: w.drive, writerKey: w.writerKey, approve: yes });
      } else if (w.kind === 'join') {
        if (yes) await nomad.vault.approveSpaceJoin(w.memberId);
        else await nomad.vault.denySpaceJoin(w.memberId);
      }
      toast.create(yes ? 'Allowed' : 'Denied');
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.answering = null;
    this.loadDashboard();
  }

  async onRunJob(j, watch = false) {
    try {
      await nomad.vault.runJob(j.id, watch ? { watch: true } : undefined);
      toast.create(watch ? 'Running it with you in the AI Sidebar' : `Running ${j.title}`);
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
    this.menu([
      { label: 'Open Link in New Tab', click: () => window.open(pin.href) },
      { label: 'Copy Link Address', click: () => writeToClipboard(pin.href) },
      pin.isFixed ? undefined : { type: 'separator' },
      pin.isFixed
        ? undefined
        : { label: 'Edit', click: () => this.onClickEditBookmark(pin) },
      pin.isFixed
        ? undefined
        : { label: 'Unpin', click: () => this.onClickUnpinBookmark(pin) },
    ]);
  }

  // A native menu at the pointer; the item picked runs its `click`.
  async menu(items) {
    items = items.filter(Boolean);
    var fns = {};
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'separator') continue;
      let id = `item=${i}`;
      items[i].id = id;
      fns[id] = items[i].click;
      delete items[i].click;
    }
    var choice = await nomad.browser.showContextMenu(items);
    if (fns[choice]) fns[choice]();
  }

  // the page as a document (ADR-0048)
  // =

  // The layout says which parts it places. A part sized by the layout (HomeNotes(10)) needs that
  // many rows from the dashboard.
  onWidgets(e) {
    if (!e.target.host) return; // a pinned card places no parts of the page
    this.widgets = e.detail?.widgets || [];
    this.placed = e.detail?.placed || [];
    const limits = {};
    for (const w of this.placed) {
      const key = SIZED[w.name];
      if (key && w.limit > 0 && !(key in limits)) limits[key] = w.limit;
    }
    const next = Object.keys(limits).length ? JSON.stringify(limits) : '';
    if (next === this.limits) return;
    this.limits = next;
    this.loadDashboard();
  }

  // A button or link in the layout or a card. A link opens here, when it is one a drawing may open
  // (a web or hyper:// page, or one of the user's things). A message for the assistant goes in the
  // AI Sidebar's input: the user reads it and sends it.
  onGenUiAction(e) {
    const GenUi = customElements.get('nomad-genui');
    for (const step of e.detail?.steps || []) {
      if (step.type === 'open_url') {
        const url = GenUi?.safeUrl ? GenUi.safeUrl(step.url) : null;
        if (url) location.href = url;
      } else if (step.type === 'continue_conversation' && String(step.message || '').trim()) {
        this.draftForAi(String(step.message).trim());
      }
    }
  }

  async draftForAi(draft) {
    try {
      await nomad.aiChats.openNew({ draft });
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
  }

  // Changing the page is the AI's work: each of these opens the AI Sidebar with the request begun.
  onAskAi(what, card) {
    if (what === 'card') return this.draftForAi('Add a card to my home page that shows ');
    if (what === 'change-card') {
      // A Job draws its card again on every run, so the change goes in the Job.
      if (card.job && !card.job.gone) {
        return this.draftForAi(`Change my Job “${card.job.title}” (id ${card.job.id}) so its card on my home page `);
      }
      return this.draftForAi(`On my home page, change the card “${card.title}” (id ${card.id}): `);
    }
    return this.draftForAi('Change my home page: ');
  }

  onCustomize() {
    const layout = this.dash?.layout || {};
    this.menu([
      { label: 'Ask AI to Change This Page…', click: () => this.onAskAi('page') },
      { label: 'Add a Card with AI…', click: () => this.onAskAi('card') },
      { type: 'separator' },
      { label: 'Restore Previous Layout', enabled: !!layout.canRestore, click: () => this.onRestoreLayout() },
      { label: 'Reset to Default Layout', enabled: !!layout.custom, click: () => this.onResetLayout() },
    ]);
  }

  async onRestoreLayout() {
    try {
      if (await nomad.vault.restoreHomeLayout()) toast.create('Layout restored');
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  async onResetLayout() {
    try {
      await nomad.vault.resetHomeLayout();
      toast.create('Back to the default layout. Customize can restore yours.');
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
  }

  // A pinned card's menu. The chat that made it is looked up first (ADR-0047), so the menu can
  // offer it only while the chat exists.
  async onCardMenu(card, i, count) {
    let chat = null;
    if (card.ai?.length) {
      try {
        chat = (await nomad.aiChats.origins(card.ai)).find((o) => o.kind === 'chat' && o.id) || null;
      } catch (e) {}
    }
    const change = (what, done) => async () => {
      try {
        await nomad.vault.updateHomeCard(card.id, what);
        if (done) toast.create(done);
      } catch (e) {
        toast.create(e.message || String(e), 'error');
      }
      this.loadDashboard();
    };
    const job = card.job && !card.job.gone ? card.job : null;
    this.menu([
      { label: 'Ask AI to Change This Card…', click: () => this.onAskAi('change-card', card) },
      job ? { label: 'Open the Job', click: () => (location.href = jobUrl(job.id)) } : undefined,
      job ? { label: 'Run the Job Now', enabled: !job.running, click: () => this.onRunJob(job) } : undefined,
      chat && !job
        ? { label: 'Open the Chat That Made It', click: () => nomad.aiChats.open(chat.id, { space: chat.space }) }
        : undefined,
      { type: 'separator' },
      { label: card.wide ? 'Make Narrow' : 'Make Wide', click: change({ wide: !card.wide }) },
      { label: 'Move Earlier', enabled: i > 0, click: change({ move: -1 }) },
      { label: 'Move Later', enabled: i < count - 1, click: change({ move: 1 }) },
      { type: 'separator' },
      { label: 'Remove from Home', click: () => this.onRemoveCard(card) },
    ]);
  }

  async onRemoveCard(card) {
    try {
      const res = await nomad.vault.removeHomeCard(card.id);
      // Taking it off also stops the Job drawing it (vault.ts removeHomeCard).
      toast.create(res?.job ? `Removed “${card.title}”. “${res.job}” won’t draw it again.` : `Removed “${card.title}”`);
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    }
    this.loadDashboard();
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
