import {
  LitElement,
  html,
} from 'beaker://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'beaker://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { writeToClipboard } from 'beaker://app-stdlib/js/clipboard.js';
import * as toast from 'beaker://app-stdlib/js/com/toast.js';
import { listContacts, removeContact } from '../lib/contacts.js';
import contactsCSS from '../../css/views/contacts.css.js';

export class ContactsView extends LitElement {
  static get properties() {
    return {
      contacts: { type: Array },
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
    this.filter = undefined;
    this.viewMode = 'card';
    this.load();
  }

  async load() {
    var contacts = await listContacts();
    // Enrich with live drive info (title/peers) where we can reach the drive.
    await Promise.all(
      contacts.map(async (c) => {
        try {
          let info = await beaker.hyperdrive.drive(c.url).getInfo();
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
    var choice = await beaker.browser.showContextMenu(items);
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
      <link rel="stylesheet" href="beaker://app-stdlib/css/fontawesome.css" />
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
                        <div>No contacts yet.</div>
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
          <button @click=${(e) => this.onClickContactMenuBtn(e, contact)}>
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

  async onClickRemove(contact) {
    if (!confirm(`Remove ${contact.title || 'this contact'}?`)) return;
    await removeContact(contact.key);
    toast.create('Contact removed', '', 10e3);
    this.load();
  }
}

customElements.define('contacts-view', ContactsView);
