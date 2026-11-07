import { LitElement, html, css } from 'lit';
import sitePermsCSS from '../../css/com/site-perms.css.js';

// The files and folders the user picked for this site in the capability file picker
// (nomad.shell.selectFileDialog({ capability: true })). The site can read each one until the user
// removes it here. Data: the internal nomad.sharedFiles API (bg/web-apis/bg/shared-files.ts).
class SharedFiles extends LitElement {
  static get properties() {
    return {
      origin: { type: String },
      files: { type: Array },
    };
  }

  static get styles() {
    return [
      sitePermsCSS,
      css`
        .shared-file {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .shared-file .name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .shared-file .where {
          color: var(--text-color--light);
        }
        .remove-btn {
          border: 0;
          background: none;
          padding: 2px 4px;
          cursor: pointer;
          color: var(--text-color--light);
          border-radius: 3px;
        }
        .remove-btn:hover {
          color: var(--text-color--default);
          background: var(--bg-color--light);
        }
      `,
    ];
  }

  constructor() {
    super();
    this.origin = '';
    this.files = [];
  }

  updated(changed) {
    if (changed.has('origin')) this.load();
  }

  async load() {
    if (!this.origin || !nomad.sharedFiles) return;
    try {
      this.files = await nomad.sharedFiles.list(this.origin);
    } catch {
      this.files = [];
    }
  }

  render() {
    if (!this.files.length) return html``;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="field-group">
        <div class="field-group-title">Files this site can read</div>
        ${this.files.map((f) => this.renderFile(f))}
      </div>
    `;
  }

  renderFile(f) {
    const isFolder = f.path === '/' || f.path.endsWith('/');
    const name = f.title || f.path;
    return html`
      <div class="shared-file">
        <span class="fa-fw ${isFolder ? 'far fa-folder' : 'far fa-file'}" aria-hidden="true"></span>
        <span class="name" title=${f.path}>
          ${name} ${f.driveTitle ? html`<span class="where">in ${f.driveTitle}</span>` : ''}
        </span>
        <button
          class="remove-btn"
          title="Stop sharing ${name}"
          aria-label="Stop sharing ${name}"
          @click=${(e) => this.onRemove(e, f)}
        >
          <span class="fas fa-fw fa-times" aria-hidden="true"></span>
        </button>
      </div>
    `;
  }

  async onRemove(e, f) {
    e.preventDefault();
    try {
      await nomad.sharedFiles.remove(f.url);
    } catch {
      /* already gone */
    }
    this.files = this.files.filter((x) => x.url !== f.url);
  }
}

customElements.define('shared-files', SharedFiles);
