// Form and its fields (ADR-0048): Input, Textarea, Select, RadioGroup, CheckboxGroup, Switch and
// Slider. The values live in the <nomad-genui> that draws the Form (ui._state) and go nowhere but
// the conversation: Submit fires `continue_conversation` with a message the user can read, the
// form's title and one "Label: value" line per field. Nothing is sent before the click, there is
// no password field, and a page with no assistant (standalone) leaves the Form out.

import { html, nothing } from 'lit';

const isEl = (v) => v && typeof v === 'object' && v.type === 'element';
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));

export const FIELDS = ['Input', 'Textarea', 'Select', 'RadioGroup', 'CheckboxGroup', 'Switch', 'Slider'];
const INPUT_TYPES = ['text', 'number', 'date', 'time', 'email', 'url'];
const MAX_VALUE = 2000;

const options = (p) => list(p.options).map(str).filter(Boolean);
const num = (v, dflt) => (Number.isFinite(Number(v)) && v != null && v !== '' ? Number(v) : dflt);

// A field's name in the form's values; two fields with one name share a value.
const nameOf = (p, i) => str(p.name) || `field${i + 1}`;

// What a field holds before the user touches it.
export function initialValue(type, p) {
  switch (type) {
    case 'Switch':
      return p.value === true;
    case 'CheckboxGroup': {
      const all = options(p);
      return list(p.values).map(str).filter((v) => all.includes(v));
    }
    case 'Slider': {
      const min = num(p.min, 0);
      const max = Math.max(min, num(p.max, 100));
      return Math.max(min, Math.min(max, num(p.value, min)));
    }
    case 'Select':
    case 'RadioGroup':
      return options(p).includes(str(p.value)) ? str(p.value) : '';
    default:
      return str(p.value).slice(0, MAX_VALUE);
  }
}

// The message Submit sends: the title, then a line per field that has an answer.
export function formMessage(title, fields, values) {
  const lines = [];
  fields.forEach((f, i) => {
    const p = f.props || {};
    const v = values[nameOf(p, i)];
    const label = str(p.label) || nameOf(p, i);
    if (f.typeName === 'Switch') lines.push(`- ${label}: ${v ? 'yes' : 'no'}`);
    else if (Array.isArray(v)) {
      if (v.length) lines.push(`- ${label}: ${v.join(', ')}`);
    } else if (v !== '' && v != null) lines.push(`- ${label}: ${String(v).trim()}`);
  });
  const head = str(title).trim() || 'My answers';
  return lines.length ? `${head}:\n${lines.join('\n')}` : head;
}

function field(type, p, name, value, set, off) {
  const label = str(p.label);
  const hint = p.hint ? html`<span class="hint">${str(p.hint)}</span>` : nothing;
  switch (type) {
    case 'Input': {
      const kind = INPUT_TYPES.includes(p.type) ? p.type : 'text';
      return html`<label class="field">
        <span class="label">${label}</span>
        <input
          class="control"
          type=${kind}
          name=${name}
          maxlength=${MAX_VALUE}
          placeholder=${str(p.placeholder)}
          .value=${value}
          ?disabled=${off}
          @input=${(e) => set(e.target.value)}
        />
        ${hint}
      </label>`;
    }
    case 'Textarea':
      return html`<label class="field">
        <span class="label">${label}</span>
        <textarea
          class="control"
          name=${name}
          rows="3"
          maxlength=${MAX_VALUE}
          placeholder=${str(p.placeholder)}
          .value=${value}
          ?disabled=${off}
          @input=${(e) => set(e.target.value)}
        ></textarea>
      </label>`;
    case 'Select':
      return html`<label class="field">
        <span class="label">${label}</span>
        <select class="control" name=${name} ?disabled=${off} @change=${(e) => set(e.target.value)}>
          <option value="" ?selected=${value === ''}>Choose…</option>
          ${options(p).map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
        </select>
      </label>`;
    case 'RadioGroup':
      return html`<fieldset class="field">
        <legend class="label">${label}</legend>
        <div class="choices">
          ${options(p).map(
            (o) =>
              html`<label class="choice">
                <input
                  type="radio"
                  name=${name}
                  .checked=${o === value}
                  ?disabled=${off}
                  @change=${() => set(o)}
                />
                <span>${o}</span>
              </label>`
          )}
        </div>
      </fieldset>`;
    case 'CheckboxGroup':
      return html`<fieldset class="field">
        <legend class="label">${label}</legend>
        <div class="choices">
          ${options(p).map(
            (o) =>
              html`<label class="choice">
                <input
                  type="checkbox"
                  .checked=${value.includes(o)}
                  ?disabled=${off}
                  @change=${(e) =>
                    set(e.target.checked ? [...value, o] : value.filter((v) => v !== o))}
                />
                <span>${o}</span>
              </label>`
          )}
        </div>
      </fieldset>`;
    case 'Switch':
      return html`<label class="field switch-field">
        <span class="switch">
          <input
            type="checkbox"
            role="switch"
            .checked=${value}
            ?disabled=${off}
            @change=${(e) => set(e.target.checked)}
          />
          <span class="track" aria-hidden="true"></span>
        </span>
        <span class="switch-text"><span class="label">${label}</span>${hint}</span>
      </label>`;
    case 'Slider': {
      const min = num(p.min, 0);
      const max = Math.max(min, num(p.max, 100));
      const step = num(p.step, 1) > 0 ? num(p.step, 1) : 1;
      return html`<label class="field">
        <span class="label slider-label"><span>${label}</span><span class="v">${value}</span></span>
        <input
          type="range"
          name=${name}
          min=${min}
          max=${max}
          step=${step}
          .value=${String(value)}
          ?disabled=${off}
          @input=${(e) => set(Number(e.target.value))}
        />
      </label>`;
    }
  }
  return nothing;
}

export function form(ui, p, path) {
  // A page of its own has no assistant to send the answers to.
  if (ui.standalone) return nothing;
  const children = list(p.fields);
  const fields = children.filter((c) => isEl(c) && FIELDS.includes(c.typeName));
  if (!fields.length) return nothing;
  const key = `form:${path}`;
  const start = {};
  fields.forEach((f, i) => {
    const name = nameOf(f.props || {}, i);
    if (!(name in start)) start[name] = initialValue(f.typeName, f.props || {});
  });
  const values = { ...start, ...ui._state(key, {}) };
  const off = ui.disabled || ui.streaming;
  const set = (name) => (v) => ui._setState(key, { ...ui._state(key, {}), [name]: v });
  const onSubmit = (e) => {
    e.preventDefault();
    if (off) return;
    ui._fire([{ type: 'continue_conversation', message: formMessage(p.title, fields, values) }]);
  };
  let n = -1;
  return html`<form class="form" @submit=${onSubmit}>
    ${p.title ? html`<div class="form-title">${str(p.title)}</div>` : nothing}
    ${p.description ? html`<div class="form-desc">${str(p.description)}</div>` : nothing}
    ${children.map((c, i) => {
      if (!isEl(c) || !FIELDS.includes(c.typeName)) return ui._node(c, `${path}.${i}`);
      n += 1;
      const name = nameOf(c.props || {}, n);
      return field(c.typeName, c.props || {}, name, values[name], set(name), off);
    })}
    <div class="buttons">
      <button class="btn primary" type="submit" ?disabled=${off}>
        ${str(p.submit) || 'Send'}
      </button>
    </div>
  </form>`;
}
