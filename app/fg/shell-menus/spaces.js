import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import buttonsCSS from './buttons2.css';

const COLORS = [
  '#6c6cff',
  '#e85d4a',
  '#e8a025',
  '#3ab36e',
  '#2b9fd4',
  '#9b59b6',
  '#e91e8c',
  '#607d8b',
];

class SpacesMenu extends LitElement {
  static get properties() {
    return {
      spaces: { type: Array },
      activeSpace: { type: Object },
      isCreating: { type: Boolean },
      newName: { type: String },
      newColor: { type: String },
    };
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.spaces = [];
    this.activeSpace = null;
    this.isCreating = false;
    this.newName = '';
    this.newColor = COLORS[0];
  }

  async init() {
    this.spaces = await bg.spaces.list();
    this.activeSpace = await bg.spaces.getActive();
  }

  render() {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      <div class="wrapper">
        <div class="header">Spaces</div>
        <div class="spaces-list">
          ${(this.spaces || []).map(
            (s) => html`
              <div
                class="space-item ${s.id === this.activeSpace?.id ? 'active' : ''}"
                @click=${() => this.onSwitch(s.id)}
              >
                <span class="dot" style="background:${s.color}"></span>
                <span class="name">${s.name}</span>
                ${s.id === this.activeSpace?.id ? html`<span class="fa fa-check"></span>` : ''}
              </div>
            `
          )}
        </div>
        <div class="divider"></div>
        ${this.isCreating
          ? this.renderForm()
          : html`
              <div class="new-btn" @click=${this.onStartCreate}>
                <span class="fa fa-plus"></span> New space
              </div>
            `}
      </div>
    `;
  }

  renderForm() {
    return html`
      <div class="create-form">
        <input
          class="name-input"
          type="text"
          placeholder="Space name"
          .value=${this.newName}
          @input=${(e) => {
            this.newName = e.target.value;
          }}
          @keydown=${this.onKeydown}
        />
        <div class="color-row">
          ${COLORS.map(
            (c) => html`
              <button
                class="swatch ${c === this.newColor ? 'selected' : ''}"
                style="background:${c}"
                @click=${() => {
                  this.newColor = c;
                }}
              ></button>
            `
          )}
        </div>
        <div class="form-btns">
          <button class="cancel" @click=${this.onCancel}>Cancel</button>
          <button class="create" ?disabled=${!this.newName.trim()} @click=${this.onCreate}>
            Create
          </button>
        </div>
      </div>
    `;
  }

  updated() {
    var el = this.shadowRoot.querySelector('.wrapper');
    if (el) {
      bg.shellMenus.resizeSelf({
        width: el.clientWidth | 0,
        height: el.clientHeight | 0,
      });
    }
    if (this.isCreating) {
      this.shadowRoot.querySelector('.name-input')?.focus();
    }
  }

  async onSwitch(id) {
    bg.spaces.setActive(id);
    bg.shellMenus.close();
  }

  onStartCreate() {
    this.isCreating = true;
    this.newName = '';
    this.newColor = COLORS[0];
  }

  onCancel() {
    this.isCreating = false;
  }

  async onCreate() {
    const name = this.newName.trim();
    if (!name) return;
    await bg.spaces.create({ name, color: this.newColor });
    bg.shellMenus.close();
  }

  onKeydown(e) {
    if (e.key === 'Enter') this.onCreate();
    if (e.key === 'Escape') this.onCancel();
  }
}

SpacesMenu.styles = [
  buttonsCSS,
  css`
    .wrapper {
      width: 200px;
      background: var(--bg-color--background);
      border-radius: 4px;
    }

    .header {
      padding: 6px 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-color--light, #888);
      border-bottom: 1px solid var(--border-color--default);
    }

    .spaces-list {
      max-height: 240px;
      overflow-y: auto;
    }

    .space-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      cursor: default;
      font-size: 12px;
      color: var(--text-color--default);
    }

    .space-item:hover {
      background: var(--bg-color--hover, rgba(0, 0, 0, 0.05));
    }

    .space-item.active {
      font-weight: 600;
    }

    .space-item .name {
      flex: 1;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: 0 0 10px;
    }

    .divider {
      height: 1px;
      background: var(--border-color--default);
      margin: 2px 0;
    }

    .new-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      font-size: 12px;
      color: var(--text-color--link, #5c5cff);
      cursor: default;
    }

    .new-btn:hover {
      background: var(--bg-color--hover, rgba(0, 0, 0, 0.05));
    }

    .create-form {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .name-input {
      width: 100%;
      padding: 4px 7px;
      border: 1px solid var(--border-color--default);
      border-radius: 3px;
      font-size: 12px;
      background: var(--bg-color--input, #fff);
      color: var(--text-color--default);
      outline: 0;
      box-sizing: border-box;
    }

    .color-row {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .swatch {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid transparent;
      padding: 0;
      cursor: default;
      outline: 0;
    }

    .swatch.selected {
      border-color: var(--text-color--default, #333);
    }

    .form-btns {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .cancel,
    .create {
      padding: 3px 10px;
      border-radius: 3px;
      border: 1px solid var(--border-color--default);
      font-size: 11px;
      cursor: default;
      outline: 0;
      background: transparent;
      color: var(--text-color--default);
    }

    .create {
      background: var(--color--blue, #5c5cff);
      color: #fff;
      border-color: transparent;
    }

    .create:disabled {
      opacity: 0.5;
    }
  `,
];

customElements.define('spaces-menu', SpacesMenu);
