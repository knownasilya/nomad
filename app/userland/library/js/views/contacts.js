import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { listContacts, removeContact } from '../lib/contacts.js';
import contactsCSS from '../../css/views/contacts.css.js';

// Who are they? suggestions (shared/household-contacts.mjs ROLE_SUGGESTIONS).
const ROLES = ['Family', 'Emergency', 'Doctor', 'Dentist', 'School', 'Babysitter', 'Neighbor', 'Plumber', 'Electrician', 'Vet'];
const FIELDS = ['name', 'role', 'phone', 'email', 'address', 'notes'];
const telOf = (phone) => {
  const d = String(phone || '').replace(/[^0-9+*#,;]/g, '');
  return d ? 'tel:' + d : null;
};
const fold = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
// Every word typed, in any order, ignoring case and accents (the rule Notes and Reader use).
const matches = (c, q) => {
  const hay = fold([c.name, c.role, c.phone, c.email, c.address, c.notes, c.by].filter(Boolean).join(' '));
  return fold(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

// My Library → Contacts. Two lists: the Space's household contacts (people who aren't on Nomad,
// such as the plumber or the school office, shared/household-contacts.mjs, shared with everyone in
// a shared Space), then the user's contacts on Nomad (Profile Drives, lib/contacts.js).
export class ContactsView extends LitElement {
  static get properties() {
    return {
      contacts: { type: Array },
      household: { type: Object },
      editing: { type: Object },
      formError: { type: String },
      filter: { type: String },
      viewMode: { type: String },
    };
  }

  static get styles() {
    return contactsCSS;
  }

  constructor() {
    super();
    this.contacts = undefined;
    this.household = undefined;
    this.editing = null;
    this.formError = '';
    this.filter = undefined;
    this.viewMode = 'card';
    this.load();
  }

  connectedCallback() {
    super.connectedCallback();
    // Another member's or Device's change to the household list.
    try {
      this._events = nomad.vault.watchAppData();
      this._events.addEventListener('changed', () => this.loadHousehold());
    } catch {}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    try {
      this._events?.close();
    } catch {}
    this._events = null;
  }

  async loadHousehold() {
    try {
      this.household = await nomad.vault.listHouseholdContacts();
    } catch (e) {
      this.household = { contacts: [], canWrite: false, error: e.message || String(e) };
    }
  }

  async load() {
    this.loadHousehold();
    var contacts = await listContacts();
    // Enrich with live drive info (title/peers) where we can reach the drive.
    await Promise.all(
      contacts.map(async (c) => {
        try {
          let info = await nomad.fs.drive(c.url).getInfo();
          if (info) {
            if (!c.title && info.title) c.title = info.title;
            if (typeof info.peers !== 'undefined') c.peers = info.peers;
          }
        } catch (e) {
          // unreachable drive - fall back to stored title / key
        }
      })
    );
    contacts.sort((a, b) =>
      (a.title || a.key).localeCompare(b.title || b.key)
    );
    this.contacts = contacts;
  }

  async contactMenu(contact) {
    var items = [
      { label: 'Open in New Tab', click: () => window.open(contact.url) },
      {
        label: 'Copy Link',
        click: () => {
          writeToClipboard(contact.url);
          toast.create('Copied to clipboard');
        },
      },
      { type: 'separator' },
      { label: 'Remove Contact', click: () => this.onClickRemove(contact) },
    ];
    var fns = {};
    for (let i = 0; i < items.length; i++) {
      if (items[i].id) continue;
      let id = `item=${i}`;
      items[i].id = id;
      fns[id] = items[i].click;
      delete items[i].click;
    }
    var choice = await nomad.browser.showContextMenu(items);
    if (fns[choice]) fns[choice]();
  }

  // rendering
  // =

  render() {
    var contacts = this.contacts;
    if (contacts && this.filter) {
      contacts = contacts.filter(
        (c) =>
          (c.title || '').toLowerCase().includes(this.filter) ||
          c.key.toLowerCase().includes(this.filter) ||
          (c.description || '').toLowerCase().includes(this.filter)
      );
    }
    const isCard = this.viewMode === 'card';
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      ${this.renderHousehold()}
      <h3 class="section-title">On Nomad</h3>
      ${contacts
        ? html`
            <div class="${isCard ? 'contacts card-view' : 'contacts'}">
              ${repeat(contacts, (c) => c.key, (c) => this.renderContact(c, isCard))}
              ${contacts.length === 0
                ? this.filter
                  ? html`
                      <div class="empty">
                        <span class="fas fa-search"></span>
                        <div>No matches for "${this.filter}"</div>
                      </div>
                    `
                  : html`
                      <div class="empty">
                        <span class="far fa-address-card"></span>
                        <div>No contacts on Nomad yet.</div>
                        <div class="empty-hint">
                          Use "New Contact" to add someone by their hyper:// link.
                        </div>
                      </div>
                    `
                : ''}
            </div>
          `
        : html`<div class="loading"><span class="spinner"></span></div>`}
    `;
  }

  renderHousehold() {
    const h = this.household;
    if (!h) return html`<div class="loading"><span class="spinner"></span></div>`;
    const list = this.filter ? h.contacts.filter((c) => matches(c, this.filter)) : h.contacts;
    const where = h.spaceName || 'this Space';
    return html`
      <section class="household">
        <div class="household-head">
          <div>
            <h3 class="section-title">${h.shared ? `${where}’s contacts` : `Contacts in ${where}`}</h3>
            <div class="household-hint">
              ${h.shared
                ? 'Everyone in this Space sees these: the plumber, the school, the babysitter.'
                : 'People who aren’t on Nomad, like the plumber or the school. Share this Space and the household sees them too.'}
            </div>
          </div>
          ${h.canWrite && !this.editing
            ? html`<button class="primary" @click=${() => this.onEdit({})}>Add a contact</button>`
            : ''}
        </div>
        ${this.editing ? this.renderForm() : ''}
        ${h.error ? html`<div class="form-error">${h.error}</div>` : ''}
        ${list.length
          ? html`<div class="hc-list">${repeat(list, (c) => c.id, (c) => this.renderHouseholdContact(c, h))}</div>`
          : !this.editing
            ? html`<div class="hc-empty">${this.filter ? `No matches for "${this.filter}"` : 'None yet.'}</div>`
            : ''}
      </section>
    `;
  }

  renderHouseholdContact(c, h) {
    const tel = telOf(c.phone);
    return html`
      <div class="hc">
        <div class="hc-avatar" aria-hidden="true">${(c.name || '?').slice(0, 1).toUpperCase()}</div>
        <div class="hc-info">
          <div class="hc-name">${c.name}${c.role ? html` <span class="hc-role">${c.role}</span>` : ''}</div>
          <div class="hc-lines">
            ${c.phone
              ? html`<a href=${tel || '#'} title="Call ${c.name}"><span class="fas fa-phone-alt"></span> ${c.phone}</a>`
              : ''}
            ${c.email
              ? html`<a href=${'mailto:' + c.email} title="Email ${c.name}"><span class="far fa-envelope"></span> ${c.email}</a>`
              : ''}
            ${c.address ? html`<span><span class="fas fa-map-marker-alt"></span> ${c.address}</span>` : ''}
          </div>
          ${c.notes ? html`<div class="hc-notes">${c.notes}</div>` : ''}
          ${h.shared && c.by ? html`<div class="hc-by">Added by ${c.by}</div>` : ''}
        </div>
        <div class="hc-ctrls">
          ${c.phone
            ? html`<button class="icon" title="Copy ${c.name}’s number" @click=${() => this.copy(c.phone, 'Number copied')}><span class="far fa-copy"></span></button>`
            : ''}
          ${h.canWrite
            ? html`
                <button class="icon" title="Edit ${c.name}" @click=${() => this.onEdit(c)}><span class="fas fa-pen"></span></button>
                <button class="icon danger" title="Remove ${c.name}" @click=${() => this.onRemoveHousehold(c)}><span class="far fa-trash-alt"></span></button>
              `
            : ''}
        </div>
      </div>
    `;
  }

  renderForm() {
    const e = this.editing;
    const input = (key, label, opts = {}) => html`
      <label class="hc-field ${opts.wide ? 'wide' : ''}">
        <span>${label}</span>
        ${opts.area
          ? html`<textarea rows="2" .value=${e[key] || ''} @input=${(ev) => this.setField(key, ev.target.value)}></textarea>`
          : html`<input
              type=${opts.type || 'text'}
              list=${opts.list || ''}
              .value=${e[key] || ''}
              placeholder=${opts.placeholder || ''}
              @input=${(ev) => this.setField(key, ev.target.value)}
              @keydown=${(ev) => ev.key === 'Enter' && this.onSave()}
            />`}
      </label>
    `;
    return html`
      <form class="hc-form" @submit=${(ev) => { ev.preventDefault(); this.onSave(); }}>
        ${input('name', 'Name', { placeholder: 'Dr. Patel' })}
        ${input('role', 'Who are they?', { list: 'hc-roles', placeholder: 'Doctor' })}
        <datalist id="hc-roles">${ROLES.map((r) => html`<option value=${r}></option>`)}</datalist>
        ${input('phone', 'Phone', { type: 'tel' })}
        ${input('email', 'Email', { type: 'email' })}
        ${input('address', 'Address', { area: true, wide: true })}
        ${input('notes', 'Notes', { area: true, wide: true })}
        ${this.formError ? html`<div class="form-error wide">${this.formError}</div>` : ''}
        <div class="hc-actions wide">
          <button type="button" @click=${() => { this.editing = null; this.formError = ''; }}>Cancel</button>
          <button type="submit" class="primary" ?disabled=${!String(e.name || '').trim()}>${e.id ? 'Save' : 'Add'}</button>
        </div>
      </form>
    `;
  }

  renderContact(contact, isCard = false) {
    var { url, key, title, description, peers } = contact;
    var displayName = title || `${key.slice(0, 6)}…${key.slice(-4)}`;
    var sub = description || `${key.slice(0, 12)}…`;
    return html`
      <a
        class="contact"
        href=${url}
        title=${title || key}
        @contextmenu=${(e) => this.onContextmenuContact(e, contact)}
      >
        <img class="avatar" src="asset:favicon:${url}" />
        <div class="info">
          <div class="name">${displayName}</div>
          <div class="sub">${sub}</div>
          ${isCard && typeof peers !== 'undefined'
            ? html`<div class="peers"><span class="fas fa-fw fa-share-alt"></span> ${peers}</div>`
            : ''}
        </div>
        <div class="ctrls">
          <button title="More" @click=${(e) => this.onClickContactMenuBtn(e, contact)}>
            <span class="fas fa-fw fa-ellipsis-h"></span>
          </button>
        </div>
      </a>
    `;
  }

  // events
  // =

  async onContextmenuContact(e, contact) {
    e.preventDefault();
    e.stopPropagation();
    await this.contactMenu(contact);
  }

  onClickContactMenuBtn(e, contact) {
    e.preventDefault();
    e.stopPropagation();
    this.contactMenu(contact);
  }

  onEdit(c) {
    this.formError = '';
    this.editing = { id: c.id || null, ...Object.fromEntries(FIELDS.map((k) => [k, c[k] || ''])) };
    this.updateComplete.then(() => this.shadowRoot.querySelector('.hc-form input')?.focus());
  }

  setField(key, value) {
    this.editing = { ...this.editing, [key]: value };
    this.formError = '';
  }

  async onSave() {
    const e = this.editing;
    if (!e || !String(e.name || '').trim()) return;
    try {
      const fields = Object.fromEntries(FIELDS.map((k) => [k, e[k] || '']));
      if (e.id) fields.id = e.id;
      await nomad.vault.saveHouseholdContact(fields);
      this.editing = null;
      toast.create(e.id ? 'Contact saved' : 'Contact added');
      this.loadHousehold();
    } catch (err) {
      this.formError = (err.message || String(err)).replace(/^Error: /, '');
    }
  }

  async onRemoveHousehold(c) {
    const where = this.household?.shared ? ` It goes for everyone in ${this.household.spaceName || 'this Space'}.` : '';
    if (!confirm(`Remove ${c.name}?${where}`)) return;
    try {
      await nomad.vault.deleteHouseholdContact(c.id);
      toast.create('Contact removed');
    } catch (err) {
      toast.create(err.message || String(err), 'error');
    }
    this.loadHousehold();
  }

  copy(text, msg) {
    writeToClipboard(text);
    toast.create(msg);
  }

  async onClickRemove(contact) {
    if (!confirm(`Remove ${contact.title || 'this contact'}?`)) return;
    await removeContact(contact.key);
    toast.create('Contact removed', '', 10e3);
    this.load();
  }
}

customElements.define('contacts-view', ContactsView);
