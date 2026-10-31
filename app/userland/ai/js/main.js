// nomad://ai — the user's AI in one place: the AI Sidebar's saved chats (/chats), what the assistant
// remembers about them (/memory, ADR-0032), the skills the user gives it (/skills, ADR-0034), and the
// runtime and model it uses (/setup, moved here from Settings). AI Jobs keep their page in My Library; the nav links there.
//
// Vanilla Lit from app-stdlib (served as-is, no bundle), styled like My Library.

import { LitElement, html } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import mainCSS from '../css/main.css.js';
import './views/chats.js';
import './views/memory.js';
import './views/skills.js';
import './views/setup.js';

// [path, icon, label, search placeholder]
const VIEWS = [
  ['chats', 'fas fa-comments', 'Chats', 'Search chats'],
  ['memory', 'fas fa-brain', 'Memory', 'Search memories'],
  ['skills', 'fas fa-magic', 'Skills', 'Search skills'],
  ['setup', 'fas fa-sliders-h', 'Setup', ''],
];

const viewFromPath = () => {
  const view = location.pathname.replace(/^\/+|\/+$/g, '');
  return VIEWS.some(([id]) => id === view) ? view : 'chats';
};

class AiApp extends LitElement {
  static get properties() {
    return {
      view: { type: String },
      query: { type: String },
    };
  }

  static get styles() {
    return mainCSS;
  }

  constructor() {
    super();
    this.view = viewFromPath();
    this.query = '';
    if (location.pathname === '/' || location.pathname === '') {
      history.replaceState({}, '', `/${this.view}`);
    }
    window.addEventListener('popstate', () => {
      this.view = viewFromPath();
      this.query = '';
    });
  }

  setView(view) {
    if (this.view === view) return;
    this.view = view;
    this.query = '';
    const input = this.shadowRoot.querySelector('.search-ctrl input');
    if (input) input.value = '';
    history.pushState({}, '', `/${view}`);
  }

  render() {
    const current = VIEWS.find(([id]) => id === this.view);
    document.title = current ? `${current[2]} · AI` : 'AI';
    const placeholder = current?.[3] || '';
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <header>
        <div class="brand">
          <img src="asset:favicon:nomad://ai/" />
          AI
        </div>
        <div class="search-ctrl ${placeholder ? '' : 'hidden'}">
          <span class="fas fa-search"></span>
          <input
            placeholder=${placeholder}
            aria-label=${placeholder || 'Search'}
            @input=${(e) => {
              this.query = e.currentTarget.value;
            }}
          />
        </div>
        <div class="header-actions">${this.renderAction()}</div>
      </header>
      <div class="layout">
        <nav>
          <div class="page-nav">
            ${VIEWS.map(
              ([id, icon, label]) => html`
                <a class=${this.view === id ? 'current' : ''} @click=${() => this.setView(id)}>
                  <span class="fa-fw ${icon}"></span>
                  <span class="label">${label}</span>
                </a>
              `
            )}
            <hr />
            <a href="nomad://library/jobs" title="AI Jobs live in My Library">
              <span class="fa-fw fas fa-clock"></span>
              <span class="label">Jobs</span>
              <span class="ext fas fa-external-link-alt"></span>
            </a>
          </div>
        </nav>
        <main>${this.renderView()}</main>
      </div>
    `;
  }

  renderAction() {
    if (this.view === 'chats') {
      return html`<button class="new-action-btn" @click=${() => nomad.aiChats.openNew()}>
        <span class="fas fa-plus"></span> New chat
      </button>`;
    }
    if (this.view === 'skills') {
      return html`<button
        class="new-action-btn"
        @click=${() => this.shadowRoot.querySelector('ai-skills-view')?.startNew()}
      >
        <span class="fas fa-plus"></span> New skill
      </button>`;
    }
    return '';
  }

  renderView() {
    switch (this.view) {
      case 'memory':
        return html`<ai-memory-view .query=${this.query}></ai-memory-view>`;
      case 'skills':
        return html`<ai-skills-view .query=${this.query}></ai-skills-view>`;
      case 'setup':
        return html`<ai-setup-view></ai-setup-view>`;
      default:
        return html`<ai-chats-view .query=${this.query}></ai-chats-view>`;
    }
  }
}

customElements.define('ai-app', AiApp);
