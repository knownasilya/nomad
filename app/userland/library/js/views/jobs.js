import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import modsCSS from '../../css/views/mods.css.js';
import jobsCSS from '../../css/views/jobs.css.js';

// The user's AI Jobs (bg/ai/jobs.js, ADR-0030): prompts the AI runs by itself, by hand or on a
// schedule, whose answers are saved here and can notify the user's phone. Jobs and their runs are
// Vault records, so the phone lists them too. The AI Sidebar makes them ("every morning, sum up my
// Reader and send it to my phone"); this is where they're seen, run, changed and paused.
//
// ?id=<id> opens one. The rules (schedules, notify, sizes) live in shared/jobs.mjs; bg checks
// them on save.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NOTIFY = [
  { id: 'always', label: 'Every run' },
  { id: 'auto', label: 'When the AI finds something' },
  { id: 'never', label: 'Never' },
];

const blank = () => ({
  id: null,
  title: '',
  prompt: '',
  kind: 'manual', // 'manual' | 'interval' | 'daily'
  every: 1,
  unit: 'hours',
  time: '08:00',
  days: [],
  notify: 'always',
  enabled: true,
  error: '',
});

export class JobsView extends LitElement {
  static get properties() {
    return {
      jobs: { type: Array },
      filter: { type: String },
      editing: { type: Object }, // a form: blank() or one made from a Job
      openId: { type: String }, // the Job whose runs show
      runs: { type: Array },
    };
  }

  static get styles() {
    return [modsCSS, jobsCSS];
  }

  constructor() {
    super();
    this.jobs = undefined; // undefined = loading
    this.filter = undefined;
    this.editing = null;
    this.runs = [];
    this.openId = new URLSearchParams(location.search).get('id') || null;
    this.load();
    // Jobs change on other Devices, from the AI, and when a run starts or ends.
    try {
      nomad.vault.watchJobs().addEventListener('changed', () => this.load());
    } catch {}
    // "Next run in 5 minutes" goes stale on its own.
    this.clock = setInterval(() => this.requestUpdate(), 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.clock);
  }

  async load() {
    try {
      this.jobs = (await nomad.vault.listJobs()).jobs;
    } catch {
      this.jobs = [];
    }
    if (this.openId) this.runs = await nomad.vault.listJobRuns(this.openId).catch(() => []);
  }

  filtered() {
    const f = (this.filter || '').toLowerCase();
    return (this.jobs || []).filter(
      (j) => !f || j.title.toLowerCase().includes(f) || j.prompt.toLowerCase().includes(f)
    );
  }

  render() {
    if (typeof this.jobs === 'undefined') return html`<div class="empty">Loading…</div>`;
    const rows = this.filtered();
    const e = this.editing;
    return html`
      <link rel="stylesheet" href="nomad://app-stdlib/css/fontawesome.css" />
      <div class="intro">
        A Job is a prompt the AI runs by itself, by hand or on a schedule, like “every weekday at
        8:00, sum up my unread Reader posts”. It can read your Notes, Reader, drives and the web, and
        it changes nothing. Its answers are kept here, and it can notify your phone. Ask the AI in the
        sidebar to make one, or make it here. A Job runs on the computer that made it, while that
        computer is awake.
      </div>
      <div class="toolbar">
        <span></span>
        ${e && !e.id ? '' : html`<button class="primary" @click=${this.onNew}>New Job</button>`}
      </div>
      ${e && !e.id ? html`<div class="card editing">${this.renderEditor(e)}</div>` : ''}
      ${rows.length === 0
        ? html`<div class="empty">
            ${this.jobs.length
              ? 'No Jobs match.'
              : 'No Jobs yet. Try asking the AI: “Every morning at 8, sum up my unread Reader posts and send it to my phone.”'}
          </div>`
        : repeat(rows, (j) => j.id, (j) => this.renderJob(j))}
    `;
  }

