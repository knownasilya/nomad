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
    this.availableModels = null; // null until a successful Test Connection fetches the catalogue
    this.keepAwakeStatus = null; // {holding, paused, onBattery, unsupported} from bg/ai/awake.js
  }

  async load() {
    this.settings = await nomad.browser.getSettings();
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
    const baseUrl = this.settings.ai_base_url || 'http://localhost:11434/v1';
    const accessToken = this.settings.ai_access_token || '';
    const model = this.settings.ai_default_model || '';
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="form-group">
        <h2>
          AI
          <span class="badge-experimental">Experimental</span>
        </h2>
        <div class="section">
          <p>
            Nomad can connect to a local OpenAI-compatible inference server
            (e.g. <a href="https://ollama.com" target="_blank">Ollama</a> or
            <a href="https://lmstudio.ai" target="_blank">LM Studio</a>) and
            expose it to Drive pages via <code>nomad.ai.chat()</code>.
          </p>
          <p>
            The model runtime and downloads are managed by your inference
            server — Nomad only connects to it.
            <a href="https://nomad.pages.dev/docs/api/apis/nomad.ai/" target="_blank">API documentation</a>
          </p>
        </div>
        <div class="section">
          <label for="ai-base-url">Runtime base URL</label>
          <p class="description">
            The base URL of your OpenAI-compatible server.
            Ollama default: <code>http://localhost:11434/v1</code> —
            LM Studio default: <code>http://localhost:1234/v1</code>
          </p>
          <div class="input-row">
            <input
              id="ai-base-url"
              type="text"
              value="${baseUrl}"
              placeholder="http://localhost:11434/v1"
              @change=${this.onAiBaseUrlChange}
            />
            <button class="btn" ?disabled=${this.testStatus === 'testing'} @click=${this.onTestConnection}>
              ${this.testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
          </div>
          <label for="ai-access-token" style="display: block; margin-top: 10px">Access token</label>
          <p class="description">
            Optional. Sent as an <code>Authorization: Bearer</code> header on every request to
            your runtime — only needed if it requires authentication (e.g. a remote or
            gateway-fronted server).
          </p>
          <input
            id="ai-access-token"
            type="password"
            style="width: 300px"
            value="${accessToken}"
            placeholder="Optional"
            autocomplete="off"
            @change=${this.onAiAccessTokenChange}
          />
          ${this.renderTestStatus()}
        </div>
        <div class="section">
          <label for="ai-default-model">Default model</label>
          <p class="description">
            Model used for AI chat unless you pick a different one for a site from the AI
            sidebar's own controls.
            ${this.availableModels && this.availableModels.length
              ? ''
              : html`Must match a model available in your runtime (e.g.
                <code>llama3.2:3b</code>) — Test Connection above to pick from
                the list instead.`}
          </p>
          ${this.availableModels && this.availableModels.length
            ? html`
                <select id="ai-default-model" style="width: 260px" @change=${this.onAiDefaultModelChange}>
                  <option value="" ?selected=${!model}>— none —</option>
                  ${[...new Set([...this.availableModels, ...(model ? [model] : [])])].map(
                    (m) => html`<option value="${m}" ?selected=${m === model}>${m}</option>`
                  )}
                </select>
              `
            : html`
                <input
                  id="ai-default-model"
                  type="text"
                  style="width: 260px"
                  value="${model}"
                  placeholder="e.g. llama3.2:3b"
                  @change=${this.onAiDefaultModelChange}
                />
              `}
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

  // events
  // =

  async onTestConnection() {
    this.testStatus = 'testing';
    this.availableModels = null;
    const baseUrl = this.settings.ai_base_url || 'http://localhost:11434/v1';
    this.testStatus = await nomad.ai.testConnection(baseUrl);
    if (this.testStatus.ok) {
      try {
        const { models } = await nomad.ai.listModels();
        this.availableModels = models || [];
      } catch {
        this.availableModels = null;
      }
    }
  }

  onAiBaseUrlChange(e) {
    this.settings.ai_base_url = e.currentTarget.value;
    nomad.browser.setSetting('ai_base_url', this.settings.ai_base_url);
    toast.create('Setting updated');
  }

  onAiAccessTokenChange(e) {
    this.settings.ai_access_token = e.currentTarget.value;
    nomad.browser.setSetting('ai_access_token', this.settings.ai_access_token);
    toast.create('Setting updated');
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
