import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

// Minimal markdown -> HTML (headings, lists, code fences, inline emphasis/code).
// Mirrors the renderer used by the shell's chat-bubble.
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

class AiSidebar extends LitElement {
  static get properties() {
    return {
      // the editor-app instance (set as a property, not an attribute) — used to
      // gate on unsaved changes and to reload files the agent writes
      host: { type: Object },
      url: { type: String },
      readOnly: { type: Boolean },
      messages: { type: Array },
      draft: { type: String },
      streaming: { type: Boolean },
    };
  }

  // Shadow DOM (like files-explorer) — a light-DOM child nested inside
  // editor-app's own light DOM gets clobbered when editor-app re-renders.
  static styles = css`
    :host {
      /* height comes from the host app's positioning (editor: absolute top/bottom;
         explorer: fixed height:100vh) — do NOT set height:100% here or it overrides
         the bottom constraint and pushes the input row off-screen. */
      display: flex;
      flex-direction: column;
      min-height: 0;
      color: #ddd;
      font-size: 13px;
    }
    .ai-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 6px 6px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .ai-title {
      font-weight: 600;
      font-size: 12px;
    }
    .ai-header-actions button {
      background: transparent;
      border: 0;
      color: #eee9;
      cursor: pointer;
      padding: 4px 6px;
    }
    .ai-header-actions button:hover:not(:disabled) {
      color: #fff;
    }
    .ai-header-actions button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .ai-note {
      font-size: 11px;
      color: #eec98a;
      background: rgba(255, 200, 120, 0.08);
      padding: 6px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .ai-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
      color: #eee7;
      font-size: 12px;
      font-style: italic;
    }
    .ai-messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      /* Firefox */
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
    }
    /* WebKit — match the dark sidebar instead of the default light bar */
    .ai-messages::-webkit-scrollbar {
      width: 8px;
    }
    .ai-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .ai-messages::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.16);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    .ai-messages::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.28);
      background-clip: padding-box;
    }
    .ai-activity {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 2px 2px 4px;
      font-size: 12px;
    }
    .ai-activity-item {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #9aa;
    }
    .ai-activity-item.active {
      color: #dde;
    }
    .ai-activity-item .fa-check {
      color: #7bb07b;
    }
    .ai-msg {
      max-width: 88%;
      font-size: 13px;
      line-height: 1.45;
      padding: 8px 12px;
      border-radius: 12px;
      word-break: break-word;
      white-space: normal;
    }
    .ai-msg.user {
      background: #2f6ae0;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      white-space: pre-wrap;
    }
    .ai-msg.assistant {
      background: #333;
      color: #eee;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .ai-msg.error {
      background: #3a2020;
      border: 1px solid #7a3b3b;
      color: #f3b0b0;
    }
    .ai-msg.streaming::after {
      content: '▋';
      opacity: 0.6;
      margin-left: 1px;
    }
    .ai-msg.assistant p,
    .ai-msg.assistant ul,
    .ai-msg.assistant pre,
    .ai-msg.assistant h1,
    .ai-msg.assistant h2,
    .ai-msg.assistant h3 {
      margin: 0 0 6px 0;
    }
    .ai-msg.assistant > *:last-child {
      margin-bottom: 0;
    }
    .ai-msg.assistant code {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 12px;
    }
    .ai-msg.assistant pre {
      background: rgba(0, 0, 0, 0.35);
      border-radius: 6px;
      padding: 8px 10px;
      overflow-x: auto;
    }
    .ai-msg.assistant pre code {
      background: none;
      padding: 0;
    }
    .ai-checkpoint {
      align-self: flex-start;
      max-width: 88%;
      margin: -2px 0 2px;
      padding: 6px 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      font-size: 11px;
    }
    .ai-checkpoint.reverted {
      opacity: 0.55;
    }
    .ai-file {
      color: #cfe0cf;
      padding: 1px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ai-revert {
      margin-top: 4px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #eee;
      border-radius: 6px;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .ai-revert:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
    }
    .ai-reverted-label {
      color: #eee9;
      font-style: italic;
    }
    .ai-input-row {
      display: flex;
      gap: 6px;
      padding: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .ai-input {
      flex: 1;
      resize: none;
      height: 52px;
      background: #2a2a2a;
      color: #eee;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 7px 9px;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .ai-input:focus {
      border-color: #2f6ae0;
    }
    .ai-send {
      flex-shrink: 0;
      align-self: stretch;
      background: #2f6ae0;
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 0 14px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition:
        background 0.15s ease,
        transform 0.06s ease;
    }
    .ai-send:hover:not(:disabled) {
      background: #3d78ef;
    }
    .ai-send:active:not(:disabled) {
      transform: translateY(1px);
    }
    .ai-send:disabled {
      background: #3a4a6a;
      color: #aab;
      cursor: default;
    }
    /* Respect reduced-motion: no spinner, no button push, no transitions. */
    @media (prefers-reduced-motion: reduce) {
      .ai-activity-item .fa-spin {
        animation: none;
      }
      .ai-send,
      .ai-input {
        transition: none;
      }
      .ai-send:active:not(:disabled) {
        transform: none;
      }
    }
  `;

