// Site info's Editors tab: who can edit this drive, the requests waiting, and invite links
// (shared/drive-invites.mjs, app/bg/hyper/drive-editors.js). A Device that can edit the drive
// makes and cancels links, allows or denies requests, and removes people; anyone else sees who
// edits it and can ask to, or accept the invite link the tab was opened with.

import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { writeToClipboard } from '../../../app-stdlib/js/clipboard.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';
import { parseInviteUrl } from '../../../../../shared/drive-invites.mjs';
import css from '../../css/com/drive-editors.css.js';

const short = (key) => `${String(key).slice(0, 6)}…`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// A Profile Drive's title, or null when it can't be read in time.
async function profileTitle(url) {
  try {
    const info = await Promise.race([
      nomad.fs.drive(url).getInfo(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return info?.title || null;
  } catch {
    return null;
  }
}

class DriveEditors extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      info: { type: Object },
      // site-info's own "Edit on this device" / "Ask to edit" covers this drive (shared Space, own Devices)
      covered: { type: Boolean },
      state: { type: Object },
      names: { type: Object },
      busy: { type: Boolean },
      asked: { type: String },
    };
  }

  static get styles() {
    return [css];
  }

  constructor() {
    super();
    this.url = '';
    this.info = undefined;
    this.covered = false;
    this.state = undefined;
    this.names = {};
    this.busy = false;
    this.asked = '';
  }

  updated(changed) {
    if (changed.has('url') && this.url) this.load();
    this.dispatchEvent(new CustomEvent('resized', { bubbles: true, composed: true }));
  }

  get invite() {
    return parseInviteUrl(this.url);
  }

  async load() {
    try {
      this.state = (await nomad.drives.editors(this.url)) || null;
    } catch (e) {
      console.error(e);
      this.state = null;
    }
    const urls = new Set();
    for (const r of [...(this.state?.writers || []), ...(this.state?.requests || [])]) {
      if (r.profileUrl && !(r.profileUrl in this.names)) urls.add(r.profileUrl);
    }
    for (const u of urls) {
      profileTitle(u).then((title) => (this.names = { ...this.names, [u]: title }));
    }
  }

  nameOf(row) {
    if (row.you) return 'This device';
    if (row.device) return row.device;
    const title = row.profileUrl ? this.names[row.profileUrl] : null;
    return title || `Someone (${short(row.writerKey)})`;
  }

  subOf(row) {
    if (row.you) return 'You';
    if (row.device) return 'Your device';
    return row.profileUrl ? 'Writes with their own key' : 'No profile shared';
  }

  // rendering
  // =

  render() {
    const st = this.state;
    if (st === undefined) return html`<div class="hint">Loading…</div>`;
    if (st === null) {
      return html`<div class="hint">Only this drive's owner edits it. Drives made before collaborative drives can't take more editors.</div>`;
    }
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${this.renderInvite()} ${st.writable ? this.renderOwner() : this.renderAsk()}
      ${this.renderWriters()}
    `;
  }

  // The tab was opened with an invite link to a drive this Device can't edit yet.
  renderInvite() {
    if (!this.invite || this.state.writable) return '';
    if (this.asked === 'invite') {
      return html`
        <div class="card ok">
          <span class="fas fa-fw fa-hourglass-half"></span>
          <div>
            <strong>Invite accepted.</strong> You can edit as soon as someone who edits this drive is
            online. Their device adds yours on its own.
          </div>
        </div>
      `;
    }
    return html`
      <div class="card invite">
        <span class="fas fa-fw fa-user-plus"></span>
        <div class="grow">
          <strong>You were invited to edit this drive.</strong>
          <div class="hint">
            Accepting lets this device change its files. The person who invited you sees your profile.
          </div>
        </div>
        <button class="primary" ?disabled=${this.busy} @click=${this.onAcceptInvite}>Accept</button>
      </div>
    `;
  }

  renderAsk() {
    if (this.covered || !this.info?.collaborative || this.invite) return '';
    if (this.asked) {
      return html`<div class="card ok">
        <span class="fas fa-fw fa-hourglass-half"></span>
        <div>Asked. Someone who edits this drive can allow it when they're online.</div>
      </div>`;
    }
    return html`
      <div class="row-actions">
        <button @click=${this.onAskToEdit} ?disabled=${this.busy}>
          <span class="fas fa-fw fa-pen"></span> Ask to edit
        </button>
        <span class="hint">The people who edit this drive see your request.</span>
      </div>
    `;
  }

  renderOwner() {
    const st = this.state;
    return html`
      <div class="row-actions">
        <button class="primary" @click=${this.onCreateInvite} ?disabled=${this.busy}>
          <span class="fas fa-fw fa-link"></span> Copy an invite link
        </button>
        <span class="hint">Works once, for 7 days. Send it to the person you want to edit with.</span>
      </div>
      ${st.invites.length
        ? html`
            <h4>Open invite links</h4>
            <div class="list">
              ${repeat(
                st.invites,
                (i) => i.id,
                (i) => html`
                  <div class="item">
                    <span class="fas fa-fw fa-link muted"></span>
                    <div class="grow">
                      <div>Made ${day(i.createdAt)}</div>
                      <div class="hint">Works until ${day(i.expiresAt)}${i.multiUse ? ', for anyone with it' : ', once'}</div>
                    </div>
                    <button
                      class="icon"
                      title="Cancel this link"
                      aria-label="Cancel this link"
                      @click=${() => this.onCancelInvite(i.id)}
                    >
                      <span class="fas fa-fw fa-times"></span>
                    </button>
                  </div>
                `
              )}
            </div>
          `
        : ''}
      ${st.requests.length
        ? html`
            <h4>Asking to edit</h4>
            <div class="list">
              ${repeat(
                st.requests,
                (r) => r.writerKey,
                (r) => html`
                  <div class="item">
                    <span class="fas fa-fw fa-user-clock muted"></span>
                    <div class="grow">
                      <div>${(r.profileUrl && this.names[r.profileUrl]) || `Someone (${short(r.writerKey)})`}</div>
                      <div class="hint">Asked ${day(r.requestedAt)}</div>
                    </div>
                    <button class="primary" @click=${() => this.onApprove(r)}>Allow</button>
                    <button @click=${() => this.onDeny(r)}>Deny</button>
                  </div>
                `
              )}
            </div>
          `
        : ''}
    `;
  }

  renderWriters() {
    const st = this.state;
    const rows = st.writers;
    return html`
      <h4>Can edit</h4>
      <div class="list">
        ${!rows.length
          ? html`<div class="item"><span class="hint">Only the device that made it.</span></div>`
          : repeat(
              rows,
              (r) => r.writerKey,
              (r) => html`
                <div class="item">
                  <span class="fas fa-fw ${r.you || r.device ? 'fa-laptop' : 'fa-user'} muted"></span>
                  <div class="grow">
                    <div>${this.nameOf(r)}</div>
                    <div class="hint">${this.subOf(r)}</div>
                  </div>
                  ${st.writable && !r.you && !r.device
                    ? html`
                        <button
                          class="icon"
                          title=${`Remove ${this.nameOf(r)}`}
                          aria-label=${`Remove ${this.nameOf(r)}`}
                          @click=${() => this.onRemove(r)}
                        >
                          <span class="fas fa-fw fa-user-minus"></span>
                        </button>
                      `
                    : ''}
                </div>
              `
            )}
      </div>
      ${rows.some((r) => r.device) && st.writable
        ? html`<div class="hint foot">Your own devices are managed in Settings, Devices.</div>`
        : ''}
    `;
  }

  // events
  // =

  async run(fn) {
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      toast.create(err.message || String(err), 'error');
    } finally {
      this.busy = false;
    }
  }

  onCreateInvite() {
    return this.run(async () => {
      const link = await nomad.fs.createInvite(this.url);
      writeToClipboard(link);
      toast.create('Invite link copied', 'success', 2500);
      await this.load();
    });
  }

  onCancelInvite(id) {
    return this.run(async () => {
      await nomad.drives.cancelInvite(this.url, id);
      await this.load();
    });
  }

  onApprove(r) {
    return this.run(async () => {
      await nomad.fs.approveRequest(this.url, r.writerKey);
      await this.load();
    });
  }

  onDeny(r) {
    return this.run(async () => {
      await nomad.fs.denyRequest(this.url, r.writerKey);
      await this.load();
    });
  }

  onRemove(r) {
    return this.run(async () => {
      await nomad.fs.removeWriter(this.url, r.writerKey);
      await this.load();
    });
  }

  onAcceptInvite() {
    return this.run(async () => {
      const res = await nomad.drives.acceptInvite(this.url);
      this.asked = 'invite';
      if (res?.writable) await this.load();
    });
  }

  onAskToEdit() {
    return this.run(async () => {
      await nomad.drives.askToEdit(this.url);
      this.asked = 'ask';
    });
  }
}

customElements.define('drive-editors', DriveEditors);
