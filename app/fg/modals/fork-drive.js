import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { shorten } from '../../lib/strings';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';
import inputsCSS from './inputs.css';
import buttonsCSS from './buttons.css';
import spinnerCSS from './spinner.css';

const STATES = {
  READY: 0,
  DOWNLOADING: 1,
  CLONING: 2,
};

class ForkDriveModal extends LitElement {
  static get properties() {
    return {
      state: { type: Number },
      label: { type: String },
      title: { type: String },
      description: { type: String },
      tags: { type: String },
      isTemplate: { type: Boolean },
      isDetached: { type: Boolean },
    };
  }

  static get styles() {
    return [
      commonCSS,
      inputsCSS,
      buttonsCSS,
      spinnerCSS,
      css`
        form {
          padding: 14px 20px;
          margin: 0;
        }

        .loading {
          padding: 14px 20px;
          color: var(--m-text-light);
          border-bottom: 1px solid var(--m-border);
        }

        h1 {
          margin-top: 0;
          font-size: 14px;
          font-weight: 600;
        }

        /* Tab-style mode switcher */

        .tabbed-nav {
          display: flex;
          align-items: center;
          gap: 2px;
          margin: -4px 0 14px;
          background: var(--m-bg-secondary);
          border: 1px solid var(--m-border);
          border-radius: var(--m-radius);
          padding: 3px;
        }

        .tabbed-nav span,
        .tabbed-nav span.spacer {
          display: none;
        }

        .tabbed-nav a {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--m-text-light);
          cursor: pointer;
          border-radius: calc(var(--m-radius) - 2px);
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.1s, color 0.1s;
        }

        .tabbed-nav a.active {
          background: #fff;
          color: var(--m-text-default);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .columns {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
        }

        .help {
          font-size: 12px;
          color: var(--m-text-light);
          margin: -6px 0 10px;
          line-height: 1.4;
        }

        .help.with-icon {
          padding-left: 18px;
          position: relative;
        }

        .help.with-icon .fas {
          position: absolute;
          left: 0;
          top: 1px;
          font-size: 11px;
          color: var(--m-text-very-light);
        }

        .help a {
          cursor: pointer;
          color: var(--m-blue);
        }

        .form-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .fork-dat-progress {
          font-size: 12px;
          color: var(--m-text-light);
        }
      `,
    ];
  }

  constructor() {
    super();

    // internal state
    this.driveInfo = null;
    this.state = STATES.READY;

    // params
    this.cbs = null;
    this.forks = [];
    this.base = undefined;
    this.label = '';
    this.title = '';
    this.description = '';
    this.tags = '';
    this.isDetached = false;
  }