  constructor() {
    super();
    this.host = undefined;
    this.url = '';
    this.readOnly = true;
    this.messages = [];
    this.draft = '';
    this.streaming = false;
    this._loadedOrigin = undefined;
    // transient live tool activity for the in-flight turn (not persisted)
    this._activity = [];
  }

  // — persistence (keyed per Drive) —

  get _origin() {
    try {
      return new URL(this.url).origin;
    } catch {
      return '';
    }
  }

  get _storeKey() {
    return `nomad-ai-sidebar:${this._origin}`;
  }

  _loadSession() {
    try {
      this.messages = JSON.parse(localStorage.getItem(this._storeKey) || '[]');
    } catch {
      this.messages = [];
    }
    this._loadedOrigin = this._origin;
  }

  _saveSession() {
    try {
      localStorage.setItem(this._storeKey, JSON.stringify(this.messages));
    } catch {
      /* quota / serialization — non-fatal */
    }
  }

  _newSession() {
    if (this.streaming) return;
    this.messages = [];
    this._saveSession();
    this.requestUpdate();
  }

  updated() {
    // reload the transcript when the editor navigates to a different Drive
    if (this._origin && this._origin !== this._loadedOrigin) {
      this._loadSession();
    }
  }

  // — render —

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="ai-header">
        <span class="ai-title"><span class="fas fa-fw fa-robot"></span> AI</span>
        <span class="ai-header-actions">
          <button
            class="transparent"
            title="New session"
            @click=${this._newSession}
            ?disabled=${this.streaming}
          >
            <span class="fas fa-fw fa-plus"></span>
          </button>
          <button class="transparent" title="Close" @click=${() => this.host?.closeAiSidebar()}>
            <span class="fas fa-fw fa-times"></span>
          </button>
        </span>
      </div>
      ${this.readOnly
        ? html`<div class="ai-note">
            This drive is read-only. Chat is available, but the agent can't edit files.
          </div>`
        : ''}
      ${this.messages.length === 0
        ? html`<div class="ai-empty">
            Ask the agent to explain or edit this drive.${this.readOnly ? '' : ' Edits apply directly to the drive; use Revert to undo a turn.'}
          </div>`
        : html`<div class="ai-messages">
            ${this.messages.map((m, i) => this._renderMessage(m, i))}
            ${this.streaming && !(this.messages[this.messages.length - 1]?.content || '').trim()
              ? this._renderActivity()
              : ''}
          </div>`}
      <div class="ai-input-row">
        <textarea
          class="ai-input"
          .value=${this.draft}
          placeholder=${this.readOnly ? 'Ask about this drive…' : 'Ask the agent to edit this drive…'}
          @input=${(e) => (this.draft = e.target.value)}
          @keydown=${this._onKeydown}
          ?disabled=${this.streaming}
        ></textarea>
        <button
          class="primary ai-send"
          @click=${this._send}
          ?disabled=${this.streaming || !this.draft.trim()}
        >
          Send
        </button>
      </div>
    `;
  }

  _renderMessage(m, i) {
    const streamingLast = i === this.messages.length - 1 && this.streaming;
    // IMPORTANT: keep the body expression flush against the tags (`>${body}</div>`).
    // The user bubble is `white-space: pre-wrap`, so any newline/indentation the
    // template puts between the tag and the expression renders as blank lines
    // inside the bubble.
    const body =
      m.role === 'assistant'
        ? unsafeHTML(mdToHtml((m.content || '').trim()))
        : (m.content || '').trim();
    return html`
      <div class="ai-msg ${m.role}${streamingLast ? ' streaming' : ''}">${body}</div>
      ${m.files && m.files.length ? this._renderCheckpoint(m, i) : ''}
    `;
  }

  // live "what the agent is doing" indicator, shown while a turn is streaming
  _renderActivity() {
    const items = this._activity;
    return html`
      <div class="ai-activity">
        ${items.length === 0
          ? html`<div class="ai-activity-item active">
              <span class="fas fa-fw fa-spinner fa-spin"></span> Thinking…
            </div>`
          : items.map(
              (a, i) => html`<div
                class="ai-activity-item ${i === items.length - 1 ? 'active' : ''}"
              >
                <span
                  class="fas fa-fw ${i === items.length - 1
                    ? 'fa-spinner fa-spin'
                    : 'fa-check'}"
                ></span>
                ${a.summary}
              </div>`
            )}
      </div>
    `;
  }

  _renderCheckpoint(m, i) {
    return html`
      <div class="ai-checkpoint ${m.reverted ? 'reverted' : ''}">
        <div class="ai-checkpoint-files">
          ${m.files.map(
            (f) => html`<div class="ai-file">
              <span class="fas fa-fw fa-${f.priorContent === null ? 'plus' : 'pen'}"></span>
              ${f.path}
            </div>`
          )}
        </div>
        ${m.reverted
          ? html`<span class="ai-reverted-label">Reverted</span>`
          : html`<button
              class="ai-revert"
              @click=${() => this._revertTurn(i)}
              ?disabled=${this.streaming}
            >
              <span class="fas fa-fw fa-undo"></span> Revert this turn
            </button>`}
      </div>
    `;
  }

  // — events —

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  async _send() {
    const text = this.draft.trim();
    if (!text || this.streaming) return;

    if (!window.nomad?.ai?.chat) {
      this.messages = [
        ...this.messages,
        { role: 'error', content: 'AI API unavailable in this context.' },
      ];
      return;
    }

    // gate on unsaved editor changes so the agent works from clean drive state
    if (this.host) {
      const ok = await this.host.prepareForAgentRun();
      if (!ok) return;
    }

    this.draft = '';
    this.streaming = true;
    this._activity = [];

    this.messages = [...this.messages, { role: 'user', content: text }];
    const assistantIdx = this.messages.length;
    // one Checkpoint per assistant turn: files[] captures {path, priorContent}
    this.messages = [...this.messages, { role: 'assistant', content: '', files: [] }];
    await this.updateComplete;
    this._scrollToBottom();

    const onToolEvent = (e) => {
      if (e.phase === 'start') {
        // live activity — what the agent is doing right now
        this._activity = [...this._activity, { name: e.name, summary: e.summary }];
      } else if (e.phase === 'write' && e.path) {
        // record each write into this turn's checkpoint (first prior wins per path)
        // and reload the affected file in the host app
        const msg = this.messages[assistantIdx];
        if (!msg.files.some((f) => f.path === e.path)) {
          msg.files = [...msg.files, { path: e.path, priorContent: e.priorContent ?? null }];
          this.messages = [...this.messages];
        }
        this.host?.onAgentWroteFile(e.path);
      }
      this.requestUpdate();
      this._scrollToBottom();
    };

    try {
      const history = this.messages
        .slice(0, assistantIdx)
        .map((m) => ({ role: m.role, content: m.content }));

      // ephemeral per-send context (drive + open file) — pins the agent to the
      // right paths; not persisted into the transcript
      const context =
        typeof this.host?.getAgentContext === 'function' ? this.host.getAgentContext() : undefined;

      let lastPaint = performance.now();
      for await (const chunk of window.nomad.ai.chat(history, {
        driveUrl: this.url,
        allowWrite: !this.readOnly,
        context,
        onToolEvent,
      })) {
        const updated = [...this.messages];
        updated[assistantIdx] = {
          ...updated[assistantIdx],
          content: (updated[assistantIdx].content || '') + chunk,
        };
        this.messages = updated;
        // Throttle the paint to ~animation-frame cadence. Lit flushes updates on
        // a microtask, which never yields to the compositor — so a fast/localhost
        // model that delivers many chunks in one burst would render all at once.
        // Yielding to requestAnimationFrame lets each frame paint progressively.
        const now = performance.now();
        if (now - lastPaint >= 16) {
          await this.updateComplete;
          this._scrollToBottom();
          await new Promise((r) => requestAnimationFrame(r));
          lastPaint = performance.now();
        }
      }
      // paint whatever remains after the final (sub-frame) chunk
      await this.updateComplete;
      this._scrollToBottom();
    } catch (err) {
      console.error('[ai-sidebar] chat failed:', err);
      const updated = [...this.messages];
      // replace the assistant turn with an error (chat-bubble behavior), but keep
      // any checkpoint files so writes made before the error can still be reverted
      updated[assistantIdx] = {
        role: 'error',
        content: `Error: ${err.message}`,
        files: updated[assistantIdx]?.files || [],
      };
      this.messages = updated;
    } finally {
      this.streaming = false;
      this._activity = [];
      this._saveSession();
      this.requestUpdate();
    }
  }

  async _revertTurn(msgIndex) {
    const msg = this.messages[msgIndex];
    if (!msg || !msg.files || msg.reverted || this.streaming) return;
    const drive = window.nomad.fs.drive(this.url);
    // restore in reverse write order
    for (const f of [...msg.files].reverse()) {
      try {
        if (f.priorContent === null) {
          // file was created this turn — remove it
          await drive.unlink(f.path);
        } else {
          await drive.writeFile(f.path, f.priorContent);
        }
        this.host?.onAgentWroteFile(f.path);
      } catch (e) {
        console.error('[ai-sidebar] revert failed for', f.path, e);
      }
    }
    msg.reverted = true;
    this.messages = [...this.messages];
    this._saveSession();
    this.requestUpdate();
  }

  _scrollToBottom() {
    const el = this.renderRoot.querySelector('.ai-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

customElements.define('ai-sidebar', AiSidebar);
