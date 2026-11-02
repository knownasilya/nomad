import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import modsCSS from '../../css/views/mods.css.js';
import personasCSS from '../../css/views/personas.css.js';

// My Library → Personas (ADR-0031 §11): the user's identities in the browser. Each Persona is a
// private label for a Profile Drive; a site sees the drive's name and picture only when the user lets
// it in the login prompt. Here the user makes, renames and deletes Personas, picks the default and
// each Space's own, and sees and ends the Sessions sites hold. Backed by nomad.personas
// (bg/ui/personas.js); everything lives in the Vault, so it follows the user to their other devices.

const blank = () => ({ isNew: true, label: '', title: '', description: '', email: '', thumb: '', thumbPreview: '', useDrive: false, profileUrl: '', error: '', busy: false });

const STATE_ICON = { 'foreign-writers': 'fa-exclamation-triangle', 'not-ready': 'fa-sync-alt' };

export class PersonasView extends LitElement {
  static get properties() {
    return {
      st: { type: Object },
      sessions: { type: Array },
      filter: { type: String },
      editing: { type: Object },
    };
  }

  static get styles() {
    return [modsCSS, personasCSS];
  }

  constructor() {
    super();
    this.st = undefined; // undefined = loading
    this.sessions = [];
    this.filter = undefined;
    this.editing = new URLSearchParams(location.search).get('new') ? blank() : null;
    this.load();
    try {
      nomad.personas.watch().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      const [st, sessions] = await Promise.all([nomad.personas.list(), nomad.personas.listSessions()]);
      this.st = st;
      this.sessions = sessions;
    } catch (e) {
      this.st = { personas: [], spaces: [], hasVault: false, vaultReady: false, error: e.message };
      this.sessions = [];
    }
  }

  matches(...parts) {
    const f = (this.filter || '').toLowerCase();
    return !f || parts.some((p) => String(p || '').toLowerCase().includes(f));
  }

