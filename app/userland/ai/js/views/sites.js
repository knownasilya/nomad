import { LitElement, html, css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import commonCSS from '../../css/views/common.css.js';
import { cleanError, timeAgo, highlight } from '../util.js';

// The sites the user let their assistant send to for 3 months (bg/ai/send-grants.js, ADR-0037
// amendment). Once a chat has read the user's Notes, Reader, files or a page, a request to a new
// site asks first; that prompt's "Allow for 3 months" box puts the site here. Kept on this computer
// only. Extend gives a site another 3 months from today; Remove makes the next request ask again.
// Sites are added only from the prompt, never here.

const DAY_MS = 24 * 60 * 60 * 1000;

function endsIn(until, now = Date.now()) {
  const days = Math.ceil((until - now) / DAY_MS);
  if (days <= 1) return 'Ends today';
  if (days < 14) return `Ends in ${days} days`;
  if (days < 60) return `Ends in ${Math.round(days / 7)} weeks`;
  return `Ends in ${Math.round(days / 30)} months`;
}

const dateOf = (t) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

class AiSitesView extends LitElement {
  static get properties() {
    return {
      query: { type: String },
      grants: { type: Array },
      days: { type: Number },
      error: { type: String },
    };
  }

  static get styles() {
    return [commonCSS, viewCSS];
  }

  constructor() {
    super();
    this.query = '';
    this.grants = undefined; // undefined = loading
    this.days = 90;
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
    // A prompt in any window adds a site while this page is open.
    try {
      this._watch = nomad.aiSites.watch();
      this._watch.addEventListener('changed', () => this.load());
    } catch {}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    try {
      this._watch?.close?.();
    } catch {}
  }

  async load() {
    try {
      const res = await nomad.aiSites.list();
      this.grants = res.grants || [];
      this.days = res.days || this.days;
      this.error = '';
    } catch (err) {
      this.grants = [];
      this.error = cleanError(err);
    }
  }

  render() {
    if (typeof this.grants === 'undefined') return html`<div class="notice">Loading…</div>`;
    const words = (this.query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = this.grants.filter((g) => words.every((w) => g.host.includes(w)));
    const months = Math.round(this.days / 30);
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <h2>Sites</h2>
      <div class="intro">
        Once a chat has read your Notes, Reader, files or a page, the assistant asks before it sends a
        request to a site you didn’t name. The sites below you allowed for ${months} months, so it sends
        to them without asking, in any chat and in your Jobs. They’re kept on this computer only.
      </div>
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${shown.length === 0
        ? words.length
          ? html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-search"></span></div>
              <h3>No sites match “${this.query.trim()}”</h3>
            </div>`
          : html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-paper-plane"></span></div>
              <h3>No sites allowed</h3>
              <p>
                When the assistant asks to send a request to a site, tick “Allow for ${months} months”
                and the site shows up here.
              </p>
            </div>`
        : html`
            <div class="toolbar">
              <span>${shown.length} ${shown.length === 1 ? 'site' : 'sites'}</span>
            </div>
            ${repeat(shown, (g) => g.host, (g) => this.renderGrant(g, words, months))}
          `}
    `;
  }

  renderGrant(g, words, months) {
    const soon = g.until - Date.now() < 14 * DAY_MS;
    return html`
      <div class="card">
        <div class="row-head">
          <div class="row-icon"><span class="fas fa-globe"></span></div>
          <div class="meta">
            <div class="text host">${highlight(g.host, words)}</div>
            <div class="summary">
              <span class=${soon ? 'soon' : ''} title=${`Until ${dateOf(g.until)}`}
                >${endsIn(g.until)}</span
              >
              · Allowed ${timeAgo(g.grantedAt)}
            </div>
          </div>
          <div class="actions">
            <button
              class="extend"
              title=${`Allow ${g.host} for another ${months} months from today`}
              @click=${() => this.onExtend(g)}
            >
              Extend ${months} months
            </button>
            <button
              class="icon danger"
              title=${`Remove ${g.host}`}
              aria-label=${`Remove ${g.host}`}
              @click=${() => this.onRemove(g)}
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

  async onExtend(g) {
    try {
      const next = await nomad.aiSites.extend(g.host);
      await this.load();
      toast.create(`${g.host} is allowed until ${dateOf(next.until)}`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onRemove(g) {
    try {
      await nomad.aiSites.remove(g.host);
      this.grants = this.grants.filter((x) => x.host !== g.host);
      toast.create(`The assistant will ask before sending to ${g.host}`);
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

const viewCSS = css`
  .meta .host {
    padding-top: 1px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .meta .summary {
    margin-top: 2px;
  }

  .summary .soon {
    color: var(--ai-sites-soon, #b26b00);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .actions .extend {
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    .summary .soon {
      color: var(--ai-sites-soon, #f0b429);
    }
  }
`;

customElements.define('ai-sites-view', AiSitesView);
