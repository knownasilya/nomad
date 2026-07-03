import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import inputsCSS from './inputs.css';
import buttonsCSS from './buttons.css';
import spinnerCSS from './spinner.css';
import './img-fallbacks.js';

class AddDriveModal extends LitElement {
  static get properties() {
    return {
      info: { type: Object },
      error: { type: String },
    };
  }

  static get styles() {
    return [
      commonCSS,
      inputsCSS,
      buttonsCSS,
      spinnerCSS,
      css`
        form {
          padding: 0;
          margin: 0;
        }
        .loading {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 20px;
          font-size: 13px;
          border-bottom: 1px solid var(--m-border);
          color: var(--m-text-light);
        }
        .error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 20px;
          font-size: 13px;
          color: #d93229;
          border-bottom: 1px solid var(--m-border);
          background: #fff8f8;
        }
        .drive {
          display: flex;
          align-items: center;
          padding: 14px 20px;
          border-bottom: 1px solid var(--m-border);
          gap: 14px;
        }
        .drive img {
          border-radius: 8px;
          object-fit: cover;
          width: 56px;
          height: 56px;
          flex-shrink: 0;
          border: 1px solid var(--m-border);
        }
        .drive .title {
          font-size: 15px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--m-text-default);
        }
        .drive .description {
          font-size: 12px;
          color: var(--m-text-light);
          margin-top: 2px;
        }
        .drive .info {
          flex: 1;
          min-width: 0;
        }
        .tags {
          padding: 10px 20px 0;
        }
        .form-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          gap: 8px;
        }
      `,
    ];
  }

  constructor() {
    super();
    this.cbs = undefined;
    this.tags = '';
    this.info = undefined;
    this.error = undefined;
  }

  init(params, cbs) {
    this.url = params.url;
    this.tags = params.tags || '';
    this.cbs = cbs;
    this.info = undefined;
    this.error = undefined;
    this.requestUpdate();
    this.tryFetch();
  }

  async tryFetch() {
    try {
      this.error = undefined;
      var info = await bg.fs.getInfo(this.url);
      if (info.version === 0) {
        this.error = 'Unable to find this site on the network';
      } else {
        this.info = info;
        this.tags = Array.from(new Set(info.tags.concat(this.tags.split(' ')))).join(' ');
      }
    } catch (e) {
      this.cbs.reject(e.message);
    }
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <h1 class="title">Add Hyperdrive to My Library</h1>
        <form @submit=${this.onSubmit}>
          ${this.error
            ? html`
                <div class="error">
                  <span class="fas fa-fw fa-exclamation-circle"></span> ${this.error}
                </div>
              `
            : this.info
              ? html`
                  <div class="drive">
                    <nomad-img-fallbacks>
                      <img src="${this.info.url}/thumb" slot="img1" />
                      <img src="nomad://assets/default-thumb" slot="img2" />
                    </nomad-img-fallbacks>
                    <div class="info">
                      <div class="title"><span>${this.info.title}</span></div>
                      <div class="description">
                        <span>${this.info.description}</span>
                      </div>
                    </div>
                  </div>
                `
              : html`
                  <div class="loading"><span class="spinner"></span> Loading drive info...</div>
                `}
          ${this.info
            ? html`
                <div class="tags">
                  <label for="tags-input">Tags</label>
                  <input
                    id="tags-input"
                    @change=${this.onChangeTags}
                    value=${this.tags || ''}
                    placeholder="Tags (optional, separated by spaces)"
                  />
                </div>
              `
            : ''}
          <div class="form-actions">
            <button type="button" @click=${this.onClickCancel} class="btn cancel" tabindex="4">
              Cancel
            </button>
            ${this.error
              ? html` <button type="submit" class="btn primary" tabindex="5">Try Again</button> `
              : html`
                  <button type="submit" class="btn primary" tabindex="5" ?disabled=${!this.info}>
                    OK
                  </button>
                `}
          </div>
        </form>
      </div>
    `;
  }

  // event handlers
  // =

  updated() {
    // adjust size based on rendering
    var height = this.shadowRoot.querySelector('div').scrollHeight;
    bg.modals.resizeSelf({ height });
  }

  onChangeTags(e) {
    this.tags = e.currentTarget.value;
  }

  onClickCancel(e) {
    e.preventDefault();
    this.cbs.reject(new Error('Canceled'));
  }

  async onSubmit(e) {
    e.preventDefault();
    if (this.info) {
      this.cbs.resolve({ key: this.info.key, tags: this.tags.split(' ') });
    } else {
      this.tryFetch();
    }
  }
}

customElements.define('add-drive-modal', AddDriveModal);
