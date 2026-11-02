import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import * as nomadPermissions from '../../lib/permissions';

// Persona menu (ADR-0031 §11), opened from the Persona icon in the location bar. Only who you are on
// this site: the Persona, what its Session lets the site do, and Log out. It acts on the ACTIVE tab's
// Session through bg.views (bg/ui/tabs/manager.js); site info keeps its own Session tab.
class PersonaMenu extends LitElement {
  static get properties() {
    return {
      session: { type: Object },
      loaded: { type: Boolean },
      busy: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.session = null;
    this.loaded = false;
    this.busy = false;
  }

  async init() {
    await this.load();
  }

  async load() {
    try {
      this.session = await bg.views.getSiteSession('active');
    } catch (e) {
      console.debug(e);
      this.session = null;
    }
    this.loaded = true;
  }

  render() {
    if (!this.loaded) return html`<div class="wrapper"></div>`;
    const s = this.session;
    if (!s) {
      return html`
        <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
        <div class="wrapper">
          <div class="section"><div class="empty">You’re not logged in to this site.</div></div>
        </div>
      `;
    }
    const p = s.persona;
    const name = p ? p.title || p.label : 'A deleted Persona';
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <div class="section who">
          ${p?.thumbUrl
            ? html`<img class="avatar" src=${p.thumbUrl} alt="" />`
            : html`<span class="avatar initial">${name.slice(0, 1).toUpperCase()}</span>`}
          <div class="who-text">
            <div class="name">${name}</div>
            <div class="sub">
              ${p ? html`Your Persona “${p.label}”` : 'Its Persona was deleted'}
            </div>
          </div>
        </div>
        <div class="section">
          <div class="subhead" title=${s.origin}>
            Logged in to <strong>${s.site}</strong> since
            ${new Date(s.createdAt).toLocaleDateString()}${s.expiresAt
              ? html`, until ${new Date(s.expiresAt).toLocaleDateString()}`
              : ''}
          </div>
          <ul class="perms">
            <li>
              <i class="fas fa-fw fa-fingerprint"></i>
              <span>Knows it’s you each time, by a random ID made only for this site</span>
            </li>
            ${s.perms.map(
              (t) =>
                html`<li>
                  <i class="fas fa-fw fa-check"></i><span>${this.permSentence(t, name, p)}</span>
                </li>`
            )}
          </ul>
        </div>
        <div class="section">
          ${p?.profileUrl
            ? html`
                <div class="menu-item" @click=${this.onOpenProfile}>
                  <i class="fas fa-id-badge"></i>
                  <span class="label">Open profile</span>
                </div>
              `
            : ''}
          <div class="menu-item" @click=${this.onManagePersonas}>
            <i class="fas fa-user-cog"></i>
            <span class="label">Manage Personas…</span>
          </div>
          <div class="menu-item ${this.busy ? 'disabled' : ''}" @click=${this.onLogOut}>
            <i class="fas fa-sign-out-alt"></i>
            <span class="label">Log out of ${s.site}</span>
          </div>
        </div>
      </div>
    `;
  }

  // The same sentences site info and the login prompt use.
  permSentence(token, name, p) {
    const permId = nomadPermissions.getPermId(token);
    if (permId === 'profile')
      return nomadPermissions.renderPermDesc({
        html,
        bg: null,
        url: '',
        permId,
        permParam: '',
        permOpts: { title: name },
      });
    if (permId === 'modifyDrive') return 'Change files in your profile drive';
    if (permId === 'email')
      return p?.email ? html`See your email, <strong>${p.email}</strong>` : 'See your email';
    return token;
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.shellMenus.resizeSelf({ width: el.clientWidth | 0, height: el.clientHeight | 0 });
  }

  onOpenProfile() {
    bg.shellMenus.createTab(this.session.persona.profileUrl);
  }

  onManagePersonas() {
    bg.shellMenus.createTab('nomad://library/personas');
  }

  // The page hears about it on nomad.session's 'change' event; the location bar's icon goes away on
  // the Personas 'changed' event.
  async onLogOut() {
    if (this.busy) return;
    this.busy = true;
    try {
      await bg.views.endSiteSession('active');
    } catch (e) {
      console.debug(e);
    }
    this.busy = false;
    bg.shellMenus.close();
  }
}

PersonaMenu.styles = [
  commonCSS,
  css`
    .wrapper {
      width: 280px;
    }
    .section:last-child {
      border-bottom: 0;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
    }
    .avatar {
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
    }
    .avatar.initial {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #2864dc;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
    }
    .who-text {
      min-width: 0;
    }
    .name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      font-size: 11px;
      color: var(--text-color--menus-wrapper--light);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subhead {
      padding: 4px 14px 6px;
      font-size: 11px;
      color: var(--text-color--menus-wrapper--light);
      white-space: normal;
    }
    .subhead strong {
      font-weight: 600;
      color: var(--text-color--menus-wrapper);
    }
    .perms {
      list-style: none;
      margin: 0;
      padding: 0 14px 4px;
      font-size: 11.5px;
      line-height: 1.4;
    }
    .perms li {
      display: flex;
      gap: 6px;
      margin-bottom: 5px;
    }
    .perms span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .perms i {
      flex: 0 0 auto;
      margin-top: 2px;
      color: var(--text-color--menu-item-icon);
    }
    .empty {
      padding: 6px 14px;
      font-size: 12px;
      color: var(--text-color--menus-wrapper--light);
    }
    .menu-item {
      height: 30px;
    }
  `,
];

customElements.define('persona-menu', PersonaMenu);
