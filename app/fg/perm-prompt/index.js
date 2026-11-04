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
  // The AI using one of the user's secrets (ADR-0033): the site in the tab didn't ask for it.
  aiSecretUse: {
    lead: 'The AI assistant wants to:',
    caution: "Only click 'Allow' if you asked the assistant to use this secret.",
  },
  // createDrive (bg/ai/create-drive.mjs): the drive goes in the user's library, not the site's.
  aiCreateDrive: {
    lead: 'The AI assistant wants to:',
  },
  // A Job on a run the user watches (ADR-0038): the page may be the one asking it to go further.
  jobPage: {
    lead: 'Your AI Job wants to:',
    caution: "Only click 'Allow' if this Job should use this site by itself.",
  },
  // A risky click on such a run (aiPageAction with `job`).
  jobAction: {
    lead: 'Your AI Job wants to:',
    caution: "Only click 'Allow' if this Job should do this.",
  },
};

// The request an aiSendData or aiSecretUse prompt is for (egress.mjs requestPreview): one line with
// its method and URL, a warning when it sends one of the user's secrets, and the rest (the whole
// URL, headers, body, where each secret goes) behind Details so the prompt stays small.
const REQUEST_PERMS = new Set(['aiSendData', 'aiSecretUse']);

function requestOf(permId, opts) {
  const r = REQUEST_PERMS.has(permId) ? opts?.request : null;
  if (!r || typeof r !== 'object' || typeof r.url !== 'string') return null;
  // A URL secret is the whole URL: the request has none of its own.
  return r.url || r.secrets?.length ? r : null;
}

const count = (n) => Number(n || 0).toLocaleString();

function hasMore(r) {
  return r.url.length > 34 || r.urlLength || r.headers?.length || r.body != null || r.secrets?.length;
}

const codes = (names) => names.map((n, i) => html`${i ? ', ' : ''}<code>${n}</code>`);

// What the yes covers, in the prompt's own terms.
function coversText(permId, permParam, r) {
  if (permId === 'aiSecretUse') {
    const hosts = r.secretDetails?.find((d) => d.name === permParam)?.hosts || [];
    return `Allowing lets the AI use ${permParam} for the rest of this answer${
      hosts.length ? `, only with ${hosts.join(', ')}` : ''
    }.`;
  }
  return `Allowing covers every request to ${permParam} for the rest of this answer.`;
}

function renderRequest(r, { permId, permParam, onToggle }) {
  const verb = r.kind === 'tab' ? 'Open' : r.method || 'GET';
  const bodyLabel = { json: 'Body (JSON)', form: 'Body (form)' }[r.bodyType] || 'Body';
  const bodySize = r.bodyLength || (r.body || '').length;
  const secrets = r.secrets || [];
  const details = r.secretDetails || [];
  return html`<div class="request">
    <div class="request-line" title=${r.url || 'The URL is one of your secrets'}>
      <span class="method">${verb}</span
      ><span class="url ${r.url ? '' : 'none'}">${r.url || 'URL from your secret'}</span>
    </div>
    ${secrets.length
      ? html`<div class="secret-warning">
          <i
            class="fas fa-exclamation-triangle"
            role="img"
            title="This request sends a secret"
            aria-label="Warning: this request sends a secret"
          ></i>
          <span
            >Sends your ${secrets.length > 1 ? 'secrets' : 'secret'} ${codes(secrets)}. Open
            Details to see where.</span
          >
        </div>`
      : ''}
    ${hasMore(r)
      ? html`<details @toggle=${onToggle}>
          <summary>Details</summary>
          <dl>
            ${r.url
              ? html`<dt>${r.kind === 'tab' ? 'Opens a tab at' : 'URL'}</dt>
                  <dd><code class="block url">${r.url}${r.urlLength ? '…' : ''}</code></dd>
                  ${r.urlLength
                    ? html`<dd class="cut">
                        Showing ${count(r.url.length)} of ${count(r.urlLength)} characters
                      </dd>`
                    : ''}`
              : ''}
            ${r.headers?.length
              ? html`<dt>Headers</dt>
                  <dd>
                    <code class="block"
                      >${r.headers.map((h) => html`<div><b>${h.name}:</b> ${h.value}</div>`)}</code
                    >
                  </dd>`
              : ''}
            ${r.body != null
              ? html`<dt>${bodyLabel}, ${count(bodySize)} characters</dt>
                  <dd>
                    <pre class="block">${r.body}${r.bodyLength ? '\n…' : ''}</pre>
                  </dd>
                  ${r.bodyLength
                    ? html`<dd class="cut">Showing the first ${count(r.body.length)}</dd>`
                    : ''}`
              : ''}
            ${secrets.length
              ? html`<dt class="warn">
                    <i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Your
                    ${secrets.length > 1 ? 'secrets' : 'secret'}
                  </dt>
                  ${secrets.map((name) => {
                    const d = details.find((x) => x.name === name);
                    return html`<dd class="secret">
                      <code>${name}</code>
                      ${d?.sentAs ? html`goes in ${d.sentAs}` : ''}${d?.hosts?.length
                        ? html`, only to ${d.hosts.join(', ')}`
                        : ''}.
                    </dd>`;
                  })}
                  <dd class="cut">Nomad adds the value; the AI never sees it.</dd>`
              : ''}
          </dl>
          <p class="covers">${coversText(permId, permParam, r)}</p>
        </details>`
      : ''}
  </div>`;
}

