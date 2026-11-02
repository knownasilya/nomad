import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import buttonsCSS from './buttons2.css';
import { renderPermDesc } from '../../lib/permissions';

// The login prompt (ADR-0031 §7): the only way a site gets a Session. It names both sides (who is
// asking, and as whom you'll appear), looks the same whether or not the user has a Persona (with
// none, the same window offers to make one), lists each permission as one sentence with its own
// checkbox, and puts Deny next to Allow at the same size. bg (web-apis/bg/session.ts) opens it with
// what it read itself; this window answers { allow, personaId | create, perms } or is cancelled.

class PersonaLoginModal extends LitElement {
  static get properties() {
    return {
      site: { type: Object },
      personas: { type: Array },
      pickedId: { type: String },
      perms: { type: Array },
      checked: { type: Array },
      space: { type: Object },
      choosing: { type: Boolean },
      making: { type: Boolean },
      newTitle: { type: String },
      newLabel: { type: String },
      vaultReady: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.cbs = null;
    this.site = null;
    this.personas = [];
    this.pickedId = null;
    this.perms = [];
    this.checked = [];
    this.space = null;
    this.choosing = false;
    this.making = false;
    this.newTitle = '';
    this.newLabel = '';
    this.vaultReady = true;
  }

  async init(params, cbs) {
    this.cbs = cbs;
    // Light and dark (modals/index.html follows the system only for windows that ask).
    document.body.classList.add('themed');
    this.site = params.site || {};
    this.personas = params.personas || [];
    this.pickedId = params.pickedId || null;
    this.perms = (params.perms || []).filter((p) => p === 'profile' || p === 'modifyDrive');
    this.checked = [...this.perms];
    this.space = params.space || null;
    this.vaultReady = params.vaultReady !== false;
    // No usable Persona: the same window offers to make one.
    this.making = !this.personas.length;
    this.choosing = !this.making && !this.picked;
    await this.requestUpdate();
    this.shadowRoot.querySelector('button.allow')?.focus();
  }

  get picked() {
    return this.personas.find((p) => p.id === this.pickedId && p.state === 'usable') || null;
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.modals.resizeSelf({ width: 440, height: el.scrollHeight });
  }

  // rendering
  // =

  render() {
    if (!this.site) return html`<div class="wrapper"></div>`;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <h1 class="title"><span>Log in with a Persona</span></h1>
        <div class="body">
          ${this.renderSite()}
          <div class="as-label">will see you as</div>
          ${this.making
            ? this.renderMake()
            : this.choosing
              ? this.renderChoices()
              : this.renderPicked()}
          ${this.renderPerms()}
          ${this.space
            ? html`<div class="space-note">
                <span class="dot" style="background:${this.space.color}"></span>
                In your ${this.space.name}
                space.${this.personas.length
                  ? ' Using another Persona here switches this space to it.'
                  : ''}
              </div>`
            : ''}
        </div>
        <div class="actions">
          <button type="button" class="deny" @click=${this.onDeny}>Don’t allow</button>
          <button
            type="button"
            class="allow primary"
            ?disabled=${!this.canAllow}
            @click=${this.onAllow}
          >
            ${this.making ? 'Make Persona and log in' : 'Log in'}
          </button>
        </div>
      </div>
    `;
  }

  renderSite() {
    const s = this.site;
    if (s.kind === 'drive') {
      const short = `${s.key.slice(0, 6)}…${s.key.slice(-6)}`;
      return html`
        <div class="party site">
          <img class="icon" src=${s.icon} alt="" @error=${hideImg} />
          <div class="who">
            <div class="name" title=${s.title || 'Untitled drive'}>
              ${s.title || 'Untitled drive'}
            </div>
            <div class="sub">
              <span class="fas fa-fw fa-folder"></span>
              <code title=${`hyper://${s.key}/`}>hyper://${short}/</code>
            </div>
          </div>
        </div>
      `;
    }
    return html`
      <div class="party site">
        <img class="icon" src=${s.icon} alt="" @error=${hideImg} />
        <div class="who">
          <div class="name" title=${s.host}>${s.host}</div>
          <div class="sub">
            ${s.secure
              ? html`<span class="fas fa-fw fa-lock"></span> Secure connection`
              : html`<span class="fas fa-fw fa-exclamation-triangle warn"></span> Not secure (http)`}
          </div>
        </div>
      </div>
    `;
  }

  renderAvatar(p, cls = '') {
    return p.thumbUrl
      ? html`<img class="avatar ${cls}" src=${p.thumbUrl} alt="" @error=${hideImg} />`
      : html`<span class="avatar initial ${cls}"
          >${(p.title || p.label || '?').slice(0, 1).toUpperCase()}</span
        >`;
  }

  renderPicked() {
    const p = this.picked;
    return html`
      <div class="party persona">
        ${this.renderAvatar(p)}
        <div class="who">
          <div class="name">${p.title || p.label}</div>
          <div class="sub">Your Persona “${p.label}”</div>
        </div>
        <a class="change" href="#" @click=${this.onChange}
          >${this.personas.length > 1 ? 'Change' : 'New'}</a
        >
      </div>
    `;
  }

  renderChoices() {
    return html`
      <div class="choices" role="radiogroup">
        ${this.personas.map((p) => {
          const ok = p.state === 'usable';
          return html`
            <label class="choice ${ok ? '' : 'disabled'} ${p.id === this.pickedId ? 'on' : ''}">
              <input
                type="radio"
                name="persona"
                .checked=${p.id === this.pickedId}
                ?disabled=${!ok}
                @change=${() => (this.pickedId = p.id)}
              />
              ${this.renderAvatar(p, 'small')}
              <span class="who">
                <span class="name">${p.title || p.label}</span>
                <span class="sub">${ok ? `“${p.label}”` : p.reason}</span>
              </span>
            </label>
          `;
        })}
        <a class="make-link" href="#" @click=${this.onStartMake}
          ><span class="fas fa-plus"></span> Make a new Persona</a
        >
      </div>
    `;
  }

  renderMake() {
    return html`
      <div class="make">
        ${this.personas.length
          ? ''
          : html`<p class="hint">
              You don’t have a Persona yet. Make one now: it’s a profile drive of your own, kept on
              your devices.
            </p>`}
        <label>
          <span>Your name, as sites see it</span>
          <input
            class="new-title"
            placeholder="Ada Lovelace"
            maxlength="280"
            .value=${this.newTitle}
            @input=${(e) => (this.newTitle = e.target.value)}
            @keydown=${this.onKeydown}
          />
        </label>
        <label>
          <span>A label only you see</span>
          <input
            class="new-label"
            placeholder="Me"
            maxlength="40"
            .value=${this.newLabel}
            @input=${(e) => (this.newLabel = e.target.value)}
            @keydown=${this.onKeydown}
          />
        </label>
        ${!this.vaultReady
          ? html`<p class="hint warn">
              This device hasn’t finished syncing your Vault. Wait for it before making a Persona.
            </p>`
          : ''}
        ${this.personas.length
          ? html`<a href="#" @click=${this.onCancelMake}>Use an existing Persona</a>`
          : ''}
      </div>
    `;
  }

  renderPerms() {
    const p = this.making ? null : this.picked;
    const title = p ? p.title || p.label : this.newTitle.trim();
    const profileOn = this.checked.includes('profile');
    return html`
      <ul class="perms">
        <li class="always">
          <span class="fas fa-fw fa-fingerprint"></span>
          <span>Know it’s the same visitor each time, by a random ID made only for this site</span>
        </li>
        ${this.perms.includes('profile')
          ? html`<li>
              <label>
                <input
                  type="checkbox"
                  .checked=${profileOn}
                  @change=${(e) => this.toggle('profile', e.target.checked)}
                />
                <span
                  >${renderPermDesc({
                    html,
                    bg: null,
                    url: '',
                    permId: 'profile',
                    permParam: '',
                    permOpts: { title },
                  })}</span
                >
              </label>
            </li>`
          : ''}
        ${this.perms.includes('modifyDrive')
          ? html`<li class="nested ${profileOn ? '' : 'off'}">
              <label>
                <input
                  type="checkbox"
                  .checked=${profileOn && this.checked.includes('modifyDrive')}
                  ?disabled=${!profileOn}
                  @change=${(e) => this.toggle('modifyDrive', e.target.checked)}
                />
                <span>Change files in your profile drive</span>
              </label>
            </li>`
          : ''}
      </ul>
    `;
  }

  get canAllow() {
    if (this.making) return !!this.newTitle.trim() && this.vaultReady;
    return !!this.picked;
  }

  toggle(perm, on) {
    this.checked = on
      ? [...new Set([...this.checked, perm])]
      : this.checked.filter((p) => p !== perm);
  }

  // events
  // =

  onChange(e) {
    e.preventDefault();
    if (this.personas.length > 1) this.choosing = true;
    else this.onStartMake(e);
  }

  onStartMake(e) {
    e?.preventDefault();
    this.making = true;
    this.choosing = false;
    this.updateComplete.then(() => this.shadowRoot.querySelector('.new-title')?.focus());
  }

  onCancelMake(e) {
    e.preventDefault();
    this.making = false;
    this.choosing = !this.picked;
  }

  onKeydown(e) {
    if (e.key === 'Enter' && this.canAllow) this.onAllow();
  }

  onDeny() {
    this.cbs.resolve({ allow: false });
  }

  onAllow() {
    if (!this.canAllow) return;
    const perms = this.checked.includes('profile')
      ? this.checked
      : this.checked.filter((p) => p !== 'modifyDrive');
    if (this.making) {
      const title = this.newTitle.trim();
      this.cbs.resolve({
        allow: true,
        create: { title, label: this.newLabel.trim() || 'Me' },
        perms,
      });
    } else {
      this.cbs.resolve({ allow: true, personaId: this.picked.id, perms });
    }
  }
}

function hideImg(e) {
  e.target.style.visibility = 'hidden';
}

PersonaLoginModal.styles = [
  commonCSS,
  buttonsCSS,
  css`
    :host {
      --pl-bg: #fff;
      --pl-card: #f7f7fa;
      --pl-ok: #15803d;
      --pl-warn: #b45309;
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
        --pl-bg: #1c1c21;
        --pl-card: #26262d;
        --pl-warn: #fbbf24;
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

      input:not([type='checkbox']):not([type='radio']) {
        background: #26262d;
        border-color: #3e3e4a;
        color: #ececf1;
      }
    }

    .wrapper {
      background: var(--pl-bg);
      user-select: none;
    }

    .body {
      padding: 14px 20px 6px;
    }

    .party {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--m-border);
      border-radius: 8px;
      background: var(--pl-card);
      min-width: 0;
    }

    .icon,
    .avatar {
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      object-fit: cover;
    }

    .avatar {
      border-radius: 50%;
    }

    .avatar.small {
      flex-basis: 28px;
      width: 28px;
      height: 28px;
    }

    .avatar.initial {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--m-blue);
      color: #fff;
      font-weight: 600;
      font-size: 15px;
    }

