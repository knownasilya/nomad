import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import modsCSS from '../../css/views/mods.css.js';
import jobsCSS from '../../css/views/jobs.css.js';
import secretsCSS from '../../css/views/secrets.css.js';

// The user's secrets (bg/ai/secret-store.js, ADR-0033): API keys and tokens the AI and Jobs use by
// name, without seeing them. A value is typed once and never shown again, here or anywhere: this
// page can replace it, not read it. Each secret goes only to the hosts listed, in the place set
// here (a header, the query, a body field, or the whole URL), and only on this computer.
//
// ?name=<NAME> opens one, and ?new=1 starts a new one. The rules (names, hosts, formats) live in
// bg/ai/secrets.mjs; bg checks them on save.

const SEND_AS = [
  { id: 'bearer', label: 'Authorization: Bearer …' },
  { id: 'header', label: 'Another header' },
  { id: 'query', label: 'A query parameter' },
  { id: 'body', label: 'A field of the request body' },
  { id: 'url', label: 'The whole URL (a webhook)' },
];

const blank = () => ({
  name: '',
  isNew: true,
  note: '',
  hosts: '',
  sendAs: 'bearer',
  header: 'X-Api-Key',
  format: '{value}',
  param: 'api_key',
  chat: true,
  value: '',
  error: '',
});

export class SecretsView extends LitElement {
  static get properties() {
    return {
      secrets: { type: Array },
      jobs: { type: Array },
      status: { type: Object },
      filter: { type: String },
      editing: { type: Object },
    };
  }

  static get styles() {
    return [modsCSS, jobsCSS, secretsCSS];
  }

  constructor() {
    super();
    this.secrets = undefined; // undefined = loading
    this.jobs = [];
    this.status = { ok: true };
    this.filter = undefined;
    const q = new URLSearchParams(location.search);
    this.openName = q.get('name') || null;
    this.editing = q.get('new') ? blank() : null;
    this.load();
    // A Job or the AI uses one (lastUsedAt), or a Job refreshes one.
    try {
      nomad.secrets.watch().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      const [res, status] = await Promise.all([nomad.secrets.list(), nomad.secrets.getStatus()]);
      this.secrets = res.secrets;
      this.jobs = res.jobs;
      this.status = status;
    } catch {
      this.secrets = [];
    }
    if (this.openName) {
      const s = this.secrets.find((x) => x.name === this.openName);
      if (s) this.edit(s);
      this.openName = null;
    }
  }

  filtered() {
    const f = (this.filter || '').toLowerCase();
    return (this.secrets || []).filter(
      (s) => !f || s.name.toLowerCase().includes(f) || s.note.toLowerCase().includes(f) || s.hosts.some((h) => h.includes(f))
    );
  }