  renderJob(j) {
    const e = this.editing && this.editing.id === j.id ? this.editing : null;
    const open = this.openId === j.id;
    return html`
      <div class="card ${e || open ? 'editing' : ''}">
        <div class="row-head">
          <label class="switch" title=${j.enabled ? 'On' : 'Paused'}>
            <input type="checkbox" .checked=${j.enabled} aria-label="${j.title} on" @change=${(ev) => this.onToggle(j, ev.target.checked)} />
            <span class="track"></span>
          </label>
          <div class="meta" @click=${() => this.onOpen(j)}>
            <div class="title">${j.title}</div>
            <div class="summary">${this.summary(j)}</div>
          </div>
          <div class="actions">
            <button class="icon" title="Run now" aria-label="Run ${j.title} now" ?disabled=${j.running} @click=${() => this.onRun(j)}>
              <span class="fas fa-fw ${j.running ? 'fa-circle-notch fa-spin' : 'fa-play'}"></span>
            </button>
            <button class="icon" title="Edit" aria-label="Edit ${j.title}" @click=${() => (e ? (this.editing = null) : this.edit(j))}>
              <span class="fas fa-fw ${e ? 'fa-chevron-up' : 'fa-pen'}"></span>
            </button>
            <button class="icon danger" title="Delete" aria-label="Delete ${j.title}" @click=${() => this.onDelete(j)}>
              <span class="fas fa-fw fa-trash"></span>
            </button>
          </div>
        </div>
        ${e ? this.renderEditor(e) : open ? this.renderRuns(j) : ''}
      </div>
    `;
  }

  summary(j) {
    const parts = [j.when];
    if (j.running) parts.push('Running now…');
    else if (j.lastRun) {
      parts.push(`${j.lastRun.status === 'error' ? 'Failed' : 'Ran'} ${ago(j.lastRun.finishedAt)}`);
    }
    if (j.enabled && j.nextRunAt && j.here) parts.push(`next ${inTime(j.nextRunAt)}`);
    if (!j.enabled) parts.push('paused');
    if (!j.here) parts.push(`runs on ${j.deviceName}`);
    if (j.notify !== 'never') parts.push(j.notify === 'auto' ? 'notifies when it finds something' : 'notifies your phone');
    return parts.join(' · ');
  }

