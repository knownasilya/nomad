import {
  LitElement,
  html,
} from 'lit';
import viewCSS from '../../css/views/ai.css.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';

class AiSettingsView extends LitElement {
  static get properties() {
    return {
      settings: { type: Object },
      testStatus: { type: Object },
      availableModels: { type: Array },
      catalog: { type: Object },
      keepAwakeStatus: { type: Object },
    };
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.settings = undefined;
    this.testStatus = null; // null | 'testing' | {ok, models} | {error}
    this.availableModels = null; // null until the active runtime's catalogue loads
    this.modelLabels = {}; // value -> readable name, when the runtime gives one (the Claude CLI does)
    this.catalog = null; // { active, model, runtimes } from nomad.ai.listRuntimes()
    this.draft = { name: '', baseUrl: '', accessToken: '' };
    this.keepAwakeStatus = null; // {holding, paused, onBattery, unsupported} from bg/ai/awake.js
  }

  async load() {
    try {
      this.catalog = await nomad.ai.listRuntimes();
    } catch {
      this.catalog = { active: '', model: '', runtimes: [] };
    }
    this.settings = await nomad.browser.getSettings();
    await this.refreshModels();
    this.refreshKeepAwake();
    this.requestUpdate();
  }

  unload() {}

  async refreshKeepAwake() {
    try {
      this.keepAwakeStatus = await nomad.browser.getAiKeepAwakeStatus();
    } catch {
      this.keepAwakeStatus = null;
    }
    this.requestUpdate();
  }

  // rendering
  // =