  render() {
    if (typeof this.secrets === 'undefined') return html`<div class="empty">Loading…</div>`;
    const rows = this.filtered();
    const e = this.editing;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        Secrets are API keys and tokens the AI and your Jobs can use without seeing them, like
        <code>GITHUB_TOKEN</code>. The AI asks for one by name, and Nomad adds it to the request, only
        for the sites you list here. Once saved, a value can’t be shown again, here or anywhere; you
        can replace it. Secrets stay on this computer, encrypted with its keychain: they don’t sync to
        your other devices or go into shared spaces. Never paste a key into the chat.
      </div>
      ${this.status.ok ? '' : html`<div class="notice">${this.status.reason}</div>`}
      <div class="toolbar">
        <span></span>
        ${e && e.isNew ? '' : html`<button class="primary" @click=${this.onNew}>New secret</button>`}
      </div>
      ${e && e.isNew ? html`<div class="card editing">${this.renderEditor(e)}</div>` : ''}
      ${rows.length === 0
        ? html`<div class="empty">
            ${this.secrets.length ? 'No secrets match.' : 'No secrets yet. Add an API key for the AI or a Job to use.'}
          </div>`
        : repeat(rows, (s) => s.name, (s) => this.renderSecret(s))}
    `;
  }

  renderSecret(s) {
    const e = this.editing && !this.editing.isNew && this.editing.name === s.name ? this.editing : null;
    return html`
      <div class="card ${e ? 'editing' : ''}">
        <div class="row-head">
          <span class="fas fa-fw fa-key" aria-hidden="true"></span>
          <div class="meta" @click=${() => (e ? null : this.edit(s))}>
            <div class="title"><code>${s.name}</code>${s.note ? html` · ${s.note}` : ''}</div>
            <div class="summary">${this.summary(s)}</div>
          </div>
          <div class="actions">
            <button class="icon" title="Edit" aria-label="Edit ${s.name}" @click=${() => (e ? (this.editing = null) : this.edit(s))}>
              <span class="fas fa-fw ${e ? 'fa-chevron-up' : 'fa-pen'}"></span>
            </button>
            <button class="icon danger" title="Delete" aria-label="Delete ${s.name}" @click=${() => this.onDelete(s)}>
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${e ? this.renderEditor(e, s) : ''}
      </div>
    `;
  }

  summary(s) {
    const parts = [s.hosts.join(', ')];
    if (!s.hasValue) parts.push('no value yet');
    const users = [];
    if (s.chat) users.push('the AI Sidebar');
    const n = (s.jobs || []).filter((id) => this.jobs.some((j) => j.id === id)).length;
    if (n) users.push(`${n} Job${n === 1 ? '' : 's'}`);
    parts.push(users.length ? `used by ${users.join(' and ')}` : 'not used by anything yet');
    if (s.lastUsedAt) parts.push(`last used ${ago(s.lastUsedAt)}`);
    return parts.join(' · ');
  }

  renderEditor(e, s = null) {
    const set = (patch) => (this.editing = { ...this.editing, ...patch, error: '' });
    return html`
      <form class="editor" @submit=${this.onSave} autocomplete="off">
        <div class="fields">
          <label>
            <span>Name</span>
            <input
              class="secret-name"
              placeholder="GITHUB_TOKEN"
              ?disabled=${!e.isNew}
              .value=${e.name}
              @input=${(ev) => set({ name: ev.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
            />
          </label>
          <label>
            <span>Note</span>
            <input class="name" placeholder="GitHub, read my repos" .value=${e.note} @input=${(ev) => set({ note: ev.target.value })} />
          </label>
        </div>

        <div class="block">
          <div class="label">Value <span class="hint">${s?.hasValue
            ? `Saved ${s.valueSetAt ? ago(s.valueSetAt) : ''}${s.valueSetBy && s.valueSetBy !== 'user' ? ' by a request' : ''}. Leave empty to keep it; type a new one to replace it.`
            : 'Paste the key or token. It can’t be shown again after you save.'}</span></div>
          <input
            class="value"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            placeholder=${s?.hasValue ? '••••••••  (saved)' : e.sendAs === 'url' ? 'https://hooks.example.com/…' : 'ghp_…'}
            .value=${e.value}
            ?disabled=${!this.status.ok}
            @input=${(ev) => set({ value: ev.target.value })}
          />
        </div>

        <div class="block">
          <div class="label">Sites it may go to <span class="hint">Hosts, separated by spaces or commas. <code>*.example.com</code> covers every host under example.com.${e.sendAs === 'url' ? ' Leave empty to use the URL’s host.' : ''}</span></div>
          <input class="hosts" placeholder="api.github.com" .value=${e.hosts} @input=${(ev) => set({ hosts: ev.target.value })} />
        </div>

        <div class="block">
          <div class="label">Sent as</div>
          <div class="send-as">
            <select @change=${(ev) => set({ sendAs: ev.target.value })}>
              ${SEND_AS.map((o) => html`<option value=${o.id} ?selected=${e.sendAs === o.id}>${o.label}</option>`)}
            </select>
            ${e.sendAs === 'header'
              ? html`
                  <input class="inject-name" placeholder="X-Api-Key" .value=${e.header} @input=${(ev) => set({ header: ev.target.value })} />
                  <input class="format" placeholder="{value}" title="How the header’s value is written: {value} is the secret, {base64} the secret in base64" .value=${e.format} @input=${(ev) => set({ format: ev.target.value })} />
                `
              : ''}
            ${e.sendAs === 'query' || e.sendAs === 'body'
              ? html`<input class="inject-name" placeholder=${e.sendAs === 'query' ? 'api_key' : 'refresh_token'} .value=${e.param} @input=${(ev) => set({ param: ev.target.value })} />`
              : ''}
          </div>
          <div class="hint-row">${sendAsHint(e)}</div>
        </div>

        <div class="block">
          <label class="check">
            <input type="checkbox" .checked=${e.chat} @change=${(ev) => set({ chat: ev.target.checked })} />
            The AI Sidebar and the phone’s AI can ask to use it
          </label>
          <div class="hint-row">They ask you the first time in each conversation turn, naming the secret.</div>
        </div>

        ${s ? this.renderJobs(s) : html`<div class="hint-row">Once it’s saved, you can pick the Jobs that may use it.</div>`}

        ${e.error ? html`<div class="error">${e.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary">${e.isNew ? 'Save secret' : 'Save'}</button>
          <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  // Which Jobs may use it on this computer. Changes at once.
  renderJobs(s) {
    return html`
      <div class="block">
        <div class="label">Jobs that may use it <span class="hint">A Job runs with nobody watching, so it uses only the secrets you tick here.</span></div>
        ${this.jobs.length
          ? html`<div class="job-list">
              ${this.jobs.map(
                (j) => html`<label>
                  <input type="checkbox" .checked=${(s.jobs || []).includes(j.id)} @change=${(ev) => this.onJobGrant(s, j, ev.target.checked)} />
                  ${j.title}
                </label>`
              )}
            </div>`
          : html`<div class="hint-row">No Jobs yet. Make one in Jobs, then come back to let it use this secret.</div>`}
      </div>
    `;
  }

  edit(s) {
    const i = s.inject || { in: 'header', name: 'Authorization', format: 'Bearer {value}' };
    const bearer = i.in === 'header' && i.name.toLowerCase() === 'authorization' && i.format === 'Bearer {value}';
    this.editing = {
      ...blank(),
      isNew: false,
      name: s.name,
      note: s.note,
      hosts: s.hosts.join(', '),
      sendAs: bearer ? 'bearer' : i.in,
      header: i.in === 'header' ? i.name : 'X-Api-Key',
      format: i.in === 'header' ? i.format : '{value}',
      param: i.in === 'query' || i.in === 'body' ? i.name : 'api_key',
      chat: s.chat,
    };
  }

  inject(e) {
    switch (e.sendAs) {
      case 'bearer':
        return { in: 'header', name: 'Authorization', format: 'Bearer {value}' };
      case 'header':
        return { in: 'header', name: e.header.trim(), format: e.format };
      case 'query':
      case 'body':
        return { in: e.sendAs, name: e.param.trim() };
      default:
        return { in: 'url' };
    }
  }

  // events
  // =

  onNew() {
    this.editing = blank();
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    const hosts = e.hosts.trim();
    try {
      const rec = await nomad.secrets.save({
        name: e.name,
        create: e.isNew,
        note: e.note,
        ...(hosts || !e.isNew || e.sendAs !== 'url' ? { hosts: hosts.split(/[\s,]+/).filter(Boolean) } : {}),
        inject: this.inject(e),
        chat: e.chat,
        value: e.value,
      });
      this.editing = null;
      await this.load();
      toast.create(`Saved ${rec.name}`, 'success');
    } catch (err) {
      // The typed value stays in the field only until it's saved or the form closes.
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  async onJobGrant(s, j, allowed) {
    try {
      await nomad.secrets.setJobGrant(s.name, j.id, allowed);
      await this.load();
      toast.create(allowed ? `“${j.title}” can use ${s.name}` : `“${j.title}” can’t use ${s.name} anymore`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onDelete(s) {
    if (!confirm(`Delete ${s.name}? The AI and Jobs that use it will stop working until you add it again.`)) return;
    try {
      await nomad.secrets.remove(s.name);
      if (this.editing?.name === s.name) this.editing = null;
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

function sendAsHint(e) {
  switch (e.sendAs) {
    case 'bearer':
      return 'Sent as Authorization: Bearer <secret>, the way most APIs take a token.';
    case 'header':
      return html`Sent as ${e.header || 'the header'}: ${(e.format || '{value}').replace('{value}', '<secret>').replace('{base64}', '<secret in base64>')}. For Basic auth, save <code>user:password</code> and write <code>Basic {base64}</code>.`;
    case 'query':
      return html`Added to the URL as <code>?${e.param || 'name'}=&lt;secret&gt;</code>.`;
    case 'body':
      return html`Set as the <code>${e.param || 'name'}</code> field of a JSON or form body, like an OAuth refresh_token or client_secret.`;
    default:
      return 'The secret is the whole URL, like a Slack or Discord webhook. The AI sends to it without knowing it.';
  }
}

// "5 minutes ago", "yesterday", or a date.
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}

// An error from bg arrives wrapped ("Error invoking remote method …: Error: …").
function cleanError(err) {
  return String(err?.message || err).replace(/^.*?Error: /, '');
}

customElements.define('secrets-view', SecretsView);
