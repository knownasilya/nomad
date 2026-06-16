import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import inputsCSS from './inputs.css';
import buttonsCSS from './buttons2.css';
import spinnerCSS from './spinner.css';

class CreateDriveModal extends LitElement {
  static get properties() {
    return {
      isProcessing: { type: Boolean },
      title: { type: String },
      description: { type: String },
      tags: { type: String },
      fromFolderPath: { type: String },
      errors: { type: Object },
      fromGit: { type: Boolean },
      gitUrl: { type: String },
      isPear: { type: Boolean },
      isCollaborative: { type: Boolean },
    };
  }

  static get styles() {
    return [
      commonCSS,
      inputsCSS,
      buttonsCSS,
      spinnerCSS,
      css`
        form input:not([type='checkbox']) {
          margin-bottom: 10px;
          display: block;
        }

        .from-folder-path {
          background: var(--m-bg-secondary);
          padding: 8px 12px;
          margin-bottom: 10px;
          border-radius: var(--m-radius);
          font-size: 12px;
          color: var(--m-text-light);
          border: 1px solid var(--m-border);
        }

        .form-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-top: 4px;
        }

        .form-actions button:nth-child(3) {
          margin-left: auto;
        }

        .git-repo {
          position: relative;
          border: 1px solid var(--m-border);
          border-radius: var(--m-radius);
          margin-top: 14px;
          padding: 16px 12px 4px;
        }

        .git-repo-label {
          position: absolute;
          top: -9px;
          left: 10px;
          padding: 0 4px;
          background: #fff;
          font-size: 11px;
          font-weight: 600;
          color: var(--m-text-light);
        }
      `,
    ];
  }

  constructor() {
    super();
    this.cbs = undefined;
    this.isProcessing = false;
    this.title = '';
    this.description = '';
    this.tags = '';
    this.author = undefined;
    this.fromFolderPath = undefined;
    this.fromGit = false;
    this.gitUrl = undefined;
    this.isPear = false;
    this.isCollaborative = false;
    this.errors = {};
  }

  async init(params, cbs) {
    this.cbs = cbs;
    this.title = params.title || '';
    this.description = params.description || '';
    this.tags = params.tags
      ? Array.isArray(params.tags)
        ? params.tags.join(' ')
        : params.tags
      : '';
    this.author = undefined; // this.author = params.author
    if (params.collaborative) this.isCollaborative = true;
    await this.requestUpdate();
  }

  updated() {
    this.adjustHeight();
  }