    .avatar.small.initial {
      font-size: 12px;
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

    .sub code {
      font-size: 11px;
      color: var(--m-text-default);
    }

    .warn {
      color: var(--pl-warn);
    }

    .as-label {
      margin: 8px 0 8px 12px;
      color: var(--m-text-very-light);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .change {
      flex: 0 0 auto;
      font-size: 12px;
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 4px;
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

    .choice.disabled {
      opacity: 0.6;
      cursor: default;
    }

    .choice .name {
      font-size: 13px;
    }

    .make-link {
      align-self: flex-start;
      margin: 4px 2px 0;
      font-size: 12px;
    }

    .make {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--m-border);
      border-radius: 8px;
      background: var(--pl-card);
      font-size: 12px;
    }

    .make label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--m-text-light);
      font-weight: 500;
    }

    .make input {
      height: 30px;
      padding: 0 9px;
      border: 1px solid var(--m-border-strong);
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }

    .make input:focus {
      border-color: var(--m-blue);
      box-shadow: 0 0 0 3px var(--m-focus-ring);
    }

    .hint {
      margin: 0;
      color: var(--m-text-light);
      line-height: 1.45;
    }

    .perms {
      list-style: none;
      margin: 14px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12.5px;
      line-height: 1.4;
    }

    .perms li {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .perms label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
    }

    .perms input {
      margin: 2px 0 0;
    }

    .perms .always {
      color: var(--m-text-light);
    }

    .perms .always .fas {
      width: 13px;
      margin-top: 2px;
      color: var(--m-text-very-light);
    }

    .perms .nested {
      padding-left: 22px;
    }

    .perms .nested.off {
      color: var(--m-text-very-light);
    }

    .space-note {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 14px;
      color: var(--m-text-very-light);
      font-size: 11.5px;
    }

    .dot {
      flex: 0 0 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 14px 20px 16px;
    }

    .actions button {
      height: 34px;
      font-size: 13px;
    }
  `,
];

customElements.define('persona-login-modal', PersonaLoginModal);
