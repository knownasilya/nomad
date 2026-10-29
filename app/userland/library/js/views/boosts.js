import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import boostsCSS from '../../css/views/boosts.css.js';

// The user's Boosts (bg/ui/boosts.js, ADR-0023): their own changes to a site, like Arc's. Each has
// a name, an on/off switch, preset styles, elements to hide, custom CSS and custom JavaScript. One
// set per user in the Vault, so they sync to linked Devices. The magic-wand button in the location
// bar switches a site's Boosts and zaps elements; this is where they're written.
//
// ?site=<host> shows that site's Boosts, ?id=<id> opens one, and ?new=1 starts a new one for the
// site. The rules (sites, selectors, sizes) live in shared/boosts.mjs; bg checks them on save.

const blank = (site = '') => ({ id: null, name: '', site, enabled: true, presets: [], hide: [], css: '', js: '' });

export class BoostsView extends LitElement {
  static get properties() {
    return {
      boosts: { type: Array },
      presets: { type: Array },
      filter: { type: String },
      site: { type: String }, // from ?site=
      editing: { type: Object }, // a draft: blank() or a copy of a Boost, plus { newSelector, error }
    };
  }

  static get styles() {
    return boostsCSS;
  }

  constructor() {
    super();
    this.boosts = undefined; // undefined = loading
    this.presets = [];
    this.filter = undefined;
    const q = new URLSearchParams(location.search);
    this.site = q.get('site') || '';
    this.openId = q.get('id') || null;
    this.editing = q.get('new') ? { ...blank(this.site), newSelector: '', error: '' } : null;
    this.load();
    // Boosts change on other Devices, from the location bar, and from the AI.
    try {
      nomad.vault.watchAppData().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      const res = await nomad.vault.listBoosts();
      this.boosts = res.boosts;
      this.presets = res.presets;
    } catch {
      this.boosts = [];
    }
    if (this.openId) {
      const b = this.boosts.find((x) => x.id === this.openId);
      if (b) this.edit(b);
      this.openId = null;
    }
  }

  filtered() {
    const f = (this.filter || '').toLowerCase();
    return (this.boosts || []).filter((b) => {
      if (this.site && !(b.site === this.site || this.site.endsWith('.' + b.site))) return false;
      return !f || b.name.toLowerCase().includes(f) || b.site.includes(f);
    });
  }

  // A site and the Boosts for it, A to Z by site.
  grouped(rows) {
    const out = new Map();
    for (const b of rows) {
      if (!out.has(b.site)) out.set(b.site, []);
      out.get(b.site).push(b);
    }
    return [...out];
  }

  render() {
    if (typeof this.boosts === 'undefined') return html`<div class="empty">Loading…</div>`;
    const rows = this.filtered();
    const e = this.editing;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        Boosts change how a site looks and works, just for you: dark mode and other quick styles,
        parts of the page to hide, your own CSS, and your own JavaScript. A Boost for
        <code>example.com</code> also applies to <code>www.</code> and <code>docs.example.com</code>.
        Switch them from the <span class="fas fa-magic"></span> button in the location bar, where
        you can also pick elements to hide. The AI can make them too. Boosts sync to your linked
        devices.
      </div>
      <div class="toolbar">
        ${this.site
          ? html`<span class="site-filter">
              Showing <strong>${this.site}</strong>
              <button class="link" @click=${this.onShowAll}>Show all</button>
            </span>`
          : html`<span></span>`}
        ${e && !e.id ? '' : html`<button class="primary" @click=${this.onNew}>New Boost</button>`}
      </div>
      ${e && !e.id ? html`<div class="card editing">${this.renderEditor(e)}</div>` : ''}
      ${rows.length === 0
        ? html`<div class="empty">
            ${this.boosts.length ? 'No Boosts match.' : 'No Boosts yet. Open a site and click the magic wand to start one.'}
          </div>`
        : this.grouped(rows).map(
            ([site, list]) => html`
              <div class="group">
                <div class="group-head">
                  <span class="site">${site}</span>
                  <button class="icon" title="Open ${site}" aria-label="Open ${site}" @click=${() => this.onOpenSite(site)}>
                    <span class="fas fa-fw fa-external-link-alt"></span>
                  </button>
                </div>
                ${repeat(list, (b) => b.id, (b) => this.renderBoost(b))}
              </div>
            `
          )}
    `;
  }

  renderBoost(b) {
    const e = this.editing && this.editing.id === b.id ? this.editing : null;
    return html`
      <div class="card ${e ? 'editing' : ''}">
        <div class="row-head">
          <label class="switch" title=${b.enabled ? 'On' : 'Off'}>
            <input type="checkbox" .checked=${b.enabled} aria-label="${b.name} on" @change=${(ev) => this.onToggle(b, ev.target.checked)} />
            <span class="track"></span>
          </label>
          <div class="meta" @click=${() => (e ? null : this.edit(b))}>
            <div class="title">${b.name}</div>
            <div class="summary">${this.summary(b)}</div>
          </div>
          <div class="actions">
            <button class="icon" title="Edit" aria-label="Edit ${b.name}" @click=${() => (e ? (this.editing = null) : this.edit(b))}>
              <span class="fas fa-fw ${e ? 'fa-chevron-up' : 'fa-pen'}"></span>
            </button>
            <button class="icon danger" title="Delete" aria-label="Delete ${b.name}" @click=${() => this.onDelete(b)}>
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${e ? this.renderEditor(e) : ''}
      </div>
    `;
  }

  summary(b) {
    const parts = b.presets.map((id) => this.presets.find((p) => p.id === id)?.label).filter(Boolean);
    if (b.hide.length) parts.push(`${b.hide.length} hidden`);
    if (b.css.trim()) parts.push('CSS');
    if (b.js.trim()) parts.push('JavaScript');
    return parts.length ? parts.join(' · ') : 'Nothing yet';
  }

  renderEditor(e) {
    const set = (patch) => (this.editing = { ...this.editing, ...patch, error: '' });
    return html`
      <form class="editor" @submit=${this.onSave}>
        <div class="fields">
          <label>
            <span>Name</span>
            <input class="name" placeholder="Clean reading" .value=${e.name} @input=${(ev) => set({ name: ev.target.value })} />
          </label>
          <label>
            <span>Site</span>
            <input class="site" placeholder="example.com" .value=${e.site} @input=${(ev) => set({ site: ev.target.value })} />
          </label>
        </div>

        <div class="block">
          <div class="label">Quick styles</div>
          <div class="presets">
            ${this.presets.map(
              (p) => html`
                <label class="chip ${e.presets.includes(p.id) ? 'on' : ''}" title=${p.description}>
                  <input
                    type="checkbox"
                    .checked=${e.presets.includes(p.id)}
                    @change=${(ev) =>
                      set({ presets: ev.target.checked ? [...e.presets, p.id] : e.presets.filter((x) => x !== p.id) })}
                  />
                  ${p.label}
                </label>
              `
            )}
          </div>
        </div>

        <div class="block">
          <div class="label">Hidden elements <span class="hint">CSS selectors, one each. The zapper in the location bar adds them for you.</span></div>
          ${e.hide.length
            ? html`<ul class="selectors">
                ${e.hide.map(
                  (s) => html`<li>
                    <code>${s}</code>
                    <button type="button" class="icon danger" title="Show it again" aria-label="Remove ${s}" @click=${() => set({ hide: e.hide.filter((x) => x !== s) })}>
                      <span class="fas fa-fw fa-times"></span>
                    </button>
                  </li>`
                )}
              </ul>`
            : ''}
          <div class="add-selector">
            <input
              class="code"
              placeholder=".cookie-banner, #sidebar"
              .value=${e.newSelector || ''}
              @input=${(ev) => set({ newSelector: ev.target.value })}
              @keydown=${(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  this.onAddSelector();
                }
              }}
            />
            <button type="button" @click=${this.onAddSelector}>Hide</button>
          </div>
        </div>

