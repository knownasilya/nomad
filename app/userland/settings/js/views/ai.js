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
    };
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.settings = undefined;
    this.testStatus = null; // null | 'testing' | {ok, models} | {error}
  }

  async load() {
    this.settings = await beaker.browser.getSettings();
    this.requestUpdate();
  }

  unload() {}

  // rendering
  // =

  render() {
    if (!this.settings) return html``;
    const baseUrl = this.settings.ai_base_url || 'http://localhost:11434/v1';
    const model = this.settings.ai_default_model || '';
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
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
            expose it to Drive pages via <code>beaker.ai.chat()</code>.
          </p>
          <p>
            The model runtime and downloads are managed by your inference
            server — Nomad only connects to it.
            <a href="https://nomad.pages.dev/docs/api/apis/beaker.ai/" target="_blank">API documentation</a>
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
          ${this.renderTestStatus()}
        </div>
        <div class="section">
          <label for="ai-default-model">Default model</label>
          <p class="description">
            Model name used when a Drive does not specify one in its
            <code>index.json</code>. Must match a model available in your
            runtime (e.g. <code>llama3.2:3b</code>).
          </p>
          <input
            id="ai-default-model"
            type="text"
            style="width: 260px"
            value="${model}"
            placeholder="e.g. llama3.2:3b"
            @change=${this.onAiDefaultModelChange}
          />
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
    const baseUrl = this.settings.ai_base_url || 'http://localhost:11434/v1';
    this.testStatus = await beaker.ai.testConnection(baseUrl);
  }

  onAiBaseUrlChange(e) {
    this.settings.ai_base_url = e.currentTarget.value;
    beaker.browser.setSetting('ai_base_url', this.settings.ai_base_url);
    toast.create('Setting updated');
  }

  onAiDefaultModelChange(e) {
    this.settings.ai_default_model = e.currentTarget.value;
    beaker.browser.setSetting('ai_default_model', this.settings.ai_default_model);
    toast.create('Setting updated');
  }
}

customElements.define('ai-settings-view', AiSettingsView);
