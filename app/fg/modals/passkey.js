import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import buttonsCSS from './buttons2.css';

// The passkey prompt (ADR-0049): a website asked to save a passkey or to sign in with one. bg
// (bg/ui/passkeys.js) opens it with what it read itself (the site from the frame, the account the
// site named, the matching passkeys) and gets back { action: 'allow', id? }, { action: 'fallback' }
// (use the computer's own WebAuthn: a phone or a security key), or { action: 'deny' }. Nothing a
// page draws can press these buttons, which is why a click here counts as the user's yes.
//
//   kind 'create'  save a new passkey for `account`
//   kind 'exists'  the site's account already has a Nomad passkey (the site gets InvalidStateError)
//   kind 'get'     sign in with one of `passkeys`
//   kind 'none'    no Nomad passkey for this site on this computer

class PasskeyModal extends LitElement {
  static get properties() {
    return {
      p: { type: Object },
      pickedId: { type: String },
    };
  }

  constructor() {
    super();
    this.cbs = null;
    this.p = null;
    this.pickedId = null;
  }

  async init(params, cbs) {
    this.cbs = cbs;
    document.body.classList.add('themed');
    this.p = params || {};
    this.pickedId = this.p.passkeys?.[0]?.id || null;
    await this.requestUpdate();
    this.shadowRoot.querySelector('button.primary')?.focus();
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.modals.resizeSelf({ width: 420, height: el.scrollHeight });
  }

  get title() {
    switch (this.p.kind) {
      case 'create':
        return 'Save a passkey';
      case 'exists':
        return 'This passkey is already saved';
      case 'none':
        return 'No passkey for this site';
      default:
        return 'Sign in with a passkey';
    }
  }