  render() {
    if (!this.settings) return html``;
    const model = this.settings.ai_default_model || '';
    const runtimes = this.catalog?.runtimes || [];
    const activeId = this.catalog?.active || this.settings.ai_active || '';
    const active = runtimes.find((runtime) => runtime.id === activeId);
    const servers = Array.isArray(this.settings.ai_servers) ? this.settings.ai_servers : [];
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="form-group">
        <h2>
          AI
          <span class="badge-experimental">Experimental</span>
        </h2>
        <div class="section">
          <p>
            Nomad uses one runtime at a time. Claude and Cursor show up here when
            they are installed on this computer. OpenAI-compatible servers
            (Ollama, LM Studio, or any other <code>/v1</code> API) can be named
            and kept side by side.
          </p>
          <p>
            A program on this computer can also call the assistant's
            <code>search</code> and <code>execute</code> tools at
            <code>http://127.0.0.1:47655/mcp</code>.
            <a href="https://nomad.pages.dev/docs/api/apis/nomad.ai/" target="_blank">API documentation</a>
          </p>
        </div>
        <div class="section">
          <label>Active runtime</label>
          <p class="description">
            Chat, including the AI sidebar, uses the selected runtime and the model below.
          </p>
          ${runtimes.length
            ? runtimes.map((runtime) => this.renderRuntime(runtime, active, servers))
            : html`<p class="description">No runtimes found yet. Add an OpenAI-compatible server below.</p>`}
          ${this.renderRuntimeNote(active)}
          <label for="ai-server-name" style="margin-top: 14px">Add an OpenAI server</label>
          <div class="server-add">
            <input
              id="ai-server-name"
              type="text"
              placeholder="Name"
              .value=${this.draft.name}
              @input=${(e) => {
                this.draft.name = e.target.value;
              }}
            />
            <input
              type="text"
              placeholder="http://127.0.0.1:11434/v1"
              .value=${this.draft.baseUrl}
              @input=${(e) => {
                this.draft.baseUrl = e.target.value;
              }}
            />
            <input
              type="password"
              placeholder="Token (optional)"
              autocomplete="off"
              .value=${this.draft.accessToken}
              @input=${(e) => {
                this.draft.accessToken = e.target.value;
              }}
            />
            <button class="btn" @click=${this.onAddServer}>Add</button>
          </div>
        </div>
        <div class="section">
          <label for="ai-default-model">Model</label>
          <p class="description">
            Used for AI chat unless a site picks a different one in the AI sidebar.
          </p>
          ${this.availableModels && this.availableModels.length
            ? html`
                <select id="ai-default-model" style="width: 260px" @change=${this.onAiDefaultModelChange}>
                  <option value="" ?selected=${!model}>— none —</option>
                  ${[...new Set([...this.availableModels, ...(model ? [model] : [])])].map(
                    (m) => html`<option value="${m}" ?selected=${m === model}>${this.modelLabels[m] || m}</option>`
                  )}
                </select>
              `
            : html`
                <input
                  id="ai-default-model"
                  type="text"
                  style="width: 260px"
                  value="${model}"
                  placeholder="Model name"
                  @change=${this.onAiDefaultModelChange}
                />
              `}
          ${active?.kind !== 'claude' && active?.kind !== 'cursor' ? this.renderTestStatus() : ''}
        </div>
        <div class="section">
          <label>
            <input
              type="checkbox"
              ?checked=${!!this.settings.ai_share_provider}
              @change=${this.onShareProviderChange}
            />
            Share this device's AI with my other devices
          </label>
          <p class="description">
            When on, your other paired devices (e.g. your phone) can run
            <code>nomad.ai.chat()</code> through this device's runtime when they
            have none of their own. Requests are limited to devices in your Vault.
            Off by default, since your runtime may be metered or run on battery.
          </p>
          ${this.renderKeepAwake()}
        </div>
      </div>
    `;
  }

  renderTestStatus() {
    if (!this.testStatus || this.testStatus === 'testing') return html``;
    if (this.testStatus.ok) {
      const label = this.testStatus.models === 1
        ? '1 model available'
        : `${this.testStatus.models} models available`;
      return html`<p class="test-status ok"><span class="fas fa-check-circle"></span> Connected — ${label}</p>`;
    }
    return html`<p class="test-status err"><span class="fas fa-times-circle"></span> ${this.testStatus.error}</p>`;
  }

  renderRuntime(runtime, active, servers) {
    const on = active && active.id === runtime.id;
    const saved = servers.find((server) => server.id === runtime.id);
    return html`
      <div class="runtime">
        <label class="runtime-pick">
          <input
            type="radio"
            name="ai-runtime"
            .checked=${on}
            @change=${() => this.onPickRuntime(runtime)}
          />
          <span>
            ${runtime.name}
            <span class="runtime-kind">${runtime.detected ? 'Detected' : 'OpenAI server'}</span>
          </span>
        </label>
        ${on && saved
          ? html`
              <div class="server-edit">
                <input
                  type="text"
                  .value=${saved.name}
                  @change=${(e) => this.onEditServer(saved.id, { name: e.target.value })}
                />
                <input
                  type="text"
                  .value=${saved.baseUrl}
                  @change=${(e) => this.onEditServer(saved.id, { baseUrl: e.target.value })}
                />
                <input
                  type="password"
                  placeholder="Token (optional)"
                  autocomplete="off"
                  .value=${saved.accessToken || ''}
                  @change=${(e) => this.onEditServer(saved.id, { accessToken: e.target.value })}
                />
                <button class="btn" ?disabled=${this.testStatus === 'testing'} @click=${() => this.onTestConnection(saved.baseUrl)}>
                  ${this.testStatus === 'testing' ? 'Testing…' : 'Test'}
                </button>
                <button class="btn" @click=${() => this.onRemoveServer(saved.id)}>Remove</button>
              </div>
            `
          : ''}
        ${on && runtime.kind === 'openai' && !saved
          ? html`
              <div class="server-edit">
                <span class="description">${runtime.baseUrl}</span>
                <button class="btn" ?disabled=${this.testStatus === 'testing'} @click=${() => this.onTestConnection(runtime.baseUrl)}>
                  ${this.testStatus === 'testing' ? 'Testing…' : 'Test'}
                </button>
              </div>
            `
          : ''}
      </div>
    `;
  }

  renderRuntimeNote(active) {
    if (!active) return '';
    if (active.kind === 'claude') {
      return html`
        <div class="server-edit">
          <p class="description">Claude uses the login already on this computer. Its shell and file tools stay off. Nomad's search and execute stay available.</p>
          <button class="btn" ?disabled=${this.testStatus === 'testing'} @click=${() => this.onTestConnection('claude')}>
            ${this.testStatus === 'testing' ? 'Testing…' : 'Test'}
          </button>
        </div>
        ${this.renderTestStatus()}
      `;
    }
    if (active.kind === 'cursor') {
      return html`
        <div class="server-edit">
          <p class="description">Cursor answers in ask mode with the login already on this computer, and does not edit files from this chat.</p>
          <button class="btn" ?disabled=${this.testStatus === 'testing'} @click=${() => this.onTestConnection('cursor')}>
            ${this.testStatus === 'testing' ? 'Testing…' : 'Test'}
          </button>
        </div>
        ${this.renderTestStatus()}
      `;
    }
    return '';
  }

  async refreshModels() {
    try {
      const { models, labels } = await nomad.ai.listModels();
      this.modelLabels = labels || {};
      this.availableModels = models || [];
    } catch {
      this.availableModels = null;
    }
  }

  servers() {
    return Array.isArray(this.settings.ai_servers) ? this.settings.ai_servers.slice() : [];
  }

  async saveServers(servers, activeId) {
    this.settings.ai_servers = servers;
    await nomad.browser.setSetting('ai_servers', servers);
    if (activeId !== undefined) {
      this.settings.ai_active = activeId;
      await nomad.browser.setSetting('ai_active', activeId);
    }
    await this.syncLegacy(activeId);
    this.catalog = await nomad.ai.listRuntimes();
    await this.refreshModels();
    this.requestUpdate();
  }

  async syncLegacy(activeId) {
    const id = activeId === undefined ? this.settings.ai_active : activeId;
    const server = this.servers().find((entry) => entry.id === id);
    const detected = (this.catalog?.runtimes || []).find((entry) => entry.id === id && entry.kind === 'openai');
    const baseUrl = server?.baseUrl || detected?.baseUrl || '';
    const token = server?.accessToken || '';
    if (baseUrl) {
      this.settings.ai_base_url = baseUrl;
      this.settings.ai_access_token = token;
      await nomad.browser.setSetting('ai_base_url', baseUrl);
      await nomad.browser.setSetting('ai_access_token', token);
    }
  }

  async onPickRuntime(runtime) {
    this.settings.ai_active = runtime.id;
    await nomad.browser.setSetting('ai_active', runtime.id);
    await this.syncLegacy(runtime.id);
    this.catalog = await nomad.ai.listRuntimes();
    this.testStatus = null;
    await this.refreshModels();
    this.requestUpdate();
    toast.create(`${runtime.name} is the active runtime`);
  }

  async onAddServer() {
    const name = this.draft.name.trim();
    const baseUrl = this.draft.baseUrl.trim();
    if (!name || !baseUrl) {
      toast.create('Name and base URL are both required');
      return;
    }
    const id = `srv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const servers = this.servers();
    servers.push({ id, name, baseUrl, accessToken: this.draft.accessToken || '' });
    this.draft = { name: '', baseUrl: '', accessToken: '' };
    await this.saveServers(servers, id);
    toast.create('Server added');
  }

