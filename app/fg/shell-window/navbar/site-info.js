import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import * as bg from '../bg-process-rpc';
import buttonResetCSS from './button-reset.css';
import { isHyperOrPearUrl } from '../../../lib/urls';

class NavbarSiteInfo extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      siteTitle: { type: String },
      siteSubtitle: { type: String },
      siteName: { type: String },
      siteIcon: { type: String },
      siteTrust: { type: String },
      driveDomain: { type: String },
      driveIdent: { type: String },
      writable: { type: Boolean },
      isPressed: { type: Boolean },
      hideOrigin: { type: Boolean, attribute: 'hide-origin' },
      rounded: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.url = '';
    this.siteTitle = '';
    this.siteSubtitle = '';
    this.siteName = '';
    this.siteIcon = '';
    this.siteTrust = '';
    this.driveDomain = '';
    this.driveIdent = '';
    this.writable = false;
    this.isPressed = false;
    this.hideOrigin = false;
    this.rounded = false;
  }

  get scheme() {
    try {
      return new URL(this.url).protocol;
    } catch (e) {
      return '';
    }
  }

  get hostname() {
    try {
      return new URL(this.url).hostname;
    } catch (e) {
      return '';
    }
  }

  get isHyperdrive() {
    return isHyperOrPearUrl(this.url);
  }

  // rendering
  // =

  render() {
    var innerHTML;
    if (this.siteIcon || this.siteTitle) {
      innerHTML = html`
        ${this.siteIcon === 'nomad-logo'
          ? html`
              <svg class="nomad-logo" viewBox="38 38 948 948" aria-hidden="true">
                <path
                  fill-rule="evenodd"
                  d="M512 38a474 474 0 1 0 0 948a474 474 0 1 0 0-948zM302 265h145l275 472v21H579L302 283zM303 348l135 229v181H303zM585 265h137v413L585 443z"
                />
              </svg>
            `
          : html` <span class="${this.siteIcon} ${this.siteTrust}"></span> `}
        ${this.renderLabel()}
        ${this.siteSubtitle ? html`<span class="label sublabel">${this.siteSubtitle}</span>` : ''}
      `;
    }

    if (!innerHTML) {
      return html`<button class="hidden"></button>`;
    }

    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <button
        class=${classMap({
          [this.siteTrust]: true,
          pressed: this.isPressed,
          'hide-origin': this.hideOrigin,
          rounded: this.rounded,
        })}
        @click=${this.onClickButton}
      >
        ${innerHTML} ${this.renderHyperCtrls()}
      </button>
    `;
  }

  // A drive or app the user named (ADR-0018) shows a green tag with a check, and its name, in place
  // of its key. Focusing the location bar hides it, and the input shows the real URL.
  // A name the AI gave isn't shown until the user keeps it (bg/ui/tabs/pane.js siteName).
  renderLabel() {
    if (this.siteName && this.isHyperdrive) {
      return html`
        <span class="label site-name" title="Your name for this site: hyper://${this.siteName}/"
          ><svg class="name-icon" viewBox="0 0 15 13" aria-hidden="true">
            <path class="tag" d="M0.6 6.5 4.6 1.9A1.4 1.4 0 0 1 5.7 1.4H13a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 13 11.6H5.7a1.4 1.4 0 0 1-1.1-.5z" />
            <path class="check" d="M6.6 6.6l1.7 1.7 3.4-3.6" /></svg
          >${this.siteName}</span
        >
      `;
    }
    return html`<span class="label">${this.siteTitle}</span>`;
  }

  renderHyperCtrls() {
    if (!this.isHyperdrive) {
      return '';
    }
    if (this.writable) {
      if (['system', 'profile'].includes(this.driveIdent)) {
        return '';
      }
      return html`<span class="fas fa-fw fa-pen"></span>`;
    }
  }

  // events
  // =

  async onClickButton(e) {
    if (Date.now() - (this.lastButtonClick || 0) < 100) {
      return;
    }
    this.isPressed = true;
    var rect = e.currentTarget.getClientRects()[0];
    await bg.views.toggleSiteInfo({
      bounds: {
        top: rect.bottom | 0,
        left: rect.left | 0,
      },
    });
    this.isPressed = false;
    this.lastButtonClick = Date.now();
  }
}
NavbarSiteInfo.styles = [
  buttonResetCSS,
  css`
    :host {
      display: block;
      min-width: 5px;
    }

    button {
      border-radius: 0;
      border-top-left-radius: 16px;
      border-bottom-left-radius: 16px;
      height: 26px;
      line-height: 27px;
      padding: 0 12px 0 10px;
      background: var(--bg-color--cert--default);
      clip-path: polygon(0% 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host([autocomplete-open]) button {
      border-top-left-radius: 12px;
      border-bottom-left-radius: 0;
    }

    button:not(:disabled):hover {
      background: var(--bg-color--cert--default--hover);
    }

    button.trusted {
      background: var(--bg-color--cert--trusted);
    }

    button.trusted:hover {
      background: var(--bg-color--cert--trusted--hover);
    }

    button.untrusted {
      background: var(--bg-color--cert--untrusted);
    }

    button.untrusted:hover {
      background: var(--bg-color--cert--untrusted--hover);
    }

    button.hide-origin .label {
      display: none;
    }

    button.rounded {
      clip-path: none;
      border-radius: 16px;
      padding: 0 10px 0 10px;
      margin-right: 2px;
    }

    button.hidden {
      display: none;
    }

    .fa-exclamation-triangle,
    .fa-check-circle {
      font-size: 12.5px;
      line-height: 27px;
    }

    .fa-user-check {
      font-size: 12px;
      line-height: 27px;
    }

    .nomad-logo {
      width: 16px;
      height: 16px;
      position: relative;
      top: 3px;
      margin: 0 -2px;
    }

    /* The Nomad mark in one color: a disc with the N cut out of it, so the N shows the button's own
       background. Dark on the light theme, light on the dark one. */
    .nomad-logo path {
      fill: var(--text-color--location-input);
    }

    .fa-user {
      font-size: 9px;
      position: relative;
      top: -1px;
    }

    .label {
      margin-left: 2px;
      margin-right: 2px;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
      font-size: 12.5px;
      line-height: 27px;
      letter-spacing: 0.5px;
    }

    .label.sublabel {
      display: inline-block;
      height: 18px;
      line-height: 20px;
      border-radius: 4px;
      padding: 0 5px;
      background: var(--bg-color--cert-sublabel);
      color: var(--text-color--cert-sublabel);
    }

    /* The name of a drive the user named: a green tag with a check cut into it. The check is drawn in
       the button's own background, so it reads as a hole in the tag. */
    button {
      --site-info-bg: var(--bg-color--cert--default);
      --site-info-name-check: #2ea44f;
    }
    button:not(:disabled):hover {
      --site-info-bg: var(--bg-color--cert--default--hover);
    }
    button.trusted {
      --site-info-bg: var(--bg-color--cert--trusted);
    }
    button.trusted:not(:disabled):hover {
      --site-info-bg: var(--bg-color--cert--trusted--hover);
    }
    @media (prefers-color-scheme: dark) {
      button {
        --site-info-name-check: #3fb950;
      }
    }

    .name-icon {
      display: inline-block;
      width: 15px;
      height: 13px;
      vertical-align: -2px;
      margin-right: 4px;
    }

    .name-icon .tag {
      fill: var(--site-info-name-check);
    }

    .name-icon .check {
      fill: none;
      stroke: var(--site-info-bg);
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .notrust {
      color: var(--text-color--cert--notrust);
    }

    .trusted {
      color: var(--text-color--cert--trusted);
    }

    .secure {
      color: var(--text-color--cert--secure);
    }

    .warning {
      color: var(--text-color--cert--warning);
    }

    .untrusted {
      color: var(--text-color--cert--untrusted);
    }
  `,
];
customElements.define('shell-window-navbar-site-info', NavbarSiteInfo);
