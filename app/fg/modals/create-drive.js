import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import inputsCSS from './inputs.css';
import buttonsCSS from './buttons2.css';
import spinnerCSS from './spinner.css';
import { DRIVE_TEMPLATES } from '../../lib/drive-templates';

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
      isCollaborative: { type: Boolean },
      template: { type: String },
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

        .templates {
          display: grid;
          /* minmax(0, …) lets a column shrink below its text's width, so the cards share the
             modal's width instead of growing past it */
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }

        /* The cards are <button>s, so undo the modal button style (fixed 30px height, no
           wrapping, centered) that pushed the description out under the card */
        .template {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 10px;
          height: auto;
          min-width: 0;
          padding: 10px 12px;
          white-space: normal;
          box-shadow: none;
          border: 1px solid var(--m-border);
          border-radius: var(--m-radius);
          background: none;
          color: var(--m-text-default);
          font: inherit;
          text-align: left;
          cursor: pointer;
        }

        .template:hover {
          border-color: var(--m-border-strong);
        }

        .template.selected {
          border-color: var(--m-blue);
          box-shadow: 0 0 0 3px var(--m-focus-ring);
        }

        .template .fa-fw {
          margin-top: 2px;
          color: var(--m-text-light);
        }

        .template.selected .fa-fw {
          color: var(--m-blue);
        }

        .template-title {
          display: block;
          font-weight: 600;
        }

        .template-text {
          min-width: 0;
        }

        .template-desc {
          display: block;
          margin-top: 2px;
          line-height: 1.35;
          font-size: 11px;
          color: var(--m-text-light);
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
    // ADR-0010: every drive is an Autobase, but "Collaborative" now means "accepts writer-access
    // requests" (a policy lock). Default LOCKED / single-writer — the safer default; the drive can
    // be unlocked later without changing its URL (or automatically when you invite a writer).
    this.isCollaborative = false;
    this.template = 'blank';
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
    if (params.template && DRIVE_TEMPLATES.some((t) => t.id === params.template)) {
      this.selectTemplate(params.template, !!params.collaborative);
    }
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
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <h1 class="title">
          ${this.isCollaborative ? 'Create Collaborative Drive' : 'Create New Drive'}
        </h1>
        <form @submit=${this.onSubmit}>
          <div class="templates" role="radiogroup" aria-label="Start with">
            ${DRIVE_TEMPLATES.map(
              (t) => html`
                <button
                  type="button"
                  role="radio"
                  aria-checked=${this.template === t.id ? 'true' : 'false'}
                  class="template ${this.template === t.id ? 'selected' : ''}"
                  tabindex="1"
                  ?disabled=${this.isProcessing}
                  @click=${() => this.selectTemplate(t.id)}
                >
                  <span class="${t.icon} fa-fw"></span>
                  <span class="template-text">
                    <span class="template-title">${t.title}</span>
                    <span class="template-desc">${t.description}</span>
                  </span>
                </button>
              `
            )}
          </div>
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
            ${this.errors.title ? html`<div class="error">${this.errors.title}</div>` : ''}
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
              <input
                type="checkbox"
                ?checked=${this.isCollaborative}
                @click=${this.onToggleCollaborative}
              />
              <div class="switch"></div>
              <span class="text">Collaborative drive (multi-writer)</span>
            </label>
            ${this.fromFolderPath
              ? html`
                  <div class="from-folder-path">
                    <strong>Import from folder:</strong> ${this.fromFolderPath}
                    <a href="#" @click=${this.onClickCancelFromFolder}>Cancel</a>
                  </div>
                `
              : ''}
          </div>

          <div class="form-actions">
            <button
              type="button"
              @click=${this.onClickFromFolder}
              tabindex="8"
              ?disabled=${this.isProcessing || this.fromGit || this.template !== 'blank'}
              title=${this.fromFolderPath || 'Choose a folder to sync'}
            >
              ${this.fromFolderPath ? this.folderName() : 'From Folder'}
            </button>
            <button
              type="button"
              @click=${this.onClickFromGit}
              tabindex="7"
              ?disabled=${this.isProcessing || !!this.fromFolderPath || this.template !== 'blank'}
            >
              From Git Repo ${this.fromGit ? html`<span class="fas fa-times"></span>` : ''}
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
            <button type="submit" class="primary" tabindex="5" ?disabled=${this.isProcessing}>
              ${this.isProcessing ? html`<div class="spinner"></div>` : 'Create'}
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
                  ${this.errors.gitUrl ? html`<div class="error">${this.errors.gitUrl}</div>` : ''}
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
      // Collaborative is a policy flag (accept writer requests), not a different backend.
      // Folder sync and a git import work the same either way.
      var url = await bg.fs.createDrive({
        title: this.title,
        description: this.description,
        collaborative: !!this.isCollaborative,
        tags: this.tags.split(' '),
        author: this.author,
        fromGitUrl: this.fromGit ? this.gitUrl : undefined,
        template: this.template,
        prompt: false,
      });
      if (this.fromFolderPath) {
        await bg.folderSync.set(url, { localPath: this.fromFolderPath });
      }
      this.cbs.resolve({ url, gotoSync: !!this.fromFolderPath });
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
    this.requestUpdate();
  }

  folderName() {
    const parts = String(this.fromFolderPath).split(/[/\\]/);
    return parts[parts.length - 1] || this.fromFolderPath;
  }

  // A template brings its own default for accepting writers (a Document is for several editors);
  // the files it copies in don't mix with a folder sync or a git import.
  selectTemplate(id, keepCollaborative = false) {
    const t = DRIVE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    this.template = id;
    if (!keepCollaborative) this.isCollaborative = !!t.collaborative;
    if (id !== 'blank') {
      this.fromFolderPath = undefined;
      this.fromGit = false;
    }
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
