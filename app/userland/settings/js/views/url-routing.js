import { LitElement, html } from 'lit';
import viewCSS from '../../css/views/url-routing.css.js';
import * as toast from '../../../app-stdlib/js/com/toast.js';

function makeRuleId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class UrlRoutingSettingsView extends LitElement {
  static get properties() {
    return {};
  }

  static get styles() {
    return viewCSS;
  }

  constructor() {
    super();
    this.rules = undefined;
    this.spaces = undefined;
    this.newPattern = '';
    this.newSpaceId = undefined;
    this.dragIndex = undefined; // the rule being dragged
    this.dropIndex = undefined; // where it would land: 0..rules.length, before that rule
  }

  async load() {
    const [rules, spaces] = await Promise.all([
      nomad.browser.getSetting('url_routing_rules'),
      nomad.browser.getSpaces(),
    ]);
    this.rules = Array.isArray(rules) ? rules : [];
    this.spaces = spaces || [];
    if (this.newSpaceId === undefined) {
      this.newSpaceId = this.spaces[0]?.id;
    }
    this.requestUpdate();
  }

  unload() {}

  save() {
    nomad.browser.setSetting('url_routing_rules', this.rules);
    this.requestUpdate();
  }

  spaceName(spaceId) {
    return this.spaces.find((s) => s.id === spaceId)?.name || 'Unknown space';
  }

  // rendering
  // =

  render() {
    if (!this.rules) return html``;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="section">
        <p class="message">
          Send a URL straight to one of your Spaces when it's opened — from a link in
          another app, a link you ${"⌘"}-click, or one you paste into the address bar.
          The first matching rule wins.
        </p>
        ${this.spaces.length < 2
          ? html`<p class="hint">
              You only have one Space right now, so routing rules have nothing to route
              between. Create another Space from the Spaces menu in the tab bar first.
            </p>`
          : ''}
      </div>

      <div class="section">${this.renderRulesList()}</div>

      <div class="section">${this.renderAddRuleForm()}</div>
    `;
  }

  renderRulesList() {
    if (this.rules.length === 0) {
      return html`<p class="empty">No URL routing rules yet.</p>`;
    }
    return html`
      <div class="rules-list">
        ${this.rules.map((rule, i) => {
          const cls = {
            'rule-row': true,
            disabled: !rule.enabled,
            dragging: i === this.dragIndex,
            'drop-before': this.isDropTarget(i),
            'drop-after': i === this.rules.length - 1 && this.isDropTarget(this.rules.length),
          };
          return html`
            <div
              class=${Object.keys(cls).filter((k) => cls[k]).join(' ')}
              @dragover=${(e) => this.onDragOverRule(e, i)}
              @drop=${this.onDropRule}
            >
              <span
                class="drag-handle fas fa-fw fa-grip-vertical"
                title="Drag to reorder"
                draggable="true"
                @dragstart=${(e) => this.onDragStartRule(e, i)}
                @dragend=${this.onDragEndRule}
              ></span>
              <input
                type="text"
                placeholder="github.com or github.com/myorg/*"
                .value=${rule.pattern}
                @change=${(e) => this.onChangePattern(i, e.target.value)}
              />
              <span class="arrow fas fa-long-arrow-alt-right"></span>
              <select @change=${(e) => this.onChangeRuleSpace(i, e.target.value)}>
                ${this.spaces.map(
                  (space) => html`
                    <option value=${space.id} ?selected=${space.id === rule.spaceId}>
                      ${space.name}
                    </option>
                  `
                )}
              </select>
              <div class="enabled-toggle">
                <label title="Enabled">
                  <input
                    type="checkbox"
                    ?checked=${rule.enabled}
                    @change=${(e) => this.onToggleRuleEnabled(i, e.target.checked)}
                  />
                </label>
              </div>
              <div class="reorder-btns">
                <a
                  class=${i === 0 ? 'disabled' : ''}
                  title="Move up"
                  @click=${() => this.onMoveRule(i, -1)}
                >
                  <span class="fas fa-fw fa-chevron-up"></span>
                </a>
                <a
                  class=${i === this.rules.length - 1 ? 'disabled' : ''}
                  title="Move down"
                  @click=${() => this.onMoveRule(i, 1)}
                >
                  <span class="fas fa-fw fa-chevron-down"></span>
                </a>
              </div>
              <a class="remove-btn" title="Remove rule" @click=${() => this.onRemoveRule(i)}>
                <span class="fas fa-fw fa-times"></span>
              </a>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderAddRuleForm() {
    return html`
      <form class="add-rule-form" @submit=${this.onAddRule}>
        <input
          type="text"
          placeholder="github.com or github.com/myorg/*"
          .value=${this.newPattern}
          @input=${(e) => (this.newPattern = e.target.value)}
          required
        />
        <span class="arrow fas fa-long-arrow-alt-right"></span>
        <select @change=${(e) => (this.newSpaceId = Number(e.target.value))}>
          ${this.spaces.map(
            (space) => html`
              <option value=${space.id} ?selected=${space.id === this.newSpaceId}>
                ${space.name}
              </option>
            `
          )}
        </select>
        <button type="submit" class="btn">Add rule</button>
      </form>
    `;
  }

  // Would dropping at `index` move the dragged rule? (Dropping it next to itself wouldn't.)
  isDropTarget(index) {
    if (this.dragIndex === undefined || this.dropIndex !== index) return false;
    return index !== this.dragIndex && index !== this.dragIndex + 1;
  }

  // events
  // =

  onDragStartRule(e, i) {
    this.dragIndex = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    const row = e.target.closest('.rule-row');
    if (row) e.dataTransfer.setDragImage(row, e.offsetX, e.offsetY);
    this.requestUpdate();
  }

  onDragOverRule(e, i) {
    if (this.dragIndex === undefined) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const dropIndex = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
    if (dropIndex !== this.dropIndex) {
      this.dropIndex = dropIndex;
      this.requestUpdate();
    }
  }

  onDropRule(e) {
    e.preventDefault();
    const from = this.dragIndex;
    const to = this.dropIndex;
    this.onDragEndRule();
    if (from === undefined || to === undefined) return;
    this.moveRule(from, to > from ? to - 1 : to);
  }

  onDragEndRule() {
    this.dragIndex = undefined;
    this.dropIndex = undefined;
    this.requestUpdate();
  }

  onChangePattern(i, value) {
    this.rules[i].pattern = value.trim();
    this.save();
  }

  onChangeRuleSpace(i, value) {
    this.rules[i].spaceId = Number(value);
    this.save();
    toast.create('Setting updated');
  }

  onToggleRuleEnabled(i, enabled) {
    this.rules[i].enabled = enabled;
    this.save();
  }

  onMoveRule(i, delta) {
    this.moveRule(i, i + delta);
  }

  moveRule(from, to) {
    if (from === to || to < 0 || to >= this.rules.length) return;
    const [rule] = this.rules.splice(from, 1);
    this.rules.splice(to, 0, rule);
    this.save();
  }

  onRemoveRule(i) {
    this.rules.splice(i, 1);
    this.save();
    toast.create('Rule removed');
  }

  onAddRule(e) {
    e.preventDefault();
    const pattern = this.newPattern.trim();
    if (!pattern || !this.newSpaceId) return;
    this.rules.push({
      id: makeRuleId(),
      pattern,
      spaceId: this.newSpaceId,
      enabled: true,
    });
    this.newPattern = '';
    this.save();
    toast.create('Rule added');
  }
}
customElements.define('url-routing-settings-view', UrlRoutingSettingsView);
