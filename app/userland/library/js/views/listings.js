import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import listingsCSS from '../../css/views/listings.css.js';

// Manage which of your drives are Listed for public discovery/search (ADR-0016). Lives in My Library
// rather than the site-info panel: listing is a property of a drive you own, managed centrally
// alongside your other drives — not a per-page action. Each row edits the drive's index.json
// `indexable` / `topics` / `keywords` via nomad.fs.configure (the bg normalizes on save).

export class ListingsView extends LitElement {
  static get properties() {
    return {
      rows: { type: Array },
      filter: { type: String },
    };
  }

  static get styles() {
    return listingsCSS;
  }

  constructor() {
    super();
    this.rows = undefined; // undefined = loading, [] = none
    this.filter = undefined;
    this.load();
  }

  async load() {
    let drives = [];
    try {
      drives = await nomad.drives.list({ includeSystem: false });
    } catch {
      drives = [];
    }
    // Only drives you can write are listable — listing is the author's own opt-in.
    const writable = drives.filter((d) => d.info && d.info.writable);
    const rows = await Promise.all(
      writable.map(async (d) => {
        let manifest = {};
        try {
          manifest = JSON.parse(await nomad.fs.drive(d.url).readFile('/index.json')) || {};
        } catch {
          /* no/empty manifest — treat as unlisted */
        }
        return {
          url: d.url,
          key: d.key,
          title: (d.info && d.info.title) || manifest.title || d.url,
          isFeed: manifest.type === 'walled.garden/feed',
          indexable: !!manifest.indexable,
          topicsStr: (Array.isArray(manifest.topics) ? manifest.topics : []).join(', '),
          keywordsStr: (Array.isArray(manifest.keywords) ? manifest.keywords : []).join(', '),
          saving: false,
          status: '',
        };
      })
    );
    rows.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    this.rows = rows;
  }

  filtered() {
    if (!this.rows) return [];
    const f = (this.filter || '').toLowerCase();
    if (!f) return this.rows;
    return this.rows.filter(
      (r) => r.title.toLowerCase().includes(f) || r.url.toLowerCase().includes(f)
    );
  }

  render() {
    if (typeof this.rows === 'undefined') {
      return html`<div class="empty">Loading…</div>`;
    }
    const rows = this.filtered();
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        List a drive to make it findable in <strong>Search</strong>. Listing announces the drive
        publicly; unlisting removes it from indexes (its data still replicates to anyone holding the
        key). Only drives you can write appear here.
      </div>
      ${rows.length === 0
        ? html`<div class="empty">
            ${this.rows.length === 0
              ? 'No writable drives yet.'
              : 'No drives match your search.'}
          </div>`
        : html`
            <div class="rows">
              ${repeat(
                rows,
                (r) => r.key,
                (r) => this.renderRow(r)
              )}
            </div>
          `}
    `;
  }

  renderRow(r) {
    return html`
      <div class="row ${r.indexable ? 'listed' : ''}">
        <div class="row-head">
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${r.indexable}
              @change=${(e) => this.onToggle(r, e.target.checked)}
            />
            <span class="switch"></span>
          </label>
          <div class="meta">
            <div class="title">
              ${r.title}
              ${r.isFeed ? html`<span class="badge">feed</span>` : ''}
            </div>
            <div class="url">${r.url}</div>
          </div>
          <div class="state">${r.indexable ? 'Listed' : 'Not listed'}</div>
        </div>
        ${r.indexable
          ? html`
              <div class="fields">
                <label>
                  <span class="flabel">Topics <em>— up to 5 categories, comma-separated</em></span>
                  <input
                    type="text"
                    placeholder="gardening, raised-beds"
                    .value=${r.topicsStr}
                    @input=${(e) => {
                      r.topicsStr = e.target.value;
                    }}
                  />
                </label>
                <label>
                  <span class="flabel">Keywords <em>— up to 12 terms, comma-separated</em></span>
                  <input
                    type="text"
                    placeholder="permaculture, composting"
                    .value=${r.keywordsStr}
                    @input=${(e) => {
                      r.keywordsStr = e.target.value;
                    }}
                  />
                </label>
              </div>
            `
          : ''}
        <div class="actions">
          <button ?disabled=${r.saving} @click=${() => this.onSave(r)}>
            ${r.saving ? 'Saving…' : 'Save'}
          </button>
          ${r.status ? html`<span class="status">${r.status}</span>` : ''}
        </div>
      </div>
    `;
  }

  // events
  // =

  onToggle(r, checked) {
    r.indexable = checked;
    r.status = '';
    this.requestUpdate();
  }

  async onSave(r) {
    if (r.saving) return;
    r.saving = true;
    r.status = '';
    this.requestUpdate();
    const splitList = (s) =>
      (s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    try {
      // The bg normalizes: slugifies topics, caps 5/12, dedupes, coerces indexable.
      await nomad.fs.configure(r.url, {
        indexable: r.indexable,
        topics: splitList(r.topicsStr),
        keywords: splitList(r.keywordsStr),
      });
      r.status = r.indexable ? 'Listed for search' : 'Unlisted';
      toast.create(r.indexable ? 'Drive listed for search' : 'Drive unlisted');
    } catch (e) {
      r.status = 'Error: ' + (e && e.message ? e.message : 'could not save');
      toast.create(r.status, 'error');
    } finally {
      r.saving = false;
      this.requestUpdate();
    }
  }
}

customElements.define('listings-view', ListingsView);