  render() {
    if (typeof this.st === 'undefined') return html`<div class="empty">Loading…</div>`;
    const st = this.st;
    const personas = st.personas.filter((p) => this.matches(p.label, p.title));
    const e = this.editing;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        A Persona is who you are when a site asks you to log in. Each one is a profile drive of your
        own: a name, a picture and a few words. A site sees nothing about you until you say yes, and
        then only a random ID made for that site, plus your profile or email if you leave them checked. Personas
        stay on your own devices.
      </div>
      ${st.hasVault && !st.vaultReady
        ? html`<div class="notice"><span class="fas fa-sync-alt"></span> This device hasn’t finished syncing your Vault, so some Personas may not be ready here yet. Keep your other device online.</div>`
        : ''}

      <div class="toolbar">
        <span class="section-title">Your Personas</span>
        ${e && e.isNew ? '' : html`<button class="primary" @click=${() => (this.editing = blank())}>New Persona</button>`}
      </div>
      ${e && e.isNew ? html`<div class="card editing">${this.renderEditor(e)}</div>` : ''}
      ${st.personas.length === 0 && !(e && e.isNew)
        ? html`<div class="empty">
            No Personas yet. Make one here, or the first time a site asks you to log in.
          </div>`
        : personas.length === 0 && st.personas.length
          ? html`<div class="empty">No Personas match.</div>`
          : repeat(personas, (p) => p.id, (p) => this.renderPersona(p))}

      ${st.personas.length ? this.renderSpaces() : ''}
      ${this.renderSessions()}
    `;
  }

  renderAvatar(p, size = '') {
    const preview = this.editing && !this.editing.isNew && this.editing.id === p.id ? this.editing.thumbPreview : '';
    const src = preview || p.thumbUrl;
    return src
      ? html`<img class="avatar ${size}" src=${src} alt="" />`
      : html`<span class="avatar initial ${size}">${(p.title || p.label || '?').slice(0, 1).toUpperCase()}</span>`;
  }

  renderPersona(p) {
    const e = this.editing && !this.editing.isNew && this.editing.id === p.id ? this.editing : null;
    const ok = p.state === 'usable';
    return html`
      <div class="card persona ${e ? 'editing' : ''}">
        <div class="row-head">
          ${this.renderAvatar(p)}
          <div class="meta" @click=${() => (e ? null : this.edit(p))}>
            <div class="title">
              ${p.title || p.label}
              <span class="chip-label">${p.label}</span>
              ${p.isDefault ? html`<span class="badge">Default</span>` : ''}
            </div>
            <div class="summary">
              ${ok
                ? html`${p.sessions ? `Logged in on ${p.sessions} site${p.sessions === 1 ? '' : 's'}` : 'Not logged in anywhere'}${p.description ? html` · ${p.description}` : ''}`
                : html`<span class="state ${p.state}"><span class="fas fa-fw ${STATE_ICON[p.state] || 'fa-info-circle'}"></span> ${p.state === 'foreign-writers' ? 'Can’t log in. ' : ''}${p.reason}</span>`}
            </div>
          </div>
          <div class="actions">
            ${p.isDefault ? '' : html`<button class="link" @click=${() => this.onSetDefault(p)}>Make default</button>`}
            <button class="icon" title="Edit" aria-label="Edit ${p.label}" @click=${() => (e ? (this.editing = null) : this.edit(p))}>
              <span class="fas fa-fw ${e ? 'fa-chevron-up' : 'fa-pen'}"></span>
            </button>
            <button class="icon danger" title="Delete" aria-label="Delete ${p.label}" @click=${() => this.onDelete(p)}>
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${e ? this.renderEditor(e, p) : ''}
      </div>
    `;
  }

  renderEditor(e, p = null) {
    const set = (patch) => (this.editing = { ...this.editing, ...patch, error: '' });
    const canProfile = !p || p.writable;
    return html`
      <form class="editor" @submit=${this.onSave} autocomplete="off">
        <div class="fields">
          <label>
            <span>Label <span class="hint">Only you see it</span></span>
            <input class="name" placeholder="Work" maxlength="40" .value=${e.label} @input=${(ev) => set({ label: ev.target.value })} />
          </label>
          ${e.useDrive
            ? html`<label class="grow">
                <span>Profile drive <span class="hint">One you made on this device</span></span>
                <input class="drive-url" placeholder="hyper://…/" .value=${e.profileUrl} @input=${(ev) => set({ profileUrl: ev.target.value })} />
              </label>`
            : html`<label>
                <span>Name <span class="hint">What sites see</span></span>
                <input class="name" placeholder="Ada Lovelace" maxlength="280" ?disabled=${!canProfile} .value=${e.title} @input=${(ev) => set({ title: ev.target.value })} />
              </label>`}
        </div>
        ${e.useDrive
          ? ''
          : html`
              <div class="profile-row">
                <div class="picture">
                  ${e.thumbPreview || p?.thumbUrl
                    ? html`<img class="avatar large" src=${e.thumbPreview || p.thumbUrl} alt="" />`
                    : html`<span class="avatar large initial">${(e.title || e.label || '?').slice(0, 1).toUpperCase()}</span>`}
                  <label class="file-btn ${canProfile ? '' : 'disabled'}">
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" ?disabled=${!canProfile} @change=${this.onPickThumb} />
                    ${e.thumbPreview || p?.thumbUrl ? 'Change picture' : 'Add a picture'}
                  </label>
                </div>
                <label class="grow">
                  <span class="label-text">About <span class="hint">Optional, also public</span></span>
                  <textarea rows="2" maxlength="1000" placeholder="A few words about you" ?disabled=${!canProfile} .value=${e.description} @input=${(ev) => set({ description: ev.target.value })}></textarea>
                </label>
              </div>
            `}
        <div class="fields">
          <label class="grow">
            <span>Email <span class="hint">Private. A site gets it only when you say yes, and sites that get the same email can tell it’s you.</span></span>
            <input class="email" type="email" placeholder="you@example.com (optional)" maxlength="254" .value=${e.email} @input=${(ev) => set({ email: ev.target.value })} />
          </label>
        </div>
        ${p && !p.writable
          ? html`<div class="hint-row">This device can’t change the profile yet. Keep the device that made it online for a minute and it adds this one.</div>`
          : ''}
        ${p
          ? html`<div class="hint-row">Profile drive: <a href=${p.profileUrl} target="_blank"><code>${p.profileUrl}</code></a></div>`
          : html`<div class="hint-row">
              ${e.useDrive
                ? html`<button type="button" class="link" @click=${() => set({ useDrive: false })}>Make a new profile drive instead</button>`
                : html`A new profile drive is made for it.
                    <button type="button" class="link" @click=${() => set({ useDrive: true })}>Use a profile drive I made</button>`}
            </div>`}
        ${e.error ? html`<div class="error">${e.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary" ?disabled=${e.busy}>${e.isNew ? (e.busy ? 'Making…' : 'Make Persona') : 'Save'}</button>
          <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  renderSpaces() {
    const st = this.st;
    const def = st.personas.find((p) => p.id === st.defaultId);
    return html`
      <div class="toolbar section">
        <span class="section-title">Persona for each Space</span>
      </div>
      <div class="card list">
        ${st.spaces.map(
          (s) => html`
            <div class="list-row">
              <span class="dot" style="background:${s.color}"></span>
              <span class="grow">${s.name}${s.id === st.currentSpaceId ? html` <span class="hint">this window</span>` : ''}</span>
              <select aria-label="Persona for ${s.name}" @change=${(ev) => this.onSetSpace(s, ev.target.value)}>
                <option value="" ?selected=${!s.personaId}>Use the default${def ? ` (${def.label})` : ' (none)'}</option>
                ${st.personas.map((p) => html`<option value=${p.id} ?selected=${s.personaId === p.id}>${p.label}</option>`)}
              </select>
            </div>
          `
        )}
      </div>
    `;
  }

  renderSessions() {
    const rows = this.sessions.filter((s) => this.matches(s.site, s.personaLabel, s.spaceName));
    return html`
      <div class="toolbar section">
        <span class="section-title">Sites you’re logged in to</span>
      </div>
      ${rows.length === 0
        ? html`<div class="empty small">${this.sessions.length ? 'No sites match.' : 'No sites yet. When a site asks you to log in and you say yes, it shows here.'}</div>`
        : html`<div class="card list">
            ${repeat(
              rows,
              (s) => s.path,
              (s) => html`
                <div class="list-row session-row">
                  <img class="favicon" src=${`asset:favicon:${s.origin}/`} alt="" @error=${(ev) => (ev.target.style.visibility = 'hidden')} />
                  <div class="grow meta-col">
                    <div class="title"><code title=${s.origin}>${s.site}</code></div>
                    <div class="summary">
                      As “${s.personaLabel}” in ${s.spaceName} · ${describePerms(s.perms)} · since ${new Date(s.createdAt).toLocaleDateString()}${s.expiresAt ? ` · ${s.expired ? 'expired' : `until ${new Date(s.expiresAt).toLocaleDateString()}`}` : ''}
                    </div>
                  </div>
                  <button @click=${() => this.onEndSession(s)}>Log out</button>
                </div>
              `
            )}
          </div>`}
    `;
  }

  edit(p) {
    this.editing = { ...blank(), isNew: false, id: p.id, label: p.label, title: p.title, description: p.description, email: p.email || '' };
  }

  // events
  // =

  onPickThumb(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.editing = { ...this.editing, error: 'Pick a picture under 2 MB' };
      return;
    }
    const reader = new FileReader();
    reader.onload = () => (this.editing = { ...this.editing, thumb: reader.result, thumbPreview: reader.result, error: '' });
    reader.readAsDataURL(file);
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    this.editing = { ...e, busy: true, error: '' };
    try {
      if (e.isNew) {
        const p = await nomad.personas.create(
          e.useDrive
            ? { label: e.label, profileUrl: e.profileUrl, email: e.email }
            : { label: e.label || e.title, title: e.title || e.label, description: e.description, thumb: e.thumb || undefined, email: e.email }
        );
        toast.create(`Made the Persona “${p.label}”`, 'success');
      } else {
        const p = this.st.personas.find((x) => x.id === e.id);
        const fields = { label: e.label, email: e.email };
        if (p?.writable) Object.assign(fields, { title: e.title, description: e.description, thumb: e.thumb || undefined });
        await nomad.personas.update(e.id, fields);
        toast.create('Saved', 'success');
      }
      this.editing = null;
      await this.load();
    } catch (err) {
      this.editing = { ...e, busy: false, error: cleanError(err) };
    }
  }

  async onSetDefault(p) {
    try {
      await nomad.personas.setDefault(p.id);
      await this.load();
      toast.create(`“${p.label}” is your default Persona`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onSetSpace(s, id) {
    try {
      await nomad.personas.setSpacePersona(s.id, id || null);
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
      await this.load();
    }
  }

  async onDelete(p) {
    const n = p.sessions ? ` You’ll be logged out of ${p.sessions} site${p.sessions === 1 ? '' : 's'}.` : '';
    if (!confirm(`Delete the Persona “${p.label}”?${n} Its profile drive stays in your Hyperdrives.`)) return;
    try {
      await nomad.personas.remove(p.id);
      await this.load();
      toast.create(`Deleted “${p.label}”`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onEndSession(s) {
    try {
      await nomad.personas.endSession(s.path);
      await this.load();
      toast.create(`Logged out of ${s.site}`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

function describePerms(perms) {
  const names = perms.map((t) => t.split(':')[0]);
  const sees = [];
  if (names.includes('profile')) sees.push('your profile');
  if (names.includes('email')) sees.push('your email');
  if (!sees.length) return 'knows only a random ID';
  return `sees ${sees.join(' and ')}${names.includes('modifyDrive') ? ', and can change your profile' : ''}`;
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error: /, '').replace(/^Error invoking remote method '[^']+': /, '');
}

customElements.define('personas-view', PersonasView);
