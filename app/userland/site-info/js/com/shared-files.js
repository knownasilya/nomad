import { LitElement, html, css } from 'lit';
import sitePermsCSS from '../../css/com/site-perms.css.js';

// The files, folders and drives the user shared with this site read-only: picked in the file picker
// (nomad.shell.selectFileDialog, always capabilities for a web page) or shared read-only from the
// drive dialog (selectDriveDialog's "Share read-only instead"). The site can read each one until the user
// removes it here. Data: the internal nomad.sharedFiles API (bg/web-apis/bg/shared-files.ts).
//
// Below them, the paths of the user's private drive the site may use until a time the user picked
// in the prompt (private-drive-guard.ts, ADR-0022): listPrivate/removePrivate.
class SharedFiles extends LitElement {
  static get properties() {
    return {
      origin: { type: String },
      files: { type: Array },
      grants: { type: Array },
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
        .shared-file .grant {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .shared-file .grant .name {
          font-size: 11px;
        }
        .shared-file .grant .where {
          font-size: 11px;
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
    this.grants = [];
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
    try {
      this.grants = (await nomad.sharedFiles.listPrivate?.(this.origin)) || [];
    } catch {
      this.grants = [];
    }
  }

  render() {
    if (!this.files.length && !this.grants.length) return html``;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${this.files.length
        ? html`<div class="field-group">
            <div class="field-group-title">Shared with this site (read-only)</div>
            ${this.files.map((f) => this.renderFile(f))}
          </div>`
        : ''}
      ${this.grants.length
        ? html`<div class="field-group">
            <div class="field-group-title">Your private drive</div>
            ${this.grants.map((g) => this.renderGrant(g))}
          </div>`
        : ''}
    `;
  }

  renderGrant(g) {
    const isFolder = g.path.endsWith('/');
    const what = g.access === 'write' ? 'Read and change' : 'Read';
    const until = new Date(g.expiresAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return html`
      <div class="shared-file">
        <span class="fa-fw ${isFolder ? 'far fa-folder' : 'far fa-file'}" aria-hidden="true"></span>
        <span class="grant" title="${what} hyper://private${g.path} until ${until}">
          <code class="name">${g.path}</code>
          <span class="where"
            >${what}${g.spaceName ? html` in ${g.spaceName}` : ''}, until ${until}</span
          >
        </span>
        <button
          class="remove-btn"
          title="End access to ${g.path}"
          aria-label="End access to ${g.path}"
          @click=${(e) => this.onRemoveGrant(e, g)}
        >
          <span class="fas fa-fw fa-times" aria-hidden="true"></span>
        </button>
      </div>
    `;
  }

  async onRemoveGrant(e, g) {
    e.preventDefault();
    try {
      await nomad.sharedFiles.removePrivate(g.id);
    } catch {
      /* already ended */
    }
    this.grants = this.grants.filter((x) => x.id !== g.id);
  }

  renderFile(f) {
    const isDrive = f.path === '/';
    const isFolder = f.path.endsWith('/');
    const name = f.title || f.path;
    return html`
      <div class="shared-file">
        <span
          class="fa-fw ${isDrive ? 'far fa-hdd' : isFolder ? 'far fa-folder' : 'far fa-file'}"
          aria-hidden="true"
        ></span>
        <span class="name" title=${f.path}>
          ${name}
          ${f.driveTitle && !isDrive ? html`<span class="where">in ${f.driveTitle}</span>` : ''}
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
