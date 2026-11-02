import { PERMS, PERM_ICONS, renderPermDesc, getPermId, getPermParam } from '../../lib/permissions';
import { LitElement, html, css } from 'lit';
import prettyHash from 'pretty-hash';
import * as bg from './bg-process-rpc';
import buttonsCSS from './buttons.css';

const IS_DRIVE_KEY_REGEX = /^[0-9a-f]{64}$/i;

// A prompt the site didn't ask for: the user's own AI wants it (ADR-0037). The site in the tab may
// even be the one trying to talk the AI into it, so the usual "trust this page" line would mislead.
const AI_ASKS = {
  aiSendData: {
    lead: 'The AI assistant wants to:',
    caution: "Only click 'Allow' if you asked the assistant to use this site.",
  },
};

class PermPrompt extends LitElement {
  constructor() {
    super();
    this.resolve = null;
    this.url = null;
    this.permId = null;
    this.permParam = null;
    this.permOpts = null;
    this.isPermExperimental = false;
    this.allowSimilar = false;

    // export interface
    window.isPromptActive = false;
    window.runPrompt = this.runPrompt.bind(this);
    window.clickAccept = () => this.shadowRoot.querySelector('.prompt-accept').click();
    window.clickReject = () => this.shadowRoot.querySelector('.prompt-reject').click();

    this.fetchBrowserInfo();
  }

  async fetchBrowserInfo() {
    // fetch platform information
    var { platform } = await bg.beakerBrowser.getInfo();
    window.platform = platform;
    if (platform === 'darwin') {
      document.body.classList.add('darwin');
    }
    if (platform === 'win32') {
      document.body.classList.add('win32');
    }
  }

  async runPrompt({ permission, url, opts }) {
    window.isPromptActive = true;

    // lookup the perm description. auto-deny if it's not a known perm.
    this.url = url;
    this.permId = getPermId(permission);
    this.permParam = getPermParam(permission);
    this.permOpts = opts || {};
    this.allowSimilar = false;
    const PERM = PERMS[this.permId];
    if (!PERM) return false;
    this.isPermExperimental = PERM.experimental;
    this.isPermDangerous = !!PERM.dangerous;

    // fetch dat title if needed
    if (!this.permOpts.title && IS_DRIVE_KEY_REGEX.test(this.permParam)) {
      let driveKey = this.permParam;
      let driveInfo;
      try {
        driveInfo = await bg.fs.getInfo(driveKey);
      } catch (e) {
        /* ignore */
      }
      this.permOpts.title =
        driveInfo && driveInfo.title ? driveInfo.title : prettyHash(this.permParam);
    }

    // create the prompt
    await this.requestUpdate();

    // adjust height based on rendering
    var height = this.shadowRoot.querySelector('div').clientHeight | 0;
    bg.permPrompt.resizeSelf({ height });

    // setup promise
    return new Promise((resolve) => {
      this.resolve = resolve;
    }).then((v) => {
      window.isPromptActive = false;
      return v;
    });
  }

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper" @contextmenu=${this.onContextMenu}>
        <p>${AI_ASKS[this.permId]?.lead || 'This site wants to:'}</p>
        <p class="perm">
          <i class="${PERM_ICONS[this.permId]}"></i>
          ${renderPermDesc({
            bg,
            html,
            url: this.url,
            permId: this.permId,
            permParam: this.permParam,
            permOpts: this.permOpts,
          })}
        </p>

        ${this.permOpts?.similar
          ? html`<label class="similar">
              <input
                type="checkbox"
                .checked=${this.allowSimilar}
                @change=${(e) => {
                  this.allowSimilar = e.target.checked;
                }}
              />
              <span>${this.permOpts.similar}</span>
            </label>`
          : ''}

        <div class="prompt-btns">
          <button class="btn prompt-reject" @click=${this.onClickDecision(false)}>Block</button>
          <button class="btn primary prompt-accept" @click=${this.onClickDecision(true)}>
            Allow
          </button>
        </div>

        ${this.isPermExperimental
          ? html` <div class="perm-experimental">
              <i class="fa fa-info-circle"></i>
              <span
                >This page is requesting an experimental feature. Only click 'Allow' if you trust
                this page.</span
              >
            </div>`
          : ''}
        ${this.isPermDangerous
          ? html` <div class="perm-experimental">
              <i class="fa fa-info-circle"></i>
              <span
                >${AI_ASKS[this.permId]?.caution || "Only click 'Allow' if you trust this page."}</span
              >
            </div>`
          : ''}
      </div>
    `;
  }

  onContextMenu(e) {
    e.preventDefault(); // disable context menu
  }

  // Allow with "allow similar" checked answers 'similar' (page control, ADR-0028).
  onClickDecision(v) {
    return (e) => this.resolve(v && this.allowSimilar ? 'similar' : v);
  }
}
PermPrompt.styles = [
  buttonsCSS,
  css`
    .wrapper {
      padding: 16px;
    }

    a {
      cursor: pointer;
      color: blue;
    }

    a:hover {
      text-decoration: underline;
    }

    p {
      margin-top: 0;
      font-weight: 500;
      font-size: 12.5px;
      word-break: break-word;
    }

    p.perm {
      font-weight: 400;
    }

    p.perm::first-letter {
      text-transform: uppercase;
    }

    p.perm i {
      margin-right: 3px;
      color: #777;
      font-size: 13px;
    }

    .perm-experimental {
      display: flex;
      background: #dfe8fa;
      color: #335291;
      font-size: 12.5px;
      padding: 10px;
      margin: 15px -15px -15px;
    }

    .perm-experimental i {
      color: #335291;
      padding-right: 8px;
      padding-top: 5px;
    }

    .similar {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: -4px 0 12px;
      font-size: 12px;
      line-height: 1.35;
      cursor: pointer;
    }

    .similar input {
      margin: 1px 0 0;
    }

    .plan-steps {
      margin: 6px 0;
      padding-left: 22px;
      max-height: 180px;
      overflow-y: auto;
    }

    .plan-steps li {
      margin: 2px 0;
    }

    .plan-what,
    .plan-note {
      color: #777;
    }

    .plan-note {
      display: block;
      font-size: 11.5px;
    }

    .prompt-btns {
      text-align: right;
    }

    @media (prefers-color-scheme: dark) {
      a {
        color: #8ab4f8;
      }

      p.perm i,
      .plan-what,
      .plan-note {
        color: #aaa;
      }

      .perm-experimental,
      .perm-experimental i {
        background: #2a3550;
        color: #b9c9ee;
      }

      code {
        color: #ddd;
      }
    }

    .prompt-btns button {
      margin-left: 5px;
    }
  `,
];

customElements.define('perm-prompt', PermPrompt);
