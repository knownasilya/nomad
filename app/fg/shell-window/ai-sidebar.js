import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import * as bg from './bg-process-rpc';
import { fromEventStream } from '../../bg/web-apis/fg/event-target';
import { streamToAsyncIterator } from '../../bg/web-apis/fg/ai-stream';

// Minimal markdown -> HTML (headings, lists, code fences, inline emphasis/code). Mirrors the
// renderer chat-bubble/ai-sidebar used before the two were unified into this component.
function mdToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    s
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const tokens = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code', code: codeLines.join('\n') });
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      tokens.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }
    if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      tokens.push({ type: 'list', items });
      continue;
    }
    if (line.trim() === '') {
      tokens.push({ type: 'blank' });
      i++;
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^[-*] /) &&
      !lines[i].match(/^#{1,3} /)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'para', lines: paraLines });
  }

  const parts = tokens.map((t) => {
    if (t.type === 'code') return `<pre><code>${esc(t.code)}</code></pre>`;
    if (t.type === 'heading') {
      const tag = `h${t.level}`;
      return `<${tag}>${inline(esc(t.text))}</${tag}>`;
    }
    if (t.type === 'list')
      return `<ul>${t.items.map((s) => `<li>${inline(esc(s))}</li>`).join('')}</ul>`;
    if (t.type === 'para') return `<p>${t.lines.map((l) => inline(esc(l))).join('<br>')}</p>`;
    return '';
  });
  return parts.join('') || `<p>${inline(esc(text))}</p>`;
}

// Puts text on the clipboard. Falls back to a selected textarea + execCommand('copy') if the
// async Clipboard API is refused (as app-stdlib/js/clipboard.js does).
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

class ShellWindowAiSidebar extends LitElement {
  static get properties() {
    return {
      activeTab: { type: Object },
      width: { type: Number },
      messages: { type: Array },
      draft: { type: String },
      streaming: { type: Boolean },
      sessionId: { type: String },
      _activity: { state: true },
      _model: { state: true },
      _think: { state: true },
      _effort: { state: true },
      _reasoningModel: { state: true },
      _visionModel: { state: true },
      _models: { state: true },
      _tools: { state: true },
      _toolsOpen: { state: true },
      _sessions: { state: true },
      _sessionsOpen: { state: true },
      _copied: { state: true },
    };
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      background: var(--bg-color--background);
      border-left: 1px solid var(--border-color--tab);
      /* The shell's tokens (assets/css/design-tokens.css) have no --text-color--default; the
         input text color is its body text in both schemes. */
      color: var(--text-color--default, var(--text-color--input));
      font-size: 13px;
    }

    .resize-handle {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      cursor: ew-resize;
      z-index: 1;
    }

