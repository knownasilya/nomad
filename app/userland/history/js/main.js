import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { findParent } from 'nomad://app-stdlib/js/dom.js';
import _debounce from 'nomad://app-stdlib/vendor/lodash.debounce.js';
import moment from 'nomad://app-stdlib/vendor/moment.js';
import mainCSS from '../css/main.css.js';

// how many px from bottom till more is loaded?
const BEGIN_LOAD_OFFSET = 500;
// how many to load in a batch?
const BATCH_SIZE = 20;

export class HistoryApp extends LitElement {
  static get styles() {
    return mainCSS;
  }

  constructor() {
    super();
    nomad.panes.setAttachable();
    nomad.panes.attachToLastActivePane();

    this.onUpdateSearchQueryDebounced = _debounce(
      this.onUpdateSearchQuery.bind(this),
      500
    );
    this.visits = [];
    this.isAtEnd = false;
    this.query = '';
    this.closedTabs = false;
    // 'devices' shows the open tabs on the user's other Devices (nomad://history/#devices).
    this.view = location.hash === '#devices' ? 'devices' : 'all';
    this.deviceTabs = null; // { devices, linked, sharing, currentSpace } once loaded
    this.currentPeriodFilter = 'all';
    this.lastRenderedDate = undefined;
    this.isFetching = false;

    if (this.view === 'devices') this.loadDeviceTabs();
    else this.fillPage();
    this.addEventListener('scroll', this.onScroll.bind(this));
    // Another Device's tabs change while this page is open.
    try {
      nomad.vault.watchAppData().addEventListener('changed', () => {
        if (this.view === 'devices') this.loadDeviceTabs();
      });
    } catch {}

    this.addEventListener('click', (e) => {
      // route navigations to the attached pane if present
      var attachedPane = nomad.panes.getAttachedPane();
      if (!attachedPane) return;
      let anchor = findParent(e.path[0], (el) => el.tagName === 'A');
      if (anchor) {
        if (!e.metaKey && anchor.getAttribute('target') !== '_blank') {
          e.stopPropagation();
          e.preventDefault();
          nomad.panes.navigate(attachedPane.id, anchor.getAttribute('href'));
        }
      }
    });
  }

  async fetchMore() {
    if (this.isFetching) return;
    if (this.isAtEnd) return;
    return this.loadVisits(this.visits.length);
  }

  // load history until the scroll bar is visible, or no more history is found
  async fillPage() {
    this.visits.length = 0; // reset
    this.isAtEnd = false;
    do {
      await this.fetchMore();
      this.requestUpdate();
    } while (
      this.shadowRoot.scrollHeight < this.shadowRoot.clientHeight &&
      !this.isAtEnd
    );
  }

  async loadVisits(offset) {
    // reset isAtEnd if starting from 0
    if (offset === 0) {
      this.isAtEnd = false;
    }

    this.isFetching = true;
    var before;
    var after;
    if (this.currentPeriodFilter === 'today') {
      after = moment().startOf('day');
    } else if (this.currentPeriodFilter === 'yesterday') {
      after = moment().subtract(1, 'day').startOf('day');
      before = moment().startOf('day');
    }
    var rows = await nomad.history.getVisitHistory({
      before: +before,
      after: +after,
      offset,
      limit: BATCH_SIZE,
      search: this.query ? this.query : false,
      tabClose: this.closedTabs,
    });
    // did we reach the end?
    if (rows.length === 0) {
      this.isAtEnd = true;
    }

    if (offset > 0) {
      // append to the end
      this.visits = this.visits.concat(rows);
    } else {
      // new results
      this.visits = rows;
    }
    this.requestUpdate();

    this.isFetching = false;
  }

  setView(view) {
    this.view = view;
    history.replaceState(null, '', view === 'devices' ? '#devices' : location.pathname);
    if (view === 'devices') {
      this.loadDeviceTabs();
      this.requestUpdate();
      return;
    }
    this.closedTabs = view === 'closed';
    this.fillPage();
  }

  async loadDeviceTabs() {
    try {
      this.deviceTabs = await nomad.vault.listDeviceTabs();
      this.deviceTabsError = null;
    } catch (err) {
      this.deviceTabsError = err?.message || String(err);
    }
    this.requestUpdate();
  }

  // rendering
  // =

