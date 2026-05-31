import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';

class ShellWindowSpacesDropdown extends LitElement {
  static get properties() {
    return {
      spaces: { type: Array },
      activeSpace: { type: Object },
    };
  }

  constructor() {
    super();
    this.spaces = [];
    this.activeSpace = null;
  }

  render() {
    const space = this.activeSpace;
    return html`
      <button
        class="spaces-btn"
        @click=${this.onToggle}
        title="Switch space"
      >
        <span class="dot" style="background:${space?.color || '#6c6cff'}"></span>
        <span class="name">${space?.name || 'Spaces'}</span>
        <span class="caret">▾</span>
      </button>
    `;
  }

  async onToggle() {
    await bg.views.toggleMenu('spaces');
  }
}

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

customElements.define('shell-window-spaces-dropdown', ShellWindowSpacesDropdown);