    .resize-handle:hover,
    .resize-handle:active {
      background: var(--highlight-color--tab--current, #5b5ef4);
      opacity: 0.3;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 6px 8px 12px;
      border-bottom: 1px solid var(--border-color--tab);
      flex-shrink: 0;
    }
    .title {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header-actions button {
      background: transparent;
      border: 0;
      color: var(--text-color--default, var(--text-color--input));
      opacity: 0.7;
      cursor: pointer;
      padding: 4px 6px;
    }
    .header-actions button:hover:not(:disabled) {
      opacity: 1;
    }
    .header-actions button.pressed {
      opacity: 1;
      color: var(--color--blue, #5c5cff);
    }
    .header-actions button:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .sessions {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
    }
    .session-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .session-row:hover {
      background: var(--bg-color--tab--hover);
    }
    .session-row.current {
      background: var(--bg-color--tab--current);
    }
    .session-row .info {
      flex: 1;
      min-width: 0;
    }
    .session-row .session-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-row .session-time {
      font-size: 11px;
      opacity: 0.6;
    }
    .session-row .delete-btn {
      background: transparent;
      border: 0;
      color: inherit;
      opacity: 0.5;
      cursor: pointer;
      padding: 4px;
    }
    .session-row .delete-btn:hover {
      opacity: 1;
    }
    .sessions-empty {
      padding: 20px 10px;
      text-align: center;
      opacity: 0.6;
      font-size: 12px;
    }

    .note {
      font-size: 11px;
      color: #eec98a;
      background: rgba(255, 200, 120, 0.08);
      padding: 6px 10px;
      border-bottom: 1px solid var(--border-color--tab);
    }
    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
      opacity: 0.6;
      font-size: 12px;
      font-style: italic;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .activity {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 2px 2px 4px;
      font-size: 12px;
    }
    .activity-item {
      display: flex;
      align-items: center;
      gap: 7px;
      opacity: 0.7;
    }
    .activity-item.active {
      opacity: 1;
    }
    .activity-item .fa-check {
      color: #7bb07b;
    }
    .msg {
      max-width: 90%;
      line-height: 1.45;
      padding: 8px 12px;
      border-radius: 12px;
      word-break: break-word;
      white-space: normal;
    }
    .msg.user {
      background: var(--color--blue, #5c5cff);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      white-space: pre-wrap;
    }
    .msg.assistant {
      background: var(--bg-color--tab--hover);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .msg.error {
      background: rgba(200, 60, 60, 0.12);
      border: 1px solid rgba(200, 60, 60, 0.4);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .msg.streaming::after {
      content: '▋';
      opacity: 0.6;
      margin-left: 1px;
    }
    .msg.assistant p,
    .msg.assistant ul,
    .msg.assistant pre,
    .msg.assistant h1,
    .msg.assistant h2,
    .msg.assistant h3 {
      margin: 0 0 6px 0;
    }
    .msg.assistant > *:last-child {
      margin-bottom: 0;
    }
    .msg.assistant code {
      background: rgba(127, 127, 127, 0.2);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 12px;
    }
    .msg.assistant pre {
      background: rgba(127, 127, 127, 0.15);
      border-radius: 6px;
      padding: 8px 10px;
      overflow-x: auto;
    }
    .msg.assistant pre code {
      background: none;
      padding: 0;
    }
    .checkpoint {
      align-self: flex-start;
      max-width: 90%;
      margin: -2px 0 2px;
      padding: 6px 8px;
      border: 1px solid var(--border-color--tab);
      border-radius: 8px;
      font-size: 11px;
    }
    .checkpoint.reverted {
      opacity: 0.55;
    }
    .checkpoint-file {
      padding: 1px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .checkpoint-drive {
      opacity: 0.65;
    }
    .revert-btn {
      margin-top: 4px;
      background: transparent;
      border: 1px solid var(--border-color--tab);
      color: inherit;
      border-radius: 6px;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .revert-btn:hover:not(:disabled) {
      background: var(--bg-color--tab--hover);
    }
    .reverted-label {
      opacity: 0.6;
      font-style: italic;
    }
    .screenshots {
      align-self: flex-start;
      max-width: 90%;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 4px;
    }
    .screenshot {
      display: block;
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border-color--tab);
      cursor: zoom-in;
    }

    .reasoning {
      margin: 0 0 6px;
      font-size: 12px;
      opacity: 0.65;
      align-self: flex-start;
      max-width: 90%;
    }
    .reasoning summary {
      cursor: pointer;
      user-select: none;
    }
    .reasoning .body {
      white-space: pre-wrap;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--border-color--tab);
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-top: 1px solid var(--border-color--tab);
      font-size: 12px;
      opacity: 0.85;
      flex-wrap: wrap;
    }
    .controls select {
      background: var(--bg-color--input, var(--bg-color--background));
      color: inherit;
      border: 1px solid var(--border-color--tab);
      border-radius: 6px;
      font: inherit;
      font-size: 12px;
      max-width: 150px;
      padding: 2px 4px;
    }
    .controls label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
    }
    .controls .link-btn {
      background: none;
      border: 0;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 0;
      margin-left: auto;
      text-decoration: underline;
    }
    .tools-panel {
      padding: 6px 10px;
      border-top: 1px solid var(--border-color--tab);
      font-size: 12px;
      max-height: 170px;
      overflow-y: auto;
    }
    .tools-panel h4 {
      margin: 8px 0 3px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.6;
    }
    .tools-panel h4:first-child {
      margin-top: 0;
    }
    .tools-panel .tool code {
      font-weight: 600;
    }
    .tools-panel .tool .d {
      opacity: 0.6;
    }
    .tools-panel .note {
      color: #e0a94a;
      background: none;
      border: 0;
      padding: 4px 0 0;
      margin-top: 4px;
    }
    .tools-panel a {
      color: var(--color--blue, #5c5cff);
    }

    .input-row {
      display: flex;
      gap: 6px;
      padding: 8px;
      border-top: 1px solid var(--border-color--tab);
      flex-shrink: 0;
    }
    .input {
      flex: 1;
      resize: none;
      height: 52px;
      background: var(--bg-color--input, var(--bg-color--background));
      color: inherit;
      border: 1px solid var(--border-color--tab);
      border-radius: 8px;
      padding: 7px 9px;
      font-family: inherit;
      font-size: 13px;
      outline: none;
    }
    .input:focus {
      border-color: var(--color--blue, #5c5cff);
    }
    .send-btn {
      flex-shrink: 0;
      align-self: stretch;
      background: var(--color--blue, #5c5cff);
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 0 14px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .send-btn.stop-btn {
      background: #333;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .stop-icon {
      width: 9px;
      height: 9px;
      background: #fff;
      border-radius: 2px;
      flex: none;
    }
    /* Copy, under each message: shown on hover, and always under the latest answer. */
    .msg-actions {
      display: flex;
      margin-top: -6px;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .msg-actions.user {
      align-self: flex-end;
    }
    .msg-actions.assistant,
    .msg-actions.error {
      align-self: flex-start;
    }
    .msg:hover + .msg-actions,
    .msg-actions:hover,
    .msg-actions:focus-within,
    .msg-actions.latest,
    .msg-actions.copied {
      opacity: 1;
    }
    .msg-action {
      background: transparent;
      border: 0;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 11px;
    }
    .msg-action:hover,
    .msg-actions.copied .msg-action {
      opacity: 1;
    }
    .msg-action:hover {
      background: var(--bg-color--tab--hover);
    }
    .msg-action .fa-check {
      color: #7bb07b;
    }
  `;

  constructor() {
    super();
    this.activeTab = null;
    this.width = 380;
    this.messages = [];
    this.draft = '';
    this.streaming = false;
    this.sessionId = '';
    this._loadedTabUrl = undefined;
    // { url, writable } for the Drive the active tab is really about — resolved async via
    // _loadDriveInfo() since for nomad://editor/explorer it isn't derivable from activeTab.url
    // alone (that's the app's own URL, never the Drive it has open — see ai-shell.ts).
    this._driveUrl = null;
    this._driveWritable = false;
    // Drives this conversation already started a Draft for (see _send).
    this._draftDrives = new Set();
    this._activity = [];
    this._model = '';
    this._think = true;
    this._effort = '';
    this._reasoningModel = null;
    this._visionModel = false; // conservative default — never offer screenshots until confirmed
    // The user's own "this model can see images", per model id ('' is the Settings default).
    this._visionByModel = {};
    this._modelInfoCache = new Map();
    this._models = null;
    this._tools = null;
    this._toolsParamsKey = null;
    this._toolsOpen = false;
    this._sessions = [];
    this._sessionsOpen = false;
    // The assistant is the user's, not a tab's (ADR-0021): one conversation and one model choice,
    // whatever tab is open.
    this._loadModels();
    this._loadPrefs();
    this._loadSession();
  }

  get _driveBase() {
    if (!this._driveUrl || !this._driveUrl.startsWith('hyper://')) return null;
    try {
      return new URL(this._driveUrl).origin;
    } catch {
      return null;
    }
  }

  get _writable() {
    return !!(this._driveBase && this._driveWritable);
  }

  updated(changedProperties) {
    this.style.width = `${this.width}px`;
    const tabUrl = this.activeTab?.url || '';
    if (tabUrl !== this._loadedTabUrl) {
      // A tab change doesn't touch the conversation or a running turn: the assistant can look at
      // the new tab with currentTab. Only the Drive info below follows the tab.
      this._loadedTabUrl = tabUrl;
      this._loadDriveInfo();
    }
    if (changedProperties.has('messages') || changedProperties.has('streaming')) {
      this._scrollToBottom();
    }
  }

  // Resolves _driveUrl/_driveWritable for the active tab. A plain hyper:// tab resolves locally;
  // nomad://editor and nomad://explorer ask the host app itself — see ai-shell.ts's
  // resolveActiveDrive, which this mirrors so the sidebar starts a Draft for the Drive the
  // backend sees.
  async _loadDriveInfo() {
    const tabUrl = this.activeTab?.url || '';
    let driveUrl = null;
    let writable = false;
    if (tabUrl.startsWith('nomad://editor') || tabUrl.startsWith('nomad://explorer')) {
      try {
        const info = await bg.aiShell.getActiveDriveInfo();
        driveUrl = info?.url || null;
        writable = !!info?.writable;
      } catch {
        /* leave null */
      }
    } else if (tabUrl.startsWith('hyper://')) {
      driveUrl = tabUrl;
      writable = !!this.activeTab?.writable;
    }
    if ((this.activeTab?.url || '') !== tabUrl) return; // tab changed again while we were loading
    this._driveUrl = driveUrl;
    this._driveWritable = writable;
  }

  // — preferences: one model/thinking/effort choice for the sidebar, saved on this device
  // (ADR-0021). It applies going forward, isn't reset by "New session" or reopening an older chat,
  // and isn't part of any session's data. —

  async _loadPrefs() {
    let prefs = null;
    try {
      prefs = await bg.aiShell.getPrefs();
    } catch {
      /* none saved yet */
    }
    this._model = prefs?.model || '';
    this._think = prefs?.think !== false;
    this._effort = prefs?.effort || '';
    this._visionByModel = prefs?.vision || {};
    // Vision: prefer a saved manual choice (needed on servers modelInfo can't probe, e.g. LM
    // Studio / llama.cpp — anything without Ollama's /api/show); _refreshModelInfo() below will
    // still override this with a confident auto-detected answer when the probe succeeds.
    this._visionModel = this._visionByModel[this._model] === true;
    this._refreshModelInfo();
  }

  async _savePrefs() {
    try {
      await bg.aiShell.savePrefs({
        model: this._model,
        think: this._think,
        effort: this._effort,
        vision: this._visionByModel,
      });
    } catch {
      /* non-fatal */
    }
  }

  // — session persistence (one list, hyper://private/.ai-chat/sessions/) —

  async _loadSession() {
    this.streaming = false;
    try {
      const lastId = await bg.aiShell.getLastSessionId();
      if (lastId) {
        const data = await bg.aiShell.loadSession(lastId);
        if (data) {
          this.sessionId = lastId;
          this.messages = data.messages || [];
          return;
        }
      }
    } catch {
      /* fall through to a fresh session */
    }
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
  }

  // Always takes explicit (sessionId, messages) rather than reading live state — a save triggered
  // from a turn must land on the session it belongs to (see _send()'s captured turnSessionId).
  async _saveSession(sessionId, messages) {
    if (!sessionId) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser ? firstUser.content.trim().slice(0, 60) : '';
    try {
      await bg.aiShell.saveSession(sessionId, { title, messages });
    } catch {
      /* non-fatal */
    }
  }

  async _newSession() {
    if (this.streaming) return;
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
    this._draftDrives = new Set();
    this._sessionsOpen = false;
    this.requestUpdate();
  }

  async _toggleSessions() {
    this._sessionsOpen = !this._sessionsOpen;
    if (this._sessionsOpen) {
      try {
        this._sessions = await bg.aiShell.listSessions();
      } catch {
        this._sessions = [];
      }
    }
  }

  async _switchToSession(id) {
    if (this.streaming || id === this.sessionId) {
      this._sessionsOpen = false;
      return;
    }
    const data = await bg.aiShell.loadSession(id);
    this.sessionId = id;
    this.messages = data?.messages || [];
    this._draftDrives = new Set();
    this._sessionsOpen = false;
  }

  async _deleteSession(e, id) {
    e.stopPropagation();
    try {
      await bg.aiShell.deleteSession(id);
    } catch {
      /* non-fatal */
    }
    this._sessions = this._sessions.filter((s) => s.id !== id);
    if (id === this.sessionId) await this._newSession();
  }

  // — model / thinking / tools —

  async _loadModels() {
    if (!this._models) {
      try {
        const { models, labels } = await bg.aiShell.listModels();
        this._modelLabels = labels || {};
        this._models = models || [];
      } catch {
        this._models = [];
      }
    }
    this._refreshModelInfo();
  }

  // Vision is only ever set here when the probe actually confirms an answer (probed:true) —
  // otherwise this._visionModel is left as whatever the caller (a saved site pref, or a reset to
  // false on manual model change) already put there, since plenty of servers (LM Studio,
  // llama.cpp, anything without Ollama's /api/show) can't be probed at all and a wrong "no
  // vision" from a failed probe shouldn't stomp a preference the user set by hand.
  async _refreshModelInfo() {
    const m = this._model;
    if (!m) {
      this._reasoningModel = true;
      return;
    }
    if (this._modelInfoCache.has(m)) {
      const cached = this._modelInfoCache.get(m);
      this._reasoningModel = cached.reasoning;
      if (cached.probed) this._visionModel = cached.vision;
      return;
    }
    try {
      const info = await bg.aiShell.modelInfo(m);
      const cached = {
        reasoning: info?.reasoning !== false,
        vision: info?.vision === true,
        probed: !!info?.probed,
      };
      this._modelInfoCache.set(m, cached);
      if (this._model === m) {
        this._reasoningModel = cached.reasoning;
        if (cached.probed) this._visionModel = cached.vision;
      }
    } catch {
      this._reasoningModel = true;
    }
  }

  async _onModelChange(e) {
    this._model = e.target.value;
    // Vision is a per-model fact: start from the user's own choice for this model. If the new
    // model's probe is confident, _refreshModelInfo() below overrides it.
    this._visionModel = this._visionByModel[this._model] === true;
    // Awaited — saving prefs before the probe resolves would persist this reset-to-false instead
    // of whatever the (possibly async, possibly confident) probe determines a moment later.
    await this._refreshModelInfo();
    this._savePrefs();
  }

  _onThinkChange(e) {
    this._think = e.target.checked;
    this._savePrefs();
  }

  _onEffortChange(e) {
    this._effort = e.target.value;
    this._savePrefs();
  }

  _onVisionChange(e) {
    this._visionModel = e.target.checked;
    this._visionByModel = { ...this._visionByModel, [this._model]: this._visionModel };
    this._savePrefs();
  }

  async _toggleTools() {
    this._toolsOpen = !this._toolsOpen;
    // Re-fetch not just on first open but whenever what would be offered has actually changed
    // (switching models can flip vision support; navigating can flip writability) — otherwise a
    // panel opened once early keeps showing a stale list for the rest of the tab's lifetime.
    const params = { allowVision: this._visionModel === true };
    const paramsKey = JSON.stringify(params);
    if (this._toolsOpen && (!this._tools || this._toolsParamsKey !== paramsKey)) {
      try {
        this._tools = await bg.aiShell.listTools(params);
        this._toolsParamsKey = paramsKey;
      } catch {
        this._tools = { builtin: [], page: [] };
      }
    }
  }

  _openInspector() {
    let origin = '';
    try {
      origin = new URL(this.activeTab?.url || '').origin;
    } catch {
      /* no tab */
    }
    bg.views.createTab('nomad://webmcp?origin=' + encodeURIComponent(origin), {
      setActive: true,
    });
  }

  // — resize (mirrors shell-window-sidebar's drag handle) —

  _onResizeMousedown(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.width;
    const onMove = (ev) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW - (ev.clientX - startX)));
      this.width = w;
      bg.views.setAiSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      bg.beakerBrowser.setSetting('ai_sidebar_width', String(this.width));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // — render —

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="resize-handle" @mousedown=${this._onResizeMousedown}></div>
      <div class="header">
        <span class="title"><span class="fas fa-fw fa-robot"></span> AI</span>
        <span class="header-actions">
          <button
            class="${this._sessionsOpen ? 'pressed' : ''}"
            title="Chat history"
            @click=${this._toggleSessions}
          >
            <span class="fas fa-fw fa-history"></span>
          </button>
          <button title="New session" @click=${this._newSession} ?disabled=${this.streaming}>
            <span class="fas fa-fw fa-plus"></span>
          </button>
          <button title="Close" @click=${() => bg.views.toggleAiSidebarOpen('active')}>
            <span class="fas fa-fw fa-times"></span>
          </button>
        </span>
      </div>
      ${!this.activeTab
        ? html`<div class="empty">No active tab</div>`
        : this._sessionsOpen
          ? this._renderSessions()
          : this._renderChat()}
    `;
  }

  _renderSessions() {
    if (!this._sessions.length) {
      return html`<div class="sessions"><div class="sessions-empty">No past chats yet.</div></div>`;
    }
    return html`
      <div class="sessions">
        ${this._sessions.map(
          (s) => html`
            <div
              class="session-row ${s.id === this.sessionId ? 'current' : ''}"
              @click=${() => this._switchToSession(s.id)}
            >
              <div class="info">
                <div class="session-title">${s.title || 'New chat'}</div>
                <div class="session-time">${s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''}</div>
              </div>
              <button class="delete-btn" title="Delete" @click=${(e) => this._deleteSession(e, s.id)}>
                <span class="fas fa-fw fa-trash-alt"></span>
              </button>
            </div>
          `
        )}
      </div>
    `;
  }

  _renderChat() {
    return html`
      ${this.messages.length === 0
        ? html`<div class="empty">
            Ask the assistant anything. It can see the tab you're on, and it can work with any drive you
            name. Use Revert to undo a turn's edits.
          </div>`
        : html`<div class="messages">
            ${this.messages.map((m, i) => this._renderMessage(m, i))}
            ${this.streaming && !(this.messages[this.messages.length - 1]?.content || '').trim()
              ? this._renderActivity()
              : ''}
          </div>`}
      ${this._toolsOpen ? this._renderTools() : ''}
      <div class="controls">
        <select title="Model" .value=${this._model} @change=${this._onModelChange} ?disabled=${this.streaming}>
          <option value="">Default</option>
          ${[...new Set([...(this._models || []), ...(this._model ? [this._model] : [])])].map(
            (m) => html`<option value=${m} ?selected=${m === this._model}>${this._modelLabels?.[m] || m}</option>`
          )}
        </select>
        <label title="Let the model show its reasoning; uncheck to ask it to skip thinking">
          <input type="checkbox" .checked=${this._think} @change=${this._onThinkChange} ?disabled=${this.streaming} />
          Thinking
        </label>
        ${this._think && this._reasoningModel !== false
          ? html`<select title="Reasoning effort" .value=${this._effort} @change=${this._onEffortChange} ?disabled=${this.streaming}>
              <option value="">Effort</option>
              <option value="low" ?selected=${this._effort === 'low'}>Low</option>
              <option value="medium" ?selected=${this._effort === 'medium'}>Medium</option>
              <option value="high" ?selected=${this._effort === 'high'}>High</option>
            </select>`
          : ''}
        <label
          title="Offer the screenshot tool for this model. Auto-detected on servers that support it (Ollama); switch on by hand elsewhere if your model supports image input."
        >
          <input
            type="checkbox"
            .checked=${this._visionModel === true}
            @change=${this._onVisionChange}
            ?disabled=${this.streaming}
          />
          Vision
        </label>
        <button class="link-btn" @click=${this._toggleTools}>${this._toolsOpen ? 'Hide tools' : 'Tools'}</button>
      </div>
      <div class="input-row">
        <textarea
          class="input"
          .value=${this.draft}
          placeholder="Ask something…"
          @input=${(e) => (this.draft = e.target.value)}
          @keydown=${this._onKeydown}
          ?disabled=${this.streaming}
        ></textarea>
        ${this.streaming
          ? html`<button class="send-btn stop-btn" @click=${this._stop} title="Stop">
              <span class="stop-icon"></span>Stop
            </button>`
          : html`<button class="send-btn" @click=${this._send} ?disabled=${!this.draft.trim()}>Send</button>`}
      </div>
    `;
  }

  _renderTools() {
    const t = this._tools;
    if (!t) return html`<div class="tools-panel">Loading…</div>`;
    return html`
      <div class="tools-panel">
              <h4>Built-in</h4>
              ${(t.builtin || []).map(
                (x) => html`<div class="tool"><code>${x.name}</code> <span class="d">${x.description}</span></div>`
              )}
              ${t.capabilities && t.capabilities.length
                ? html`
                    <h4>Capabilities</h4>
                    ${t.capabilities.map(
                      (x) => html`<div class="tool"><code>${x.name}</code> <span class="d">${x.description}</span></div>`
                    )}
                  `
                : ''}
        ${t.page && t.page.length
          ? html`
              <h4>From this page (${t.page.length})</h4>
              ${t.page.map(
                (x) => html`<div class="tool"><code>${x.name}</code> <span class="d">${x.description}</span></div>`
              )}
              ${t.pageGranted !== 1
                ? html`<div class="note">The assistant will ask before using these.</div>`
                : ''}
              <div style="margin-top:6px">
                <a
                  href="#"
                  @click=${(e) => {
                    e.preventDefault();
                    this._openInspector();
                  }}
                  >Open in WebMCP Inspector →</a
                >
              </div>
            `
          : ''}
      </div>
    `;
  }

  _renderMessage(m, i) {
    const streamingLast = i === this.messages.length - 1 && this.streaming;
    const body =
      m.role === 'assistant'
        ? unsafeHTML(mdToHtml((m.content || '').trim()))
        : (m.content || '').trim();
    const reasoning =
      m.role === 'assistant' && m.reasoning && m.reasoning.trim()
        ? html`<details class="reasoning" ?open=${streamingLast && !m.content}>
            <summary>Thoughts</summary>
            <div class="body">${m.reasoning.trim()}</div>
          </details>`
        : '';
    return html`
      ${reasoning}
      ${m.images && m.images.length
        ? html`<div class="screenshots">
            ${m.images.map(
              (src) => html`<img
                class="screenshot"
                src=${src}
                title="Click to open full size in a new tab"
                @click=${() => bg.views.createTab(src, { setActive: true })}
              />`
            )}
          </div>`
        : ''}
      <div class="msg ${m.role}${streamingLast ? ' streaming' : ''}">${body}</div>
      ${!streamingLast && (m.content || '').trim()
        ? html`<div class="msg-actions ${m.role}${this._isLatestAnswer(i) ? ' latest' : ''}${this._copied === i ? ' copied' : ''}">
            <button
              class="msg-action"
              title=${m.role === 'user' ? 'Copy your message' : 'Copy the answer as Markdown'}
              @click=${() => this._copyMessage(m, i)}
            >
              ${this._copied === i
                ? html`<span class="fas fa-fw fa-check"></span> Copied`
                : html`<span class="far fa-fw fa-copy"></span> Copy`}
            </button>
          </div>`
        : ''}
      ${m.files && m.files.length ? this._renderCheckpoint(m, i) : ''}
    `;
  }

  // The last message, when it is a finished answer: its Copy shows without a hover.
  _isLatestAnswer(i) {
    return i === this.messages.length - 1 && !this.streaming && this.messages[i].role === 'assistant';
  }

  // A prompt is copied as typed, an answer as the Markdown it arrived in.
  async _copyMessage(m, i) {
    await writeClipboard((m.content || '').trim());
    this._copied = i;
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => (this._copied = null), 1500);
  }

  _renderActivity() {
    const items = this._activity;
    return html`
      <div class="activity">
        ${items.length === 0
          ? html`<div class="activity-item active"><span class="fas fa-fw fa-spinner fa-spin"></span> Thinking…</div>`
          : items.map(
              (a, i) => html`<div class="activity-item ${i === items.length - 1 ? 'active' : ''}">
                <span class="fas fa-fw ${i === items.length - 1 ? 'fa-spinner fa-spin' : 'fa-check'}"></span>
                ${a.summary}
              </div>`
            )}
      </div>
    `;
  }

  _renderCheckpoint(m, i) {
    return html`
      <div class="checkpoint ${m.reverted ? 'reverted' : ''}">
        ${m.files.map(
          (f) => html`<div class="checkpoint-file" title=${f.drive ? f.drive + f.path : f.path}>
            <span class="fas fa-fw fa-${f.priorContent === null ? 'plus' : 'pen'}"></span> ${f.path}
            ${f.drive && f.drive !== this._driveBase
              ? html`<span class="checkpoint-drive">in ${f.drive.replace(/^hyper:\/\/([0-9a-f]{6})[0-9a-f]{58}$/i, 'hyper://$1…')}</span>`
              : ''}
          </div>`
        )}
        ${m.reverted
          ? html`<span class="reverted-label">Reverted</span>`
          : html`<button class="revert-btn" @click=${() => this._revertTurn(i)} ?disabled=${this.streaming}>
              <span class="fas fa-fw fa-undo"></span> Revert this turn
            </button>`}
      </div>
    `;
  }

  // — events —

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  async _send() {
    const text = this.draft.trim();
    if (!text || this.streaming || !this.activeTab) return;

    // Captured once, up front — this turn belongs to THIS session. A tab switch doesn't change
    // that (ADR-0021). The live this.messages only gets touched while isCurrent() holds; the turn
    // always keeps mutating its own local turnMessages regardless, and the final save (in
    // `finally`) always targets turnSessionId, never live state.
    const turnSessionId = this.sessionId;
    const isCurrent = () => this.sessionId === turnSessionId;

    // Draft Mode (ADR-0012): the first time this conversation is used on a writable Drive, start
    // a Draft for it, so the agent's writes there stage privately — the user reviews the whole
    // Draft and Publishes/Discards.
    const tabDrive = this._writable ? this._driveBase : null;
    if (tabDrive && !this._draftDrives.has(tabDrive)) {
      this._draftDrives.add(tabDrive);
      try {
        await bg.fs.beginDraft(this._driveUrl);
      } catch (e) {
        console.warn('[ai-sidebar] beginDraft failed', e);
      }
    }

    this.draft = '';
    this.streaming = true;
    this._activity = [];

    let turnMessages = [...this.messages, { role: 'user', content: text }];
    const assistantIdx = turnMessages.length;
    // one Checkpoint per assistant turn: files[] captures {path, priorContent}
    turnMessages = [...turnMessages, { role: 'assistant', content: '', reasoning: '', files: [] }];
    this.messages = turnMessages;
    await this.updateComplete;

    // Mirror the turn's local state into the live UI — but only while we're still looking at the
    // tab this turn started on; otherwise this.messages belongs to whatever tab is active now.
    const sync = () => {
      if (!isCurrent()) return;
      this.messages = turnMessages;
      this.requestUpdate();
    };

    const onToolEvent = (e) => {
      if (e.phase === 'start') {
        if (isCurrent()) this._activity = [...this._activity, { name: e.name, summary: e.summary }];
      } else if (e.phase === 'write' && e.path) {
        // Each file keeps its drive: the assistant can write to any drive the user names.
        const msg = turnMessages[assistantIdx];
        const drive = e.drive || tabDrive || this._driveBase;
        if (msg && !msg.files.some((f) => f.path === e.path && f.drive === drive)) {
          turnMessages = [...turnMessages];
          turnMessages[assistantIdx] = {
            ...msg,
            files: [...msg.files, { drive, path: e.path, priorContent: e.priorContent ?? null }],
          };
        }
      } else if (e.phase === 'screenshot' && e.imageDataUrl) {
        // The model only gets a text description back from the tool call — show the actual
        // image to the human here, since otherwise nobody but the model ever sees it.
        const msg = turnMessages[assistantIdx];
        if (msg) {
          turnMessages = [...turnMessages];
          turnMessages[assistantIdx] = { ...msg, images: [...(msg.images || []), e.imageDataUrl] };
        }
      }
      sync();
    };

    const onReasoning = (chunk) => {
      const cur = turnMessages[assistantIdx];
      if (!cur) return;
      turnMessages = [...turnMessages];
      turnMessages[assistantIdx] = { ...cur, reasoning: (cur.reasoning || '') + chunk };
      sync();
    };

    let stopped = false;
    let iterator = null;
    try {
      // 'error' is a UI-only pseudo-role (a failed turn's bubble) — the runtime only accepts
      // system/user/assistant/tool/developer, so a past failure must never be replayed as history.
      const history = turnMessages
        .slice(0, assistantIdx)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const eventTarget = fromEventStream(
        bg.aiShell.chat(history, {
          model: this._model || undefined,
          think: this._think,
          effort: this._think ? this._effort || undefined : undefined,
          allowVision: this._visionModel === true,
        })
      );
      eventTarget.addEventListener('tool', (e) => onToolEvent(e));
      eventTarget.addEventListener('reasoning', (e) => onReasoning(e.text));
      iterator = streamToAsyncIterator(eventTarget);
      this._stopChat = () => {
        stopped = true;
        iterator.return?.();
      };

      let lastPaint = performance.now();
      while (true) {
        const { value: chunk, done } = await iterator.next();
        if (done) break;
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = {
          ...turnMessages[assistantIdx],
          content: (turnMessages[assistantIdx].content || '') + chunk,
        };
        const now = performance.now();
        if (now - lastPaint >= 16) {
          sync();
          await this.updateComplete;
          await new Promise((r) => requestAnimationFrame(r));
          lastPaint = performance.now();
        }
      }
      sync();
      await this.updateComplete;
    } catch (err) {
      if (!stopped) {
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = {
          role: 'error',
          content: `Error: ${err.message}`,
          files: turnMessages[assistantIdx]?.files || [],
        };
      }
    } finally {
      iterator?.return?.();
      this._stopChat = null;
      if (isCurrent()) {
        this.streaming = false;
        this._activity = [];
      }
      const cur = turnMessages[assistantIdx];
      if (stopped && cur && cur.role === 'assistant' && !cur.content) {
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = { ...cur, content: '_Stopped._' };
      }
      sync();
      await this._saveSession(turnSessionId, turnMessages);
    }
  }

  _stop() {
    if (this._stopChat) this._stopChat();
  }

  async _revertTurn(msgIndex) {
    const msg = this.messages[msgIndex];
    if (!msg || !msg.files || msg.reverted || this.streaming) return;
    const sessionId = this.sessionId;
    for (const f of [...msg.files].reverse()) {
      const base = f.drive;
      if (!base) continue;
      try {
        const fileUrl = base + f.path;
        if (f.priorContent === null) {
          await bg.fs.unlink(fileUrl);
        } else {
          await bg.fs.writeFile(fileUrl, f.priorContent);
        }
        // Mirrors the 'write' tool-event tap in a live turn — lets editor/explorer reload the
        // affected buffer/listing after a revert, same as after the original write.
        await bg.aiShell.notifyAgentWroteFile(f.path, base);
      } catch (e) {
        console.error('[ai-sidebar] revert failed for', f.path, e);
      }
    }
    // Switched sessions mid-revert: the files were still restored above, but the live transcript
    // is another session now — leave it alone.
    if (this.sessionId !== sessionId) return;
    msg.reverted = true;
    this.messages = [...this.messages];
    await this._saveSession(sessionId, this.messages);
    this.requestUpdate();
  }

  _scrollToBottom() {
    const el = this.renderRoot?.querySelector('.messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

customElements.define('shell-window-ai-sidebar', ShellWindowAiSidebar);
