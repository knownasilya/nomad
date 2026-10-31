import { LitElement, html, css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import commonCSS from '../../css/views/common.css.js';
import { cleanError, timeAgo, highlight } from '../util.js';

// The user's skills (bg/ai/skills.js, ADR-0034): instructions for kinds of tasks. Each of the user's
// own chats lists the ones that are on by name and description, and the assistant reads a skill's
// instructions when a request matches it. Only the user changes them, here. Vault records, so they
// sync to linked devices. A skill imports from and exports to a SKILL.md. The rules (names, sizes,
// the SKILL.md format) live in shared/ai-skills.mjs; bg checks them on save.

const blank = () => ({ id: null, name: '', description: '', instructions: '', error: '' });

class AiSkillsView extends LitElement {
  static get properties() {
    return {
      query: { type: String },
      skills: { type: Array },
      max: { type: Number },
      limits: { type: Object },
      editing: { type: Object },
      expanded: { type: String },
    };
  }

  static get styles() {
    return [commonCSS, viewCSS];
  }

  constructor() {
    super();
    this.query = '';
    this.skills = undefined; // undefined = loading
    this.max = 100;
    this.limits = { name: 64, description: 1024, instructions: 20000 };
    this.editing = null; // { id: null for a new skill, name, description, instructions, error }
    this.expanded = ''; // the id of the skill whose instructions show
    this._timer = null;
    this._seq = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
    // Linked devices change them too.
    try {
      this._watch = nomad.vault.watchAppData();
      this._watch.addEventListener('changed', () => this.load());
    } catch {}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    try {
      this._watch?.close?.();
    } catch {}
  }

  updated(changed) {
    if (changed.has('query') && changed.get('query') !== undefined) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.load(), 150);
    }
  }

  async load() {
    const seq = ++this._seq;
    try {
      const res = await nomad.vault.listSkills({ query: this.query || '' });
      if (seq !== this._seq) return;
      this.skills = res.skills || [];
      this.max = res.max || this.max;
      this.limits = res.limits || this.limits;
    } catch (err) {
      if (seq !== this._seq) return;
      this.skills = [];
      toast.create(cleanError(err), 'error');
    }
  }

  // The header's New skill button.
  startNew(fields = {}) {
    this.editing = { ...blank(), ...fields };
    this.focusEditor();
  }

  focusEditor() {
    this.updateComplete.then(() => {
      const form = this.shadowRoot.querySelector('form.editor');
      form?.scrollIntoView({ block: 'nearest' });
      const el = form?.querySelector(this.editing?.name ? 'textarea.instructions' : 'input[name="name"]');
      el?.focus();
    });
  }

  render() {
    if (typeof this.skills === 'undefined') return html`<div class="notice">Loading…</div>`;
    const searching = !!(this.query || '').trim();
    const words = (this.query || '').trim().split(/\s+/).filter(Boolean);
    const on = this.skills.filter((s) => s.enabled).length;
    const isNew = this.editing && !this.editing.id;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <h2>Skills</h2>
      <div class="intro">
        Instructions you give the assistant for a kind of task, like how you want a weekly report
        written or how to turn a recipe into a Note. Each of your chats in the AI sidebar, on your
        phone and in Jobs lists the skills that are on by name and description, and the assistant reads
        a skill’s instructions when what you ask matches it. Pages that use AI never see them. Skills
        sync to your linked devices, and you can import or export them as <code>SKILL.md</code> files.
      </div>

      <input
        type="file"
        class="import-input"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        @change=${this.onImportFile}
      />

      ${isNew ? this.renderEditor() : ''}
      ${this.skills.length === 0
        ? searching
          ? html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-search"></span></div>
              <h3>No skills match “${this.query.trim()}”</h3>
            </div>`
          : isNew
          ? ''
          : html`<div class="notice">
              <div class="notice-icon"><span class="fas fa-magic"></span></div>
              <h3>No skills yet</h3>
              <p>
                Write one for a task you ask the assistant to do often, or import a
                <code>SKILL.md</code>.
              </p>
              <div class="buttons center">
                <button class="primary" @click=${() => this.startNew()}>
                  <span class="fas fa-plus"></span> New skill
                </button>
                <button @click=${this.onImportClick}>
                  <span class="fas fa-file-import"></span> Import SKILL.md
                </button>
              </div>
            </div>`
        : html`
            <div class="toolbar">
              <span>
                ${searching
                  ? `${this.skills.length} ${this.skills.length === 1 ? 'skill' : 'skills'} found`
                  : `${this.skills.length} ${this.skills.length === 1 ? 'skill' : 'skills'}, ${on} on`}
              </span>
              <button class="link" @click=${this.onImportClick}>
                <span class="fas fa-file-import"></span> Import SKILL.md
              </button>
            </div>
            ${repeat(this.skills, (s) => s.id, (s) => this.renderSkill(s, words))}
          `}
    `;
  }

  renderSkill(s, words) {
    if (this.editing?.id === s.id) return this.renderEditor();
    const open = this.expanded === s.id;
    return html`
      <div class="card skill ${s.enabled ? '' : 'off'} ${open ? 'open' : ''}">
        <div class="row-head">
          <label class="switch" title=${s.enabled ? 'On' : 'Off'}>
            <input
              type="checkbox"
              .checked=${!!s.enabled}
              aria-label=${`Use the ${s.name} skill`}
              @change=${(e) => this.onToggle(s, e.target.checked)}
            />
            <span class="track"></span>
          </label>
          <div class="meta clickable" @click=${() => (this.expanded = open ? '' : s.id)}>
            <div class="name-row">
              <span class="name">${highlight(s.name, words)}</span>
              ${s.enabled ? '' : html`<span class="badge muted">Off</span>`}
            </div>
            <div class="description">${highlight(s.description, words)}</div>
            <div class="summary">
              Edited ${timeAgo(s.updatedAt)} · ${s.instructions.length.toLocaleString()} characters of
              instructions
              <span class="fas fa-fw ${open ? 'fa-chevron-up' : 'fa-chevron-down'}"></span>
            </div>
          </div>
          <div class="actions">
            <button class="icon" title="Edit" aria-label=${`Edit ${s.name}`} @click=${() => this.onEdit(s)}>
              <span class="fas fa-fw fa-pen"></span>
            </button>
            <button
              class="icon"
              title="Export SKILL.md"
              aria-label=${`Export ${s.name} as SKILL.md`}
              @click=${() => this.onExport(s)}
            >
              <span class="fas fa-fw fa-file-export"></span>
            </button>
            <button
              class="icon danger"
              title="Delete"
              aria-label=${`Delete ${s.name}`}
              @click=${() => this.onDelete(s)}
            >
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${open ? html`<pre class="instructions-view">${highlight(s.instructions, words)}</pre>` : ''}
      </div>
    `;
  }

  renderEditor() {
    const e = this.editing;
    const set = (field) => (ev) => (this.editing = { ...this.editing, [field]: ev.target.value, error: '' });
    const keys = (ev) => {
      if (ev.key === 'Escape') this.onCancel();
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) this.onSave(ev);
    };
    return html`
      <form class="card editor editing" @submit=${this.onSave} @keydown=${keys}>
        <div class="editor-head">${e.id ? `Edit ${e.name || 'skill'}` : 'New skill'}</div>
        <label>
          <span class="label">Name</span>
          <input
            name="name"
            maxlength=${this.limits.name}
            placeholder="weekly-report"
            spellcheck="false"
            autocomplete="off"
            .value=${e.name}
            @input=${set('name')}
          />
          <span class="hint">Lowercase words joined by hyphens. Spaces turn into hyphens when you save.</span>
        </label>
        <label>
          <span class="label">When to use it</span>
          <textarea
            name="description"
            rows="2"
            maxlength=${this.limits.description}
            placeholder="Use when I ask for my weekly report or a summary of what I did this week."
            .value=${e.description}
            @input=${set('description')}
          ></textarea>
          <span class="hint">The assistant reads this on every chat to decide whether the skill fits.</span>
        </label>
        <label>
          <span class="label">Instructions</span>
          <textarea
            class="instructions"
            name="instructions"
            rows="12"
            maxlength=${this.limits.instructions}
            placeholder=${'Markdown the assistant follows when it uses the skill, e.g.\n\n1. Read my Notes tagged #work from the last 7 days.\n2. Group them by project.\n3. Write three short sections: Done, Next, Blocked.'}
            .value=${e.instructions}
            @input=${set('instructions')}
          ></textarea>
          <span class="hint">
            ${e.instructions.length.toLocaleString()}/${this.limits.instructions.toLocaleString()} · Read only when the
            skill is used.
          </span>
        </label>
        ${e.error ? html`<div class="error">${e.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary" ?disabled=${!e.name.trim() || !e.description.trim() || !e.instructions.trim()}>
            ${e.id ? 'Save' : 'Add skill'}
          </button>
          <button type="button" @click=${this.onCancel}>Cancel</button>
          ${e.id
            ? ''
            : html`<button type="button" class="link push" @click=${this.onImportClick}>
                <span class="fas fa-file-import"></span> Fill from a SKILL.md
              </button>`}
        </div>
      </form>
    `;
  }

  // events
  // =

  onEdit(s) {
    this.editing = {
      id: s.id,
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      error: '',
    };
    this.focusEditor();
  }

  onCancel() {
    this.editing = null;
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    if (!e) return;
    try {
      const rec = await nomad.vault.saveSkill({
        id: e.id || undefined,
        name: e.name,
        description: e.description,
        instructions: e.instructions,
      });
      this.editing = null;
      await this.load();
      toast.create(e.id ? `Saved ${rec.name}` : `Added ${rec.name}`, 'success');
    } catch (err) {
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  async onToggle(s, on) {
    this.skills = this.skills.map((x) => (x.id === s.id ? { ...x, enabled: on } : x));
    try {
      await nomad.vault.saveSkill({ id: s.id, enabled: on });
      toast.create(on ? `${s.name} is on` : `${s.name} is off`);
    } catch (err) {
      this.skills = this.skills.map((x) => (x.id === s.id ? { ...x, enabled: !on } : x));
      toast.create(cleanError(err), 'error');
    }
  }

  async onDelete(s) {
    if (!confirm(`Delete the skill ${s.name}? This can’t be undone. Export it first to keep a copy.`)) return;
    try {
      await nomad.vault.deleteSkill(s.id);
      if (this.editing?.id === s.id) this.editing = null;
      this.skills = this.skills.filter((x) => x.id !== s.id);
      toast.create(`Deleted ${s.name}`);
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onExport(s) {
    try {
      const text = await nomad.vault.exportSkill(s.id);
      const a = document.createElement('a');
      a.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text);
      a.download = `${s.name}.md`;
      a.click();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  onImportClick() {
    const input = this.shadowRoot.querySelector('.import-input');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async onImportFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await nomad.vault.parseSkillMd(await file.text());
      // A file named SKILL.md is usually in a folder named after the skill; any other file names it.
      const fromFile = /^skill\.md$/i.test(file.name) ? '' : file.name.replace(/\.(md|markdown|txt)$/i, '');
      const fields = {
        name: parsed.name || fromFile,
        description: parsed.description,
        instructions: parsed.instructions,
      };
      if (this.editing && !this.editing.id) {
        // Fill only what the file has, so a name already typed stays.
        this.editing = {
          ...this.editing,
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
          error: '',
        };
        this.focusEditor();
      } else {
        this.startNew(fields);
      }
      if (!parsed.description) toast.create('Add a description that says when to use it');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

const viewCSS = css`
  .import-input {
    display: none;
  }

  .row-head {
    align-items: flex-start;
  }

  .row-head .switch {
    margin-top: 2px;
  }

  .name {
    font-family: var(--code-font);
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .badge.muted {
    background: var(--bg-color--semi-light);
    color: var(--text-color--light);
  }

  .description {
    margin-top: 2px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .meta .summary {
    margin-top: 4px;
  }

  .meta .summary .fas {
    font-size: 9px;
  }

  .card.off .name,
  .card.off .description {
    opacity: 0.6;
  }

  .instructions-view {
    margin: 10px 0 2px 44px;
    padding: 10px 12px;
    max-height: 360px;
    overflow: auto;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-family: var(--code-font);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    margin-bottom: 16px;
  }

  .editor-head {
    font-weight: 600;
  }

  .editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .editor .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--lightish);
  }

  .editor input[name='name'] {
    max-width: 340px;
    font-family: var(--code-font);
  }

  .editor textarea.instructions {
    min-height: 220px;
    font-family: var(--code-font);
    font-size: 12px;
  }

  .editor .hint {
    font-size: 11px;
    color: var(--text-color--pretty-light);
  }

  .buttons {
    align-items: center;
  }

  .buttons.center {
    justify-content: center;
  }

  .buttons .push {
    margin-left: auto;
  }

  .toolbar .link .fas,
  .buttons .fas {
    margin-right: 3px;
  }
`;

customElements.define('ai-skills-view', AiSkillsView);
