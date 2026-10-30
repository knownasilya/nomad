import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import sharingCSS from '../../css/views/sharing.css.js';

// Sharing this Space with other people (ADR-0029, bg/hyper/space-library.js). Sharing moves the
// Space's library (drives, contacts, feeds, its own Notes and Names) into a Space Library that its
// members replicate. Owners invite people with a single-use code, approve them, set who can edit
// and who can view, and answer viewers' asks to edit one drive. Anyone can join a shared Space with
// a code here, too.

const ROLE_LABELS = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

export class SharingView extends LitElement {
  static get properties() {
    return {
      info: { type: Object }, // nomad.vault.getSpaceShare(), undefined while loading
      ownName: { type: String },
      inviteRole: { type: String },
      invite: { type: Object }, // { code, role } once made
      joining: { type: Object }, // { code, name, waiting, error }
      busy: { type: Boolean },
      error: { type: String },
    };
  }

  static get styles() {
    return sharingCSS;
  }

  constructor() {
    super();
    this.info = undefined;
    this.ownName = '';
    this.inviteRole = 'viewer';
    this.invite = null;
    this.joining = { code: '', name: '', waiting: false, error: '' };
    this.busy = false;
    this.error = '';
    this.load();
    try {
      nomad.vault.watchSpaceShare().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      this.info = await nomad.vault.getSpaceShare();
      if (!this.ownName) this.ownName = this.info.ownName || '';
      if (!this.joining.name) this.joining = { ...this.joining, name: this.info.ownName || '' };
    } catch (e) {
      this.info = { shared: false, error: e.message || String(e) };
    }
  }

  async run(fn, okMsg) {
    this.busy = true;
    this.error = '';
    try {
      const res = await fn();
      if (okMsg) toast.create(okMsg, 'success');
      await this.load();
      return res;
    } catch (e) {
      this.error = e.message || String(e);
    } finally {
      this.busy = false;
    }
  }

  // rendering
  // =

