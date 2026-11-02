import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';

class ShellWindowSpacesDropdown extends LitElement {
  static get properties() {
    return {
      spaces: { type: Array },
      activeSpace: { type: Object },
      persona: { type: Object }, // the Space's Persona (ADR-0031): { label, title, thumbUrl }
    };
  }

  constructor() {
    super();
    this.spaces = [];
    this.activeSpace = null;
    this.persona = null;
  }

  render() {
    const space = this.activeSpace;
    return html`
      <button
        class="spaces-btn"
        @click=${this.onToggle}
        title=${this.persona ? `Switch space. You are ${this.persona.title || this.persona.label} (${this.persona.label}) here.` : 'Switch space'}
      >
        <span class="dot" style="background:${space?.color || '#6c6cff'}"></span>
        <span class="name">${space?.name || 'Spaces'}</span>
        ${personaAvatar(this.persona)}
        <span class="caret">▾</span>
      </button>
    `;
  }

  async onToggle() {
    await bg.views.toggleMenu('spaces');
  }
}

// The Persona on the Spaces button: its picture, or its first letter. Always on screen, so the user
// sees who they are before a site asks (ADR-0031 §11).
export function personaAvatar(p) {
  if (!p) return '';
  return p.thumbUrl
    ? html`<img class="persona" src=${p.thumbUrl} alt="" />`
    : html`<span class="persona initial">${(p.title || p.label || '?').slice(0, 1).toUpperCase()}</span>`;
}

export const personaAvatarCSS = css`
  .persona {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--border-color--tab, rgba(0, 0, 0, 0.12));
  }

  .persona.initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #5c5cff;
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
  }
`;

ShellWindowSpacesDropdown.styles = css`
  :host {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    height: 33px;
    border-left: 1px solid var(--border-color--tab);
    padding: 0 2px;
  }

  .spaces-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 7px;
    border-radius: 4px;
    border: 0;
    background: transparent;
    cursor: default;
    font-size: 11px;
    color: var(--text-color--tab--title);
    white-space: nowrap;
    outline: 0;
  }

  .spaces-btn:hover {
    background: var(--bg-color--tab--hover);
  }

  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: 0 0 9px;
  }

  .caret {
    font-size: 9px;
    opacity: 0.6;
  }
`;

ShellWindowSpacesDropdown.styles = [ShellWindowSpacesDropdown.styles, personaAvatarCSS];

customElements.define('shell-window-spaces-dropdown', ShellWindowSpacesDropdown);
