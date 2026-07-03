import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

function mdToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    s
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const tokens = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code', code: codeLines.join('\n') });
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      tokens.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }
    if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      tokens.push({ type: 'list', items });
      continue;
    }
    if (line.trim() === '') {
      tokens.push({ type: 'blank' });
      i++;
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^[-*] /) &&
      !lines[i].match(/^#{1,3} /)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'para', lines: paraLines });
  }

  const parts = tokens.map((t) => {
    if (t.type === 'code') return `<pre><code>${esc(t.code)}</code></pre>`;
    if (t.type === 'heading') {
      const tag = `h${t.level}`;
      return `<${tag}>${inline(esc(t.text))}</${tag}>`;
    }
    if (t.type === 'list')
      return `<ul>${t.items.map((s) => `<li>${inline(esc(s))}</li>`).join('')}</ul>`;
    if (t.type === 'para') return `<p>${t.lines.map((l) => inline(esc(l))).join('<br>')}</p>`;
    return '';
  });
  return parts.join('') || `<p>${inline(esc(text))}</p>`;
}

class NomadChatBubble extends LitElement {
  static properties = {
    open: { type: Boolean },
    messages: { type: Array },
    draft: { type: String },
    streaming: { type: Boolean },
    sessionId: { type: String },
  };

  static styles = css`
    :host {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    }

    /* Bubble button */
    .bubble {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #0a84ff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
      transition:
        transform 0.15s,
        background 0.15s;
      position: relative;
      z-index: 1;
    }

    .bubble:hover {
      background: #0071e3;
      transform: scale(1.06);
    }
    .bubble:active {
      transform: scale(0.97);
    }

    .bubble svg {
      width: 26px;
      height: 26px;
      fill: #fff;
    }

    /* Panel */
    .panel {
      position: absolute;
      bottom: 68px;
      right: 0;
      width: 360px;
      height: 480px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: pop-in 0.18s cubic-bezier(0.34, 1.4, 0.64, 1);
    }

    @keyframes pop-in {
      from {
        opacity: 0;
        transform: scale(0.92) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    /* Header */
    .header {
      background: #0a84ff;
      color: #fff;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .header-title {
      font-weight: 600;
      font-size: 15px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.75);
      font-size: 18px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 4px;
      transition:
        color 0.1s,
        background 0.1s;
      display: flex;
      align-items: center;
    }

    .icon-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.15);
    }

    .icon-btn svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Messages */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .messages::-webkit-scrollbar {
      width: 4px;
    }
    .messages::-webkit-scrollbar-thumb {
      background: #d1d1d6;
      border-radius: 2px;
    }

    .msg {
      max-width: 85%;
      padding: 9px 12px;
      border-radius: 12px;
      line-height: 1.45;
      word-break: break-word;
      font-size: 13.5px;
    }

    .msg.user {
      white-space: pre-wrap;
    }

    .msg.assistant p,
    .msg.assistant h1,
    .msg.assistant h2,
    .msg.assistant h3,
    .msg.assistant ul,
    .msg.assistant pre {
      margin: 0 0 6px 0;
    }
    .msg.assistant p:last-child,
    .msg.assistant ul:last-child,
    .msg.assistant pre:last-child {
      margin-bottom: 0;
    }

    .msg.assistant h1 {
      font-size: 15px;
      font-weight: 700;
    }
    .msg.assistant h2 {
      font-size: 14px;
      font-weight: 700;
    }
    .msg.assistant h3 {
      font-size: 13.5px;
      font-weight: 600;
    }

    .msg.assistant ul {
      padding-left: 18px;
    }
    .msg.assistant li {
      margin-bottom: 2px;
    }

    .msg.assistant code {
      background: rgba(0, 0, 0, 0.08);
      border-radius: 3px;
      padding: 1px 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
    }

    .msg.assistant pre {
      background: rgba(0, 0, 0, 0.07);
      border-radius: 6px;
      padding: 8px 10px;
      overflow-x: auto;
    }
    .msg.assistant pre code {
      background: none;
      padding: 0;
      font-size: 12px;
    }

    .msg.user {
      background: #0a84ff;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .msg.assistant {
      background: #f2f2f7;
      color: #1d1d1f;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .msg.assistant.streaming::after {
      content: '▋';
      display: inline;
      animation: blink 0.8s step-end infinite;
      opacity: 0.6;
      margin-left: 1px;
    }

    @keyframes blink {
      0%,
      100% {
        opacity: 0.6;
      }
      50% {
        opacity: 0;
      }
    }

    .msg.error {
      background: #fff0f0;
      border: 1px solid #ffc0c0;
      color: #c0392b;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #8e8e93;
      font-size: 13px;
      text-align: center;
      padding: 20px;
      gap: 8px;
    }

    .empty-state svg {
      opacity: 0.3;
      width: 40px;
      height: 40px;
      fill: #8e8e93;
    }

    /* Input row */
    .input-row {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid #e5e5ea;
      flex-shrink: 0;
      background: #fff;
    }

    .input-row textarea {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid #d1d1d6;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13.5px;
      resize: none;
      outline: none;
      height: 36px;
      line-height: 1.4;
      transition: border-color 0.15s;
      overflow: hidden;
    }

    .input-row textarea:focus {
      border-color: #0a84ff;
    }

    .send-btn {
      padding: 0 14px;
      background: #0a84ff;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      height: 36px;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
      background: #0071e3;
    }
    .send-btn:disabled {
      background: #a0c4ff;
      cursor: default;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this.messages = [];
    this.draft = '';
    this.streaming = false;
    this._pendingReload = false;
    this.sessionId = this._loadSessionId() || this._createSessionId();
    this.messages = this._loadMessages(this.sessionId);
    this._watchDriveChanges();
  }

  // Reload the page when the AI writes to the drive.
  // If a change arrives mid-stream, defer the reload until streaming ends.
  _watchDriveChanges() {
    try {
      const drive = window.nomad?.hyperdrive?.drive(location.href);
      if (!drive) return;
      const watcher = drive.watch('/');
      watcher.addEventListener('changed', () => {
        if (this.streaming) {
          this._pendingReload = true;
        } else if (!this.draft) {
          location.reload();
        }
      });
    } catch {
      /* non-hyper page or API unavailable */
    }
  }

  // — Session persistence —

  get _prefix() {
    return `nomad-chat:${location.origin}`;
  }

  _loadSessionId() {
    return localStorage.getItem(`${this._prefix}:session-id`) || null;
  }

  _createSessionId() {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    localStorage.setItem(`${this._prefix}:session-id`, id);
    return id;
  }

  _loadMessages(id) {
    try {
      return JSON.parse(localStorage.getItem(`${this._prefix}:session:${id}`) || '[]');
    } catch {
      return [];
    }
  }

  _saveMessages() {
    localStorage.setItem(
      `${this._prefix}:session:${this.sessionId}`,
      JSON.stringify(this.messages)
    );
  }

  _newSession() {
    this.sessionId = this._createSessionId();
    this.messages = [];
    this._saveMessages();
    this.requestUpdate();
  }

  // — Render —

  render() {
    return html`
      ${this.open ? this.renderPanel() : ''}
      <button class="bubble" @click=${this._toggleOpen} title="Ask AI">
        ${this.open ? closeSvg() : chatSvg()}
      </button>
    `;
  }

  renderPanel() {
    const isStreaming = this.streaming;
    return html`
      <div class="panel">
        <div class="header">
          <span class="header-title">Ask AI</span>
          <div class="header-actions">
            <button class="icon-btn" title="New session" @click=${this._newSession}>
              ${newChatSvg()}
            </button>
            <button class="icon-btn" title="Close" @click=${this._toggleOpen}>${closeSvg()}</button>
          </div>
        </div>
        ${this.messages.length === 0
          ? html`
              <div class="empty-state">
                ${chatSvg()}
                <p>Ask a question about this page</p>
              </div>
            `
          : html`
              <div class="messages" ${scrollRef(this)}>
                ${this.messages.map(
                  (m, i) =>
                    html`<div
                      class="msg ${m.role}${i === this.messages.length - 1 && isStreaming
                        ? ' streaming'
                        : ''}"
                    >
                      ${m.role === 'assistant'
                        ? unsafeHTML(mdToHtml(m.content.trimStart()))
                        : m.content.trimStart()}
                    </div>`
                )}
              </div>
            `}
        <div class="input-row">
          <textarea
            .value=${this.draft}
            @input=${(e) => {
              this.draft = e.target.value;
            }}
            @keydown=${this._onKeydown}
            placeholder="Ask something…"
            ?disabled=${isStreaming}
          ></textarea>
          <button
            class="send-btn"
            @click=${this._send}
            ?disabled=${isStreaming || !this.draft.trim()}
          >
            Send
          </button>
        </div>
      </div>
    `;
  }

  // — Events —

  _toggleOpen() {
    this.open = !this.open;
    if (this.open) {
      this.updateComplete.then(() => this._scrollToBottom());
    }
  }

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  async _send() {
    const text = this.draft.trim();
    if (!text || this.streaming) return;

    this.draft = '';
    this.streaming = true;

    this.messages = [...this.messages, { role: 'user', content: text }];
    const assistantIdx = this.messages.length;
    this.messages = [...this.messages, { role: 'assistant', content: '' }];

    await this.updateComplete;
    this._scrollToBottom();

    try {
      const history = this.messages
        .slice(0, assistantIdx)
        .map((m) => ({ role: m.role, content: m.content }));

      for await (const chunk of window.nomad.ai.chat(history)) {
        const updated = [...this.messages];
        updated[assistantIdx] = {
          role: 'assistant',
          content: updated[assistantIdx].content + chunk,
        };
        this.messages = updated;
        await this.updateComplete;
        this._scrollToBottom();
      }
    } catch (err) {
      const updated = [...this.messages];
      updated[assistantIdx] = { role: 'error', content: `Error: ${err.message}` };
      this.messages = updated;
    } finally {
      this.streaming = false;
      this._saveMessages();
      if (this._pendingReload && !this.draft) {
        this._pendingReload = false;
        location.reload();
      }
    }
  }

  _scrollToBottom() {
    const el = this.shadowRoot?.querySelector('.messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

// Directive that auto-scrolls when new messages arrive
function scrollRef(host) {
  return (el) => {
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  };
}

function chatSvg() {
  return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2C6.477 2 2 6.253 2 11.5c0 2.303.84 4.414 2.228 6.062L2.5 21.5l4.313-1.37A10.07 10.07 0 0 0 12 21c5.523 0 10-4.253 10-9.5S17.523 2 12 2Z"
    />
  </svg>`;
}

function closeSvg() {
  return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M18 6 6 18M6 6l12 12"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      fill="none"
    />
  </svg>`;
}

function newChatSvg() {
  return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
  </svg>`;
}

if (!customElements.get('nomad-chat-bubble')) {
  customElements.define('nomad-chat-bubble', NomadChatBubble);
}