  async init(params, cbs) {
    // store params
    this.cbs = cbs;
    this.forks = params.forks;
    this.base =
      this.forks.find((fork) => fork.url === params.url) || this.forks[0];
    this.isDetached = params.detached || false;
    this.isTemplate = params.isTemplate || false;
    this.label = params.label || '';
    await this.requestUpdate();

    // fetch drive info
    this.driveInfo = await bg.hyperdrive.getInfo(this.base.url);
    this.title =
      typeof params.title === 'string'
        ? params.title
        : this.driveInfo.title || '';
    this.description =
      typeof params.description === 'string'
        ? params.description
        : this.driveInfo.description || '';
    this.tags = params.tags
      ? Array.isArray(params.tags)
        ? params.tags.join(' ')
        : params.tags
      : this.driveInfo.tags?.join(' ') || '';
    await this.requestUpdate();
    this.adjustHeight();
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
    if (!this.driveInfo) {
      return this.renderLoading();
    }

    var progressEl;
    var actionBtn;
    switch (this.state) {
      case STATES.READY:
        progressEl = html`<div class="fork-dat-progress">
          Ready to ${this.isDetached ? 'make a copy' : 'fork'}.
        </div>`;
        actionBtn = html`<button type="submit" class="btn primary" tabindex="5">
          ${this.isDetached ? 'Copy drive' : 'Create fork'}
        </button>`;
        break;
      case STATES.DOWNLOADING:
        progressEl = html`<div class="fork-dat-progress">
          Downloading remaining files...
        </div>`;
        actionBtn = html`<button
          type="submit"
          class="btn"
          disabled
          tabindex="5"
        >
          <span class="spinner"></span>
        </button>`;
        break;
      case STATES.CLONING:
        progressEl = html`<div class="fork-dat-progress">
          Downloading and copying...
        </div>`;
        actionBtn = html`<button
          type="submit"
          class="btn"
          disabled
          tabindex="5"
        >
          <span class="spinner"></span>
        </button>`;
        break;
    }

    const navItem = (v, label) => html`
      <a
        class=${this.isDetached === v ? 'active' : ''}
        @click=${(e) => this.onSetDetached(v)}
        >${label}</a
      >
    `;
    const baseOpt = (fork) => {
      return html`
        <option value=${fork.url} ?selected=${this.base === fork}>
          ${fork.forkOf && fork.forkOf.label ? fork.forkOf.label : 'Original'}
        </option>
      `;
    };
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      <div class="wrapper">
        <form @submit=${this.onSubmit}>
          ${this.isTemplate
            ? html` <h1>Create a new drive</h1> `
            : html`
                <div class="tabbed-nav">
                  <span></span>
                  ${navItem(false, 'Fork')} ${navItem(true, 'Copy')}
                  <span class="spacer"></span>
                </div>
              `}
          ${this.isDetached
            ? html`
                <p class="help with-icon">
                  <span class="fas fa-fw fa-info"></span>
                  ${this.isTemplate
                    ? html`
                        Using
                        <a @click=${this.onClickTemplate}
                          >${shorten(this.driveInfo.title, 20)}</a
                        >
                        as a template.
                      `
                    : 'Make an independent copy of the drive.'}
                </p>
                <label for="title">Title</label>
                <input
                  autofocus
                  name="title"
                  tabindex="1"
                  value=${this.title || ''}
                  @change=${this.onChangeTitle}
                  required
                  placeholder="Title"
                />
                <label for="desc">Description</label>
                <input
                  name="desc"
                  tabindex="2"
                  @change=${this.onChangeDescription}
                  value=${this.description || ''}
                  placeholder="Description (optional)"
                />
                <label for="tags">Tags</label>
                <input
                  name="tags"
                  tabindex="3"
                  @change=${this.onChangeTags}
                  value=${this.tags || ''}
                  placeholder="Tags (optional, separated by spaces)"
                />
              `
            : html`
                <p class="help with-icon">
                  <span class="fas fa-fw fa-info"></span> A fork is a linked
                  copy of the drive which is used for making changes and then
                  merging into the original.
                </p>
                <div class="columns">
                  <div>
                    <label for="base">Base</label>
                    <div style="margin: 5px 0 8px">
                      <select
                        name="base"
                        tabindex="1"
                        @change=${this.onChangeBase}
                      >
                        ${baseOpt(this.forks[0])}
                        <optgroup label="Forks">
                          ${repeat(this.forks.slice(1), (fork) =>
                            baseOpt(fork)
                          )}
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label for="label">Label</label>
                    <input
                      name="label"
                      tabindex="2"
                      value="${this.label}"
                      @change=${this.onChangeLabel}
                      placeholder="e.g. 'dev' or 'my-new-feature'"
                      autofocus
                      required
                    />
                    <p class="help">
                      The label will help you identify the fork.
                    </p>

                    <label for="tags">Tags</label>
                    <input
                      name="tags"
                      tabindex="3"
                      @change=${this.onChangeTags}
                      value=${this.tags || ''}
                      placeholder="Tags (optional, separated by spaces)"
                    />
                  </div>
                </div>
              `}

          <hr />

          <div class="form-actions">
            ${progressEl}
            <div>
              <button
                type="button"
                class="btn cancel"
                @click=${this.onClickCancel}
                tabindex="4"
              >
                Cancel
              </button>
              ${actionBtn}
            </div>
          </div>
        </form>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div class="wrapper">
        <div class="loading">Loading...</div>
        <form>
          <div class="form-actions">
            <div></div>
            <div>
              <button
                type="button"
                class="btn cancel"
                @click=${this.onClickCancel}
                tabindex="4"
              >
                Cancel
              </button>
              <button type="submit" class="btn" tabindex="5" disabled>
                Create
              </button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  // event handlers
  // =

  onClickTemplate(e) {
    bg.beakerBrowser.openUrl(this.driveInfo.url, { setActive: true });
  }

  onSetDetached(v) {
    this.isDetached = v;
  }

  async onChangeBase(e) {
    this.base = this.forks.find((fork) => fork.url === e.currentTarget.value);
    this.driveInfo = await bg.hyperdrive.getInfo(this.base.url);
    this.requestUpdate();
  }

  onChangeLabel(e) {
    this.label = e.target.value;
  }

  onChangeTitle(e) {
    this.title = e.target.value;
  }

  onChangeDescription(e) {
    this.description = e.target.value;
  }

  onChangeTags(e) {
    this.tags = e.target.value;
  }

  onClickCancel(e) {
    e.preventDefault();
    this.cbs.reject(new Error('Canceled'));
  }

  async onSubmit(e) {
    e.preventDefault();

    if (this.isDetached) {
      if (!this.title.trim()) return;
    } else {
      if (!this.label.trim()) return;
    }

    // this.state = STATES.DOWNLOADING
    // await bg.hyperdrive.download(this.base.url)

    this.state = STATES.CLONING;
    try {
      var url = await bg.hyperdrive.forkDrive(this.base.url, {
        detached: this.isDetached,
        title: this.isDetached ? this.title : this.driveInfo.title,
        description: this.isDetached
          ? this.description
          : this.driveInfo.description,
        tags: this.tags.split(' '),
        label: this.label,
        prompt: false,
      });
      this.cbs.resolve({ url });
    } catch (e) {
      this.cbs.reject(e.message || e.toString());
    }
  }
}

customElements.define('fork-drive-modal', ForkDriveModal);
