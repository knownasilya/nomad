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
//
// Set up a home (shared/home-setup.mjs) makes a new shared Space for the people the user lives with,
// with a Groceries list and House info pinned, and opens this page in it (?home=1) to invite them.

const ROLE_LABELS = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };
const YOUR_ROLE = { owner: 'You own it', editor: 'You can edit', viewer: 'You can view' };

// A Space's color, as the Space switcher's dot shows it, or the accent when it isn't a plain hex color.
function spaceColor(c) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : 'var(--share-fill)';
}

// A home (shared/home-setup.mjs HOME_ICON). Personal also carries the 'home' icon from the first
// schema, but it's not a home.
const isHome = (s) => !!s && s.icon === 'home' && !s.personal && Number(s.id ?? s.spaceId) !== 1;

// A Space's mark: its color, with a house for a home, else its first letter.
function spaceMark(s, small = false) {
  const letter = (String(s.name || '').trim()[0] || '?').toUpperCase();
  return html`<span class="space-mark ${small ? 'small' : ''}" style="--space-color: ${spaceColor(s.color)}" aria-hidden="true">
    ${isHome(s) ? html`<span class="fas fa-home"></span>` : letter}
  </span>`;
}

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
      homeName: { type: String }, // Set up a home: the new Space's name
      welcome: { type: Boolean }, // just set up a home: say what's in it
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
    this.homeName = 'Home';
    this.welcome = false;
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('home') === '1') {
        this.welcome = true;
        this.inviteRole = 'editor'; // the people you live with edit the lists too
        url.searchParams.delete('home');
        history.replaceState(history.state, '', url.pathname + url.search);
      }
    } catch {}
    this.load();
    try {
      nomad.vault.watchSpaceShare().addEventListener('changed', () => this.load());
    } catch {}
  }

  async load() {
    try {
      this.info = await nomad.vault.getSpaceShare();
      // A shared Space has no ownName: the user's name in it is their member record's.
      const me = (this.info.members || []).find((m) => m.memberId && m.memberId === this.info.memberId);
      const own = this.info.ownName || me?.name || '';
      if (!this.ownName) this.ownName = own;
      if (!this.joining.name) this.joining = { ...this.joining, name: own };
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
  //
  // Two zones, so what acts on this Space never blends with what makes or joins another one:
  //  - This Space: a card headed by the Space's own color and name (the dot the Space switcher shows),
  //    and its state: Personal, not shared, shared (with your role), or removed.
  //  - Other Spaces: the user's other shared Spaces, each with Open (two "Home"s are told apart by
  //    color and role), then Set up a home and Join a shared Space side by side.

  render() {
    if (!this.info) return html`<div class="empty">Loading…</div>`;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <section class="zone current" style="--space-color: ${spaceColor(this.info.color)}" aria-labelledby="this-space">
        ${this.renderHead()}
        <div class="zone-body">${this.renderCurrent()}</div>
      </section>
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.renderOthers()}
    `;
  }

  renderHead() {
    const i = this.info;
    let status;
    if (i.personal) status = html`<span class="fas fa-fw fa-lock"></span> Only you`;
    else if (!i.shared) status = html`<span class="fas fa-fw fa-lock"></span> Not shared`;
    else if (i.removed) status = html`<span class="fas fa-fw fa-user-slash"></span> You were removed`;
    else {
      const n = (i.members || []).length;
      const who = n > 1 ? `Shared with ${n} people` : 'Shared, just you so far';
      status = html`<span class="fas fa-fw fa-user-friends"></span> ${who} · ${YOUR_ROLE[i.role] || YOUR_ROLE.viewer}`;
    }
    return html`
      <div class="space-head">
        ${spaceMark(i)}
        <div class="head-text">
          <div class="eyebrow">This Space</div>
          <h2 id="this-space">${i.name}</h2>
          <div class="status ${i.shared && !i.removed ? 'on' : ''}">${status}</div>
        </div>
      </div>
    `;
  }

  renderCurrent() {
    const i = this.info;
    if (i.personal) {
      return html`
        <p class="intro">
          Your Personal Space holds your own things, so it can’t be shared. To share with other people, open
          one of your shared Spaces or set one up below.
        </p>
      `;
    }
    if (!i.shared) return this.renderNotShared();
    if (i.removed) {
      return html`
        <p class="intro">
          You were removed from ${i.name}. It no longer syncs new changes from the others. What you already
          have stays until you remove it.
        </p>
        <div class="row-actions"><button @click=${this.onLeave}>Remove ${i.name} from this device</button></div>
      `;
    }
    return this.renderShared();
  }

  renderNotShared() {
    const i = this.info;
    return html`
      <p class="intro">
        Share ${i.name} with other people. Each person can view everything in it, or edit everything in it.
        A person who can only view can ask you to let them edit one drive.
      </p>
      <div class="what">
        <div><strong>What they’ll see:</strong> ${i.preview || 'this Space’s drives, contacts, feeds, notes and names'}.</div>
        <div>
          Your private drive (<code>hyper://private/</code>), your AI chats, your Vault and your notes for every
          Space stay yours.
        </div>
      </div>
      <div class="fields">
        <label class="inline" for="own-name">Your name in ${i.name}</label>
        <input id="own-name" .value=${this.ownName} @input=${(e) => (this.ownName = e.target.value)} placeholder="Your name" />
        <button class="primary" ?disabled=${this.busy} @click=${this.onShare}>
          <span class="fas fa-user-friends"></span> Share ${i.name}
        </button>
      </div>
    `;
  }

  renderShared() {
    const i = this.info;
    const owner = i.role === 'owner' && i.writable;
    return html`
      ${this.welcome && owner
        ? html`
            <div class="notice welcome">
              <span class="fas fa-fw fa-check-circle"></span>
              <div>
                <strong>${i.name} is ready.</strong> Its Groceries list and House info are pinned at the top of
                the sidebar. Now make a code for each person you live with, and approve them here when they join.
              </div>
            </div>
          `
        : ''}
      ${i.role === 'viewer' ? html`<p class="intro">To edit a drive in ${i.name}, open the drive and ask from its site info.</p>` : ''}
      ${!i.writable && i.role !== 'viewer'
        ? html`<p class="intro">This device is waiting for your other device to let it edit.</p>`
        : ''}

      ${i.joins?.length
        ? html`
            <h3 class="section-title attention"><span class="fas fa-fw fa-bell"></span> Waiting to join</h3>
            <div class="list">
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
            <h3 class="section-title attention"><span class="fas fa-fw fa-bell"></span> Asking to edit a drive</h3>
            <div class="list">
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
                      ${i.writable ? html`<button @click=${() => this.answer(r, false)}>Deny</button>` : ''}
                      ${r.canApprove ? html`<button class="primary" @click=${() => this.answer(r, true)}>Approve</button>` : ''}
                    </div>
                  </div>
                `
              )}
            </div>
          `
        : ''}

      <h3 class="section-title">People</h3>
      <div class="list">
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
                        aria-label="Role for ${m.name}"
                        title="Role for ${m.name}"
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
        ? html`<div class="note">
            Removing someone stops their changes, but they keep what they already have and can still read the
            drives this Space listed.
          </div>`
        : ''}

      ${owner
        ? html`
            <div class="invite">
              <h3 class="section-title"><span class="fas fa-fw fa-user-plus"></span> Invite someone to ${i.name}</h3>
              <div class="fields">
                <label class="inline" for="invite-role">They can</label>
                <select id="invite-role" .value=${this.inviteRole} @change=${(e) => (this.inviteRole = e.target.value)}>
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
                      Send this code to one person. They enter it under Join a shared Space, and you approve them
                      here. They’ll ${this.invite.role === 'editor' ? 'be able to edit' : 'be able to view'} everything.
                    </div>
                  `
                : ''}
            </div>
          `
        : ''}

      <div class="leave">
        <button class="danger" @click=${this.onLeave}><span class="fas fa-sign-out-alt"></span> Leave ${i.name}</button>
        <span class="sub">It goes from all your devices.</span>
      </div>
    `;
  }

  // The other Spaces: the user's other shared Spaces, then Set up a home and Join, side by side.
  renderOthers() {
    const i = this.info;
    const others = i.others || [];
    return html`
      <section class="zone others" aria-labelledby="other-spaces">
        <div class="zone-head">
          <h2 id="other-spaces">Other Spaces</h2>
          <p>
            ${others.length ? 'Open another of your shared Spaces, set up a home, or join' : 'Set up a home, or join'}
            someone’s Space with a code. Each is its own Space in your Spaces menu; ${i.name} doesn’t change.
          </p>
        </div>
        ${others.length
          ? html`
              <div class="list spaces">
                ${repeat(
                  others,
                  (s) => s.id,
                  (s) => html`
                    <div class="row">
                      ${spaceMark(s, true)}
                      <div class="meta">
                        <div class="title">${s.name}</div>
                        <div class="sub">${s.removed ? 'You were removed' : YOUR_ROLE[s.role] || YOUR_ROLE.viewer}</div>
                      </div>
                      <div class="actions">
                        <button @click=${() => this.onOpenSpace(s)}>Open <span class="fas fa-arrow-right"></span></button>
                      </div>
                    </div>
                  `
                )}
              </div>
            `
          : ''}
        <div class="options">${this.renderHome()} ${this.renderJoin()}</div>
      </section>
    `;
  }

  // Set up a home: a new Space for the people the user lives with.
  renderHome() {
    const names = [this.info.name, ...(this.info.others || []).map((s) => s.name)];
    const wanted = (this.homeName || 'Home').trim().toLowerCase();
    const taken = names.some((n) => String(n || '').trim().toLowerCase() === wanted);
    const another = (this.info.others || []).some(isHome) || isHome(this.info);
    return html`
      <div class="option">
        <div class="option-head">
          <span class="option-icon"><span class="fas fa-home"></span></span>
          <div>
            <div class="option-title">${another ? 'Set up another home' : 'Set up a home'}</div>
            <div class="option-sub">A new Space for the people you live with</div>
          </div>
        </div>
        <div class="what">
          <div>
            It comes with a <strong>Groceries</strong> list everyone can tick off, and <strong>House info</strong>
            for the Wi-Fi, bins and emergency contacts, both pinned. Then you invite them.
          </div>
        </div>
        <label for="home-name">Name</label>
        <input id="home-name" .value=${this.homeName} @input=${(e) => (this.homeName = e.target.value)} placeholder="Home" />
        ${taken
          ? html`<div class="hint">
              <span class="fas fa-info-circle"></span> You already have a Space named ${this.homeName.trim() || 'Home'}.
              A different name tells them apart.
            </div>`
          : ''}
        <label for="home-own-name">Your name</label>
        <input id="home-own-name" .value=${this.ownName} @input=${(e) => (this.ownName = e.target.value)} placeholder="Your name" />
        <div class="option-actions">
          <button class="primary" ?disabled=${this.busy} @click=${this.onSetUpHome}>Set up</button>
        </div>
      </div>
    `;
  }

  renderJoin() {
    const j = this.joining;
    return html`
      <div class="option">
        <div class="option-head">
          <span class="option-icon"><span class="fas fa-sign-in-alt"></span></span>
          <div>
            <div class="option-title">Join a shared Space</div>
            <div class="option-sub">Someone sent you a code</div>
          </div>
        </div>
        <div class="what"><div>Enter the code. Someone who owns the Space approves you, and it opens here.</div></div>
        ${j.waiting
          ? html`<div class="waiting"><span class="spinner"></span> Waiting for an owner to approve you…</div>`
          : html`
              <label for="join-code">Code</label>
              <input
                id="join-code"
                class="code-input"
                .value=${j.code}
                placeholder="Paste the code"
                @input=${(e) => (this.joining = { ...j, code: e.target.value, error: '' })}
              />
              <label for="join-name">Your name</label>
              <input id="join-name" .value=${j.name} placeholder="Your name" @input=${(e) => (this.joining = { ...j, name: e.target.value })} />
              <div class="option-actions">
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

  async onSetUpHome() {
    // The window switches to the new Space, with this page open there.
    await this.run(() => nomad.vault.setUpHome({ name: this.homeName, ownName: this.ownName }));
  }

  async onOpenSpace(s) {
    await this.run(() => nomad.vault.openSpace(s.id));
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
