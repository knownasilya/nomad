import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import inputsCSS from './inputs.css';
import buttonsCSS from './buttons2.css';
import { ucfirst, joinPath } from '../../lib/strings';

class DrivePropertiesModal extends LitElement {
  static get styles() {
    return [
      commonCSS,
      inputsCSS,
      buttonsCSS,
      css`
        form {
          padding: 0;
          margin: 0;
        }

        .props {
          border-bottom: 1px solid var(--m-border);
        }

        .prop {
          display: flex;
          align-items: center;
          border-bottom: 1px solid var(--m-border);
          min-height: 38px;
        }

        .prop:last-child {
          border-bottom: 0;
        }

        .prop .key {
          flex: 0 0 110px;
          padding: 8px 10px 8px 20px;
          border-right: 1px solid var(--m-border);
          font-size: 12px;
          font-weight: 500;
          color: var(--m-text-light);
          align-self: stretch;
          display: flex;
          align-items: center;
          background: var(--m-bg-secondary);
        }

        .prop input[type='text'] {
          flex: 1;
          font-size: 13px;
          padding: 0 12px;
          border-radius: 0;
          border: 0;
          height: 38px;
          background: transparent;
          color: var(--m-text-default);
        }

        .prop input[type='text']:focus {
          box-shadow: inset 0 0 0 2px rgba(64, 64, 231, 0.25);
          background: rgba(64, 64, 231, 0.03);
        }

        .prop .img-input {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
        }

        .prop img {
          width: 32px;
          height: 32px;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid var(--m-border);
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
    this.url = '';
    this.writable = false;
    this.thumbPath = null;
    this.props = {};
  }

  async init(params, cbs) {
    this.cbs = cbs;
    this.url = params.url;
    this.writable = params.writable;
    this.thumbPath = params.thumbPath || null;
    this.props = params.props || {};
    this.props.title = this.props.title || '';
    this.props.description = this.props.description || '';
    this.props.tags = this.props.tags?.join(' ') || '';
    await this.requestUpdate();
    this.adjustHeight();
  }

  adjustHeight() {
    var height = this.shadowRoot.querySelector('div').scrollHeight;
    bg.modals.resizeSelf({ height });
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      <div class="wrapper">
        <h1 class="title">Hyperdrive Properties</h1>

        <form @submit=${this.onSubmit}>
          <div class="props">
            ${repeat(
              Object.entries(this.props),
              (entry) => entry[0],
              (entry) => this.renderProp(...entry)
            )}

            <div class="prop">
              <div class="key">Thumbnail</div>
              <div class="img-input">
                <img src="${this.url}/${this.thumbPath || 'thumb'}" />
                <input
                  id="thumb-input"
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  ?disabled=${!this.writable}
                />
              </div>
            </div>
          </div>

          <div class="form-actions">
            <button
              type="button"
              @click=${this.onClickCancel}
              class="cancel"
              tabindex="5"
            >
              Cancel
            </button>
            <button type="submit" class="primary" tabindex="4">OK</button>
          </div>
        </form>
      </div>
    `;
  }

  renderProp(key, value) {
    var writable = key === 'tags' || this.writable;
    return html`
      <div class="prop ${writable ? 'writable' : ''}">
        <div class="key">${ucfirst(key)}</div>
        <input
          type="text"
          name=${key}
          value=${value}
          ?readonly=${!writable}
          @change=${this.onInputChange}
        />
      </div>
    `;
  }

  // event handlers
  // =

  onInputChange(e) {
    this.requestUpdate();
  }

  onClickCancel(e) {
    e.preventDefault();
    this.cbs.resolve();
  }

  async onSubmit(e) {
    e.preventDefault();

    var newProps = Object.fromEntries(new FormData(e.currentTarget));
    newProps.tags = newProps.tags.split(' ');

    // handle thumb file
    var thumbInput = this.shadowRoot.querySelector('#thumb-input');
    if (thumbInput.files[0]) {
      let file = thumbInput.files[0];
      let ext = file.name.split('.').pop();
      let reader = new FileReader();
      let bufPromise = new Promise((resolve, reject) => {
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
      });
      reader.readAsArrayBuffer(file);

      await Promise.all([
        bg.hyperdrive
          .unlink(joinPath(this.url, '/thumb.png'))
          .catch((e) => null),
        bg.hyperdrive
          .unlink(joinPath(this.url, '/thumb.jpg'))
          .catch((e) => null),
        bg.hyperdrive
          .unlink(joinPath(this.url, '/thumb.jpeg'))
          .catch((e) => null),
      ]);
      let newThumbPath = `thumb.${ext}`;
      await bg.hyperdrive.writeFile(
        joinPath(this.url, `/${newThumbPath}`),
        await bufPromise
      );
      newProps.thumb = newThumbPath;
    }

    // handle props (configure also awaits asset cache update)
    await bg.hyperdrive.configure(this.url, newProps).catch((e) => null);

    this.cbs.resolve();
  }
}

customElements.define('drive-properties-modal', DrivePropertiesModal);