  render() {
    if (!this.info) return html`<div class="empty">Loading…</div>`;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      ${this.info.shared ? this.renderShared() : this.renderNotShared()}
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.renderJoin()}
    `;
  }

  renderNotShared() {
    const i = this.info;
    if (i.personal) {
      return html`
        <div class="intro">
          Your Personal Space holds your own things, so it can’t be shared. Make another Space, or switch
          to one, to share it with other people.
        </div>
      `;
    }
    return html`
      <div class="intro">
        Share <strong>${i.name}</strong> with other people. Each person can view everything in it, or edit
        everything in it. A person who can only view can ask you to let them edit one drive.
      </div>
      <div class="card">
        <div class="card-title"><span class="fas fa-fw fa-user-friends"></span> Share ${i.name}</div>
        <div class="what">
          <div><strong>What they’ll see:</strong> ${i.preview || 'this Space’s drives, contacts, feeds, notes and names'}.</div>
          <div>
            Everyone you invite can read every drive listed in this Space. Your private drive
            (<code>hyper://private/</code>), your AI chats, your Vault and your notes for every Space stay
            yours.
          </div>
        </div>
        <div class="fields">
          <label for="own-name">Your name in this Space</label>
          <input
            id="own-name"
            .value=${this.ownName}
            @input=${(e) => (this.ownName = e.target.value)}
            placeholder="Your name"
          />
          <button class="primary" ?disabled=${this.busy} @click=${this.onShare}>Share this Space</button>
        </div>
      </div>
    `;
  }

  renderShared() {
    const i = this.info;
    const owner = i.role === 'owner' && i.writable;
    if (i.removed) {
      return html`
        <div class="notice">
          <span class="fas fa-fw fa-user-slash"></span> You were removed from ${i.name}. It no longer syncs
          new changes from the others.
        </div>
        <div class="row-actions"><button @click=${this.onLeave}>Remove ${i.name} from this device</button></div>
      `;
    }
    return html`
      <div class="intro">
        <strong>${i.name}</strong> is shared. You ${i.role === 'viewer' ? 'can view it' : i.role === 'owner' ? 'own it' : 'can edit it'}.
        ${i.role === 'viewer' ? 'To edit a drive in it, open the drive and ask from its site info.' : ''}
        ${!i.writable && i.role !== 'viewer' ? html`<br />This device is waiting for your other device to let it edit.` : ''}
      </div>

      ${i.joins?.length
        ? html`
            <div class="section-title">Waiting to join</div>
            <div class="rows">
              ${repeat(
                i.joins,
                (j) => j.memberId,
                (j) => html`
                  <div class="row">
                    <span class="fas fa-fw fa-user-plus"></span>
                    <div class="meta">
                      <div class="title">${j.name} wants to join</div>
                      <div class="sub">They’ll ${j.role === 'editor' ? 'be able to edit' : 'be able to view'} everything in ${i.name}.</div>
                    </div>
                    <div class="actions">
                      <button @click=${() => this.run(() => nomad.vault.denySpaceJoin(j.memberId))}>Deny</button>
                      <button class="primary" @click=${() => this.run(() => nomad.vault.approveSpaceJoin(j.memberId), `${j.name} joined`)}>
                        Approve
                      </button>
                    </div>
                  </div>
                `
              )}
            </div>
          `
        : ''}

      ${i.requests?.length
        ? html`
            <div class="section-title">Asking to edit a drive</div>
            <div class="rows">
              ${repeat(
                i.requests,
                (r) => r.drive + r.writerKey,
                (r) => html`
                  <div class="row">
                    <span class="fas fa-fw fa-pen"></span>
                    <div class="meta">
                      <div class="title">${r.name} asks to edit ${r.title || 'a drive'}</div>
                      <div class="sub">
                        ${r.note ? html`“${r.note}” · ` : ''}Only that drive, only in ${i.name}.
                        ${r.canApprove ? '' : 'Someone who can edit that drive has to answer.'}
                      </div>
                    </div>
                    <div class="actions">
                      ${i.writable
                        ? html`<button @click=${() => this.answer(r, false)}>Deny</button>`
                        : ''}
                      ${r.canApprove
                        ? html`<button class="primary" @click=${() => this.answer(r, true)}>Approve</button>`
                        : ''}
                    </div>
                  </div>
                `
              )}
            </div>
          `
        : ''}

      <div class="section-title">People</div>
      <div class="rows">
        ${repeat(
          i.members || [],
          (m) => m.memberId,
          (m) => html`
            <div class="row">
              <span class="fas fa-fw fa-user"></span>
              <div class="meta">
                <div class="title">${m.name}${m.memberId === i.memberId ? html` <span class="badge">You</span>` : ''}</div>
                <div class="sub">${ROLE_LABELS[m.role]}</div>
              </div>
              <div class="actions">
                ${owner && m.memberId !== i.memberId
                  ? html`
                      <select
                        aria-label="Role"
                        .value=${m.role}
                        @change=${(e) => this.run(() => nomad.vault.setSpaceRole(m.memberId, e.target.value))}
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                      <button class="icon danger" title="Remove ${m.name}" aria-label="Remove ${m.name}" @click=${() => this.onRemove(m)}>
                        <span class="fas fa-times"></span>
                      </button>
                    `
                  : ''}
              </div>
            </div>
          `
        )}
      </div>

      ${owner
        ? html`
            <div class="card">
              <div class="card-title"><span class="fas fa-fw fa-user-plus"></span> Invite someone</div>
              <div class="fields">
                <select aria-label="They can" .value=${this.inviteRole} @change=${(e) => (this.inviteRole = e.target.value)}>
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
                <button class="primary" ?disabled=${this.busy} @click=${this.onInvite}>Make a code</button>
              </div>
              ${this.invite
                ? html`
                    <div class="code-row">
                      <code class="code">${this.invite.code}</code>
                      <button @click=${() => this.copy(this.invite.code)}><span class="far fa-copy"></span> Copy</button>
                    </div>
                    <div class="sub">
                      Send this code to one person. They enter it under Join a shared Space, and you
                      approve them here. They’ll ${this.invite.role === 'editor' ? 'be able to edit' : 'be able to view'} everything.
                    </div>
                  `
                : ''}
            </div>
          `
        : ''}

      <div class="leave">
        <button @click=${this.onLeave}><span class="fas fa-sign-out-alt"></span> Leave ${i.name}</button>
        <div class="sub">
          Removing someone stops their changes, but they keep what they already have and can still read
          the drives this Space listed.
        </div>
      </div>
    `;
  }

  renderJoin() {
    const j = this.joining;
    return html`
      <div class="card join">
        <div class="card-title"><span class="fas fa-fw fa-sign-in-alt"></span> Join a shared Space</div>
        ${j.waiting
          ? html`<div class="sub"><span class="spinner"></span> Waiting for an owner to approve you…</div>`
          : html`
              <div class="fields">
                <input
                  class="code-input"
                  .value=${j.code}
                  placeholder="Code"
                  aria-label="Code"
                  @input=${(e) => (this.joining = { ...j, code: e.target.value, error: '' })}
                />
                <input
                  .value=${j.name}
                  placeholder="Your name"
                  aria-label="Your name"
                  @input=${(e) => (this.joining = { ...j, name: e.target.value })}
                />
                <button class="primary" ?disabled=${!j.code.trim()} @click=${this.onJoin}>Join</button>
              </div>
            `}
        ${j.error ? html`<div class="error">${j.error}</div>` : ''}
      </div>
    `;
  }

  // events
  // =

  async onShare() {
    await this.run(() => nomad.vault.shareSpace({ name: this.ownName }), 'Shared. Now invite people');
  }

  async onInvite() {
    const res = await this.run(() => nomad.vault.createSpaceInvite(this.inviteRole));
    if (res) this.invite = res;
  }

  async onRemove(m) {
    if (!confirm(`Remove ${m.name} from ${this.info.name}? Their changes stop, but they keep what they already have.`)) return;
    await this.run(() => nomad.vault.removeSpaceMember(m.memberId), `Removed ${m.name}`);
  }

  async answer(r, approve) {
    await this.run(
      () => nomad.vault.answerSpaceRequest({ drive: r.drive, writerKey: r.writerKey, approve }),
      approve ? `${r.name} can edit ${r.title || 'the drive'}` : null
    );
  }

  async onLeave() {
    if (!confirm(`Leave ${this.info.name}? It goes from all your devices.`)) return;
    await this.run(() => nomad.vault.leaveSpace(), 'Left the Space');
  }

  async onJoin() {
    const j = this.joining;
    this.joining = { ...j, waiting: true, error: '' };
    try {
      const res = await nomad.vault.joinSpace(j.code.trim(), { name: j.name });
      this.joining = { code: '', name: j.name, waiting: false, error: '' };
      toast.create(`Joined ${res.name}`, 'success');
      await this.load();
    } catch (e) {
      this.joining = { ...j, waiting: false, error: e.message || String(e) };
    }
  }

  copy(text) {
    writeToClipboard(text);
    toast.create('Code copied', '', 2e3);
  }
}

customElements.define('sharing-view', SharingView);
