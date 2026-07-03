/* globals nomad */
import {
  html,
  css,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { BasePopup } from 'nomad://app-stdlib/js/com/popups/base.js';
import popupsCSS from 'nomad://app-stdlib/css/com/popups.css.js';
import { addContact } from '../lib/contacts.js';

// exported api
// =

export class AddContactPopup extends BasePopup {
  constructor() {
    super();
    this.errorMsg = '';
  }

  static get properties() {
    return {
      errorMsg: { type: String },
    };
  }

  static get styles() {
    return [
      popupsCSS,
      css`
        .popup-inner {
          width: 500px;
        }
        .error {
          color: var(--text-color--error, #d80b22);
          margin: 8px 0 0;
          font-size: 13px;
        }
        .hint {
          color: var(--text-color--light);
          font-size: 12px;
          margin: 2px 0 8px;
        }
      `,
    ];
  }

  // management
  //

  static async create() {
    return BasePopup.create(AddContactPopup);
  }

  static destroy() {
    return BasePopup.destroy('add-contact-popup');
  }

  // rendering
  // =

  renderTitle() {
    return 'New contact';
  }

  renderBody() {
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <form @submit=${this.onSubmit}>
        <div>
          <label for="key-input">Hyperdrive link or key</label>
          <input
            required
            type="text"
            id="key-input"
            name="key"
            placeholder="hyper://… or a 64-character key"
          />
          <div class="hint">Paste the person's hyper:// address or public key.</div>

          <label for="title-input">Name</label>
          <input
            type="text"
            id="title-input"
            name="title"
            placeholder="E.g. Alice"
          />

          <label for="desc-input">Note</label>
          <input
            type="text"
            id="desc-input"
            name="description"
            placeholder="Optional"
          />
        </div>

        ${this.errorMsg ? html`<p class="error">${this.errorMsg}</p>` : ''}

        <div class="actions">
          <button type="button" class="btn" @click=${this.onReject} tabindex="2">
            Cancel
          </button>
          <button type="submit" class="btn primary" tabindex="1">Add contact</button>
        </div>
      </form>
    `;
  }

  updated() {
    this.shadowRoot.querySelector('input').focus();
  }

  // events
  // =

  async onSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    this.errorMsg = '';
    try {
      let key = await addContact({
        key: e.target.key.value,
        title: e.target.title.value,
        description: e.target.description.value,
      });
      this.dispatchEvent(new CustomEvent('resolve', { detail: { key } }));
    } catch (err) {
      this.errorMsg = err.message || String(err);
    }
  }
}

customElements.define('add-contact-popup', AddContactPopup);
