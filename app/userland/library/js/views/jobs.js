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
// A Job can come from a drive: its job.js and/or job.md (shared/jobs.mjs sourceFiles). A drive of
// the user's own runs its latest files; anyone else's is copied, and a newer version shows here to
// look at and take, or leave.
//
// ?id=<id> opens one. The rules (schedules, notify, sizes) live in shared/jobs.mjs; bg checks
// them on save.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KINDS = [
  { id: 'manual', label: 'Only when I run it' },
  { id: 'interval', label: 'Every…' },
  { id: 'daily', label: 'At times of day' },
  { id: 'monthly', label: 'On days of the month' },
  { id: 'once', label: 'Once, at…' },
  { id: 'text', label: 'Type it (words or cron)' },
];
const NOTIFY = [
  { id: 'always', label: 'Every run' },
  { id: 'auto', label: 'When the AI finds something' },
  { id: 'never', label: 'Never' },
];

const blank = () => ({
  id: null,
  title: '',
  prompt: '',
  source: '', // a drive URL or name; '' for none
  kind: 'manual', // 'manual' | 'interval' | 'daily' | 'monthly' | 'once' | 'text'
  every: 1,
  unit: 'hours',
  windowed: false, // an interval only between `from` and `to`
  from: '09:00',
  to: '17:00',
  times: ['08:00'],
  days: [],
  dates: '1', // a monthly schedule's days of the month: "1, 15, last"
  at: '', // a one-time schedule's datetime-local value
  text: '', // a typed schedule: a phrase or cron
  preview: null, // { when, next } or { error } from bg previewSchedule
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
      newer: { type: Object }, // a newer version of the open Job's source: { jobId, url, module, prompt } or { jobId, error }
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
    this.newer = null;
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
      (j) =>
        !f ||
        j.title.toLowerCase().includes(f) ||
        j.prompt.toLowerCase().includes(f) ||
        (j.source?.url || '').includes(f)
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
        sidebar to make one, or make it here. A Job can also come from a drive with a
        <code>job.md</code> prompt and a <code>job.js</code> module. A Job runs on the computer that
        made it, while that computer is awake.
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
    if (j.source?.changed) parts.push('a newer version is in its drive');
    return parts.join(' · ');
  }

  renderRuns(j) {
    const runs = this.runs || [];
    return html`
      <div class="job-body">
        ${j.source ? this.renderSource(j) : ''}
        ${j.prompt
          ? html`<div class="label">${j.source ? 'More instructions' : 'Prompt'}</div>
              <div class="prompt">${j.prompt}</div>`
          : ''}
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

  // Where a drive Job comes from, its copy, and a newer version to take.
  renderSource(j) {
    const src = j.source;
    const u = this.newer && this.newer.jobId === j.id ? this.newer : null;
    return html`
      <div class="label">From a drive</div>
      <div class="source">
        <a href=${src.url} target="_blank">${src.url}</a>
        <div class="hint-row">
          ${src.live
            ? 'Your drive: each run uses its files as they are then.'
            : `Someone else’s drive: this Job runs the copy made ${ago(src.copiedAt)}.`}
        </div>
        ${src.live ? '' : this.renderFiles(src)}
        ${src.live
          ? ''
          : u?.error
            ? html`<div class="error">${u.error}</div>`
            : u
              ? html`<div class="update">
                  ${u.same
                    ? html`<div class="hint-row">The drive has the same version as this copy.</div>`
                    : html`
                        <div class="hint-row">The drive’s version now. Look it over before you take it: the Job runs it on this computer.</div>
                        ${this.renderFiles(u, true)}
                        <div class="buttons">
                          <button class="primary" @click=${() => this.onTakeUpdate(j, u)}>Use this version</button>
                          <button @click=${() => (this.newer = null)}>Keep the copy</button>
                        </div>
                      `}
                </div>`
              : html`<div class="hint-row">
                  ${src.changed ? html`<strong>A newer version is in the drive.</strong>` : ''}
                  <button class="link" @click=${() => this.onCheckSource(j)}>${src.changed ? 'Look at it' : 'Check for a newer version'}</button>
                </div>`}
      </div>
    `;
  }

  renderFiles(f, open = false) {
    return html`
      ${f.prompt
        ? html`<details class="file" ?open=${open}><summary>job.md</summary><pre>${f.prompt}</pre></details>`
        : ''}
      ${f.module
        ? html`<details class="file" ?open=${open}><summary>job.js</summary><pre>${f.module}</pre></details>`
        : ''}
    `;
  }

  renderEditor(e) {
    const set = (patch) => {
      this.editing = { ...this.editing, ...patch, error: '' };
      this.checkSchedule();
    };
    return html`
      <form class="editor" @submit=${this.onSave}>
        <div class="fields">
          <label>
            <span>Name</span>
            <input class="name" placeholder="Morning digest" .value=${e.title} @input=${(ev) => set({ title: ev.target.value })} />
          </label>
        </div>

        <div class="block">
          <div class="label">Drive <span class="hint">Optional. A folder with a job.md prompt and/or a job.js module, or one of your drive names.</span></div>
          <input class="source-url" placeholder="hyper://…/jobs/digest/" .value=${e.source} @input=${(ev) => set({ source: ev.target.value })} />
        </div>

        <div class="block">
          <div class="label">${e.source.trim() ? 'More instructions' : 'Prompt'} <span class="hint">${e.source.trim()
            ? 'Optional. Added to the drive’s job.md, or given to the AI with what job.js returns.'
            : 'What the AI does each run. It starts fresh each time, with nobody to ask, so say everything it needs.'}</span></div>
          <textarea rows="5" placeholder="Sum up my unread Reader posts from the last day in a few bullet points, newest first." .value=${e.prompt} @input=${(ev) => set({ prompt: ev.target.value })}></textarea>
        </div>

        <div class="block">
          <div class="label">When</div>
          <div class="when">
            <select @change=${(ev) => set({ kind: ev.target.value })}>
              ${KINDS.map((k) => html`<option value=${k.id} ?selected=${e.kind === k.id}>${k.label}</option>`)}
            </select>
            ${e.kind === 'interval'
              ? html`
                  <input class="num" type="number" min="1" .value=${String(e.every)} @input=${(ev) => set({ every: ev.target.value })} />
                  <select @change=${(ev) => set({ unit: ev.target.value })}>
                    <option value="minutes" ?selected=${e.unit === 'minutes'}>minutes</option>
                    <option value="hours" ?selected=${e.unit === 'hours'}>hours</option>
                  </select>
                `
              : ''}
            ${e.kind === 'once'
              ? html`<input class="at" type="datetime-local" .value=${e.at} @input=${(ev) => set({ at: ev.target.value })} />`
              : ''}
            ${e.kind === 'text'
              ? html`<input class="text" placeholder="weekdays 9:00 and 17:00 · 1st and 15th at 9am · 0 8 * * 1-5" .value=${e.text} @input=${(ev) => set({ text: ev.target.value })} />`
              : ''}
          </div>
          ${e.kind === 'interval'
            ? html`<div class="when sub">
                <label class="check">
                  <input type="checkbox" .checked=${e.windowed} @change=${(ev) => set({ windowed: ev.target.checked })} />
                  Only between
                </label>
                <input class="time" type="time" ?disabled=${!e.windowed} .value=${e.from} @input=${(ev) => set({ from: ev.target.value })} />
                and
                <input class="time" type="time" ?disabled=${!e.windowed} .value=${e.to} @input=${(ev) => set({ to: ev.target.value })} />
              </div>`
            : ''}
          ${e.kind === 'daily' || e.kind === 'monthly' ? this.renderTimes(e, set) : ''}
          ${e.kind === 'monthly'
            ? html`<div class="when sub">
                <span>On days</span>
                <input class="dates" placeholder="1, 15, last" .value=${e.dates} @input=${(ev) => set({ dates: ev.target.value })} />
                <span class="hint">of the month; “last” is the last day</span>
              </div>`
            : ''}
          ${e.kind === 'daily' || e.kind === 'interval'
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
          ${e.kind === 'text'
            ? html`<div class="hint-row">Words like “every 2 hours”, “Mondays and Fridays 6pm”, “last day of the month 18:00”, “tomorrow 9:00”, or a cron expression (minute hour day month weekday).</div>`
            : ''}
          ${e.kind !== 'manual' && e.preview
            ? e.preview.error
              ? html`<div class="preview err">${e.preview.error}</div>`
              : html`<div class="preview">
                  <span class="fas fa-fw fa-calendar-alt"></span> ${e.preview.when}${e.preview.next.length
                    ? html` · next ${e.preview.next.map((t) => when(t)).join(', ')}`
                    : ' · no more runs'}
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

  renderTimes(e, set) {
    const times = e.times.length ? e.times : ['08:00'];
    const put = (i, v) => set({ times: times.map((t, k) => (k === i ? v : t)) });
    return html`<div class="when sub times">
      <span>At</span>
      ${times.map(
        (t, i) => html`<span class="time-item">
          <input class="time" type="time" .value=${t} @input=${(ev) => put(i, ev.target.value)} />
          ${times.length > 1
            ? html`<button type="button" class="icon" title="Remove this time" aria-label="Remove ${t}" @click=${() => set({ times: times.filter((_, k) => k !== i) })}>
                <span class="fas fa-fw fa-times"></span>
              </button>`
            : ''}
        </span>`
      )}
      <button type="button" class="link" @click=${() => set({ times: [...times, nextHour(times[times.length - 1])] })}>
        <span class="fas fa-plus"></span> Add a time
      </button>
    </div>`;
  }

  edit(j) {
    const s = j.schedule;
    const form = {
      ...blank(),
      id: j.id,
      title: j.title,
      prompt: j.prompt,
      source: j.source?.url || '',
      notify: j.notify,
      enabled: j.enabled,
    };
    if (s?.kind === 'interval') {
      const hours = s.minutes % 60 === 0;
      Object.assign(form, {
        kind: 'interval',
        every: hours ? s.minutes / 60 : s.minutes,
        unit: hours ? 'hours' : 'minutes',
        windowed: !!s.from,
        from: s.from || form.from,
        to: s.to || form.to,
        days: s.days || [],
      });
    } else if (s?.kind === 'daily') {
      Object.assign(form, { kind: 'daily', times: s.times || [s.time], days: s.days || [] });
    } else if (s?.kind === 'monthly') {
      Object.assign(form, {
        kind: 'monthly',
        times: s.times,
        dates: s.dates.map((d) => (d === -1 ? 'last' : d)).join(', '),
      });
    } else if (s?.kind === 'once') {
      Object.assign(form, { kind: 'once', at: localInput(new Date(s.at)) });
    } else if (s?.kind === 'cron') {
      Object.assign(form, { kind: 'text', text: s.expr });
    }
    this.editing = form;
    this.checkSchedule();
  }

  schedule(e) {
    const days = e.days.length ? e.days : null;
    switch (e.kind) {
      case 'interval': {
        const n = Number(e.every);
        return {
          kind: 'interval',
          minutes: e.unit === 'hours' ? n * 60 : n,
          ...(e.windowed ? { from: e.from, to: e.to } : {}),
          days,
        };
      }
      case 'daily':
        return { kind: 'daily', times: e.times, days };
      case 'monthly':
        return {
          kind: 'monthly',
          times: e.times,
          dates: e.dates
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((d) => (/^last$/i.test(d) ? -1 : Number(d.replace(/(st|nd|rd|th)$/i, '')))),
        };
      case 'once':
        return { kind: 'once', at: e.at ? new Date(e.at).toISOString() : null };
      case 'text':
        return e.text.trim() || null;
    }
    return null;
  }

  // Checks the form's schedule in bg as it changes, and shows it in words with its next runs.
  checkSchedule() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(async () => {
      const e = this.editing;
      if (!e || e.kind === 'manual') return;
      let preview;
      try {
        const res = await nomad.vault.previewSchedule(this.schedule(e));
        preview = res.schedule ? res : { error: 'Type a schedule' };
      } catch (err) {
        preview = { error: cleanError(err) };
      }
      if (this.editing === e) this.editing = { ...e, preview };
    }, 250);
  }

  // events
  // =

  onNew() {
    this.editing = { ...blank(), at: localInput(new Date(Date.now() + 3600e3)) };
  }

  async onOpen(j) {
    if (this.editing?.id === j.id) return;
    this.openId = this.openId === j.id ? null : j.id;
    this.runs = [];
    this.newer = null;
    history.replaceState({}, '', this.openId ? `/jobs?id=${this.openId}` : '/jobs');
    if (this.openId) this.runs = await nomad.vault.listJobRuns(j.id).catch(() => []);
  }

  async onSave(ev) {
    ev.preventDefault();
    const e = this.editing;
    const prev = e.id ? this.jobs.find((j) => j.id === e.id) : null;
    const url = e.source.trim();
    // The drive is read again only when it changed: keeping the URL keeps the copy.
    const source = url === (prev?.source?.url || '') ? undefined : url || null;
    try {
      const rec = await nomad.vault.saveJob({
        id: e.id || undefined,
        title: e.title,
        prompt: e.prompt,
        source,
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

  async onCheckSource(j) {
    try {
      const now = await nomad.vault.checkJobSource(j.id);
      this.newer = { jobId: j.id, ...now, same: now.hash === j.source.hash };
    } catch (err) {
      this.newer = { jobId: j.id, error: cleanError(err) };
    }
  }

  // Take the version the user looked at: exactly those files, even if the drive changed since.
  async onTakeUpdate(j, u) {
    try {
      await nomad.vault.saveJob({ id: j.id, source: { url: j.source.url, module: u.module, prompt: u.prompt } });
      this.newer = null;
      await this.load();
      toast.create(`“${j.title}” now runs the new version`, 'success');
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

// A Date as a datetime-local input's value, in local time.
function localInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The hour after an HH:MM, for a new time in the list.
function nextHour(t) {
  const h = (Number(String(t || '08:00').split(':')[0]) + 1) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

// "today 17:00", "Mon 09:00", or a date, for the schedule preview.
function when(iso) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
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
