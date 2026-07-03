import { LitElement, html } from 'lit';
import viewCSS from '../../css/views/devices.css.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';

// Devices settings subpage — manage the Devices linked to your Vault (the identity-level store
// that lets all your Devices read and edit all your Spaces). Backed by beaker.vault.
// See ~/maintained/nomad/docs/multi-device-protocol.md and ADR-0006 / ADR-0007.
class DevicesView extends LitElement {
  static get properties() {
    return {
      loading: { type: Boolean },
      error: { type: String },
      hasVault: { type: Boolean },
      thisDevice: { type: Object },
      devices: { type: Array },
      pending: { type: Array },
      inviteCode: { type: String },
      busy: { type: Boolean },
      migrating: { type: Boolean },
      migrateProgress: { type: Object },
      editingKey: { type: String },
      editName: { type: String },
      confirmingKey: { type: String },
    };
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.loading = true;
    this.error = '';
    this.hasVault = false;
    this.thisDevice = null;
    this.devices = [];
    this.pending = [];
    this.inviteCode = '';
    this.busy = false;
    this.migrating = false;
    this.migrateProgress = null;
    this.editingKey = '';
    this.editName = '';
    this.confirmingKey = '';
    this._pendingStream = null;
    this._pollTimer = null;
  }

  async load() {
    this.loading = true;
    this.error = '';
    try {
      const status = await beaker.vault.getStatus();
      this.hasVault = status.hasVault;
      this.thisDevice = status.thisDevice;
      if (this.hasVault) {
        await this._refresh();
        this._watchPending();
        this._startPolling();
      }
    } catch (e) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  unload() {
    if (this._pendingStream) {
      try {
        this._pendingStream.close();
      } catch {}
      this._pendingStream = null;
    }
    this._stopPolling();
  }

  // Poll for incoming pairing requests (and device-list changes) while the page is open. The
  // event-stream watch above should cover this, but polling guarantees the request list updates
  // live without a manual refresh.
  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => {
      // Don't clobber an in-progress rename/remove interaction.
      if (this.editingKey || this.confirmingKey || this.busy) return;
      this._refresh().catch(() => {});
    }, 3000);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _refresh() {
    this.devices = (await beaker.vault.listDevices()) || [];
    this.pending = (await beaker.vault.listPendingRequests()) || [];
    this.requestUpdate();
  }

  _watchPending() {
    if (this._pendingStream) return;
    try {
      this._pendingStream = beaker.vault.watchPendingRequests();
      this._pendingStream.addEventListener('changed', () => this._refresh());
    } catch {
      // fall back to no live updates; manual reload still works
    }
  }

  // rendering
  // =

