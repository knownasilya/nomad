import {
  LitElement,
  html,
} from 'lit';
import viewCSS from '../../css/views/security.css.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';

class SecuritySettingsView extends LitElement {
  static get properties() {
    return {
      exceptions: { type: Array },
    };
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.exceptions = [];
  }

  async load() {
    this.exceptions = (await nomad.browser.getCertExceptions()) || [];
    this.requestUpdate();
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="form-group">
        <h2>Trusted Domains (Certificate Bypass)</h2>
        ${this.renderExceptionsList()}
        <p class="hint">
          Domains listed here will load even when their SSL certificate is invalid or
          does not match the hostname. Use only for local development servers.
        </p>
      </div>
    `;
  }

  renderExceptionsList() {
    if (!this.exceptions || this.exceptions.length === 0) {
      return html`<div class="empty-state">No trusted domains added yet.</div>`;
    }
    return html`
      <div class="domain-list">
        ${this.exceptions.map(
          (hostname) => html`
            <div class="domain-row">
              <span class="domain-name">${hostname}</span>
              <button
                class="remove-btn"
                @click=${() => this.onClickRemove(hostname)}
                title="Remove"
              >
                <span class="fas fa-times"></span> Remove
              </button>
            </div>
          `
        )}
      </div>
    `;
  }

  // events
  // =

  async onClickRemove(hostname) {
    await nomad.browser.removeCertException(hostname);
    this.exceptions = await nomad.browser.getCertExceptions();
    toast.create(`Removed ${hostname} from trusted domains`);
    this.requestUpdate();
  }
}

customElements.define('security-settings-view', SecuritySettingsView);
