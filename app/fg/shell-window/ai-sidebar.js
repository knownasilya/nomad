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
      color: var(--text-color--default, #ddd);
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
      color: var(--text-color--default, #ddd);
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
    this._activity = [];
    this._model = '';
    this._think = true;
    this._effort = '';
    this._reasoningModel = null;
    this._visionModel = false; // conservative default — never offer screenshots until confirmed
    this._modelInfoCache = new Map();
    this._models = null;
    this._tools = null;
    this._toolsParamsKey = null;
    this._toolsOpen = false;
    this._sessions = [];
    this._sessionsOpen = false;
    this._loadModels();
  }

  // Chat/session storage is keyed by this — the resolved Drive's origin when there is one (so
  // editing hyper://siteA vs hyper://siteB in the SAME editor tab never shares a session), else
  // the tab's own origin (a plain web page).
  get _origin() {
    try {
      return new URL(this._driveUrl || this.activeTab?.url || '').origin;
    } catch {
      return '';
    }
  }

  get _driveBase() {
    return this._driveUrl && this._driveUrl.startsWith('hyper://') ? this._origin : null;
  }

  get _writable() {
    return !!(this._driveBase && this._driveWritable);
  }

  updated(changedProperties) {
    this.style.width = `${this.width}px`;
    const tabUrl = this.activeTab?.url || '';
    if (tabUrl !== this._loadedTabUrl) {
      this._loadedTabUrl = tabUrl;
      // If a turn is still streaming for the tab we're leaving, stop it — otherwise its next
      // chunk lands in whatever this.messages holds for the NEW tab once _loadDriveInfo below
      // replaces it, corrupting the new tab's (unrelated) session. _send()'s own captured-origin
      // guards are the other half of this: even a turn that's mid-flight when this fires will
      // still save to the session it actually belongs to, not wherever the UI has since moved on to.
      if (this.streaming) this._stopChat?.();
      this._loadDriveInfo();
    }
    if (changedProperties.has('messages') || changedProperties.has('streaming')) {
      this._scrollToBottom();
    }
  }

  // Resolves _driveUrl/_driveWritable for the active tab, THEN (since that can change _origin)
  // loads that origin's prefs/session. A plain hyper:// tab resolves locally; nomad://editor and
  // nomad://explorer ask the host app itself — see ai-shell.ts's resolveActiveDrive, which this
  // mirrors so the sidebar's own "read-only"/revert/Draft-Mode UI agrees with what the backend
  // actually targets.
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
    this._loadPrefs();
    this._loadSession();
  }

  // — site preferences: model/thinking/effort are a per-SITE choice (hyper://private/.ai-chat/…),
  // independent of which chat is open — picking a model applies going forward, isn't reset by
  // "New session" or reopening an older chat, and isn't part of any individual session's data. —

  async _loadPrefs() {
    const origin = this._origin;
    let prefs = null;
    try {
      prefs = await bg.aiShell.getSitePrefs(origin);
    } catch {
      /* none saved yet */
    }
    if (this._origin !== origin) return; // origin changed again while we were loading
    this._model = prefs?.model || '';
    this._think = prefs?.think !== false;
    this._effort = prefs?.effort || '';
    // Vision: prefer a saved manual choice (needed on servers modelInfo can't probe, e.g. LM
    // Studio / llama.cpp — anything without Ollama's /api/show); _refreshModelInfo() below will
    // still override this with a confident auto-detected answer when the probe succeeds.
    this._visionModel = prefs?.vision === true;
    this._refreshModelInfo();
  }

  async _savePrefs() {
    const origin = this._origin;
    if (!origin) return;
    try {
      await bg.aiShell.saveSitePrefs(origin, {
        model: this._model,
        think: this._think,
        effort: this._effort,
        vision: this._visionModel === true,
      });
    } catch {
      /* non-fatal */
    }
  }

  // — session persistence (per-origin, hyper://private/.ai-chat/…) —

  async _loadSession() {
    const origin = this._origin;
    this.streaming = false;
    try {
      const lastId = await bg.aiShell.getLastSessionId(origin);
      if (lastId) {
        const data = await bg.aiShell.loadSession(origin, lastId);
        if (data && this._origin === origin) {
          this.sessionId = lastId;
          this.messages = data.messages || [];
          return;
        }
      }
    } catch {
      /* fall through to a fresh session */
    }
    if (this._origin !== origin) return; // origin changed again while we were loading
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
  }

  // Always takes explicit (origin, sessionId, messages) rather than reading live state — a save
  // triggered from a turn that outlives the user switching tabs must still land on the session it
  // actually belongs to (see _send()'s captured turnOrigin/turnSessionId), not wherever this.origin
  // /this.sessionId happen to point by the time the save actually runs.
  async _saveSession(origin, sessionId, messages) {
    if (!origin || !sessionId) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser ? firstUser.content.trim().slice(0, 60) : '';
    try {
      await bg.aiShell.saveSession(origin, sessionId, { title, messages });
    } catch {
      /* non-fatal */
    }
  }

  async _newSession() {
    if (this.streaming) return;
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
    this._sessionsOpen = false;
    this.requestUpdate();
  }

  async _toggleSessions() {
    this._sessionsOpen = !this._sessionsOpen;
    if (this._sessionsOpen) {
      try {
        this._sessions = await bg.aiShell.listSessions(this._origin);
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
    const data = await bg.aiShell.loadSession(this._origin, id);
    this.sessionId = id;
    this.messages = data?.messages || [];
    this._sessionsOpen = false;
  }

  async _deleteSession(e, id) {
    e.stopPropagation();
    try {
      await bg.aiShell.deleteSession(this._origin, id);
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
        const { models } = await bg.aiShell.listModels();
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
    // Vision is really a per-model fact, not per-site, but prefs are stored per-site — so a
    // manual "yes" set for a different model must not silently carry over here. If the new
    // model's probe is confident, _refreshModelInfo() below overrides this right back.
    this._visionModel = false;
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
    this._savePrefs();
  }

  async _toggleTools() {
    this._toolsOpen = !this._toolsOpen;
    // Re-fetch not just on first open but whenever what would be offered has actually changed
    // (switching models can flip vision support; navigating can flip writability) — otherwise a
    // panel opened once early keeps showing a stale list for the rest of the tab's lifetime.
    const params = { allowWrite: this._writable, allowVision: this._visionModel === true };
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
    bg.views.createTab('nomad://webmcp?origin=' + encodeURIComponent(this._origin), {
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
      return html`<div class="sessions"><div class="sessions-empty">No past chats for this site yet.</div></div>`;
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
    const readOnly = this._driveBase && !this._writable;
    return html`
      ${readOnly
        ? html`<div class="note">This drive is read-only. Chat is available, but the agent can't edit files.</div>`
        : ''}
      ${this.messages.length === 0
        ? html`<div class="empty">
            Ask the assistant about this page.${this._writable
              ? ' Edits to this drive apply directly; use Revert to undo a turn.'
              : ''}
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
            (m) => html`<option value=${m} ?selected=${m === this._model}>${m}</option>`
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
      ${m.files && m.files.length ? this._renderCheckpoint(m, i) : ''}
    `;
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
          (f) => html`<div class="checkpoint-file">
            <span class="fas fa-fw fa-${f.priorContent === null ? 'plus' : 'pen'}"></span> ${f.path}
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

    // Captured once, up front — this turn belongs to THIS origin/session no matter what the user
    // does with the tab while it's in flight. The live this.messages only gets touched while
    // isCurrent() holds; the turn always keeps mutating its own local turnMessages regardless, and
    // the final save (in `finally`) always targets these captured values, never live state — so a
    // mid-stream tab switch can neither corrupt the new tab's session nor lose this turn's save.
    const turnOrigin = this._origin;
    const turnSessionId = this.sessionId;
    const isCurrent = () => this._origin === turnOrigin;

    // Draft Mode (ADR-0012): auto-enable on the FIRST turn of a session on a writable Drive, so
    // the agent's writes stage privately — the user reviews the whole Draft and Publishes/Discards.
    if (this.messages.length === 0 && this._writable) {
      try {
        await bg.fs.beginDraft(this._driveUrl);
      } catch (e) {
        console.warn('[ai-sidebar] beginDraft failed', e);
      }
      if (!isCurrent()) return; // navigated away during the awaited beginDraft above
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
        const msg = turnMessages[assistantIdx];
        if (msg && !msg.files.some((f) => f.path === e.path)) {
          turnMessages = [...turnMessages];
          turnMessages[assistantIdx] = {
            ...msg,
            files: [...msg.files, { path: e.path, priorContent: e.priorContent ?? null }],
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
          allowWrite: this._writable,
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
      await this._saveSession(turnOrigin, turnSessionId, turnMessages);
    }
  }

  _stop() {
    if (this._stopChat) this._stopChat();
  }

  async _revertTurn(msgIndex) {
    const msg = this.messages[msgIndex];
    const base = this._driveBase;
    if (!msg || !msg.files || msg.reverted || this.streaming || !base) return;
    const origin = this._origin;
    const sessionId = this.sessionId;
    for (const f of [...msg.files].reverse()) {
      try {
        const fileUrl = base + f.path;
        if (f.priorContent === null) {
          await bg.fs.unlink(fileUrl);
        } else {
          await bg.fs.writeFile(fileUrl, f.priorContent);
        }
        // Mirrors the 'write' tool-event tap in a live turn — lets editor/explorer reload the
        // affected buffer/listing after a revert, same as after the original write.
        await bg.aiShell.notifyAgentWroteFile(f.path);
      } catch (e) {
        console.error('[ai-sidebar] revert failed for', f.path, e);
      }
    }
    // Navigated away mid-revert: the files were still correctly restored on disk above, but the
    // live transcript now belongs to a different tab — leave it alone.
    if (this._origin !== origin) return;
    msg.reverted = true;
    this.messages = [...this.messages];
    await this._saveSession(origin, sessionId, this.messages);
    this.requestUpdate();
  }

  _scrollToBottom() {
    const el = this.renderRoot?.querySelector('.messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

customElements.define('shell-window-ai-sidebar', ShellWindowAiSidebar);