  render() {
    if (!this.p) return html`<div class="wrapper"></div>`;
    const p = this.p;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper" @keydown=${this.onKeydown}>
        <h1 class="title">
          <span><span class="fas fa-fw fa-fingerprint" aria-hidden="true"></span> ${this.title}</span>
        </h1>
        <div class="body">
          ${this.renderSite()} ${p.kind === 'create' ? this.renderCreate() : ''}
          ${p.kind === 'exists' ? this.renderExists() : ''} ${p.kind === 'get' ? this.renderGet() : ''}
          ${p.kind === 'none' ? this.renderNone() : ''}
        </div>
        ${this.renderActions()}
      </div>
    `;
  }

  renderSite() {
    const s = this.p.site || {};
    const rp = this.p.rpId && this.p.rpId !== s.host ? this.p.rpId : '';
    return html`
      <div class="party site">
        <img class="icon" src=${s.icon} alt="" @error=${hideImg} />
        <div class="who">
          <div class="name" title=${s.host}>${s.host}</div>
          <div class="sub">
            ${s.secure
              ? html`<span class="fas fa-fw fa-lock"></span> Secure connection`
              : html`<span class="fas fa-fw fa-laptop-code"></span> This computer`}${rp
              ? html` · for <code>${rp}</code>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderAccount(a, cls = '') {
    return html`
      <div class="party account ${cls}">
        <span class="key"><span class="fas fa-fw fa-key" aria-hidden="true"></span></span>
        <div class="who">
          <div class="name" title=${a.title}>${a.title}</div>
          ${a.sub ? html`<div class="sub">${a.sub}</div>` : ''}
        </div>
      </div>
    `;
  }

  renderCreate() {
    const p = this.p;
    return html`
      <div class="as-label">for your account</div>
      ${this.renderAccount(p.account || { title: 'Unnamed account' })}
      ${p.canSave
        ? html`<p class="hint">
            Nomad keeps it on this computer, encrypted with its keychain. It doesn’t sync to your
            other devices.${p.replaces ? ' It replaces the passkey Nomad has for this account.' : ''}
          </p>`
        : html`<p class="hint warn-text">
            <span class="fas fa-fw fa-exclamation-triangle warn"></span> ${p.reason}
          </p>`}
    `;
  }

  renderExists() {
    return html`<p class="hint">
      Nomad already has a passkey for this account on this computer. Sign in with it instead.
    </p>`;
  }

  renderGet() {
    const list = this.p.passkeys || [];
    if (list.length === 1)
      return html`<div class="as-label">sign in as</div>
        ${this.renderAccount(list[0])}
        <p class="hint">${usedLine(list[0])}</p>`;
    return html`
      <div class="as-label">sign in as</div>
      <div class="choices" role="radiogroup" aria-label="Passkeys">
        ${list.map(
          (k) => html`
            <label class="choice ${k.id === this.pickedId ? 'on' : ''}">
              <input
                type="radio"
                name="passkey"
                .checked=${k.id === this.pickedId}
                @change=${() => (this.pickedId = k.id)}
              />
              <div class="who">
                <div class="name">${k.title}</div>
                <div class="sub">${k.sub ? `${k.sub} · ` : ''}${usedLine(k)}</div>
              </div>
            </label>
          `
        )}
      </div>
    `;
  }

  renderNone() {
    return html`<p class="hint">
      Nomad has no passkey for <code>${this.p.rpId}</code> on this computer. If you saved one
      somewhere else, use your phone or a security key.
    </p>`;
  }

  renderActions() {
    const p = this.p;
    const touch = p.touchId ? html`<span class="fas fa-fw fa-fingerprint" aria-hidden="true"></span> ` : '';
    let primary;
    if (p.kind === 'create')
      primary = html`<button type="button" class="primary" ?disabled=${!p.canSave} @click=${this.onAllow}>
        ${touch}${p.touchId ? 'Save with Touch ID' : 'Save passkey'}
      </button>`;
    else if (p.kind === 'get')
      primary = html`<button type="button" class="primary" ?disabled=${!this.pickedId} @click=${this.onAllow}>
        ${touch}${p.touchId ? 'Sign in with Touch ID' : 'Sign in'}
      </button>`;
    else if (p.kind === 'none')
      primary = html`<button type="button" class="primary" @click=${this.onFallback}>
        Use a phone or security key
      </button>`;
    else primary = html`<button type="button" class="primary" @click=${this.onAllow}>OK</button>`;
    return html`
      <div class="actions">
        <button type="button" class="deny" @click=${this.onDeny}>Cancel</button>
        ${primary}
      </div>
      ${p.kind === 'create' || p.kind === 'get'
        ? html`<div class="other">
            <button type="button" class="link" @click=${this.onFallback}>
              Use a phone or security key instead
            </button>
          </div>`
        : ''}
    `;
  }

  // events
  // =

  onKeydown(e) {
    if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') this.shadowRoot.querySelector('button.primary:not([disabled])')?.click();
  }

  onDeny() {
    this.cbs.resolve({ action: 'deny' });
  }

  onFallback() {
    this.cbs.resolve({ action: 'fallback' });
  }

  onAllow() {
    if (this.p.kind === 'get') this.cbs.resolve({ action: 'allow', id: this.pickedId });
    else this.cbs.resolve({ action: 'allow' });
  }
}

function usedLine(k) {
  return k.lastUsedAt ? `Last used ${ago(k.lastUsedAt)}` : `Saved ${ago(k.createdAt)}`;
}

// "5 minutes ago", "yesterday", or a date.
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}

function hideImg(e) {
  e.target.style.visibility = 'hidden';
}

PasskeyModal.styles = [
  commonCSS,
  buttonsCSS,
  css`
    :host {
      --pk-bg: #fff;
      --pk-card: #f7f7fa;
      --pk-warn: #b45309;
      --pk-key-bg: #ececff;
      --pk-key: #4f4fe8;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --m-border: #34343e;
        --m-border-strong: #44444f;
        --m-bg-secondary: #26262d;
        --m-text-default: #ececf1;
        --m-text-light: #a8a8b8;
        --m-text-very-light: #7c7c8c;
        --m-blue: #8b8bff;
        --m-focus-ring: rgba(139, 139, 255, 0.25);
        --pk-bg: #1c1c21;
        --pk-card: #26262d;
        --pk-warn: #fbbf24;
        --pk-key-bg: #2f2f4a;
        --pk-key: #a5a5ff;
      }

      button {
        background: #2a2a32;
        border-color: #3e3e4a;
        color: #ececf1;
        box-shadow: none;
      }

      button:hover {
        background: #33333d;
        border-color: #4a4a58;
      }

      button.primary {
        background: #4f4fe8;
        border-color: #4f4fe8;
        color: #fff;
      }

      button.primary:hover {
        background: #5c5cf0;
      }
    }

    .wrapper {
      background: var(--pk-bg);
      user-select: none;
    }

    .title .fas {
      color: var(--m-blue);
    }

    .body {
      padding: 14px 20px 4px;
    }

    .party {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--m-border);
      border-radius: 8px;
      background: var(--pk-card);
      min-width: 0;
    }

    .icon,
    .key {
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      object-fit: cover;
    }

    .key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--pk-key-bg);
      color: var(--pk-key);
      font-size: 15px;
    }

    .who {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .name {
      overflow: hidden;
      font-size: 14px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sub {
      overflow: hidden;
      color: var(--m-text-light);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    code {
      font-size: 11.5px;
      color: var(--m-text-default);
    }

    .warn {
      color: var(--pk-warn);
    }

    .as-label {
      margin: 10px 0 8px 12px;
      color: var(--m-text-very-light);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 196px;
      overflow-y: auto;
    }

    .choice {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border: 1px solid var(--m-border);
      border-radius: 8px;
      cursor: pointer;
    }

    .choice.on {
      border-color: var(--m-blue);
      box-shadow: 0 0 0 3px var(--m-focus-ring);
    }

    .choice .name {
      font-size: 13px;
    }

    .hint {
      margin: 12px 2px 0;
      color: var(--m-text-light);
      font-size: 12.5px;
      line-height: 1.45;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 14px 20px 10px;
    }

    .actions button {
      height: 34px;
      font-size: 13px;
    }

    .actions button .fas {
      margin-right: 3px;
    }

    .other {
      padding: 0 20px 14px;
      text-align: center;
    }

    button.link,
    button.link:hover {
      height: auto;
      padding: 2px 4px;
      border: 0;
      background: none;
      box-shadow: none;
      color: var(--m-blue);
      font-size: 12px;
      cursor: pointer;
    }

    button.link:hover {
      text-decoration: underline;
    }
  `,
];

customElements.define('passkey-modal', PasskeyModal);
