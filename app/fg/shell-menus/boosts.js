import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import * as bg from './bg-process-rpc';
import commonCSS from './common.css';

// Boosts menu (ADR-0023), opened from the magic-wand button in the location bar. Lists the site's
// Boosts with a switch each, quick preset styles, and the zapper. Acts on the ACTIVE tab's page
// through bg.views (bg/ui/boosts.js); edits happen in My Library → Boosts.
class BoostsMenu extends LitElement {
  static get properties() {
    return {
      state: { type: Object },
      busy: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.state = { site: null, boosts: [], presets: [] };
    this.busy = false;
  }

  async init() {
    await this.load();
  }

  async load() {
    try {
      this.state = await bg.views.getBoosts('active');
    } catch (e) {
      console.debug(e);
    }
  }

  async act(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      console.debug(e);
    }
    this.busy = false;
    await this.load();
  }

  render() {
    const { site, boosts, presets } = this.state || {};
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="wrapper">
        <div class="section heading">
          <span class="title"><i class="fas fa-magic"></i> Boosts</span>
          <span class="site">${site || ''}</span>
        </div>
        ${site
          ? html`
              <div class="section">
                ${boosts.length
                  ? repeat(
                      boosts,
                      (b) => b.id,
                      (b) => this.renderBoost(b)
                    )
                  : html`<div class="empty">
                      Change how ${site} looks: hide parts of it, restyle it, or run your own
                      script. Boosts sync to your devices.
                    </div>`}
              </div>
              <div class="section">
                <div class="subhead">Quick styles</div>
                <div class="presets">
                  ${presets.map(
                    (p) => html`
                      <button
                        class="chip ${p.on ? 'on' : ''}"
                        title=${p.description}
                        aria-pressed=${p.on ? 'true' : 'false'}
                        @click=${() => this.act(() => bg.views.toggleBoostPreset('active', p.id))}
                      >
                        ${p.label}
                      </button>
                    `
                  )}
                </div>
              </div>
              <div class="section">
                <div class="menu-item" @click=${() => this.onZap(null)}>
                  <i class="fas fa-crosshairs"></i>
                  <span class="label">Hide elements…</span>
                </div>
                <div class="menu-item" @click=${() => this.onEdit({ site, isNew: true })}>
                  <i class="fas fa-plus"></i>
                  <span class="label">New Boost with CSS or JavaScript…</span>
                </div>
                <div class="menu-item" @click=${() => this.onEdit({ site })}>
                  <i class="fas fa-sliders-h"></i>
                  <span class="label">Manage Boosts…</span>
                </div>
              </div>
            `
          : html`<div class="section">
              <div class="empty">Boosts work on web and hyper:// pages.</div>
            </div>`}
      </div>
    `;
  }

  renderBoost(b) {
    return html`
      <div class="boost">
        <label class="switch" title=${b.enabled ? 'Turn off' : 'Turn on'}>
          <input
            type="checkbox"
            .checked=${b.enabled}
            aria-label="${b.name}"
            @change=${(e) =>
              this.act(() => bg.views.setBoostEnabled('active', b.id, e.target.checked))}
          />
          <span class="track"></span>
        </label>
        <div
          class="info"
          @click=${() => this.onEdit({ site: b.site, id: b.id })}
          title="Edit ${b.name}"
        >
          <div class="name">${b.name}</div>
          <div class="summary">
            ${b.summary.length ? b.summary.join(' · ') : 'Empty'}${b.site !== this.state.site
              ? html` · ${b.site}`
              : ''}
          </div>
        </div>
        <button class="icon" title="Hide elements with this Boost" @click=${() => this.onZap(b.id)}>
          <i class="fas fa-crosshairs"></i>
        </button>
      </div>
    `;
  }

  updated() {
    const el = this.shadowRoot.querySelector('.wrapper');
    if (el) bg.shellMenus.resizeSelf({ width: el.clientWidth | 0, height: el.clientHeight | 0 });
  }

  // The menu closes first, so the page has focus for the zapper's keys.
  async onZap(id) {
    await bg.shellMenus.close();
    bg.views.zapBoost('active', id);
  }

  async onEdit(opts) {
    await bg.shellMenus.close();
    bg.views.editBoosts('active', opts);
  }
}

BoostsMenu.styles = [
  commonCSS,
  css`
    .wrapper {
      width: 300px;
    }
    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 14px;
      font-size: 12px;
    }
    .heading .title {
      font-weight: 600;
    }
    .heading .title i {
      color: #2864dc;
      margin-right: 4px;
    }
    .heading .site {
      color: var(--text-color--light, #99a);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 6px 14px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-color--light, #99a);
      white-space: normal;
    }
    .subhead {
      padding: 2px 14px 6px;
      font-size: 11px;
      color: var(--text-color--light, #99a);
    }
    .boost {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 8px 5px 14px;
    }
    .boost:hover {
      background: var(--bg-color--menu-item--hover);
    }
    .boost .info {
      flex: 1;
      min-width: 0;
      cursor: default;
    }
    .boost .name {
      font-size: 12.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .boost .summary {
      font-size: 11px;
      color: var(--text-color--light, #99a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button.icon {
      border: 0;
      background: none;
      padding: 4px 6px;
      border-radius: 4px;
      color: var(--text-color--menu-item-icon);
    }
    button.icon:hover {
      background: var(--bg-color--menu-item--hover);
      color: var(--text-color--default);
    }
    .switch {
      position: relative;
      flex: 0 0 28px;
      height: 16px;
    }
    .switch input {
      position: absolute;
      opacity: 0;
      inset: 0;
      margin: 0;
      cursor: pointer;
    }
    .switch .track {
      position: absolute;
      inset: 0;
      border-radius: 8px;
      background: var(--border-color--default);
      transition: background 0.15s;
      pointer-events: none;
    }
    .switch .track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transition: transform 0.15s;
    }
    .switch input:checked + .track {
      background: #2864dc;
    }
    .switch input:checked + .track::after {
      transform: translateX(12px);
    }
    .switch input:focus-visible + .track {
      outline: 2px solid #2864dc;
      outline-offset: 1px;
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 14px 4px;
    }
    .chip {
      font-size: 11.5px;
      padding: 3px 9px;
      border-radius: 12px;
      border: 1px solid var(--border-color--default);
      background: transparent;
    }
    .chip:hover {
      background: var(--bg-color--menu-item--hover);
    }
    .chip.on {
      background: #2864dc;
      border-color: #2864dc;
      color: #fff;
    }
    .menu-item {
      height: 32px;
    }
  `,
];

customElements.define('boosts-menu', BoostsMenu);
