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
      vouches: { type: Object },
      showOthers: { type: Boolean },
    };
  }

  static get styles() {
    return [identityCSS];
  }

  constructor() {
    super();
    this.url = undefined;
    this.cert = undefined;
    this.vouches = null; // nomad.personas.profileVouches(url) on a Profile Drive (ADR-0045)
    this.showOthers = false;
    this.loadedFor = null;
  }

  updated(changed) {
    if ((changed.has('cert') || changed.has('url')) && this.cert?.ident?.person && this.url !== this.loadedFor) {
      this.loadedFor = this.url;
      this.loadVouches();
    }
  }

  async loadVouches() {
    const url = this.url;
    try {
      const v = await nomad.personas.profileVouches(url);
      if (url === this.url) this.vouches = v;
    } catch {
      this.vouches = null;
    }
  }
  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${this.cert
        ? html`
            ${this.cert.type === 'nomad'
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
                  ${this.cert.ident && this.cert.ident.person
                    ? html`
                        <div class="field-group person-actions">
                          <button
                            style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;font-size:13px"
                            @click=${this.onMessage}
                          >
                            <span class="fa-fw fas fa-comment"></span> Message
                          </button>
                          <button class="vouch-btn" @click=${this.onVouch} title="Say you’ve had this person over at your home">
                            <span class="fa-fw fas fa-home"></span> I’ve had them over
                          </button>
                        </div>
                        ${this.renderVouches()}
                      `
                    : ''}
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
                  ${this.cert.ident && this.cert.ident.calendar
                    ? html`
                        <div class="field-group">
                          <button
                            style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;font-size:13px"
                            @click=${this.onFollowCalendar}
                          >
                            <span class="fa-fw fas fa-calendar-alt"></span> Follow in
                            Calendar
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

  // Who has had this person over (ADR-0045 §6): Vouches from people the viewer knows by name, the
  // rest folded into one line. Never a total, never a badge.
  renderVouches() {
    const v = this.vouches;
    if (!v || !v.readable || (!v.known.length && !v.others.length)) return '';
    const guest = this.cert?.driveInfo?.title || 'them';
    const row = (it) => {
      const host = it.host?.title || shortKey(it.vouch.host);
      return html`
        <li class="vouch">
          ${it.host?.thumbUrl
            ? html`<img class="vouch-avatar" src=${it.host.thumbUrl} alt="" @error=${(e) => (e.target.style.visibility = 'hidden')} />`
            : html`<span class="vouch-avatar initial">${host.slice(0, 1).toUpperCase()}</span>`}
          <span class="vouch-text">
            <span><strong>${host}</strong> has had ${guest} over${it.state === 'unreachable' ? html` <span class="muted">(couldn’t check)</span>` : ''}</span>
            ${it.vouch.note ? html`<span class="vouch-note">“${it.vouch.note}”</span>` : ''}
            <code class="muted" title=${it.vouch.host}>${shortKey(it.vouch.host)}</code>
          </span>
        </li>
      `;
    };
    return html`
      <div class="field-group vouches">
        <div class="vouches-title">Who has had them over</div>
        <ul class="vouch-list">${repeat(v.known, (it) => it.vouch.id, row)}</ul>
        ${v.others.length
          ? this.showOthers
            ? html`<ul class="vouch-list others">${repeat(v.others, (it) => it.vouch.id, row)}</ul>`
            : html`<button class="link-btn" @click=${() => (this.showOthers = true)}>
                ${v.others.length} more from people you don’t know
              </button>`
          : ''}
        <div class="muted vouches-hint">Someone says so; it isn’t proof. Weigh it by whether you know who said it.</div>
      </div>
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

  // A new message to this Profile Drive, from the Persona this window's Space uses (ADR-0036 §7.2).
  async onMessage() {
    if (!this.url) return;
    const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(this.url);
    if (!m) return;
    const persona = await nomad.inbox.tabPersona().catch(() => null);
    const q = `to=${encodeURIComponent(`hyper://${m[1].toLowerCase()}/`)}${persona ? `&persona=${encodeURIComponent(persona)}` : ''}`;
    nomad.browser.openUrl(`nomad://messages/new?${q}`, { setActive: true });
  }

  // Give this person a Vouch: My Library → Personas, with the form filled in.
  async onVouch() {
    const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(this.url || '');
    if (!m) return;
    const persona = await nomad.personas.tabPersona().catch(() => null);
    const q = `vouch=${encodeURIComponent(`hyper://${m[1].toLowerCase()}/`)}${persona ? `&persona=${encodeURIComponent(persona)}` : ''}`;
    nomad.browser.openUrl(`nomad://library/personas?${q}`, { setActive: true });
  }

  onSubscribe() {
    if (!this.url) return;
    // Open in a TAB via the browser API — NOT window.open. The site-info panel is a subwindow, so
    // window.open there creates a standalone OS window with no `nomad` bridge injected, and the
    // Reader then throws `nomad is not defined`. openUrl routes to a real tab in the current Space
    // (the same call the rest of site-info uses to open drive URLs).
    nomad.browser.openUrl('nomad://reader/?subscribe=' + encodeURIComponent(this.url), {
      setActive: true,
    });
  }

  // A calendar drive: open nomad://calendar with its address in the Follow box (the user follows it
  // there, so nothing is added without a click on the calendar's own page).
  onFollowCalendar() {
    const m = /^hyper:\/\/([0-9a-z]{52,64})/i.exec(this.url || '');
    if (!m) return;
    nomad.browser.openUrl('nomad://calendar/?follow=' + encodeURIComponent(`hyper://${m[1].toLowerCase()}/`), {
      setActive: true,
    });
  }
}

function shortKey(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(String(url || ''));
  return m ? `hyper://${m[1].slice(0, 6)}…${m[1].slice(-4)}/` : String(url || '');
}

customElements.define('identity-signals', Identity);