  render() {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css" />
      ${this.loading
        ? html`<div class="loading">
            <span class="spinner"></span> Loading devices…
          </div>`
        : this.error
        ? html`<div class="message error">
            <span class="fas fa-fw fa-exclamation-circle"></span>
            <span>${this.error}</span>
          </div>`
        : this.hasVault
        ? this.renderLinked()
        : this.renderSetup()}
    `;
  }

  // No Vault yet on this device: either set one up or join an identity from another device.
  renderSetup() {
    return html`
      <div class="section">
        <h2>Devices</h2>
        <p class="hint">
          Linking devices lets every device you own read and edit all your spaces and
          drives. Your spaces are grouped under a private <strong>Vault</strong> that every
          linked device is a writer of.
        </p>
        <div class="actions">
          <button class="btn primary" ?disabled=${this.migrating} @click=${this.onClickSetup}>
            ${this.migrating
              ? html`<span class="spinner"></span> Setting up…`
              : html`<span class="fas fa-fw fa-laptop-house"></span> Set up this device`}
          </button>
        </div>
      </div>

      <div class="section">
        <h2>Join from another device</h2>
        <p class="hint">
          Already set up on another device? Paste an invite code from it to link this device.
        </p>
        ${this.renderJoinForm()}
      </div>
    `;
  }

  renderLinked() {
    return html`
      <div class="section">
        <h2>Your devices</h2>
        ${this.renderDeviceList()}
      </div>

      ${this.pending && this.pending.length
        ? html`<div class="section">
            <h2>Pending requests</h2>
            ${this.renderPending()}
          </div>`
        : ''}

      <div class="section">
        <h2>Add a device</h2>
        <p class="hint">
          Generate an invite code, then enter it on your other device. You'll approve the
          request here before it gains access.
        </p>
        ${this.inviteCode ? this.renderInvite() : html`
          <div class="actions">
            <button class="btn primary" ?disabled=${this.busy} @click=${this.onClickCreateInvite}>
              <span class="fas fa-fw fa-plus"></span> Create invite code
            </button>
          </div>
        `}
      </div>

      <div class="section">
        <h2>Join from another device</h2>
        ${this.renderJoinForm()}
      </div>
    `;
  }

  renderDeviceList() {
    if (!this.devices || this.devices.length === 0) {
      return html`<div class="empty-state">
        This is your only device. Add another to sync your spaces.
      </div>`;
    }
    const thisKey = this.thisDevice?.key;
    return html`
      <div class="list">
        ${this.devices.map(
          (d) => html`
            <div class="row">
              <span class="icon fas fa-fw ${d.platform === 'mobile' ? 'fa-mobile-alt' : 'fa-laptop'}"></span>
              ${this.editingKey === d.key
                ? html`
                    <input
                      class="rename-input"
                      .value=${this.editName}
                      ?disabled=${this.busy}
                      @input=${(e) => { this.editName = e.target.value; }}
                      @keydown=${(e) => { if (e.key === 'Enter') this.onSaveRename(d); if (e.key === 'Escape') this.onCancelEdit(); }}
                    />
                    <div class="actions">
                      <button class="btn primary" ?disabled=${this.busy} @click=${() => this.onSaveRename(d)}>Save</button>
                      <button class="btn" ?disabled=${this.busy} @click=${this.onCancelEdit}>Cancel</button>
                    </div>
                  `
                : html`
                    <div class="body">
                      <div class="name">
                        ${d.name}
                        ${d.key && d.key === thisKey ? html`<span class="tag this">This device</span>` : ''}
                      </div>
                      <div class="meta">
                        Added ${this._formatDate(d.addedAt)} · <span class="tag">${d.platform}</span>
                      </div>
                    </div>
                    ${this.confirmingKey === d.key
                      ? html`<div class="actions">
                          <button class="btn" ?disabled=${this.busy} @click=${() => this.onConfirmRemove(d)}>
                            ${this.busy ? html`<span class="spinner"></span>` : 'Confirm remove'}
                          </button>
                          <button class="btn" ?disabled=${this.busy} @click=${() => { this.confirmingKey = ''; this.requestUpdate(); }}>Cancel</button>
                        </div>`
                      : html`<div class="actions">
                          <button class="btn" ?disabled=${this.busy} @click=${() => this.onStartRename(d)} title="Rename">
                            <span class="fas fa-pen"></span>
                          </button>
                          ${d.key && d.key === thisKey
                            ? ''
                            : html`<button class="btn" ?disabled=${this.busy} @click=${() => { this.confirmingKey = d.key; this.requestUpdate(); }} title="Remove this device">
                                <span class="fas fa-times"></span> Remove
                              </button>`}
                        </div>`}
                  `}
            </div>
          `
        )}
      </div>
      <p class="hint">
        Removing a device stops it from making further changes. It can't un-share data the
        device already synced, and that device keeps its local copies.
      </p>
    `;
  }

  renderPending() {
    return html`
      <div class="list">
        ${this.pending.map(
          (r) => html`
            <div class="row">
              <span class="icon fas fa-fw fa-user-clock"></span>
              <div class="body">
                <div class="name">${r.name}</div>
                <div class="meta">Requested ${this._formatDate(r.requestedAt)} · ${r.platform}</div>
              </div>
              <div class="actions">
                <button class="btn primary" ?disabled=${this.busy} @click=${() => this.onClickApprove(r)}>
                  Approve
                </button>
                <button class="btn" ?disabled=${this.busy} @click=${() => this.onClickDeny(r)}>
                  Deny
                </button>
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  renderInvite() {
    return html`
      <div class="invite-code">
        <code>${this.inviteCode}</code>
        <button class="btn" @click=${this.onClickCopy} title="Copy">
          <span class="far fa-copy"></span>
        </button>
      </div>
      <div class="qr">
        <!-- TODO(phase-4): render QR of this.inviteCode for desktop->mobile scanning (needs a qrcode lib bundled into settings userland) -->
        <p class="hint">Enter this code on your other device to request access.</p>
      </div>
      <div class="actions">
        <button class="btn" @click=${() => { this.inviteCode = ''; this.requestUpdate(); }}>Done</button>
      </div>
    `;
  }

  renderJoinForm() {
    return html`
      <div class="join-form">
        <input
          type="text"
          placeholder="Paste invite code"
          .value=${this._joinCode || ''}
          @input=${(e) => { this._joinCode = e.target.value; }}
          ?disabled=${this.busy}
        />
        <button class="btn primary" ?disabled=${this.busy} @click=${this.onClickJoin}>
          ${this.busy ? html`<span class="spinner"></span>` : 'Join'}
        </button>
      </div>
    `;
  }

  _formatDate(iso) {
    if (!iso) return 'unknown';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  // events
  // =

  async onClickSetup() {
    this.migrating = true;
    this.error = '';
    try {
      // Create the Vault for this identity (drives are already collaborative from birth, so there is
      // nothing to migrate). createInvite ensures the Vault exists and records this Device in it.
      await beaker.vault.createInvite();
      toast.create('This device is set up. You can now add more devices.', 'success');
      await this.load();
    } catch (e) {
      this.error = e.message || String(e);
    } finally {
      this.migrating = false;
      this.migrateProgress = null;
      this.requestUpdate();
    }
  }

  async onClickCreateInvite() {
    this.busy = true;
    try {
      const { code } = await beaker.vault.createInvite();
      this.inviteCode = code;
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  onClickCopy() {
    try {
      navigator.clipboard.writeText(this.inviteCode);
      toast.create('Invite code copied');
    } catch {}
  }

  async onClickApprove(req) {
    this.busy = true;
    try {
      await beaker.vault.approveDevice(req.deviceKey);
      toast.create(`Approved ${req.name}`, 'success');
      await this._refresh();
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  async onClickDeny(req) {
    this.busy = true;
    try {
      await beaker.vault.denyDevice(req.deviceKey);
      await this._refresh();
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  onStartRename(device) {
    this.editingKey = device.key;
    this.editName = device.name;
    this.confirmingKey = '';
    this.requestUpdate();
  }

  onCancelEdit() {
    this.editingKey = '';
    this.editName = '';
    this.requestUpdate();
  }

  async onSaveRename(device) {
    const trimmed = (this.editName || '').trim();
    if (!trimmed || trimmed === device.name) {
      this.onCancelEdit();
      return;
    }
    this.busy = true;
    try {
      await beaker.vault.renameDevice(device.key, trimmed);
      this.editingKey = '';
      this.editName = '';
      toast.create('Device renamed');
      await this._refresh();
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  async onConfirmRemove(device) {
    this.busy = true;
    try {
      await beaker.vault.removeDevice(device.key);
      this.confirmingKey = '';
      toast.create(`Removed ${device.name}`);
      await this._refresh();
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  async onClickJoin() {
    if (!this._joinCode) return;
    this.busy = true;
    this.error = '';
    try {
      await beaker.vault.submitInvite(this._joinCode.trim());
      toast.create('Request sent. Approve it on your other device.', 'success');
      this._joinCode = '';
      await this.load();
    } catch (e) {
      toast.create(e.message || String(e), 'error');
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }
}
customElements.define('devices-view', DevicesView);