// A Job's own click asks under aiPageAction with `job` set: it reads as the Job's, like jobPage.
function aiAsk(permId, opts) {
  return AI_ASKS[permId] || (permId === 'aiPageAction' && opts?.job ? AI_ASKS.jobAction : null);
}

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
    this.fitHeight();

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
        <p>${aiAsk(this.permId, this.permOpts)?.lead || 'This site wants to:'}</p>
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
        ${requestOf(this.permId, this.permOpts)
          ? renderRequest(requestOf(this.permId, this.permOpts), {
              permId: this.permId,
              permParam: this.permParam,
              onToggle: () => this.fitHeight(),
            })
          : ''}
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
                >${aiAsk(this.permId, this.permOpts)?.caution || "Only click 'Allow' if you trust this page."}</span
              >
            </div>`
          : ''}
      </div>
    `;
  }

  // The prompt's window is as tall as what it shows: again when Details opens or closes.
  fitHeight() {
    var height = this.shadowRoot.querySelector('div').clientHeight | 0;
    bg.permPrompt.resizeSelf({ height });
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

    .request {
      margin: -4px 0 12px;
      font-size: 12px;
    }

    .request-line {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 5px 7px;
      border: 1px solid #ddd;
      border-radius: 3px;
      background: #f7f7f8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11.5px;
    }

    .request-line .method {
      flex: none;
      font-weight: 600;
      color: #555;
    }

    .request-line .url {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    details {
      margin-top: 6px;
    }

    summary {
      cursor: pointer;
      color: #555;
      user-select: none;
      width: max-content;
    }

    summary:focus-visible {
      outline: 2px solid #2864dc;
      outline-offset: 2px;
      border-radius: 2px;
    }

    dl {
      margin: 6px 0 0;
    }

    dt {
      margin-top: 8px;
      color: #666;
      font-size: 11.5px;
    }

    dd {
      margin: 3px 0 0;
    }

    dd.cut,
    .covers {
      color: #777;
      font-size: 11.5px;
    }

    .covers {
      margin: 8px 0 0;
      font-weight: 400;
    }

    .block {
      display: block;
      margin: 0;
      padding: 5px 7px;
      max-height: 120px;
      overflow: auto;
      border: 1px solid #e3e3e3;
      border-radius: 3px;
      background: #f7f7f8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    code.block.url {
      word-break: break-all;
    }

    code.block div + div {
      margin-top: 2px;
    }

    .request-line .url.none {
      font-family: inherit;
      font-style: italic;
      color: #666;
    }

    .secret-warning {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-top: 6px;
      padding: 5px 7px;
      border: 1px solid #f0d58c;
      border-radius: 3px;
      background: #fff8e1;
      color: #6b4e00;
      line-height: 1.35;
    }

    .secret-warning i,
    dt.warn i {
      color: #c58a00;
    }

    dd.secret {
      line-height: 1.4;
    }

    @media (prefers-color-scheme: dark) {
      a {
        color: #8ab4f8;
      }

      p.perm i,
      .plan-what,
      .plan-note,
      summary,
      dt,
      dd.cut,
      .covers,
      .request-line .method {
        color: #aaa;
      }

      .request-line,
      .block {
        background: #232325;
        border-color: #4a4a4e;
      }

      summary:focus-visible {
        outline-color: #8ab4f8;
      }

      .request-line .url.none {
        color: #aaa;
      }

      .secret-warning {
        background: #3a3120;
        border-color: #6b5520;
        color: #f1d9a0;
      }

      .secret-warning i,
      dt.warn i {
        color: #f0b429;
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
