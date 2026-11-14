// Site info's Online tab: what keeps this drive reachable while this computer is off. A drive is
// served only by the devices that have it, so this lists the user's always-on Peers (ADR-0038) and
// whether each keeps the drive, with its Space or on its own (shared/peers.mjs keepsDrive), and
// lets the user keep it on a Peer by itself (`extra` in the Peer's hold).

import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';
import css from '../../css/com/drive-online.css.js';

class DriveOnline extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      info: { type: Object },
      saved: { type: Boolean },
      state: { type: Object },
      busy: { type: String },
    };
  }

  static get styles() {
    return [css];
  }

  constructor() {
    super();
    this.url = '';
    this.info = undefined;
    this.saved = false;
    this.state = undefined;
    this.busy = '';
  }

  updated(changed) {
    if (changed.has('url') && this.url) this.load();
    this.dispatchEvent(new CustomEvent('resized', { bubbles: true, composed: true }));
  }

  async load() {
    try {
      this.state = await nomad.vault.drivePeers(this.url);
    } catch (e) {
      console.error(e);
      this.state = { space: null, peers: [] };
    }
  }

  get keptBy() {
    return (this.state?.peers || []).filter((p) => p.keeps);
  }

  render() {
    const st = this.state;
    if (!st) return html`<div class="hint">Loading…</div>`;
    const kept = this.keptBy;
    const here = this.info?.writable || this.saved;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${kept.length
        ? html`
            <div class="card ok">
              <span class="fas fa-fw fa-check-circle"></span>
              <div>
                <strong>Online when this computer is off.</strong>
                ${kept.map((p) => p.name).join(', ')} ${kept.length === 1 ? 'keeps' : 'keep'} a full copy and
                share${kept.length === 1 ? 's' : ''} it.
              </div>
            </div>
          `
        : html`
            <div class="card warn">
              <span class="fas fa-fw fa-exclamation-circle"></span>
              <div>
                <strong>${here ? 'Only your open devices share it.' : 'Only the devices that have it share it.'}</strong>
                ${here
                  ? 'When this computer is off and no one else has it open, the link won’t open for anyone.'
                  : 'It opens when one of them is online.'}
              </div>
            </div>
          `}

      <div class="list">
        <div class="item">
          <span class="fas fa-fw fa-laptop muted"></span>
          <div class="grow">
            <div>This computer</div>
            <div class="hint">
              ${here ? 'Shares it while Nomad is open' : 'Shares the parts you opened, while this tab is open'}
            </div>
          </div>
        </div>
        ${repeat(st.peers, (p) => p.key, (p) => this.renderPeer(p))}
      </div>

      ${st.peers.length
        ? !st.space
          ? html`<div class="hint foot">
              A Peer finds drives through your library. Add this drive to your library to keep it on one.
            </div>`
          : ''
        : html`
            <div class="hint foot">
              An always-on Peer is Nomad running on a computer that stays on, like a home server. It keeps
              your drives online while your laptop sleeps.
              <a href="#" @click=${this.onOpenDevices}>Set one up in Settings, Devices</a>.
            </div>
          `}
    `;
  }

  renderPeer(p) {
    const viaSpace = p.keeps === 'space';
    const on = !!p.keeps;
    const disabled = viaSpace || !this.state.space || this.busy === p.key;
    const title = viaSpace
      ? `${p.name} keeps everything in ${this.state.space?.name || 'this Space'}`
      : on
        ? `Stop keeping this drive on ${p.name}`
        : `Keep this drive online on ${p.name}`;
    return html`
      <div class="item">
        <span class="fas fa-fw fa-server muted"></span>
        <div class="grow">
          <div>${p.name}</div>
          <div class="hint">
            ${p.summary}${viaSpace ? html` · Kept with ${this.state.space?.name || 'its Space'}` : ''}
          </div>
        </div>
        <label class="toggle" title=${title}>
          <input
            type="checkbox"
            aria-label=${title}
            .checked=${on}
            ?disabled=${disabled}
            @change=${(e) => this.onToggle(p, e.target.checked)}
          />
          <span class="switch"></span>
        </label>
      </div>
    `;
  }

  async onToggle(p, on) {
    this.busy = p.key;
    try {
      await nomad.vault.setPeerDrive(p.key, this.url, on);
      toast.create(on ? `${p.name} will keep this drive online` : `${p.name} stops keeping this drive`, 'success', 2500);
    } catch (err) {
      toast.create(err.message || String(err), 'error');
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  onOpenDevices(e) {
    e.preventDefault();
    nomad.browser.openUrl('nomad://settings/?view=devices', { setActive: true });
    nomad.browser.toggleSiteInfo(false);
  }
}

customElements.define('drive-online', DriveOnline);