        <div class="block">
          <div class="label">CSS</div>
          <textarea class="code" rows="6" spellcheck="false" placeholder="body { font-family: Georgia, serif; }" .value=${e.css} @input=${(ev) => set({ css: ev.target.value })}></textarea>
        </div>

        <div class="block">
          <div class="label">JavaScript <span class="hint">Runs in the page each time it loads, once the page is ready. <code>await</code> works.</span></div>
          <textarea class="code" rows="6" spellcheck="false" placeholder="document.querySelectorAll('details').forEach((d) => (d.open = true));" .value=${e.js} @input=${(ev) => set({ js: ev.target.value })}></textarea>
        </div>

        ${e.error ? html`<div class="error">${e.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary">${e.id ? 'Save' : 'Create Boost'}</button>
          <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  edit(b) {
    this.editing = { ...b, presets: [...b.presets], hide: [...b.hide], newSelector: '', error: '' };
  }

  // events
  // =

  onNew() {
    this.editing = { ...blank(this.site), newSelector: '', error: '' };
  }

  onShowAll() {
    this.site = '';
    history.replaceState({}, '', '/boosts');
  }

  onOpenSite(site) {
    nomad.browser.openUrl(/^[0-9a-f]{64}$/.test(site) ? `hyper://${site}/` : `https://${site}/`, { setActive: true });
  }

  onAddSelector() {
    const e = this.editing;
    const parts = String(e.newSelector || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    this.editing = { ...e, hide: [...new Set([...e.hide, ...parts])], newSelector: '', error: '' };
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    const pending = String(e.newSelector || '').trim();
    try {
      const rec = await nomad.vault.saveBoost({
        id: e.id || undefined,
        name: e.name,
        site: e.site,
        enabled: e.enabled,
        presets: e.presets,
        hide: pending ? [...new Set([...e.hide, pending])] : e.hide,
        css: e.css,
        js: e.js,
      });
      this.editing = null;
      await this.load();
      toast.create(e.id ? `Saved “${rec.name}”` : `Created “${rec.name}” for ${rec.site}`, 'success');
    } catch (err) {
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  async onToggle(b, enabled) {
    try {
      await nomad.vault.saveBoost({ id: b.id, enabled });
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onDelete(b) {
    if (!confirm(`Delete the Boost “${b.name}” for ${b.site}?`)) return;
    try {
      await nomad.vault.deleteBoost(b.id);
      if (this.editing?.id === b.id) this.editing = null;
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

// An error from bg arrives wrapped ("Error invoking remote method …: Error: …").
function cleanError(err) {
  return String(err?.message || err).replace(/^.*?Error: /, '');
}

customElements.define('boosts-view', BoostsView);
