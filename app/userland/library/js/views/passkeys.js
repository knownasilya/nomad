import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import modsCSS from '../../css/views/mods.css.js';
import secretsCSS from '../../css/views/secrets.css.js';
import passkeysCSS from '../../css/views/passkeys.css.js';

// The passkeys Nomad keeps for websites on this computer (bg/passkeys/store.js, ADR-0049). Sites make
// them in Nomad's own prompt when you sign up or add a passkey to your account; this page lists them
// by site and deletes them. A key never leaves the keychain, and nothing here can show one.
//
// ?site=<rp id> shows one site's.

export class PasskeysView extends LitElement {
  static get properties() {
    return {
      passkeys: { type: Array },
      status: { type: Object },
      filter: { type: String },
    };
  }

  static get styles() {
    return [modsCSS, secretsCSS, passkeysCSS];
  }

  constructor() {
    super();
    this.passkeys = undefined; // undefined = loading
    this.status = { ok: true };
    this.filter = undefined;
    this.site = new URLSearchParams(location.search).get('site') || null;
    this.load();
    // A site makes or uses one while this page is open.
    try {
      nomad.passkeys.watch().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      const [list, status] = await Promise.all([nomad.passkeys.list(), nomad.passkeys.getStatus()]);
      this.passkeys = list;
      this.status = status;
    } catch {
      this.passkeys = [];
    }
  }

  filtered() {
    const f = (this.filter || '').toLowerCase();
    return (this.passkeys || []).filter(
      (p) =>
        (!this.site || p.rpId === this.site) &&
        (!f ||
          p.rpId.includes(f) ||
          p.userName.toLowerCase().includes(f) ||
          p.displayName.toLowerCase().includes(f) ||
          p.rpName.toLowerCase().includes(f))
    );
  }

  render() {
    if (typeof this.passkeys === 'undefined') return html`<div class="empty">Loading…</div>`;
    const rows = this.filtered();
    const groups = new Map();
    for (const p of rows) groups.set(p.rpId, [...(groups.get(p.rpId) || []), p]);
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        A passkey signs you in to a website without a password. When a site offers to make one, Nomad
        saves it here, and asks you before any site uses it. Passkeys stay on this computer, encrypted
        with its keychain: they don’t sync to your other devices or go into shared spaces. To sign in
        with a passkey you keep somewhere else, pick “Use a phone or security key” in the prompt.
      </div>
      ${this.status.ok ? '' : html`<div class="notice">${this.status.reason}</div>`}
      ${this.site
        ? html`<div class="toolbar">
            <span class="site-filter">Passkeys for <strong>${this.site}</strong></span>
            <button @click=${this.onAllSites}>Show all sites</button>
          </div>`
        : ''}
      ${rows.length === 0
        ? html`<div class="empty">
            ${this.passkeys.length
              ? 'No passkeys match.'
              : 'No passkeys yet. When a site offers to make a passkey, Nomad saves it here.'}
          </div>`
        : [...groups].map(([rpId, list]) => this.renderGroup(rpId, list))}
    `;
  }

  renderGroup(rpId, list) {
    const origin = list[0].origin || `https://${rpId}`;
    return html`
      <div class="group">
        <div class="group-head">
          <img src="asset:favicon:${origin}/" alt="" @error=${(e) => (e.target.style.visibility = 'hidden')} />
          <span class="site">${rpId}</span>
        </div>
        ${repeat(list, (p) => p.id, (p) => this.renderPasskey(p))}
      </div>
    `;
  }

  renderPasskey(p) {
    const a = account(p);
    return html`
      <div class="card">
        <div class="row-head">
          <span class="key"><span class="fas fa-fw fa-key" aria-hidden="true"></span></span>
          <div class="meta">
            <div class="title">${a.title}${a.sub ? html` <span class="sub">· ${a.sub}</span>` : ''}</div>
            <div class="summary">${summary(p)}</div>
          </div>
          <div class="actions">
            <button
              class="icon danger"
              title="Delete passkey"
              aria-label="Delete the passkey for ${a.title} on ${p.rpId}"
              @click=${() => this.onDelete(p)}
            >
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // events
  // =

  onAllSites() {
    this.site = null;
    history.replaceState({}, '', location.pathname);
    this.requestUpdate();
  }

  async onDelete(p) {
    const a = account(p);
    if (
      !confirm(
        `Delete the passkey for ${a.title} on ${p.rpId}? You won’t be able to sign in with it again. The site still lists it until you remove it in your account settings there.`
      )
    )
      return;
    try {
      await nomad.passkeys.remove(p.id);
      await this.load();
      toast.create('Passkey deleted', 'success');
    } catch (err) {
      toast.create(String(err?.message || err).replace(/^.*?Error: /, ''), 'error');
    }
  }
}

function account(p) {
  const name = p.userName || '';
  const display = p.displayName || '';
  if (display && name && display !== name) return { title: display, sub: name };
  return { title: display || name || 'Unnamed account', sub: '' };
}

function summary(p) {
  const parts = [`Saved ${ago(p.createdAt)}`];
  parts.push(p.lastUsedAt ? `last used ${ago(p.lastUsedAt)}` : 'not used yet');
  if (p.rpName && p.rpName.toLowerCase() !== p.rpId) parts.push(p.rpName);
  return parts.join(' · ');
}

// "5 minutes ago", "yesterday", or a date.
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}

customElements.define('passkeys-view', PasskeysView);
