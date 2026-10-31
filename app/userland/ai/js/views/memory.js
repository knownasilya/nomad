import { LitElement, html, css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import commonCSS from '../../css/views/common.css.js';
import { cleanError, timeAgo, highlight } from '../util.js';

// What the user's assistant remembers about them (bg/ai/memory.js, ADR-0032): short facts the
// assistant saves with `remember` in the AI sidebar, or the user adds here. Every one goes into the
// assistant's instructions on each of the user's own chats. Vault records, so they sync to linked
// devices. The `ai_memory` setting turns it all off.

const MAX_TEXT = 500;

class AiMemoryView extends LitElement {
  static get properties() {
    return {
      query: { type: String },
      memories: { type: Array },
      enabled: { type: Boolean },
      max: { type: Number },
      draft: { type: String },
      editing: { type: Object },
      error: { type: String },
    };
  }

  static get styles() {
    return [commonCSS, viewCSS];
  }

  constructor() {
    super();
    this.query = '';
    this.memories = undefined; // undefined = loading
    this.enabled = true;
    this.max = 200;
    this.draft = '';
    this.editing = null; // { id, text, error }
    this.error = '';
    this._timer = null;
    this._seq = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
    // The assistant remembers things in the sidebar, and linked devices change them too.
    try {
      this._watch = nomad.vault.watchAppData();
      this._watch.addEventListener('changed', () => this.load());
    } catch {}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    try {
      this._watch?.close?.();
    } catch {}
  }

  updated(changed) {
    if (changed.has('query') && changed.get('query') !== undefined) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.load(), 150);
    }
  }

  async load() {
    const seq = ++this._seq;
    try {
      const res = await nomad.vault.listMemories({ query: this.query || '' });
      if (seq !== this._seq) return;
      this.memories = res.memories || [];
      this.enabled = res.enabled !== false;
      this.max = res.max || this.max;
    } catch (err) {
      if (seq !== this._seq) return;
      this.memories = [];
      this.error = cleanError(err);
    }
  }

  render() {
    if (typeof this.memories === 'undefined') return html`<div class="notice">Loading…</div>`;
    const searching = !!(this.query || '').trim();
    const words = (this.query || '').trim().split(/\s+/).filter(Boolean);
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <h2>Memory</h2>
      <div class="intro">
        Things the assistant keeps about you between chats, like how you like answers or what your
        drives are for. It saves one when you tell it something worth keeping (“remember that I use
        metric units”), and it reads all of them at the start of each of your chats in the AI sidebar
        and on your phone. Pages that use AI never see them. Memories sync to your linked devices.
      </div>

      <div class="card setting">
        <div class="row-head">
          <label class="switch" title=${this.enabled ? 'On' : 'Off'}>
            <input
              type="checkbox"
              .checked=${this.enabled}
              aria-label="Let the assistant remember things about you"
              @change=${(e) => this.onToggle(e.target.checked)}
            />
            <span class="track"></span>
          </label>
          <div class="meta">
            <div class="title">Let the assistant remember things about you</div>
            <div class="summary">
              ${this.enabled
                ? 'On. The assistant asks your permission before it first saves or forgets something.'
                : 'Off. Your chats don’t get these memories, and the assistant can’t save new ones.'}
            </div>
          </div>
        </div>
      </div>

      <form class="card add ${this.enabled ? '' : 'off'}" @submit=${this.onAdd}>
        <textarea
          rows="2"
          maxlength=${MAX_TEXT}
          placeholder="Add something for the assistant to remember, e.g. “I live in Lisbon and prefer metric units.”"
          aria-label="New memory"
          .value=${this.draft}
          @input=${(e) => {
            this.draft = e.target.value;
            this.error = '';
          }}
          @keydown=${(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.onAdd(e);
          }}
        ></textarea>
        <div class="add-foot">
          <span class="count">${this.draft.length}/${MAX_TEXT}</span>
          ${this.error ? html`<span class="error">${this.error}</span>` : ''}
          <button type="submit" class="primary" ?disabled=${!this.draft.trim()}>Remember</button>
        </div>
      </form>

      ${this.memories.length === 0
        ? searching
          ? html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-search"></span></div>
              <h3>No memories match “${this.query.trim()}”</h3>
            </div>`
          : html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-brain"></span></div>
              <h3>Nothing remembered yet</h3>
              <p>
                Tell the assistant something about yourself in the AI sidebar and ask it to remember,
                or add it above.
              </p>
            </div>`
        : html`
            <div class="toolbar">
              <span>
                ${this.memories.length} ${this.memories.length === 1 ? 'memory' : 'memories'}${searching
                  ? ' found'
                  : ` of ${this.max}`}
              </span>
              ${searching
                ? ''
                : html`<button class="link danger-text" @click=${this.onClear}>Forget everything</button>`}
            </div>
            ${repeat(this.memories, (m) => m.id, (m) => this.renderMemory(m, words))}
          `}
    `;
  }

  renderMemory(m, words) {
    const e = this.editing?.id === m.id ? this.editing : null;
    const by = m.by === 'user' ? 'Added by you' : 'Saved by the assistant';
    return html`
      <div class="card ${e ? 'editing' : ''} ${this.enabled ? '' : 'off'}">
        ${e
          ? html`<form class="edit" @submit=${(ev) => this.onSaveEdit(ev, m)}>
              <textarea
                rows="2"
                maxlength=${MAX_TEXT}
                aria-label="Memory"
                .value=${e.text}
                @input=${(ev) => (this.editing = { ...e, text: ev.target.value, error: '' })}
                @keydown=${(ev) => {
                  if (ev.key === 'Escape') this.editing = null;
                  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) this.onSaveEdit(ev, m);
                }}
              ></textarea>
              ${e.error ? html`<div class="error">${e.error}</div>` : ''}
              <div class="buttons">
                <button type="submit" class="primary">Save</button>
                <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
              </div>
            </form>`
          : html`<div class="row-head">
              <div class="row-icon ${m.by === 'user' ? 'user' : ''}">
                <span class="fas ${m.by === 'user' ? 'fa-user' : 'fa-brain'}"></span>
              </div>
              <div class="meta">
                <div class="text">${highlight(m.text, words)}</div>
                <div class="summary">${by} · ${timeAgo(m.updatedAt)}</div>
              </div>
              <div class="actions">
                <button class="icon" title="Edit" aria-label="Edit memory" @click=${() => this.onEdit(m)}>
                  <span class="fas fa-fw fa-pen"></span>
                </button>
                <button class="icon danger" title="Forget" aria-label="Forget memory" @click=${() => this.onDelete(m)}>
                  <span class="fas fa-fw fa-trash"></span>
                </button>
              </div>
            </div>`}
      </div>
    `;
  }

  // events
  // =

  async onToggle(on) {
    this.enabled = on;
    try {
      await nomad.browser.setSetting('ai_memory', on ? 1 : 0);
      toast.create(on ? 'The assistant can remember things about you' : 'Memory is off');
    } catch (err) {
      this.enabled = !on;
      toast.create(cleanError(err), 'error');
    }
  }

  async onAdd(e) {
    e.preventDefault();
    const text = this.draft.trim();
    if (!text) return;
    try {
      const rec = await nomad.vault.saveMemory({ text });
      this.draft = '';
      await this.load();
      toast.create(rec?.existed ? 'Already remembered' : 'Remembered', 'success');
    } catch (err) {
      this.error = cleanError(err);
    }
  }

  onEdit(m) {
    this.editing = { id: m.id, text: m.text, error: '' };
    this.updateComplete.then(() => {
      const el = this.shadowRoot.querySelector('.edit textarea');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  async onSaveEdit(ev, m) {
    ev.preventDefault();
    const e = this.editing;
    try {
      await nomad.vault.saveMemory({ id: m.id, text: e.text });
      this.editing = null;
      await this.load();
    } catch (err) {
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  async onDelete(m) {
    try {
      await nomad.vault.deleteMemory(m.id);
      if (this.editing?.id === m.id) this.editing = null;
      this.memories = this.memories.filter((x) => x.id !== m.id);
      toast.create('Forgotten');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onClear() {
    const n = this.memories.length;
    if (!confirm(`Forget all ${n} ${n === 1 ? 'memory' : 'memories'}? The assistant starts fresh. This can’t be undone.`)) return;
    try {
      await nomad.vault.clearMemories();
      await this.load();
      toast.create('Forgot everything');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

const viewCSS = css`
  .setting {
    margin-bottom: 12px;
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
  }

  .add textarea,
  .edit textarea {
    min-height: 54px;
  }

  .add-foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .add-foot .count {
    font-size: 11px;
    color: var(--text-color--pretty-light);
  }

  .add-foot button {
    margin-left: auto;
  }

  .edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row-head {
    align-items: flex-start;
  }

  .row-icon.user {
    background: var(--bg-color--semi-light);
    color: var(--text-color--light);
  }

  .meta .text {
    padding-top: 1px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .meta .summary {
    margin-top: 2px;
  }

  .card.off {
    opacity: 0.6;
  }
`;

customElements.define('ai-memory-view', AiMemoryView);
