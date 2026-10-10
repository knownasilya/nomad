import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import namesCSS from '../../css/views/names.css.js';

// The user's names (bg/hyper/names.js): short words for drives, apps in a private drive, and any
// URL. One set per user in the Vault, so they sync to linked Devices. Typing a name in the URL bar,
// or opening hyper://<name>/, goes to what it names; the AI can look names up and use them.
// A page can also be named from its site-info panel.

// The name rules live in shared/names.mjs (bg checks them on save); this only tidies typing.
const tidy = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

export class NamesView extends LitElement {
  static get properties() {
    return {
      names: { type: Array },
      filter: { type: String },
      adding: { type: Object }, // { name, url, error }
      editing: { type: Object }, // { previous, name, url, error }
    };
  }

  static get styles() {
    return namesCSS;
  }

  constructor() {
    super();
    this.names = undefined; // undefined = loading
    this.filter = undefined;
    this.adding = { name: '', url: '', error: '' };
    this.editing = null;
    this.load();
    // Names change on other Devices too.
    try {
      nomad.vault.watchAppData().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      this.names = await nomad.vault.listNames();
    } catch {
      this.names = [];
    }
  }

  filtered() {
    const f = (this.filter || '').toLowerCase();
    if (!f) return this.names || [];
    return (this.names || []).filter(
      (n) => n.name.includes(f) || (n.title || '').toLowerCase().includes(f) || n.url.toLowerCase().includes(f)
    );
  }

  // A title for a new name: the drive's title for a hyper:// URL, else the URL's host.
  async titleFor(url) {
    if (url.startsWith('hyper://')) {
      try {
        const info = await nomad.fs.drive(url).getInfo();
        if (info && info.title) return info.title;
      } catch {}
    }
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  async save({ name, url, previous }) {
    const target = String(url || '').trim();
    await nomad.vault.setName({ name: tidy(name), url: target, title: await this.titleFor(target), previous });
    await this.load();
  }

  render() {
    if (typeof this.names === 'undefined') return html`<div class="empty">Loading…</div>`;
    const rows = this.filtered();
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        Short names for your drives, apps and pages. Type a name in the URL bar, or open
        <code>hyper://name/</code>, to go there, and ask the AI to use it ("add a post to my blog").
        Names sync to your linked devices. You can also name a page from its site info.
      </div>
      ${this.renderAdd()}
      ${rows.length === 0
        ? html`<div class="empty">${this.names.length ? 'No names match your search.' : 'No names yet.'}</div>`
        : html`<div class="rows">${repeat(rows, (n) => n.name, (n) => this.renderRow(n))}</div>`}
    `;
  }

  renderAdd() {
    const a = this.adding;
    return html`
      <form class="add" @submit=${this.onAdd}>
        <div class="fields">
          <span class="prefix">hyper://</span>
          <input
            class="name"
            placeholder="name"
            aria-label="Name"
            .value=${a.name}
            @input=${(e) => (this.adding = { ...a, name: e.target.value, error: '' })}
          />
          <span class="prefix">/ &rarr;</span>
          <input
            class="url"
            placeholder="hyper://… https://… or nomad://…"
            aria-label="What it names"
            .value=${a.url}
            @input=${(e) => (this.adding = { ...a, url: e.target.value, error: '' })}
          />
          <button type="submit" class="primary">Add name</button>
        </div>
        ${a.error ? html`<div class="error">${a.error}</div>` : ''}
      </form>
    `;
  }

  renderRow(n) {
    const e = this.editing && this.editing.previous === n.name ? this.editing : null;
    return html`
      <div class="row">
        <div class="row-head">
          <span class="name-chip">${n.name}</span>
          <div class="meta">
            <div class="title">${n.title || n.name}</div>
            <div class="target">${n.url}</div>
          </div>
          <div class="actions">
            <button class="icon" title="Open" aria-label="Open ${n.name}" @click=${() => this.onOpen(n)}>
              <span class="fas fa-fw fa-external-link-alt"></span>
            </button>
            <button class="icon" title="Edit" aria-label="Edit ${n.name}" @click=${() => this.onEdit(n)}>
              <span class="fas fa-fw fa-pen"></span>
            </button>
            <button class="icon danger" title="Remove" aria-label="Remove ${n.name}" @click=${() => this.onRemove(n)}>
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${e
          ? html`
              <form class="fields" @submit=${this.onSaveEdit}>
                <span class="prefix">hyper://</span>
                <input
                  class="name"
                  aria-label="Name"
                  .value=${e.name}
                  @input=${(ev) => (this.editing = { ...e, name: ev.target.value, error: '' })}
                />
                <span class="prefix">/ &rarr;</span>
                <input
                  class="url"
                  aria-label="What it names"
                  .value=${e.url}
                  @input=${(ev) => (this.editing = { ...e, url: ev.target.value, error: '' })}
                />
                <button type="submit" class="primary">Save</button>
                <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
              </form>
              ${e.error ? html`<div class="error">${e.error}</div>` : ''}
            `
          : ''}
      </div>
    `;
  }

  // events
  // =

  async onAdd(e) {
    e.preventDefault();
    try {
      await this.save(this.adding);
      toast.create(`Named hyper://${tidy(this.adding.name)}/`, 'success');
      this.adding = { name: '', url: '', error: '' };
    } catch (err) {
      this.adding = { ...this.adding, error: err.message || String(err) };
    }
  }

  onOpen(n) {
    // hyper://<name>/ goes through the tab's name lookup, like typing it.
    nomad.browser.openUrl(`hyper://${n.name}/`, { setActive: true });
  }

  onEdit(n) {
    this.editing = { previous: n.name, name: n.name, url: n.url, error: '' };
  }

  async onSaveEdit(e) {
    e.preventDefault();
    try {
      await this.save(this.editing);
      this.editing = null;
    } catch (err) {
      this.editing = { ...this.editing, error: err.message || String(err) };
    }
  }

  async onRemove(n) {
    if (!confirm(`Remove the name “${n.name}”? What it names stays as it is.`)) return;
    try {
      await nomad.vault.removeName(n.name);
      await this.load();
    } catch (err) {
      toast.create(err.message || String(err), 'error');
    }
  }
}

customElements.define('names-view', NamesView);