  async onEditServer(id, patch) {
    const servers = this.servers().map((server) => (server.id === id ? { ...server, ...patch } : server));
    if (typeof patch.name === 'string') {
      const name = patch.name.trim();
      if (!name) {
        this.requestUpdate();
        return;
      }
      servers.find((server) => server.id === id).name = name.slice(0, 60);
    }
    if (typeof patch.baseUrl === 'string') {
      const baseUrl = patch.baseUrl.trim();
      if (!baseUrl) {
        this.requestUpdate();
        return;
      }
      servers.find((server) => server.id === id).baseUrl = baseUrl;
    }
    await this.saveServers(servers, this.settings.ai_active);
    toast.create('Setting updated');
  }

  async onRemoveServer(id) {
    const servers = this.servers().filter((server) => server.id !== id);
    const activeId = this.settings.ai_active === id ? servers[0]?.id || '' : this.settings.ai_active;
    await this.saveServers(servers, activeId);
    toast.create('Server removed');
  }

  async onTestConnection(baseUrl) {
    this.testStatus = 'testing';
    this.requestUpdate();
    try {
      this.testStatus = await nomad.ai.testConnection(baseUrl);
      if (this.testStatus.ok) await this.refreshModels();
    } catch (err) {
      this.testStatus = { ok: false, error: err.message || 'Test failed' };
    }
    this.requestUpdate();
  }

  onAiDefaultModelChange(e) {
    this.settings.ai_default_model = e.currentTarget.value;
    nomad.browser.setSetting('ai_default_model', this.settings.ai_default_model);
    toast.create('Setting updated');
  }

  renderKeepAwake() {
    const sharing = !!this.settings.ai_share_provider;
    const on = !!this.settings.ai_keep_awake;
    const status = this.keepAwakeStatus;
    return html`
      <label class="sub-setting">
        <input
          type="checkbox"
          ?checked=${on}
          ?disabled=${!sharing}
          @change=${this.onKeepAwakeChange}
        />
        Keep this device awake while sharing
      </label>
      <p class="description sub-setting">
        A sleeping device can't answer. This stops the idle-sleep timer while sharing
        is on — it does <strong>not</strong> keep the device awake with the lid closed.
        Paused automatically on battery.
      </p>
      ${on && sharing && status ? this.renderKeepAwakeStatus(status) : ''}
    `;
  }

  renderKeepAwakeStatus(status) {
    if (status.unsupported) {
      return html`<p class="keep-awake-status warn">${status.unsupported}</p>`;
    }
    if (status.paused) {
      return html`<p class="keep-awake-status warn">Paused — running on battery.</p>`;
    }
    if (status.holding) {
      return html`<p class="keep-awake-status ok">Keeping this device awake.</p>`;
    }
    return '';
  }

  onKeepAwakeChange(e) {
    const on = e.currentTarget.checked ? 1 : 0;
    this.settings.ai_keep_awake = on;
    nomad.browser.setSetting('ai_keep_awake', on);
    toast.create(on ? 'This device will stay awake while sharing' : 'This device may sleep again');
    // The bg gate (battery / platform support) resolves asynchronously; re-read rather than guess.
    setTimeout(() => this.refreshKeepAwake(), 250);
  }

  onShareProviderChange(e) {
    const on = e.currentTarget.checked ? 1 : 0;
    this.settings.ai_share_provider = on;
    nomad.browser.setSetting('ai_share_provider', on);
    toast.create(on ? 'Sharing AI with your other devices' : 'Stopped sharing AI');
    setTimeout(() => this.refreshKeepAwake(), 250);
  }
}

customElements.define('ai-settings-view', AiSettingsView);