  adjustHeight() {
    var height = this.shadowRoot.querySelector('div').scrollHeight;
    bg.modals.resizeSelf({ height });
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      <div class="wrapper">
        <h1 class="title">${this.isCollaborative ? 'Create Collaborative Drive' : 'Create New Hyperdrive'}</h1>
        <form @submit=${this.onSubmit}>
          <div>
            <input
              autofocus
              name="title"
              tabindex="2"
              value=${this.title || ''}
              @change=${this.onChangeTitle}
              class="${this.errors.title ? 'has-error' : ''}"
              placeholder="Title"
            />
            ${this.errors.title
              ? html`<div class="error">${this.errors.title}</div>`
              : ''}
            <input
              name="desc"
              tabindex="3"
              @change=${this.onChangeDescription}
              value=${this.description || ''}
              placeholder="Description (optional)"
            />
            <input
              name="tags"
              tabindex="4"
              @change=${this.onChangeTags}
              value=${this.tags || ''}
              placeholder="Tags (optional, separated by spaces)"
            />
            <label class="toggle non-fullwidth">
              <input type="checkbox" ?checked=${this.isPear} @click=${this.onTogglePear} />
              <div class="switch"></div>
              <span class="text">Create as Pear app</span>
            </label>
            <label class="toggle non-fullwidth">
              <input type="checkbox" ?checked=${this.isCollaborative} @click=${this.onToggleCollaborative} />
              <div class="switch"></div>
              <span class="text">Collaborative drive (multi-writer)</span>
            </label>
            ${this.fromFolderPath
              ? html`
                  <div class="from-folder-path">
                    <strong>Import from folder:</strong> ${this.fromFolderPath}
                    <a href="#" @click=${this.onClickCancelFromFolder}
                      >Cancel</a
                    >
                  </div>
                `
              : ''}
          </div>

          <div class="form-actions">
            <button
              type="button"
              @click=${this.onClickFromFolder}
              tabindex="8"
              ?disabled=${this.isProcessing || this.fromGit || this.isCollaborative}
            >
              From Folder
            </button>
            <button
              type="button"
              @click=${this.onClickFromGit}
              tabindex="7"
              ?disabled=${this.isProcessing || !!this.fromFolderPath || this.isCollaborative}
            >
              From Git Repo
              ${this.fromGit ? html`<span class="fas fa-times"></span>` : ''}
            </button>
            <button
              type="button"
              @click=${this.onClickCancel}
              class="cancel"
              tabindex="6"
              ?disabled=${this.isProcessing}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="primary"
              tabindex="5"
              ?disabled=${this.isProcessing}
            >
              ${this.isProcessing
                ? html`<div class="spinner"></div>`
                : 'Create'}
            </button>
          </div>

          ${this.fromGit
            ? html`
                <div class="git-repo">
                  <span class="git-repo-label">From Git Repo</span>
                  <input
                    name="git-url"
                    placeholder="Repo URL"
                    value=${this.gitUrl || ''}
                    @change=${this.onChangeGitUrl}
                    class="${this.errors.gitUrl ? 'has-error' : ''}"
                  />
                  ${this.errors.gitUrl
                    ? html`<div class="error">${this.errors.gitUrl}</div>`
                    : ''}
                </div>
              `
            : ''}
        </form>
      </div>
    `;
  }

  // event handlers
  // =

  onChangeTitle(e) {
    this.title = e.target.value.trim();
  }

  onChangeDescription(e) {
    this.description = e.target.value.trim();
  }

  onChangeTags(e) {
    this.tags = e.target.value.trim();
  }

  onChangeGitUrl(e) {
    this.gitUrl = e.target.value.trim();
  }

  onClickCancel(e) {
    e.preventDefault();
    this.cbs.reject(new Error('Canceled'));
  }

  async onSubmit(e) {
    e.preventDefault();

    if (!this.title) {
      this.errors = { title: 'Required' };
      return;
    }

    if (this.fromGit) {
      if (!this.gitUrl) {
        this.errors = { gitUrl: 'Required' };
        return;
      }
      let urlp;
      try {
        urlp = new URL(this.gitUrl);
        if (!['http:', 'https:'].includes(urlp.protocol)) {
          throw new Error();
        }
      } catch {
        this.errors = { gitUrl: 'Must be a valid HTTP/S URL' };
        return;
      }
    }

    this.isProcessing = true;

    try {
      var url;
      if (this.isCollaborative) {
        url = await bg.autobase.createCollaborativeDrive({
          title: this.title,
          description: this.description,
        });
      } else {
        url = await bg.hyperdrive.createDrive({
          title: this.title,
          description: this.description,
          tags: this.tags.split(' '),
          author: this.author,
          fromGitUrl: this.fromGit ? this.gitUrl : undefined,
          prompt: false,
        });
      }
      if (this.isPear && !this.isCollaborative) {
        if (this.fromFolderPath) {
          await bg.folderSync.set(url, { localPath: this.fromFolderPath });
        }
        this.cbs.resolve({ url, gotoSync: !!this.fromFolderPath, isPear: true, pearName: this.title });
        return;
      }
      if (this.fromFolderPath && !this.isCollaborative) {
        await bg.folderSync.set(url, { localPath: this.fromFolderPath });
      }
      this.cbs.resolve({ url, gotoSync: !this.isCollaborative && !!this.fromFolderPath });
    } catch (e) {
      if (e.message && e.message.includes('git')) {
        this.isProcessing = false;
        this.errors = { gitUrl: e.message };
        return;
      }
      this.cbs.reject(e.message || e.toString());
    }
  }

  async onClickFromFolder(e) {
    e.preventDefault();

    var folder = await bg.beakerBrowser.showOpenDialog({
      title: 'Select folder',
      buttonLabel: 'Use folder',
      properties: ['openDirectory'],
    });
    if (!folder || !folder.length) return;
    this.fromFolderPath = folder[0];
  }

  onTogglePear() {
    this.isPear = !this.isPear;
  }

  onToggleCollaborative() {
    this.isCollaborative = !this.isCollaborative;
  }

  onClickFromGit(e) {
    this.fromGit = !this.fromGit;
  }

  onClickCancelFromFolder(e) {
    e.preventDefault();
    this.fromFolderPath = undefined;
  }
}

customElements.define('create-drive-modal', CreateDriveModal);
