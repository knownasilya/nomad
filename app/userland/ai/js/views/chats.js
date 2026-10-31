import { LitElement, html, css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import commonCSS from '../../css/views/common.css.js';
import { cleanError, timeAgo, highlight } from '../util.js';

// The AI Sidebar's saved chats (bg/ai/chat-store.js, in hyper://private/.ai-chat/): one list for the
// user, not one per site (ADR-0021). Search their names and messages, read one, give it a name,
// delete it, or open it in the sidebar of this window to carry on.

const DAY = 24 * 60 * 60 * 1000;

// "Today", "Yesterday", "Previous 7 days", "Previous 30 days", then the month.
function groupOf(ts, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return 'Today';
  if (ts >= start - DAY) return 'Yesterday';
  if (ts >= start - 7 * DAY) return 'Previous 7 days';
  if (ts >= start - 30 * DAY) return 'Previous 30 days';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

class AiChatsView extends LitElement {
  static get properties() {
    return {
      query: { type: String },
      chats: { type: Array },
      lastId: { type: String },
      openId: { type: String },
      transcript: { type: Object },
      renaming: { type: Object },
    };
  }

  static get styles() {
    return [commonCSS, viewCSS];
  }

  constructor() {
    super();
    this.query = '';
    this.chats = undefined; // undefined = loading
    this.lastId = null;
    this.openId = null; // the chat whose messages are shown
    this.transcript = null; // its messages
    this.renaming = null; // { id, value }
    this._timer = null;
    this._seq = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
    // Coming back to the tab after chatting in the sidebar shows the new chats.
    this._onVisible = () => document.visibilityState === 'visible' && this.load();
    document.addEventListener('visibilitychange', this._onVisible);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._onVisible);
  }

  updated(changed) {
    if (changed.has('query') && changed.get('query') !== undefined) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.load(), 200);
    }
  }

  async load() {
    const seq = ++this._seq;
    try {
      const res = await nomad.aiChats.list({ query: this.query || '' });
      if (seq !== this._seq) return;
      this.chats = res.chats || [];
      this.lastId = res.lastId || null;
    } catch (err) {
      if (seq !== this._seq) return;
      this.chats = [];
      toast.create(cleanError(err), 'error');
    }
  }

  grouped(rows) {
    const out = new Map();
    for (const c of rows) {
      const g = groupOf(c.updatedAt || 0);
      if (!out.has(g)) out.set(g, []);
      out.get(g).push(c);
    }
    return [...out];
  }

  render() {
    if (typeof this.chats === 'undefined') return html`<div class="notice">Loading…</div>`;
    const searching = !!(this.query || '').trim();
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <h2>Chats</h2>
      <div class="intro">
        Your conversations with the assistant in the AI sidebar. They’re kept in your private drive, so
        your other devices in this Space have them too. Open one to carry on where you left off.
      </div>
      ${this.chats.length === 0
        ? searching
          ? html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-search"></span></div>
              <h3>No chats match “${this.query.trim()}”</h3>
              <p>Search looks at each chat’s name and every message in it.</p>
            </div>`
          : html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-comments"></span></div>
              <h3>No chats yet</h3>
              <p>Open the AI sidebar from the location bar, or start one here.</p>
              <button class="primary" @click=${() => nomad.aiChats.openNew()}>New chat</button>
            </div>`
        : html`
            <div class="toolbar">
              <span>${this.chats.length} ${this.chats.length === 1 ? 'chat' : 'chats'}${searching ? ' found' : ''}</span>
            </div>
            ${this.grouped(this.chats).map(
              ([group, rows]) => html`
                <div class="group-head">${group}</div>
                ${repeat(rows, (c) => c.id, (c) => this.renderChat(c))}
              `
            )}
          `}
    `;
  }

  renderChat(c) {
    const open = this.openId === c.id;
    const renaming = this.renaming?.id === c.id ? this.renaming : null;
    const words = (this.query || '').trim().split(/\s+/).filter(Boolean);
    const count = `${c.messageCount} ${c.messageCount === 1 ? 'message' : 'messages'}`;
    return html`
      <div class="card ${open ? 'open' : ''}">
        <div class="row-head">
          <div class="row-icon"><span class="fas fa-comment-alt"></span></div>
          ${renaming
            ? html`<form class="rename" @submit=${(e) => this.onRenameSave(e, c)}>
                <input
                  aria-label="Chat name"
                  .value=${renaming.value}
                  placeholder=${c.named ? '' : c.title || 'New chat'}
                  maxlength="80"
                  @input=${(e) => (this.renaming = { ...renaming, value: e.target.value })}
                  @keydown=${(e) => e.key === 'Escape' && (this.renaming = null)}
                />
                <button type="submit" class="primary">Save</button>
                <button type="button" @click=${() => (this.renaming = null)}>Cancel</button>
              </form>`
            : html`<div class="meta clickable" @click=${() => this.toggle(c)}>
                <div class="title">
                  ${highlight(c.title || 'New chat', words)}
                  ${c.id === this.lastId ? html`<span class="badge" title="The chat the AI sidebar opens with">In sidebar</span>` : ''}
                </div>
                <div class="summary">${count} · ${timeAgo(c.updatedAt)}</div>
                ${c.snippet
                  ? html`<div class="snippet">${highlight(c.snippet, words)}</div>`
                  : !open && c.preview
                    ? html`<div class="snippet">${c.preview}</div>`
                    : ''}
              </div>`}
          ${renaming
            ? ''
            : html`<div class="actions">
                <button class="open-btn" title="Open in the AI sidebar" @click=${() => this.onOpen(c)}>
                  <span class="fas fa-columns"></span> Open
                </button>
                <button class="icon" title="Rename" aria-label="Rename ${c.title}" @click=${() => this.onRename(c)}>
                  <span class="fas fa-fw fa-pen"></span>
                </button>
                <button class="icon danger" title="Delete" aria-label="Delete ${c.title}" @click=${() => this.onDelete(c)}>
                  <span class="fas fa-fw fa-trash"></span>
                </button>
              </div>`}
        </div>
        ${open ? this.renderTranscript(words) : ''}
      </div>
    `;
  }

  renderTranscript(words) {
    if (!this.transcript) return html`<div class="transcript"><div class="summary">Loading…</div></div>`;
    const rows = this.transcript.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()
    );
    if (!rows.length) return html`<div class="transcript"><div class="summary">This chat is empty.</div></div>`;
    return html`
      <div class="transcript">
        ${rows.map(
          (m) => html`
            <div class="msg ${m.role}">
              <div class="who">${m.role === 'user' ? 'You' : 'Assistant'}</div>
              <div class="text">${highlight(m.content.trim(), words)}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  // events
  // =

  async toggle(c) {
    if (this.openId === c.id) {
      this.openId = null;
      this.transcript = null;
      return;
    }
    this.openId = c.id;
    this.transcript = null;
    try {
      const data = await nomad.aiChats.load(c.id);
      if (this.openId === c.id) this.transcript = data?.messages || [];
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onOpen(c) {
    try {
      await nomad.aiChats.open(c.id);
      this.lastId = c.id;
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  onRename(c) {
    this.renaming = { id: c.id, value: c.named ? c.title : '' };
    this.updateComplete.then(() => this.shadowRoot.querySelector('.rename input')?.focus());
  }

  async onRenameSave(e, c) {
    e.preventDefault();
    try {
      await nomad.aiChats.rename(c.id, this.renaming?.value || '');
      this.renaming = null;
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onDelete(c) {
    if (!confirm(`Delete the chat “${c.title || 'New chat'}”? This can’t be undone.`)) return;
    try {
      await nomad.aiChats.remove(c.id);
      if (this.openId === c.id) {
        this.openId = null;
        this.transcript = null;
      }
      this.chats = this.chats.filter((x) => x.id !== c.id);
      toast.create('Chat deleted');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

const viewCSS = css`
  .card .snippet {
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .open-btn .fas {
    margin-right: 3px;
    font-size: 11px;
  }

  .rename {
    flex: 1;
    display: flex;
    gap: 8px;
  }

  .rename input {
    flex: 1;
    min-width: 0;
  }

  .transcript {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 420px;
    overflow-y: auto;
    margin: 12px -14px -10px;
    padding: 12px 14px;
    border-top: 1px solid var(--border-color--very-light);
    border-radius: 0 0 10px 10px;
    background: var(--bg-color--secondary);
  }

  .msg {
    max-width: 92%;
  }

  .msg.user {
    align-self: flex-end;
  }

  .msg .who {
    margin-bottom: 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-color--pretty-light);
  }

  .msg.user .who {
    text-align: right;
  }

  .msg .text {
    padding: 7px 10px;
    border-radius: 10px;
    background: var(--bg-color--default);
    border: 1px solid var(--border-color--very-light);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .msg.user .text {
    background: var(--ai-accent-soft);
    border-color: transparent;
  }
`;

customElements.define('ai-chats-view', AiChatsView);