  render() {
    const current = this.view === 'devices' ? 'devices' : this.closedTabs ? 'closed' : 'all';
    const navItem = (view, label) => html`
      <a class=${current === view ? 'current' : ''} @click=${(e) => this.setView(view)}
        >${label}</a
      >
    `;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <header>
        <nav>
          ${navItem('all', 'All')} ${navItem('closed', 'Recently Closed Tabs')}
          ${navItem('devices', 'Tabs From Other Devices')}
        </nav>
        ${this.view === 'devices' ? '' : this.renderSubheader()}
      </header>
      <main>
        ${this.view === 'devices'
          ? this.renderDeviceTabs()
          : html`<div class="rows">${this.renderRows()}</div>`}
      </main>
    `;
  }

  // The open tabs on the user's other Devices, grouped by Device and then Space, this Space first.
  renderDeviceTabs() {
    if (this.deviceTabsError) {
      return html`<p class="empty">Couldn't load your other devices' tabs: ${this.deviceTabsError}</p>`;
    }
    const dt = this.deviceTabs;
    if (!dt) return html`<p class="empty">Loading...</p>`;
    const notSharing = dt.sharing
      ? ''
      : html`<p class="note">
          This device isn't sharing its own tabs. Turn it on in
          <a href="nomad://settings/?view=devices">Settings → Devices</a>.
        </p>`;
    if (!dt.linked) {
      return html`<p class="empty">
        Link another device in <a href="nomad://settings/?view=devices">Settings → Devices</a> to see
        the tabs it has open here.
      </p>`;
    }
    if (!dt.devices.length) {
      return html`${notSharing}
        <p class="empty">
          Your other devices don't have any tabs open. Tabs show up here a few seconds after a
          device opens them, once it has synced.
        </p>`;
    }
    return html`
      ${notSharing}
      ${dt.devices.map(
        (d) => html`
          <div class="device">
            <div class="device-heading">
              <i class="fas fa-fw ${d.platform === 'mobile' ? 'fa-mobile-alt' : 'fa-laptop'}"></i>
              <span class="device-name">${d.name}</span>
              <span class="device-when">
                ${d.connected
                  ? 'Connected'
                  : d.updatedAt
                    ? `Updated ${moment(d.updatedAt).fromNow()}`
                    : ''}
              </span>
            </div>
            ${d.spaces.map(
              (sp) => html`
                <div class="space-name">
                  ${sp.name}${sp.rootDriveKey === dt.currentSpace
                    ? html` <span class="this-space">This space</span>`
                    : ''}
                </div>
                ${sp.tabs.map((tab) => this.renderDeviceTab(tab))}
              `
            )}
          </div>
        `
      )}
    `;
  }

  renderDeviceTab(tab) {
    return html`
      <div class="row">
        <a class="link" href=${tab.url} title=${tab.title || tab.url}>
          <img class="favicon" src=${'asset:favicon:' + tab.url} />
          <span class="title">${tab.title || getHostname(tab.url)}</span>
          <span class="url">${getHostname(tab.url)}</span>
        </a>
        ${tab.pinned
          ? html`<i class="fas fa-thumbtack pinned" title="Pinned on that device"></i>`
          : ''}
      </div>
    `;
  }

  renderRows() {
    var rowEls = [];
    this.lastRenderedDate = moment().startOf('day').add(1, 'day');

    this.visits.forEach((row, i) => {
      // render a date heading if this post is from a different day than the last
      var oldLastDate = this.lastRenderedDate;
      this.lastRenderedDate = moment(row.ts).endOf('day');
      if (!this.lastRenderedDate.isSame(oldLastDate, 'day')) {
        rowEls.push(html`
          <div class="heading">
            ${ucfirst(niceDate(this.lastRenderedDate, { noTime: true }))}
          </div>
        `);
      }

      // render row
      rowEls.push(this.renderRow(row, i));
    });

    // empty state
    if (rowEls.length === 0) {
      if (this.isFetching) {
        rowEls.push(html`<p class="empty">Loading...</p>`);
      } else if (this.query) {
        rowEls.push(
          html`<p class="view empty">No results for "${this.query}"</p>`
        );
      } else {
        rowEls.push(html`<p class="empty">No history... yet!</p>`);
      }
    }

    return rowEls;
  }

  renderClearHistoryButton() {
    return html`
      <span class="clear-history">
        <a @click=${this.onClickDeleteBulk}> Clear history </a>

        <select id="delete-period">
          <option value="day" selected>from today</option>
          <option value="week">from this week</option>
          <option value="month">from this month</option>
          <option value="all">from all time</option>
        </select>
      </span>
    `;
  }

  renderRow(row, i) {
    return html`
      <div class="row">
        <a class="link" href=${row.url} title=${row.title}>
          <img class="favicon" src=${'asset:favicon:' + row.url} />
          <span class="title">${row.title.replace(/[^\x00-\x7F]/g, '')}</span>
          <span class="url">${getHostname(row.url)}</span>
        </a>
        <div class="actions">
          <div
            class="action"
            @click=${(e) => this.onClickDelete(e, i)}
            title="Remove from history"
          >
            <i class="fa fa-times icon"></i>
          </div>
        </div>
      </div>
    `;
  }

  renderSubheader() {
    return html`
      <div class="search-container">
        <input
          autofocus
          @keyup=${this.onUpdateSearchQueryDebounced}
          placeholder="Search your browsing history"
          type="text"
          class="search"
        />
        ${this.query
          ? html`
              <span @click=${this.onClearQuery} class="close-btn">
                <span class="fas fa-fw fa-times"></span>
              </span>
            `
          : ''}
        <i class="fa fa-search"></i>
      </div>

      ${this.renderClearHistoryButton()}
    `;
  }

  // events
  // =

  onUpdateSearchQuery(e) {
    var newQuery = this.shadowRoot.querySelector('.search').value.toLowerCase();
    if (newQuery !== this.query) {
      this.query = newQuery;
      this.fillPage();
    }
  }

  onClearQuery() {
    this.shadowRoot.querySelector('input.search').value = '';
    this.query = '';
    this.fillPage();
  }

  onUpdatePeriodFilter(e) {
    this.shadowRoot.querySelector('input.search').value = '';
    this.query = '';
    this.currentPeriodFilter = e.target.dataset.period;
    this.fillPage();
  }

  onScroll(e) {
    if (this.isAtEnd) return;

    var el = this;
    if (el.offsetHeight + el.scrollTop + BEGIN_LOAD_OFFSET >= el.scrollHeight) {
      // hit bottom
      this.fetchMore();
    }
  }

  onClickDelete(e, i) {
    if (!confirm('Are you sure?')) return;
    var v = this.visits[i];
    this.visits.splice(i, 1);
    nomad.history.removeVisit(v.url);
    this.requestUpdate();
  }

  onClickDeleteBulk() {
    if (!confirm('Are you sure?')) return;
    var period = this.shadowRoot.querySelector('#delete-period').value;

    // clear all history
    if (period === 'all') {
      this.visits = [];
      nomad.history.removeAllVisits();
      this.requestUpdate();
    } else {
      var threshold = moment().startOf(period).valueOf();

      // filter out visits that with a timestamp >= threshold
      this.visits = this.visits.filter((v) => v.ts < threshold);
      nomad.history.removeVisitsAfter(threshold);

      // fetch and render more visits if possible
      this.fetchMore();
    }
  }
}

customElements.define('history-app', HistoryApp);

// internal
// =

function getHostname(str) {
  try {
    const u = new URL(str);
    if (u.protocol === 'hyper:' && u.hostname.length === 64) {
      return 'hyper://' + shortenHash(u.hostname);
    }
    return u.hostname;
  } catch (e) {
    return str;
  }
}

function shortenHash(str, n = 6) {
  if (str.startsWith('hyper://')) {
    return (
      'hyper://' +
      shortenHash(str.slice('hyper://'.length).replace(/\/$/, '')) +
      '/'
    );
  }
  if (str.length > n + 5) {
    return str.slice(0, n) + '..' + str.slice(-2);
  }
  return str;
}

function ucfirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function niceDate(ts, opts) {
  const endOfToday = moment().endOf('day');
  if (typeof ts === 'number') {
    ts = moment(ts);
  }
  if (ts.isSame(endOfToday, 'day')) {
    if (opts && opts.noTime) {
      return 'today';
    }
    return ts.fromNow();
  } else if (ts.isSame(endOfToday.subtract(1, 'day'), 'day')) {
    return 'yesterday';
  } else if (ts.isSame(endOfToday, 'month')) {
    return ts.fromNow();
  }
  return ts.format('ll');
}
