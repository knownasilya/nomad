import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';

// Draft Mode menu (ADR-0012) — opened from the pen-nib icon in the location bar. Acts on the ACTIVE
// tab's Drive via bg.views (which resolves the Drive key from the pane, incl. hyper://private/).
class DraftMenu extends LitElement {
  static get properties() {
    return {
      status: { type: Object },
      confirmingDiscard: { type: Boolean },
      conflicts: { type: Array },
      busy: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.status = { hasDraft: false, previewing: false, changes: [] };
    this.confirmingDiscard = false;
    this.conflicts = [];
    this.busy = false;
  }

  async init() {
    try {
      this.status = await bg.views.getDraftStatus('active');
    } catch (e) {
      console.debug(e);
    }
    this.requestUpdate();
  }

  get count() {
    return this.status?.changes?.length || 0;
  }

  render() {
    const previewing = !!this.status?.previewing;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <div class="section heading">
          <span class="title"><i class="fas fa-pen-nib"></i> Draft</span>
          <span class="count">${this.count} unpublished change${this.count === 1 ? '' : 's'}</span>
        </div>

        <div class="section">
          <div class="menu-item" @click=${this.onTogglePreview}>
            <i class="fas fa-eye"></i>
            <span class="label">${previewing ? 'Stop previewing' : 'Preview in this tab'}</span>
            ${previewing ? html`<i class="fas fa-check tick"></i>` : ''}
          </div>
        </div>

        ${this.conflicts.length
          ? html`
              <div class="section conflict">
                <div class="warn">
                  <i class="fas fa-exclamation-triangle"></i>
                  ${this.conflicts.length} file${this.conflicts.length === 1 ? '' : 's'} changed on
                  the drive since you staged. Publish anyway to overwrite.
                </div>
                <div class="menu-item danger" @click=${this.onPublishForce}>
                  <i class="fas fa-cloud-upload-alt"></i>
                  <span class="label">Publish anyway (overwrite)</span>
                </div>
              </div>
            `
          : this.confirmingDiscard
            ? html`
                <div class="section">
                  <div class="confirm">Discard ${this.count} staged change${this.count === 1 ? '' : 's'}? This can't be undone.</div>
                  <div class="menu-item danger" @click=${this.onDiscardConfirm}>
                    <i class="far fa-trash-alt"></i>
                    <span class="label">Discard draft</span>
                  </div>
                  <div class="menu-item" @click=${() => (this.confirmingDiscard = false)}>
                    <i class="fas fa-times"></i>
                    <span class="label">Cancel</span>
                  </div>
                </div>
              `
            : html`
                <div class="section">
                  <div
                    class="menu-item ${this.count && !this.busy ? '' : 'disabled'}"
                    @click=${this.onPublish}
                  >
                    <i class="fas fa-cloud-upload-alt"></i>
                    <span class="label">Publish changes</span>
                  </div>
                  <div
                    class="menu-item ${this.count && !this.busy ? '' : 'disabled'}"
                    @click=${this.onDiscard}
                  >
                    <i class="far fa-trash-alt"></i>
                    <span class="label">Discard draft</span>
                  </div>
                </div>
              `}
      </div>
    `;
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.shellMenus.resizeSelf({ width: el.clientWidth | 0, height: el.clientHeight | 0 });
  }

  onTogglePreview() {
    bg.views.toggleDraftPreview('active');
    bg.shellMenus.close();
  }

  async onPublish() {
    if (!this.count || this.busy) return;
    this.busy = true;
    const res = await bg.views.publishDraft('active', {});
    this.busy = false;
    if (res?.conflicts?.length) {
      this.conflicts = res.conflicts; // stay open, offer force
      return;
    }
    bg.shellMenus.close();
  }

  async onPublishForce() {
    this.busy = true;
    await bg.views.publishDraft('active', { force: true });
    this.busy = false;
    bg.shellMenus.close();
  }

  onDiscard() {
    if (!this.count || this.busy) return;
    this.confirmingDiscard = true;
  }

  async onDiscardConfirm() {
    this.busy = true;
    await bg.views.discardDraft('active', {});
    this.busy = false;
    bg.shellMenus.close();
  }
}

DraftMenu.styles = [
  commonCSS,
  css`
    .wrapper {
      width: 280px;
    }
    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      font-size: 12px;
    }
    .heading .title {
      font-weight: 600;
    }
    .heading .title i {
      color: #2864dc;
      margin-right: 4px;
    }
    .heading .count {
      color: var(--text-color--light, #99a);
    }
    .menu-item {
      height: 40px;
    }
    .menu-item.disabled {
      opacity: 0.4;
      pointer-events: none;
    }
    .menu-item.danger .label,
    .menu-item.danger i {
      color: #d13b3b;
    }
    .menu-item .tick {
      margin-left: auto;
      color: #2864dc;
    }
    .confirm,
    .warn {
      padding: 8px 14px;
      font-size: 12px;
      line-height: 1.35;
      color: var(--text-color--default);
    }
    .warn {
      color: #b25a00;
    }
    .warn i {
      color: #d13b3b;
      margin-right: 4px;
    }
  `,
];

customElements.define('draft-menu', DraftMenu);
