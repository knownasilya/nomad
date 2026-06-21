import {
  LitElement,
  html,
} from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { emit } from '../../../app-stdlib/js/dom.js';
import identityCSS from '../../css/com/identity.css.js';

class Identity extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      cert: { type: Object },
    };
  }

  static get styles() {
    return [identityCSS];
  }

  constructor() {
    super();
    this.url = undefined;
    this.cert = undefined;
  }
  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      ${this.cert
        ? html`
            ${this.cert.type === 'beaker'
              ? html`
                  <div class="field-group">
                    This is a builtin interface of Nomad
                  </div>
                `
              : ''}
            ${this.cert.type === 'tls'
              ? html`
                  <div class="field-group">
                    <div class="identity">
                      <span class="fa-fw fas fa-address-card"></span>
                      ${this.cert.subjectName}
                    </div>
                    <div class="verifier">
                      Issued by ${this.cert.issuerName}
                    </div>
                  </div>
                `
              : ''}
            ${this.cert.type === 'hyperdrive'
              ? html`
                  ${this.cert.ident.profile
                    ? html`
                        <div class="field-group">
                          <div class="identity">This is your profile site</div>
                        </div>
                      `
                    : this.cert.ident.system
                    ? html`
                        <div class="field-group">
                          <div class="identity">This is your private drive</div>
                        </div>
                      `
                    : this.cert.driveInfo.writable
                    ? html`
                        <div class="field-group">
                          <div class="identity">
                            You created this Hyperdrive
                          </div>
                        </div>
                      `
                    : html`
                        <div class="field-group">
                          No identity information found
                        </div>
                      `}
                  ${this.cert.ident && this.cert.ident.feed
                    ? html`
                        <div class="field-group">
                          <button
                            style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;font-size:13px"
                            @click=${this.onSubscribe}
                          >
                            <span class="fa-fw fas fa-rss"></span> Subscribe in
                            Reader
                          </button>
                        </div>
                      `
                    : ''}
                `
              : ''}
          `
        : html` <div class="field-group">No identity information found</div> `}
    `;
  }

  // ${this.renderSignal({icon: 'fab fa-twitter', url: 'https://twitter.com/pfrazee', userid: 'pfrazee', directory})}
  // ${this.renderSignal({icon: 'fab fa-github', url: 'https://github.com/pfrazee', userid: 'pfrazee', directory})}
  // renderSignal (signal) {
  //   return html`
  //     <div class="identity">
  //       <span class="fa-fw ${signal.icon}"></span>
  //       <a href=${signal.url}>${signal.userid}</a>
  //     </div>
  //     <div class="verifier">
  //       Verified by <a href=${signal.directory.url}>${signal.directory.title}</a>
  //     </div>
  //   `
  // }

  // events
  // =

  onSubscribe() {
    if (!this.url) return;
    window.open('beaker://reader/?subscribe=' + encodeURIComponent(this.url));
  }
}

customElements.define('identity-signals', Identity);
