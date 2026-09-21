import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';

const DEFAULT_DURATION_MS = 3000;

class ToastPrompt extends LitElement {
  static get properties() {
    return {
      message: { type: String },
    };
  }

  static get styles() {
    return [
      css`
        .wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
        }
        .fa-check-circle {
          color: #26b872;
        }
        .message {
          flex: 1;
        }
        .close-btn {
          background: transparent;
          border: 0;
          padding: 0;
          margin: 0;
          color: #999;
          cursor: pointer;
        }
        .close-btn:hover {
          color: #333;
        }
      `,
    ];
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.message = '';
    clearTimeout(this._closeTimeout);
  }

  async init(params) {
    this.message = (params && params.message) || '';
    await this.requestUpdate();
    this.scheduleAutoClose((params && params.duration) ?? DEFAULT_DURATION_MS);
  }

  scheduleAutoClose(duration) {
    clearTimeout(this._closeTimeout);
    if (duration > 0) {
      this._closeTimeout = setTimeout(() => bg.prompts.close(), duration);
    }
  }

  onClickClose() {
    clearTimeout(this._closeTimeout);
    bg.prompts.close();
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <span class="fas fa-check-circle"></span>
        <span class="message">${this.message}</span>
        <button class="close-btn" @click=${this.onClickClose} title="Dismiss">
          <span class="fas fa-times"></span>
        </button>
      </div>
    `;
  }
}

customElements.define('toast-prompt', ToastPrompt);
