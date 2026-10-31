import {
  LitElement,
  html,
} from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import * as QP from './lib/query-params.js';
import css from '../css/main.css.js';
import './views/general.js';
import './views/url-routing.js';
import './views/blocking.js';
import './views/security.js';
import './views/devices.js';
import './views/info.js';
import './views/network.js';
import './views/fs-audit-log.js';
import './views/daemon-log.js';
import './views/log.js';

// Sub-pages that live elsewhere now: the nav item opens the page instead.
const MOVED = {
  // The AI's setup moved to its own page, with its chats and memory (nomad://ai).
  ai: 'nomad://ai/setup',
};

// [id, icon, label] for each sub-page; null draws a divider
const SUBVIEWS = [
  ['general', 'fas fa-cog', 'General'],
  ['url-routing', 'fas fa-route', 'URL Routing'],
  ['blocking', 'fas fa-ban', 'Content Blocking'],
  ['ai', 'fas fa-brain', 'AI'],
  ['security', 'fas fa-shield-alt', 'Security'],
  ['devices', 'fas fa-laptop', 'Devices'],
  null,
  ['general-logs', 'fas fa-clipboard-list', 'General Logs'],
  ['network', 'fas fa-share-alt', 'Network Stats'],
  ['fs-audit-log', 'fas fa-clipboard-check', 'Filesystem Audit Log'],
  ['info', 'fas fa-info-circle', 'Information'],
  null,
];

class SettingsApp extends LitElement {
  static get properties() {
    return {
      currentSubview: { type: String },
    };
  }

  static get styles() {
    return css;
  }

  constructor() {
    super();
    this.currentSubview = QP.getParam('view') || 'general';
    // An old link to Settings → AI.
    if (MOVED[this.currentSubview]) {
      location.replace(MOVED[this.currentSubview]);
      return;
    }
    // back/forward between sub-pages
    window.addEventListener('popstate', () => {
      const view = QP.getParam('view') || 'general';
      if (view === this.currentSubview) return;
      this.currentSubview = view;
      this.load();
    });
  }

  firstUpdated() {
    this.load();
  }

  async load() {
    try {
      await Promise.all(
        Array.from(this.shadowRoot.querySelectorAll('[loadable]'), (el) =>
          el.unload()
        )
      );
    } catch (e) {
      console.debug(e);
    }
    await this.requestUpdate();
    try {
      await Promise.all(
        Array.from(this.shadowRoot.querySelectorAll('[loadable]'), (el) =>
          el.load()
        )
      );
    } catch (e) {
      console.debug(e);
    }
  }

  // rendering
  // =

  render() {
    const current = SUBVIEWS.find((v) => v && v[0] === this.currentSubview);
    document.title = current ? `${current[2]} · Settings` : 'Settings';
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="subnav">${this.renderSubnav()}</div>
      <div class="subview">${this.renderSubview()}</div>
    `;
  }

  renderSubnav() {
    const item = (id, icon, label) => {
      const cls = classMap({ item: true, current: id === this.currentSubview });
      return html`
        <div class=${cls} @click=${(e) => this.onClickSubview(e, id)}>
          <span class="fa-fw ${icon}"></span> ${label}
          ${MOVED[id]
            ? html`<span class="moved fas fa-external-link-alt" title="Opens the AI page"></span>`
            : ''}
        </div>
      `;
    };
    return SUBVIEWS.map((v) => (v ? item(...v) : html`<hr />`));
  }

  renderSubview() {
    switch (this.currentSubview) {
      case 'general':
        return html`<general-settings-view loadable></general-settings-view>`;
      case 'url-routing':
        return html`<url-routing-settings-view loadable></url-routing-settings-view>`;
      case 'blocking':
        return html`<blocking-settings-view loadable></blocking-settings-view>`;
      case 'security':
        return html`<security-settings-view loadable></security-settings-view>`;
      case 'devices':
        return html`<devices-view loadable></devices-view>`;
      case 'info':
        return html`<info-settings-view loadable></info-settings-view>`;
      case 'network':
        return html`<network-view loadable></network-view>`;
      case 'general-logs':
        return html`<log-settings-view loadable></log-settings-view>`;
      case 'fs-audit-log':
        return html`<fs-audit-log-view loadable></fs-audit-log-view>`;
      case 'daemon-log':
        return html`<daemon-log-view loadable></daemon-log-view>`;
      default:
        return html`<div class="empty">
          <div><span class="fas fa-toolbox"></span></div>
          Under Construction
        </div>`;
    }
  }

  // events
  // =

  onClickSubview(e, id) {
    if (MOVED[id]) {
      location.href = MOVED[id];
      return;
    }
    this.currentSubview = id;
    QP.setParams({ view: id });
    this.load();
  }
}

customElements.define('settings-app', SettingsApp);
