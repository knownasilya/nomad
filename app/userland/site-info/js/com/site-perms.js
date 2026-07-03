import {
  LitElement,
  html,
} from 'lit';
import * as nomadPermissions from '../../../../lib/permissions';
import sitePermsCSS from '../../css/com/site-perms.css.js';

class RequestedPerms extends LitElement {
  static get properties() {
    return {
      origin: { type: String },
      requestedPerms: { type: Array },
    };
  }

  static get styles() {
    return [sitePermsCSS];
  }

  constructor() {
    super();
    this.origin = '';
    this.requestedPerms = [];
  }
  // rendering
  // =

  render() {
    var requestedPerms = this.requestedPerms
      .map((perm) => this.renderRequestedPerm(perm))
      .filter((el) => typeof el !== 'undefined');
    if (!requestedPerms.length) {
      return html`<div class="field-group">No permissions assigned</div>`;
    }
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${requestedPerms.length
        ? html`
            <div class="field-group">
              <div class="field-group-title">Permissions</div>
              ${requestedPerms}
            </div>
          `
        : ''}
    `;
  }

  renderRequestedPerm({ perm, value, opts }) {
    const permId = nomadPermissions.getPermId(perm);
    const permParam = nomadPermissions.getPermParam(perm);
    const desc = nomadPermissions.renderPermDesc({
      bg: null,
      html,
      url: this.origin,
      permId,
      permParam,
      permOpts: opts,
    });
    if (!desc) return;
    return html`
      <div>
        <span class="fa-fw ${nomadPermissions.PERM_ICONS[permId]}"></span>
        ${desc}:
        <select @change=${(e) => this.onChangePerm(e, perm)}>
          <option value="1" ?selected=${value}>Allow</option>
          <option value="0" ?selected=${!value}>Deny</option>
        </select>
        <a href="#" @click=${(e) => this.onClearPerm(e, perm)}
          ><span class="fas fa-fw fa-times"></span
        ></a>
      </div>
    `;
  }

  // events
  // =

  async onChangePerm(e, perm) {
    var permObj = this.requestedPerms.find((o) => o.perm === perm);
    if (!permObj) return;
    var newValue = +e.currentTarget.value;
    await nomad.sitedata.setPermission(this.origin, perm, newValue);
    permObj.value = newValue;
    this.requestUpdate();
  }

  async onClearPerm(e, perm) {
    e.preventDefault();
    var permObj = this.requestedPerms.find((o) => o.perm === perm);
    if (!permObj) return;
    await nomad.sitedata.clearPermission(this.origin, perm);
    this.requestedPerms = this.requestedPerms.filter((p) => p !== permObj);
    this.requestUpdate();
  }
}

customElements.define('site-perms', RequestedPerms);