  renderRuns(j) {
    const runs = this.runs || [];
    return html`
      <div class="job-body">
        <div class="label">Prompt</div>
        <div class="prompt">${j.prompt}</div>
        ${j.here
          ? ''
          : html`<div class="elsewhere">
              This Job runs on ${j.deviceName}.
              <button class="link" @click=${() => this.onRunHere(j)}>Run it on this computer instead</button>
            </div>`}
        <div class="label">Runs</div>
        ${runs.length === 0
          ? html`<div class="hint-row">No runs yet. Click <span class="fas fa-play"></span> to run it now.</div>`
          : runs.map(
              (r, i) => html`
                <details class="run" ?open=${i === 0}>
                  <summary>
                    <span class="fas fa-fw ${r.status === 'error' ? 'fa-exclamation-circle err' : 'fa-check-circle ok'}"></span>
                    ${new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    <span class="muted">· ${r.trigger === 'manual' ? 'by hand' : 'on schedule'}${r.notification ? ' · notified' : ''}</span>
                  </summary>
                  ${r.error ? html`<div class="error">${r.error}</div>` : ''}
                  ${r.output ? html`<div class="output">${r.output}</div>` : ''}
                </details>
              `
            )}
      </div>
    `;
  }

  renderEditor(e) {
    const set = (patch) => (this.editing = { ...this.editing, ...patch, error: '' });
    return html`
      <form class="editor" @submit=${this.onSave}>
        <div class="fields">
          <label>
            <span>Name</span>
            <input class="name" placeholder="Morning digest" .value=${e.title} @input=${(ev) => set({ title: ev.target.value })} />
          </label>
        </div>

        <div class="block">
          <div class="label">Prompt <span class="hint">What the AI does each run. It starts fresh each time, with nobody to ask, so say everything it needs.</span></div>
          <textarea rows="5" placeholder="Sum up my unread Reader posts from the last day in a few bullet points, newest first." .value=${e.prompt} @input=${(ev) => set({ prompt: ev.target.value })}></textarea>
        </div>

        <div class="block">
          <div class="label">When</div>
          <div class="when">
            <select .value=${e.kind} @change=${(ev) => set({ kind: ev.target.value })}>
              <option value="manual" ?selected=${e.kind === 'manual'}>Only when I run it</option>
              <option value="interval" ?selected=${e.kind === 'interval'}>Every…</option>
              <option value="daily" ?selected=${e.kind === 'daily'}>At a time of day</option>
            </select>
            ${e.kind === 'interval'
              ? html`
                  <input class="num" type="number" min="1" .value=${String(e.every)} @input=${(ev) => set({ every: ev.target.value })} />
                  <select .value=${e.unit} @change=${(ev) => set({ unit: ev.target.value })}>
                    <option value="minutes" ?selected=${e.unit === 'minutes'}>minutes</option>
                    <option value="hours" ?selected=${e.unit === 'hours'}>hours</option>
                  </select>
                `
              : ''}
            ${e.kind === 'daily'
              ? html`<input class="time" type="time" .value=${e.time} @input=${(ev) => set({ time: ev.target.value })} />`
              : ''}
          </div>
          ${e.kind === 'daily'
            ? html`<div class="presets days">
                ${DAYS.map(
                  (d, i) => html`
                    <label class="chip ${e.days.includes(i) ? 'on' : ''}">
                      <input
                        type="checkbox"
                        .checked=${e.days.includes(i)}
                        @change=${(ev) => set({ days: ev.target.checked ? [...e.days, i] : e.days.filter((x) => x !== i) })}
                      />
                      ${d}
                    </label>
                  `
                )}
                <span class="hint">${e.days.length ? '' : 'Every day'}</span>
              </div>`
            : ''}
        </div>

        <div class="block">
          <div class="label">Notify my phone</div>
          <select .value=${e.notify} @change=${(ev) => set({ notify: ev.target.value })}>
            ${NOTIFY.map((n) => html`<option value=${n.id} ?selected=${e.notify === n.id}>${n.label}</option>`)}
          </select>
          ${e.notify === 'auto'
            ? html`<div class="hint-row">Say in the prompt when you want to hear, like “notify me only if Ada posted”.</div>`
            : ''}
        </div>

        ${e.error ? html`<div class="error">${e.error}</div>` : ''}
        <div class="buttons">
          <button type="submit" class="primary">${e.id ? 'Save' : 'Create Job'}</button>
          <button type="button" @click=${() => (this.editing = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  edit(j) {
    const s = j.schedule;
    const form = { ...blank(), id: j.id, title: j.title, prompt: j.prompt, notify: j.notify, enabled: j.enabled };
    if (s?.kind === 'interval') {
      const hours = s.minutes % 60 === 0;
      Object.assign(form, { kind: 'interval', every: hours ? s.minutes / 60 : s.minutes, unit: hours ? 'hours' : 'minutes' });
    } else if (s?.kind === 'daily') {
      Object.assign(form, { kind: 'daily', time: s.time, days: s.days || [] });
    }
    this.editing = form;
  }

  schedule(e) {
    if (e.kind === 'interval') {
      const n = Number(e.every);
      return { kind: 'interval', minutes: e.unit === 'hours' ? n * 60 : n };
    }
    if (e.kind === 'daily') return { kind: 'daily', time: e.time, days: e.days.length ? e.days : null };
    return null;
  }

  // events
  // =

  onNew() {
    this.editing = blank();
  }

  async onOpen(j) {
    if (this.editing?.id === j.id) return;
    this.openId = this.openId === j.id ? null : j.id;
    this.runs = [];
    history.replaceState({}, '', this.openId ? `/jobs?id=${this.openId}` : '/jobs');
    if (this.openId) this.runs = await nomad.vault.listJobRuns(j.id).catch(() => []);
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    try {
      const rec = await nomad.vault.saveJob({
        id: e.id || undefined,
        title: e.title,
        prompt: e.prompt,
        schedule: this.schedule(e),
        notify: e.notify,
      });
      this.editing = null;
      this.openId = rec.id;
      await this.load();
      toast.create(e.id ? `Saved “${rec.title}”` : `Created “${rec.title}”`, 'success');
    } catch (err) {
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  async onRun(j) {
    try {
      await nomad.vault.runJob(j.id);
      if (this.openId !== j.id) await this.onOpen(j);
      toast.create(`Running “${j.title}”…`);
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onRunHere(j) {
    try {
      await nomad.vault.saveJob({ id: j.id, runHere: true });
      await this.load();
      toast.create(`“${j.title}” now runs on this computer`, 'success');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onToggle(j, enabled) {
    try {
      await nomad.vault.saveJob({ id: j.id, enabled });
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  async onDelete(j) {
    if (!confirm(`Delete the Job “${j.title}” and its saved runs?`)) return;
    try {
      await nomad.vault.deleteJob(j.id);
      if (this.editing?.id === j.id) this.editing = null;
      if (this.openId === j.id) this.openId = null;
      await this.load();
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }
}

// "5 minutes ago", "yesterday", or a date.
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}

// "in 5 minutes", "at 08:00", or a day and time.
function inTime(iso) {
  const at = new Date(iso);
  const min = Math.round((at.getTime() - Date.now()) / 60_000);
  if (min <= 1) return 'any moment';
  if (min < 60) return `in ${min} minutes`;
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === new Date().toDateString()) return `at ${time}`;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// An error from bg arrives wrapped ("Error invoking remote method …: Error: …").
function cleanError(err) {
  return String(err?.message || err).replace(/^.*?Error: /, '');
}

customElements.define('jobs-view', JobsView);
