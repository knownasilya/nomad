import { LitElement, html, css } from 'lit';

class NomadChatBubble extends LitElement {
  static properties = {
    open: { type: Boolean },
    messages: { type: Array },
    draft: { type: String },
    streaming: { type: Boolean },
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
      box-shadow: 0 4px 16px rgba(0,0,0,.22);
      transition: transform .15s, background .15s;
      position: relative;
      z-index: 1;
    }

    .bubble:hover { background: #0071e3; transform: scale(1.06); }
    .bubble:active { transform: scale(.97); }

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
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: pop-in .18s cubic-bezier(.34,1.4,.64,1);
    }

    @keyframes pop-in {
      from { opacity: 0; transform: scale(.92) translateY(8px); }
      to   { opacity: 1; transform: scale(1)   translateY(0);   }
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

    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: rgba(255,255,255,.75);
      font-size: 20px;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      transition: color .1s;
    }

    .close-btn:hover { color: #fff; }

    /* Messages */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-thumb { background: #d1d1d6; border-radius: 2px; }

    .msg {
      max-width: 85%;
      padding: 9px 12px;
      border-radius: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13.5px;
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
      display: inline-block;
      animation: blink .8s step-end infinite;
      opacity: .6;
      margin-left: 1px;
    }

    @keyframes blink {
      0%, 100% { opacity: .6; }
      50%       { opacity: 0;  }
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
      opacity: .3;
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
      transition: border-color .15s;
      overflow: hidden;
    }

    .input-row textarea:focus { border-color: #0a84ff; }

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
      transition: background .15s;
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) { background: #0071e3; }
    .send-btn:disabled { background: #a0c4ff; cursor: default; }
  `;

  constructor() {
    super();
    this.open = false;
    this.messages = [];
    this.draft = '';
    this.streaming = false;
  }

  render() {
    return html`
      ${this.open ? this.renderPanel() : ''}
      <button class="bubble" @click=${this._toggleOpen} title="Ask AI">
        ${this.open ? closeSvg() : chatSvg()}
      </button>
    `;
  }

  renderPanel() {
    return html`
      <div class="panel">
        <div class="header">
          <span class="header-title">Ask AI</span>
          <button class="close-btn" @click=${this._toggleOpen}>×</button>
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
                ${this.messages.map((m, i) => html`
                  <div class="msg ${m.role}${i === this.messages.length - 1 && this.streaming ? ' streaming' : ''}">
                    ${m.content}
                  </div>
                `)}
              </div>
            `
        }
        <div class="input-row">
          <textarea
            .value=${this.draft}
            @input=${e => { this.draft = e.target.value; }}
            @keydown=${this._onKeydown}
            placeholder="Ask something…"
            ?disabled=${this.streaming}
          ></textarea>
          <button class="send-btn" @click=${this._send} ?disabled=${this.streaming || !this.draft.trim()}>
            Send
          </button>
        </div>
      </div>
    `;
  }

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
        .map(m => ({ role: m.role, content: m.content }));

      for await (const chunk of window.beaker.ai.chat(history)) {
        const updated = [...this.messages];
        updated[assistantIdx] = { role: 'assistant', content: updated[assistantIdx].content + chunk };
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
      // scroll to bottom on initial render of messages container
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  };
}

function chatSvg() {
  return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.477 2 2 6.253 2 11.5c0 2.303.84 4.414 2.228 6.062L2.5 21.5l4.313-1.37A10.07 10.07 0 0 0 12 21c5.523 0 10-4.253 10-9.5S17.523 2 12 2Z"/>
  </svg>`;
}

function closeSvg() {
  return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6 6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </svg>`;
}

if (!customElements.get('nomad-chat-bubble')) {
  customElements.define('nomad-chat-bubble', NomadChatBubble);
}
