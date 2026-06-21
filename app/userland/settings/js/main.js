import {
  LitElement,
  html,
} from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import * as QP from './lib/query-params.js';
import css from '../css/main.css.js';
import './views/general.js';
import './views/blocking.js';
import './views/ai.js';
import './views/security.js';
import './views/devices.js';
import './views/info.js';
import './views/network.js';
import './views/fs-audit-log.js';
import './views/daemon-log.js';
import './views/log.js';

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
    document.title = 'Settings';
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
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
        </div>
      `;
    };
    return html`
      ${item('general', 'fas fa-cog', 'General')}
      ${item('blocking', 'fas fa-ban', 'Content Blocking')}
      ${item('ai', 'fas fa-brain', 'AI')}
      ${item('security', 'fas fa-shield-alt', 'Security')}
      ${item('devices', 'fas fa-laptop', 'Devices')}
      <hr />
      ${item('general-logs', 'fas fa-clipboard-list', 'General Logs')}
      ${item('network', 'fas fa-share-alt', 'Network Stats')}
      ${item('fs-audit-log', 'fas fa-clipboard-check', 'Filesystem Audit Log')}
      ${
        '' /*DISABLEDitem('daemon-log', 'fas fa-clipboard-list', 'Daemon Log')*/
      }
      ${item('info', 'fas fa-info-circle', 'Information')}
      <hr />
    `;
  }

  renderSubview() {
    switch (this.currentSubview) {
      case 'general':
        return html`<general-settings-view loadable></general-settings-view>`;
      case 'blocking':
        return html`<blocking-settings-view loadable></blocking-settings-view>`;
      case 'ai':
        return html`<ai-settings-view loadable></ai-settings-view>`;
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
    this.currentSubview = id;
    QP.setParams({ view: id });
    this.load();
  }
}

customElements.define('settings-app', SettingsApp);
