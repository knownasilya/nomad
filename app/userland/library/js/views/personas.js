import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { setItemTitle } from '../lib/page-title.js';
import modsCSS from '../../css/views/mods.css.js';
import personasCSS from '../../css/views/personas.css.js';

// My Library → Personas (ADR-0031 §11): the user's identities in the browser. Each Persona is a
// private label for a Profile Drive; a site sees the drive's name and picture only when the user lets
// it in the login prompt. Here the user makes, renames and deletes Personas, picks the default and
// each Space's own, and sees and ends the Sessions sites hold. Backed by nomad.personas
// (bg/ui/personas.js); everything lives in the Vault, so it follows the user to their other devices.

const blank = () => ({ isNew: true, label: '', title: '', description: '', email: '', thumb: '', thumbPreview: '', useDrive: false, profileUrl: '', error: '', busy: false });

const blankVouch = (o = {}) => ({ to: '', personaId: '', note: '', preview: null, checking: false, busy: false, error: '', ...o });

const STATE_ICON = { 'foreign-writers': 'fa-exclamation-triangle', 'not-ready': 'fa-sync-alt' };

export class PersonasView extends LitElement {
  static get properties() {
    return {
      st: { type: Object },
      sessions: { type: Array },
      inbox: { type: Object },
      vouches: { type: Object },
      giving: { type: Object },
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
    this.inbox = null; // nomad.inbox.summary() and the notification setting (ADR-0036)
    this.vouches = null; // nomad.personas.listVouches() (ADR-0045)
    this.filter = undefined;
    const q = new URLSearchParams(location.search);
    this.editing = q.get('new') ? blank() : null;
    // site-info's "Vouch for them" opens the giving form for that profile.
    this.giving = q.get('vouch') ? blankVouch({ to: q.get('vouch'), personaId: q.get('persona') || '' }) : null;
    this.scrollToVouches = !!this.giving;
    this.load();
    try {
      nomad.personas.watch().addEventListener('changed', () => this.load());
      nomad.inbox.watch().addEventListener('changed', () => this.loadInbox());
    } catch {}
  }

  async loadInbox() {
    try {
      const [summary, notify] = await Promise.all([nomad.inbox.summary(), nomad.inbox.getNotify()]);
      this.inbox = { ...summary, notify };
    } catch {
      this.inbox = null;
    }
  }

  async loadVouches() {
    try {
      this.vouches = await nomad.personas.listVouches();
    } catch {
      this.vouches = null;
    }
    if (this.giving && !this.giving.personaId) {
      const usable = this.st?.personas?.filter((p) => p.state === 'usable') || [];
      const tab = await nomad.personas.tabPersona().catch(() => null);
      const pick = usable.find((p) => p.id === tab) || usable[0];
      if (pick) this.setGiving({ personaId: pick.id });
    }
    if (this.giving?.to && !this.giving.preview && !this.giving.checking) this.checkGiving();
  }

  async load() {
    try {
      const [st, sessions] = await Promise.all([nomad.personas.list(), nomad.personas.listSessions()]);
      this.st = st;
      this.sessions = sessions;
      this.loadInbox();
      this.loadVouches();
    } catch (e) {
      this.st = { personas: [], spaces: [], hasVault: false, vaultReady: false, error: e.message };
      this.sessions = [];
    }
  }

  matches(...parts) {
    const f = (this.filter || '').toLowerCase();
    return !f || parts.some((p) => String(p || '').toLowerCase().includes(f));
  }

  // The tab title names the Persona that is open (lib/page-title.js).
  itemTitle() {
    const e = this.editing;
    if (!e) return this.giving ? 'Give a vouch' : '';
    if (e.isNew) return 'New Persona';
    return this.st?.personas?.find((p) => p.id === e.id)?.label || e.label;
  }

  updated() {
    setItemTitle(this, this.itemTitle());
    const form = this.scrollToVouches && this.shadowRoot.querySelector('.vouch-form');
    if (form) {
      this.scrollToVouches = false;
      form.scrollIntoView({ block: 'center' });
      form.querySelector('textarea')?.focus();
    }
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
      ${st.personas.length ? this.renderMessages() : ''}
      ${st.personas.length || this.vouches?.held?.length ? this.renderVouches() : ''}
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

  // One column in two groups: what sites see (picture, name, about) and what stays with the user
  // (label, email), each hint under its field, then the profile drive, then the buttons.
  renderEditor(e, p = null) {
    const set = (patch) => (this.editing = { ...this.editing, ...patch, error: '' });
    const canProfile = !p || p.writable;
    const thumb = e.thumbPreview || p?.thumbUrl;
    return html`
      <form class="editor persona-form" @submit=${this.onSave} autocomplete="off">
        <fieldset class="group">
          <legend>Public profile <span class="legend-hint">Sites see this when you log in</span></legend>
          ${e.useDrive
            ? html`<label class="field">
                <span class="field-label">Profile drive</span>
                <input class="drive-url" placeholder="hyper://…/" .value=${e.profileUrl} @input=${(ev) => set({ profileUrl: ev.target.value })} />
                <span class="field-hint">One you made on this device. Its name and picture are what sites see.</span>
              </label>`
            : html`
                <div class="picture-row">
                  ${thumb
                    ? html`<img class="avatar large" src=${thumb} alt="" />`
                    : html`<span class="avatar large initial">${(e.title || e.label || '?').slice(0, 1).toUpperCase()}</span>`}
                  <div class="picture-actions">
                    <label class="file-btn ${canProfile ? '' : 'disabled'}">
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" ?disabled=${!canProfile} @change=${this.onPickThumb} />
                      <span class="fas fa-fw fa-image"></span> ${thumb ? 'Change picture' : 'Add a picture'}
                    </label>
                    <span class="field-hint">PNG, JPEG, WebP or GIF, under 2 MB</span>
                  </div>
                </div>
                <label class="field">
                  <span class="field-label">Name</span>
                  <input placeholder="Ada Lovelace" maxlength="280" ?disabled=${!canProfile} .value=${e.title} @input=${(ev) => set({ title: ev.target.value })} />
                </label>
                <label class="field">
                  <span class="field-label">About <span class="optional">Optional</span></span>
                  <textarea rows="2" maxlength="1000" placeholder="A few words about you" ?disabled=${!canProfile} .value=${e.description} @input=${(ev) => set({ description: ev.target.value })}></textarea>
                </label>
                ${p && !p.writable
                  ? html`<div class="field-hint notice-hint">
                      <span class="fas fa-fw fa-sync-alt"></span> This device can’t change the profile yet. Keep the device that made it online
                      for a minute and it adds this one.
                    </div>`
                  : ''}
              `}
        </fieldset>

        <fieldset class="group">
          <legend>Private <span class="legend-hint">Stays on your devices</span></legend>
          <label class="field">
            <span class="field-label">Label</span>
            <input placeholder="Work" maxlength="40" .value=${e.label} @input=${(ev) => set({ label: ev.target.value })} />
            <span class="field-hint">Your name for this Persona. Only you see it.</span>
          </label>
          <label class="field">
            <span class="field-label">Email <span class="optional">Optional</span></span>
            <input type="email" placeholder="you@example.com" maxlength="254" .value=${e.email} @input=${(ev) => set({ email: ev.target.value })} />
            <span class="field-hint">A site gets it only when you say yes, and sites that get the same email can tell it’s you.</span>
          </label>
        </fieldset>

        ${p
          ? html`<div class="drive-row">
              <span class="drive-label">Profile drive</span>
              <code class="drive-key" title=${p.profileUrl}>${shortDriveUrl(p.profileUrl)}</code>
              <button type="button" class="icon" title="Copy profile drive address" aria-label="Copy profile drive address" @click=${() => this.onCopyDrive(p)}>
                <span class="fas fa-fw fa-copy"></span>
              </button>
              <a class="icon-link" href=${p.profileUrl} target="_blank" title="Open profile drive" aria-label="Open profile drive">
                <span class="fas fa-fw fa-external-link-alt"></span>
              </a>
            </div>`
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

  async onCopyDrive(p) {
    try {
      await navigator.clipboard.writeText(p.profileUrl);
      toast.create('Profile drive address copied', 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
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

  // Messages (ADR-0036): who may write to each Persona, its message link and its address.
  renderMessages() {
    const box = this.inbox;
    if (!box) return '';
    return html`
      <div class="toolbar section">
        <span class="section-title">Messages</span>
        <a class="link" href="nomad://messages" target="_blank">Open Messages</a>
      </div>
      <div class="card list">
        ${box.personas.map(
          (m) => html`
            <div class="list-row inbox-row">
              <div class="grow meta-col">
                <div class="title">${m.label}</div>
                <div class="summary">${inboxSummary(m)}</div>
              </div>
              ${m.mode === 'link' && m.enabled
                ? html`<button class="icon" title="Copy message link" aria-label="Copy the message link for ${m.label}" @click=${() => this.onCopyLink(m)}>
                    <span class="fas fa-fw fa-link"></span>
                  </button>`
                : ''}
              ${m.enabled
                ? html`<button class="icon" title="Change inbox address" aria-label="Change the inbox address for ${m.label}" @click=${() => this.onRotate(m)}>
                    <span class="fas fa-fw fa-sync-alt"></span>
                  </button>`
                : ''}
              <select aria-label="Who can message ${m.label}" ?disabled=${!m.usable} @change=${(ev) => this.onSetMode(m, ev.target.value)}>
                <option value="off" ?selected=${m.mode === 'off'}>Only people I write to</option>
                <option value="link" ?selected=${m.mode === 'link'}>People I give a link to</option>
                <option value="anyone" ?selected=${m.mode === 'anyone'}>Anyone, as requests</option>
              </select>
            </div>
          `
        )}
        <label class="list-row">
          <input type="checkbox" .checked=${!!box.notify} @change=${(ev) => this.onSetNotify(ev.target.checked)} />
          <span class="grow">Notify me of new messages from my contacts <span class="hint">Never for requests</span></span>
        </label>
      </div>
      <div class="hint-row">
        Messages are sealed so only your devices can open them, and kept in your Vault. The person you write to sees your
        device’s network address, and anyone who can read your Vault can read your messages.
      </div>
    `;
  }

  async onSetMode(m, mode) {
    try {
      await nomad.inbox.setMode(m.personaId, mode);
      await this.loadInbox();
      if (mode === 'link') toast.create(`Copy the message link and give it to people you want to hear from`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
      await this.loadInbox();
    }
  }

  async onCopyLink(m) {
    try {
      const link = await nomad.inbox.messageLink(m.personaId);
      if (!link) throw new Error('This Persona has no inbox yet');
      await navigator.clipboard.writeText(link);
      toast.create('Message link copied', 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onRotate(m) {
    const ok = confirm(
      `Change the inbox address for “${m.label}”?\n\nEvery message link you gave out stops working, and people you talk to get the new address with your next message. Messages already on their way still arrive for 14 days.`
    );
    if (!ok) return;
    try {
      await nomad.inbox.rotate(m.personaId);
      await this.loadInbox();
      toast.create('Inbox address changed', 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onSetNotify(on) {
    try {
      await nomad.inbox.setNotify(on);
      await this.loadInbox();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  // Vouches (ADR-0045)
  // =
  //
  // "I've had this person over." Vouches for the user wait here as New until they accept or decline;
  // an accepted one is shown only to them until they pick sites or their profile. Vouches they gave
  // can be renewed in their last month and withdrawn at any time, quietly.

  renderVouches() {
    const v = this.vouches;
    const held = (v?.held || []).filter((r) => this.matches(r.host.title, r.vouch.note));
    const given = (v?.given || []).filter((r) => this.matches(r.guest.title, r.vouch.note));
    const label = (pid) => this.st.personas.find((p) => p.id === pid)?.label || '';
    const many = this.st.personas.length > 1;
    return html`
      <div class="toolbar section" id="vouches">
        <span class="section-title">Vouches</span>
        ${this.giving ? '' : html`<button class="link" @click=${() => this.startGiving()}>Give a vouch</button>`}
      </div>
      ${this.giving ? html`<div class="card editing">${this.renderGiving()}</div>` : ''}
      ${(v?.foreign || []).map(
        (f) => html`<div class="notice warn-notice" role="alert">
          <span class="fas fa-exclamation-triangle"></span>
          <strong>Someone added a vouch to your Persona “${f.label}”.</strong> None of your devices wrote it, so someone else may be able to
          change that profile drive. Check its writers in your Hyperdrives.
        </div>`
      )}
      <div class="subsection-title">For you</div>
      ${held.length
        ? html`<div class="card list">${repeat(held, (r) => `${r.personaId}:${r.id}`, (r) => this.renderHeld(r, many ? label(r.personaId) : ''))}</div>`
        : html`<div class="empty small">
            ${v?.held?.length ? 'No vouches match.' : 'No one has vouched for you yet. When someone vouches for you, it waits here for you to accept.'}
          </div>`}
      <div class="subsection-title">You gave</div>
      ${given.length
        ? html`<div class="card list">${repeat(given, (r) => `${r.personaId}:${r.id}`, (r) => this.renderGiven(r, many ? label(r.personaId) : ''))}</div>`
        : html`<div class="empty small">
            ${v?.given?.length ? 'No vouches match.' : 'You haven’t vouched for anyone. Open someone’s profile drive and choose Vouch for them in site info, or use Give a vouch.'}
          </div>`}
      <div class="hint-row">
        A vouch says one thing: someone has had this person over at home. It isn’t proof that an account is a real person, and Nomad never turns
        vouches into a score or a badge. Each lasts a year. Anyone can see how many vouches you’ve given, but not who they’re for.
      </div>
    `;
  }

  renderPerson(who, fallback = '?') {
    const name = who.title || fallback;
    return who.thumbUrl
      ? html`<img class="avatar small" src=${who.thumbUrl} alt="" @error=${(ev) => (ev.target.style.visibility = 'hidden')} />`
      : html`<span class="avatar small initial">${name.slice(0, 1).toUpperCase()}</span>`;
  }

  renderHeld(r, personaLabel) {
    const host = r.host.title || shortDriveUrl(r.vouch.host);
    const status = {
      withdrawn: html`<span class="state warn">No longer valid: ${host} withdrew it</span>`,
      expired: html`<span class="state warn">Expired</span>`,
      unreachable: html`<span class="state">Couldn’t check just now</span>`,
      invalid: html`<span class="state warn">Not a valid vouch</span>`,
    }[r.check];
    return html`
      <div class="list-row vouch-row ${r.state === 'new' ? 'is-new' : ''}">
        ${this.renderPerson(r.host)}
        <div class="grow meta-col">
          <div class="title">
            ${host} vouched for you
            ${r.state === 'new' ? html`<span class="badge">New</span>` : ''}
          </div>
          ${r.vouch.note ? html`<div class="note">“${r.vouch.note}”</div>` : ''}
          <div class="summary">
            <code title=${r.vouch.host}>${shortDriveUrl(r.vouch.host)}</code>${personaLabel ? ` · to “${personaLabel}”` : ''} · until
            ${new Date(r.vouch.expiresAt).toLocaleDateString()}${status ? html` · ${status}` : ''}
          </div>
        </div>
        ${r.state === 'new'
          ? html`<div class="row-actions">
              <button class="primary" @click=${() => this.onVouch('acceptVouch', r, 'Accepted. Only you see it until you choose where it shows.')}>Accept</button>
              <button @click=${() => this.onDeclineVouch(r, host)}>Decline</button>
            </div>`
          : html`<div class="row-actions">
              <select aria-label="Who sees the vouch from ${host}" title="Who sees it" @change=${(ev) => this.onSetShown(r, ev.target.value)}>
                <option value="me" ?selected=${r.shown === 'me'}>Only me</option>
                <option value="sites" ?selected=${r.shown === 'sites'}>Sites I log into</option>
                <option value="profile" ?selected=${r.shown === 'profile'}>On my profile</option>
              </select>
              <button class="icon danger" title="Remove this vouch" aria-label="Remove the vouch from ${host}" @click=${() => this.onDeclineVouch(r, host, true)}>
                <span class="fas fa-fw fa-trash"></span>
              </button>
            </div>`}
      </div>
    `;
  }

  renderGiven(r, personaLabel) {
    const guest = r.guest.title || shortDriveUrl(r.vouch.guest);
    const done = r.withdrawnAt || r.expired;
    return html`
      <div class="list-row vouch-row ${done ? 'is-done' : ''}">
        ${this.renderPerson(r.guest)}
        <div class="grow meta-col">
          <div class="title">You vouched for ${guest}</div>
          ${r.vouch.note ? html`<div class="note">“${r.vouch.note}”</div>` : ''}
          <div class="summary">
            <code title=${r.vouch.guest}>${shortDriveUrl(r.vouch.guest)}</code>${personaLabel ? ` · as “${personaLabel}”` : ''} ·
            ${r.withdrawnAt
              ? `withdrawn ${new Date(r.withdrawnAt).toLocaleDateString()}`
              : r.expired
                ? `expired ${new Date(r.vouch.expiresAt).toLocaleDateString()}`
                : `until ${new Date(r.vouch.expiresAt).toLocaleDateString()}`}
          </div>
        </div>
        <div class="row-actions">
          ${r.renewDue && !r.expired ? html`<button @click=${() => this.onVouch('renewVouch', r, `Renewed for another year and sent to ${guest}`)}>Renew</button>` : ''}
          ${done
            ? html`<button class="icon" title="Remove from this list" aria-label="Remove the vouch for ${guest} from this list" @click=${() => this.onVouch('forgetVouch', r)}>
                <span class="fas fa-fw fa-times"></span>
              </button>`
            : html`<button @click=${() => this.onWithdrawVouch(r, guest)}>Withdraw</button>`}
        </div>
      </div>
    `;
  }

  renderGiving() {
    const g = this.giving;
    const usable = this.st.personas.filter((p) => p.state === 'usable');
    const pv = g.preview;
    const name = pv?.title || 'They';
    return html`
      <form class="editor persona-form vouch-form" @submit=${this.onGiveVouch} autocomplete="off">
        <div class="form-title">Vouch for them</div>
        <label class="field">
          <span class="field-label">Their profile</span>
          <input
            class="drive-url"
            placeholder="hyper://…/ or their message link"
            .value=${g.to}
            @input=${(ev) => this.setGiving({ to: ev.target.value, preview: null })}
            @change=${() => this.checkGiving()}
          />
          ${pv && pv.profileUrl
            ? html`<span class="field-hint guest-line">
                ${pv.title ? html`<strong>${pv.title}</strong> · ` : ''}<code title=${pv.profileUrl}>${shortDriveUrl(pv.profileUrl)}</code>
              </span>`
            : html`<span class="field-hint">Their profile drive, or the message link they gave you.</span>`}
        </label>
        <label class="field">
          <span class="field-label">From</span>
          <select aria-label="The Persona the vouch comes from" .value=${g.personaId} @change=${(ev) => {
            this.setGiving({ personaId: ev.target.value, preview: null });
            this.checkGiving();
          }}>
            ${usable.map((p) => html`<option value=${p.id} ?selected=${p.id === g.personaId}>${p.title || p.label} (“${p.label}”)</option>`)}
          </select>
          ${usable.length ? '' : html`<span class="field-hint">None of your Personas can give vouches right now.</span>`}
        </label>
        <label class="field">
          <span class="field-label">A note <span class="optional">Optional</span></span>
          <textarea rows="2" maxlength="280" placeholder="Lovely to have you for dinner" .value=${g.note} @input=${(ev) => this.setGiving({ note: ev.target.value })}></textarea>
          <span class="field-hint">Plain text, at most 280 characters. Don’t put where you live or when they came.</span>
        </label>
        <div class="field-hint notice-hint">
          <span class="fas fa-fw fa-info-circle"></span>
          ${name} can show this to sites and on their profile, with your name on it. It lasts a year, and you can withdraw it at any time without telling them.
        </div>
        ${pv && !pv.ok ? html`<div class="error">${pv.reason}</div>` : ''}
        ${g.error ? html`<div class="error">${g.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary" ?disabled=${g.busy || g.checking || !g.personaId || !pv?.ok}>${g.busy ? 'Sending…' : 'Send vouch'}</button>
          <button type="button" @click=${() => (this.giving = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  setGiving(patch) {
    this.giving = { ...this.giving, ...patch, error: '' };
  }

  startGiving() {
    const usable = this.st.personas.filter((p) => p.state === 'usable');
    this.giving = blankVouch({ personaId: usable[0]?.id || '' });
    this.updateComplete.then(() => this.shadowRoot.querySelector('.vouch-form input')?.focus());
  }

  async checkGiving() {
    const g = this.giving;
    if (!g?.to?.trim()) return;
    const asked = `${g.personaId}|${g.to}`;
    this.setGiving({ checking: true });
    try {
      const preview = await nomad.personas.previewVouch({ personaId: g.personaId || null, to: g.to.trim() });
      if (this.giving && `${this.giving.personaId}|${this.giving.to}` === asked) this.setGiving({ preview, checking: false });
    } catch (err) {
      if (this.giving) this.setGiving({ preview: { ok: false, reason: cleanError(err) }, checking: false });
    }
  }

  async onGiveVouch(ev) {
    ev.preventDefault();
    const g = this.giving;
    if (!g?.preview?.ok) return;
    this.setGiving({ busy: true });
    try {
      await nomad.personas.giveVouch({ personaId: g.personaId, to: g.to.trim(), note: g.note });
      toast.create(`Vouch sent to ${g.preview.title || 'them'}. It shows once they accept it.`, 'success');
      this.giving = null;
      await this.loadVouches();
    } catch (err) {
      this.giving = { ...this.giving, busy: false, error: cleanError(err) };
    }
  }

  async onVouch(method, r, done = '') {
    try {
      await nomad.personas[method](r.personaId, r.id);
      if (done) toast.create(done, 'success');
      await this.loadVouches();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onDeclineVouch(r, host, accepted = false) {
    const ok = confirm(
      accepted
        ? `Remove the vouch from ${host}?\n\nIt comes off your profile and sites stop seeing it. ${host} isn’t told.`
        : `Decline the vouch from ${host}?\n\nIt’s deleted from all your devices. ${host} isn’t told.`
    );
    if (!ok) return;
    await this.onVouch('declineVouch', r, accepted ? 'Vouch removed' : 'Vouch declined');
  }

  async onWithdrawVouch(r, guest) {
    if (!confirm(`Withdraw your vouch for ${guest}?\n\nIt stops counting everywhere it’s shown. Nothing is sent to ${guest}.`)) return;
    await this.onVouch('withdrawVouch', r, 'Vouch withdrawn');
  }

  async onSetShown(r, shown) {
    if (shown === 'profile' && !confirm('Show this vouch on your profile?\n\nAnyone with your profile drive’s address can see it and who gave it. Like anything published, copies may stay after you take it off.')) {
      await this.loadVouches();
      return;
    }
    try {
      await nomad.personas.setVouchShown(r.personaId, r.id, shown);
      await this.loadVouches();
    } catch (err) {
      toast.create(cleanError(err), 'error');
      await this.loadVouches();
    }
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
    if (
      !confirm(
        `Delete the Persona “${p.label}”?${n} Its messages and contacts are deleted from all your devices, every vouch it gave is withdrawn and every vouch it holds is deleted. Its profile drive stays in your Hyperdrives.`
      )
    )
      return;
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

// hyper://838d28aa…7b51b800/: enough of the key to tell drives apart; the whole URL is in the title.
function shortDriveUrl(url) {
  const m = /^hyper:\/\/([0-9a-z]{20,})\/?$/i.exec(String(url || ''));
  return m ? `hyper://${m[1].slice(0, 8)}…${m[1].slice(-8)}/` : url;
}

function inboxSummary(m) {
  if (!m.usable) return 'Off: its profile drive has a writer that isn’t one of your devices.';
  if (m.state === 'changed') return m.reason;
  if (!m.enabled) return 'Off. Writing to someone turns it on for the people you write to.';
  if (m.mode === 'anyone') return 'Anyone can write. People who aren’t your contacts wait in Requests.';
  if (m.mode === 'link') return 'People with your message link can write. They wait in Requests until you accept.';
  return 'Only people you wrote to can answer.';
}

function describePerms(perms) {
  const names = perms.map((t) => t.split(':')[0]);
  const sees = [];
  if (names.includes('profile')) sees.push('your profile');
  if (names.includes('email')) sees.push('your email');
  if (names.includes('vouches')) sees.push('who vouched for you');
  if (!sees.length) return 'knows only a random ID';
  return `sees ${sees.join(' and ')}${names.includes('modifyDrive') ? ', and can change your profile' : ''}`;
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error: /, '').replace(/^Error invoking remote method '[^']+': /, '');
}

customElements.define('personas-view', PersonasView);
