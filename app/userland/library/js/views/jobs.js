import {
  LitElement,
  html,
} from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import * as toast from 'nomad://app-stdlib/js/com/toast.js';
import { setItemTitle } from '../lib/page-title.js';
import { queryWords, matchesWords } from 'nomad://app-stdlib/js/search-match.js';
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
// A Job can also use web pages (ADR-0038): open a site in a page of its own, signed in as the user,
// and click and type there. The user gives it each site on a run they watch (Run with me), or here
// in the editor; a run with nobody watching shows what it wanted and wasn't given.
//
// ?id=<id> opens one. The rules (schedules, notify, sizes) live in shared/jobs.mjs; bg checks
// them on save.

// How much history a Job keeps (shared/jobs.mjs KEEP_HISTORY, KEEP_RUNS).
const KEEP_HISTORY = 50;
const KEEP_RUNS = 10;
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
  // What the Job may change with nobody watching: drives ({ url, title, draft }), Notes, Reader.
  drives: [],
  addDrive: '', // the drive URL or name being typed
  notes: false,
  reader: false,
  newDrives: false, // make new drives (createDrive), and write the ones it makes
  // Sites it may open, and click and type on (`control`), with the clicks it may repeat (`actions`).
  pages: [],
  addSite: '', // the site being typed
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
  audience: 'me', // 'space': everyone in the Job's shared Space gets its notifications too
  sharedSpaceName: null, // that Space's name, when the Job's Space is shared
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
      runFilter: { type: String }, // the open Job's history: 'all' or 'failed'
      runQuery: { type: String }, // words to find in the open Job's history
      newer: { type: Object }, // a newer version of the open Job's source: { jobId, url, module, prompt } or { jobId, error }
      secrets: { type: Array }, // the user's secrets on this computer, without values
      sharedSpace: { type: Object }, // { space, name }: this Space is shared, so a Job can notify everyone in it
      live: { type: Object }, // the open Job's run going on now: bg job-chat.js progress(), or null
      stopping: { type: Object }, // a Set of Job ids the user stopped, until their run ends
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
    this.runFilter = 'all';
    this.runQuery = '';
    this.newer = null;
    this.secrets = [];
    this.live = null;
    this.stopping = new Set();
    this.liveJobId = null; // the Job whose progress this.liveWatch follows
    this.liveWatch = null;
    this.openId = new URLSearchParams(location.search).get('id') || null;
    this.load();
    // Jobs change on other Devices, from the AI, and when a run starts or ends.
    try {
      this.jobsWatch = nomad.vault.watchJobs();
      this.jobsWatch.addEventListener('changed', () => this.load());
    } catch {}
    // "Next run in 5 minutes" goes stale on its own.
    this.clock = setInterval(() => this.requestUpdate(), 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.clock);
    this.followLive(null);
    try {
      this.jobsWatch?.close?.();
    } catch {}
  }

  // Follow the open Job's run while it goes on, so it can be watched from here partway through.
  followLive(jobId) {
    if (jobId === this.liveJobId) return;
    try {
      this.liveWatch?.close?.();
    } catch {}
    this.liveWatch = null;
    this.liveJobId = jobId;
    this.live = null;
    if (!jobId) return;
    try {
      this.liveWatch = nomad.vault.watchJobProgress(jobId);
      this.liveWatch.addEventListener('progress', (e) => {
        if (this.liveJobId === jobId) this.live = e.progress || null;
      });
    } catch {}
  }

  async load() {
    try {
      const res = await nomad.vault.listJobs();
      this.jobs = res.jobs;
      this.sharedSpace = res.sharedSpace || null;
    } catch {
      this.jobs = [];
      this.sharedSpace = null;
    }
    // The secrets each Job may use on this computer (ADR-0033), granted in Secrets.
    try {
      this.secrets = (await nomad.secrets.list()).secrets;
    } catch {
      this.secrets = [];
    }
    // A run that ended isn't being stopped anymore.
    const busy = new Set((this.jobs || []).filter((j) => j.running || j.queued).map((j) => j.id));
    if ([...this.stopping].some((id) => !busy.has(id))) {
      this.stopping = new Set([...this.stopping].filter((id) => busy.has(id)));
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

  // The tab title names the Job that is open (lib/page-title.js).
  itemTitle() {
    const e = this.editing;
    if (e && !e.id) return 'New Job';
    const id = e?.id || this.openId;
    return (id && this.jobs?.find((j) => j.id === id)?.title) || '';
  }

  updated() {
    setItemTitle(this, this.itemTitle());
    const open = this.openId && !this.editing ? this.jobs?.find((j) => j.id === this.openId) : null;
    this.followLive(open?.running ? open.id : null);
    // The live run's steps stay scrolled to the newest, unless the user scrolled up to read.
    const steps = this.renderRoot?.querySelector('.live-steps');
    if (steps && !this.liveScrolledUp) steps.scrollTop = steps.scrollHeight;
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
        it changes only what you let it: your Notes, your Reader, or drives you pick, live or in a
        Draft for you to publish. With a secret you let it use (in Secrets), it can call an API or a
        webhook without seeing the key. It can open web pages signed in as you, and click and type on
        them, on the sites you let it: run it with you once and it asks. Its answers and what it changed are kept here, and it can
        notify your phone. Ask the AI in the
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
            <div class="title">
              ${j.title}
              ${j.running
                ? html`<span class="running-badge" title=${open ? '' : 'Open it to see what it’s doing'}><span class="fas fa-fw fa-circle-notch fa-spin"></span> ${this.stopping.has(j.id) ? 'Stopping' : 'Running'}</span>`
                : j.queued
                  ? html`<span class="running-badge waiting" title="It runs once the Job running now is done"><span class="fas fa-fw fa-hourglass-half"></span> Waiting</span>`
                  : ''}
            </div>
            <div class="summary">${this.summary(j)}</div>
            ${!j.running && j.lastRun?.status === 'error' && !open && !e
              ? html`<div class="last-error" title=${j.lastRun.error || ''}>
                  <span class="fas fa-fw fa-exclamation-circle"></span> ${j.lastRun.error || 'The Job didn’t finish'}
                </div>`
              : ''}
          </div>
          <div class="actions">
            ${j.running || j.queued
              ? html`<button
                  class="icon stop"
                  title=${this.stopping.has(j.id) ? 'Stopping…' : j.running ? 'Stop this run' : 'Don’t run it'}
                  aria-label=${j.running ? `Stop ${j.title}` : `Don’t run ${j.title}`}
                  ?disabled=${this.stopping.has(j.id)}
                  @click=${() => this.onStop(j)}
                >
                  <span class="fas fa-fw ${this.stopping.has(j.id) ? 'fa-circle-notch fa-spin' : 'fa-stop'}"></span>
                </button>`
              : html`<button class="icon" title="Run now" aria-label="Run ${j.title} now" @click=${() => this.onRun(j)}>
                  <span class="fas fa-fw fa-play"></span>
                </button>`}
            ${j.running
              ? html`<button class="watch-btn" title="Watch this run: its page, and its chat in the AI sidebar" @click=${() => this.onWatch(j)}>
                  <span class="fas fa-fw fa-eye"></span> Watch
                </button>`
              : html`<button class="icon" title="Run with me: watch it in a tab, and allow the sites it uses" aria-label="Run ${j.title} with me" @click=${() => this.onRun(j, true)}>
                  <span class="fas fa-fw fa-eye"></span>
                </button>`}
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
    if (j.lastRun && !j.running) {
      parts.push(
        `${j.lastRun.status === 'error' ? 'Failed' : j.lastRun.stopped ? 'Stopped' : 'Ran'} ${ago(j.lastRun.finishedAt)}`
      );
    }
    if (j.enabled && j.nextRunAt && j.here) parts.push(`next ${inTime(j.nextRunAt)}`);
    if (!j.enabled) parts.push('paused');
    if (!j.here) parts.push(`runs on ${j.deviceName}`);
    if (j.notify !== 'never') {
      const who = j.audience === 'space' && j.sharedSpaceName ? `everyone in ${j.sharedSpaceName}` : 'your phone';
      parts.push(j.notify === 'auto' ? `notifies ${who} when it finds something` : `notifies ${who}`);
    }
    if (j.source?.changed) parts.push('a newer version is in its drive');
    const w = j.writes;
    if (w?.notes || w?.reader || w?.drives?.length) parts.push('can change things');
    if (w?.pages?.length) parts.push(`uses ${w.pages.length === 1 ? w.pages[0].site : `${w.pages.length} sites`}`);
    return parts.join(' · ');
  }

  renderRuns(j) {
    const runs = this.runs || [];
    return html`
      <div class="job-body">
        ${j.running ? this.renderLive(j) : ''}
        ${j.source ? this.renderSource(j) : ''}
        ${j.prompt
          ? html`<div class="label">${j.source ? 'More instructions' : 'Prompt'}</div>
              <div class="prompt">${j.prompt}</div>`
          : ''}
        ${this.renderGrants(j)}
        ${j.here
          ? ''
          : html`<div class="elsewhere">
              This Job runs on ${j.deviceName}.
              <button class="link" @click=${() => this.onRunHere(j)}>Run it on this computer instead</button>
            </div>`}
        ${this.renderSecrets(j)}
        ${this.renderHistory(j)}
      </div>
    `;
  }

  // The run going on now, as it goes: what it said and each step it took, newest last. The row's
  // Stop ends it, and its Watch follows it in the AI sidebar (its chat, and its page when it has one).
  renderLive(j) {
    const p = this.liveJobId === j.id ? this.live : null;
    const items = p?.items || [];
    const stopping = this.stopping.has(j.id) || p?.stopping;
    return html`
      <div class="live" aria-live="polite">
        <div class="live-head">
          <span class="fas fa-fw fa-circle-notch fa-spin live-spin"></span>
          <span class="live-title">${stopping ? 'Stopping…' : 'Running now'}</span>
          ${p?.startedAt ? html`<span class="muted">· started ${ago(p.startedAt)}</span>` : ''}
          <span class="spacer"></span>
          <span class="muted">Watch follows it in the AI sidebar${p?.page ? ', with its page' : ''}</span>
        </div>
        <div class="live-steps" @scroll=${(ev) => this.onLiveScroll(ev)}>
          ${items.map((it) =>
            it.kind === 'text'
              ? html`<div class="live-text">${it.text}</div>`
              : html`<div class="live-step ${it.child ? 'child' : ''} ${it.state}" title=${it.error || ''}>
                  <span class="fas fa-fw ${it.state === 'running' ? 'fa-circle-notch fa-spin' : it.state === 'error' ? 'fa-exclamation-circle' : 'fa-check'}"></span>
                  <span>${it.summary}</span>
                </div>`
          )}
          ${p?.thinking
            ? html`<div class="live-step thinking"><span class="fas fa-fw fa-ellipsis-h"></span> Thinking…</div>`
            : !items.length
              ? html`<div class="live-step thinking"><span class="fas fa-fw fa-ellipsis-h"></span> ${p ? 'Starting…' : 'Loading…'}</div>`
              : ''}
        </div>
      </div>
    `;
  }

  onLiveScroll(ev) {
    const el = ev.target;
    this.liveScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 24;
  }

  // The Job's history: its saved runs, newest first, with what each answered or why it failed. The
  // newest is open. It can be narrowed to failed runs or searched, and cleared.
  renderHistory(j) {
    const runs = this.runs || [];
    const failed = runs.filter((r) => r.status === 'error').length;
    const words = queryWords(this.runQuery || '');
    const shown = runs.filter(
      (r) =>
        (this.runFilter !== 'failed' || r.status === 'error') &&
        (!words.length || matchesWords(r.searchText || '', words))
    );
    const cleared = j.cleared?.at ? `History cleared ${ago(j.cleared.at)}.` : '';
    return html`
      <div class="history-head">
        <div class="label">History</div>
        ${runs.length
          ? html`<span class="count">${runs.length} ${runs.length === 1 ? 'run' : 'runs'}${failed ? html` · <span class="err">${failed} failed</span>` : ''}</span>`
          : ''}
        <span class="spacer"></span>
        ${runs.length > 1
          ? html`
              <input
                type="search"
                class="history-search"
                placeholder="Search history"
                aria-label="Search ${j.title}’s history"
                .value=${this.runQuery || ''}
                @input=${(ev) => (this.runQuery = ev.target.value)}
              />
              <div class="seg" role="group" aria-label="Show">
                <button class=${this.runFilter === 'failed' ? '' : 'on'} aria-pressed=${this.runFilter !== 'failed'} @click=${() => (this.runFilter = 'all')}>All</button>
                <button class=${this.runFilter === 'failed' ? 'on' : ''} aria-pressed=${this.runFilter === 'failed'} ?disabled=${!failed} @click=${() => (this.runFilter = 'failed')}>Failed</button>
              </div>
            `
          : ''}
        ${runs.length
          ? html`<button class="clear" title="Delete this Job’s saved runs on all your devices" @click=${() => this.onClearHistory(j)}>
              <span class="fas fa-fw fa-broom"></span> Clear history
            </button>`
          : ''}
      </div>
      ${runs.length === 0
        ? html`<div class="hint-row">
            ${cleared ? cleared + ' ' : ''}No runs yet. Click <span class="fas fa-play"></span> to run it now.
          </div>`
        : shown.length === 0
          ? html`<div class="hint-row">${this.runFilter === 'failed' && !words.length ? 'No failed runs.' : 'No runs match.'}</div>`
          : shown.map(
              (r) => html`
                <details class="run ${r.status === 'error' ? 'failed' : ''}" ?open=${r.id === runs[0].id || (words.length && shown.length <= 3)}>
                  <summary>
                    <span
                      class="fas fa-fw ${r.status === 'error' ? 'fa-exclamation-circle err' : r.stopped ? 'fa-stop-circle stopped' : 'fa-check-circle ok'}"
                      title=${r.status === 'error' ? 'Failed' : r.stopped ? 'You stopped it' : 'Done'}
                    ></span>
                    <span class="run-when">${new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span class="muted">· ${runMeta(r, j)}</span>
                    <span class="run-preview">${r.preview || ''}</span>
                  </summary>
                  ${r.error ? html`<div class="run-error"><span class="fas fa-fw fa-exclamation-triangle"></span> ${r.error}</div>` : ''}
                  ${r.output
                    ? html`<div class="output">${r.output}</div>`
                    : r.summary
                      ? html`<div class="output trimmed">${r.summary}</div>
                          <div class="hint-row">An older run: only the start of its answer is kept.</div>`
                      : r.stopped
                        ? html`<div class="hint-row">You stopped it before it answered.</div>`
                        : r.status !== 'error'
                          ? html`<div class="hint-row">No answer.</div>`
                          : ''}
                  ${r.chat
                    ? html`<div class="run-chat">
                        <button class="link" title="Open this run’s chat in the AI sidebar" @click=${() => this.onOpenRunChat(j, r)}>
                          <span class="fas fa-fw fa-comment-alt"></span> Open its chat
                        </button>
                      </div>`
                    : ''}
                  ${this.renderChanges(j, r)}
                  ${r.id === runs[0].id ? this.renderNeeds(j, r) : ''}
                </details>
              `
            )}
      ${runs.length
        ? html`<div class="hint-row">
            Keeps the last ${KEEP_HISTORY} runs, the newest ${KEEP_RUNS} with their whole answer. ${cleared}
          </div>`
        : ''}
    `;
  }

  // What a Job may change on its own, and the sites it may use.
  renderGrants(j) {
    const w = j.writes;
    if (!w) return '';
    const changes = w.notes || w.reader || w.newDrives || w.drives?.length;
    return html`
      ${changes ? this.renderChangeGrants(w) : ''}
      ${w.pages?.length
        ? html`<div class="label">Web pages</div>
            <ul class="grants">
              ${w.pages.map(
                (p) => html`<li>
                  <span class="fas fa-fw ${p.control ? 'fa-mouse-pointer' : 'fa-globe'}"></span>
                  ${p.control ? 'Opens, clicks and types on' : 'Opens and reads'} <strong>${p.site}</strong>
                  ${p.actions?.length
                    ? html`<span class="muted">· may also ${p.actions.map((a) => a.label).join('; ')}</span>`
                    : ''}
                </li>`
              )}
            </ul>`
        : ''}
    `;
  }

  renderChangeGrants(w) {
    return html`
      <div class="label">Can change</div>
      <ul class="grants">
        ${w.notes ? html`<li><span class="fas fa-fw fa-sticky-note"></span> Your Notes</li>` : ''}
        ${w.reader ? html`<li><span class="fas fa-fw fa-rss"></span> Your Reader (follow, unfollow, mark read)</li>` : ''}
        ${w.newDrives ? html`<li><span class="fas fa-fw fa-plus-square"></span> New drives it makes</li>` : ''}
        ${(w.drives || []).map(
          (d) => html`<li>
            <span class="fas fa-fw fa-hdd"></span>
            <a href=${d.url} target="_blank">${d.title || d.url}</a>
            ${d.draft ? html`<span class="muted">· in a Draft, for you to publish</span>` : ''}
          </li>`
        )}
      </ul>
    `;
  }

  // What the newest run wanted and wasn't given: sites to open or use, clicks to make. Run with me
  // asks for them.
  renderNeeds(j, r) {
    const needs = r.needs || [];
    if (!needs.length) return '';
    return html`<div class="needs">
      <div class="label">It wanted to</div>
      <ul>
        ${needs.map(
          (n) => html`<li>
            <span class="fas fa-fw ${n.control || n.action ? 'fa-mouse-pointer' : 'fa-globe'}"></span>
            ${n.action ? html`${n.action} on <strong>${n.site}</strong>` : html`${n.control ? 'click and type on' : 'open'} <strong>${n.site}</strong>`}
          </li>`
        )}
      </ul>
      <div class="hint-row">
        It runs with nobody watching, so it can only use what you allowed.
        <button class="link" ?disabled=${j.running} @click=${() => this.onRun(j, true)}>Run it with me</button>
        to watch it and allow these.
      </div>
    </div>`;
  }

  // What a run changed: drives it made, files it wrote, and Notes and Reader changes.
  renderChanges(j, r) {
    const changes = r.changes || [];
    if (!changes.length) return '';
    // A drive the run made has its title in the change that made it.
    const title = (url) =>
      (j.writes?.drives || []).find((d) => d.url === url)?.title ||
      changes.find((c) => c.tool === 'createDrive' && c.drive === url)?.title ||
      '';
    return html`<div class="changes">
      <div class="label">Changed</div>
      <ul>
        ${changes.map((c) =>
          c.path
            ? html`<li>
                <span class="fas fa-fw fa-file-alt"></span>
                <a href=${c.drive.replace(/\/$/, '') + c.path} target="_blank">${c.path}</a>
                <span class="muted">in ${title(c.drive) || c.drive}${c.draft ? ' (Draft)' : ''}</span>
              </li>`
            : c.drive
              ? html`<li>
                  <span class="fas fa-fw fa-hdd"></span>
                  <a href=${c.drive} target="_blank">${c.summary || c.drive}</a>
                </li>`
              : html`<li><span class="fas fa-fw fa-pen"></span> ${c.summary || c.tool}</li>`
        )}
      </ul>
    </div>`;
  }

  // The secrets this Job may use on this computer. They're granted on the secret, in Secrets.
  renderSecrets(j) {
    if (!j.here) return '';
    const mine = (this.secrets || []).filter((s) => (s.jobs || []).includes(j.id));
    return html`<div class="label">Secrets</div>
      <div class="hint-row">
        ${mine.length
          ? html`It can use ${mine.map((s, i) => html`${i ? ', ' : ''}<code>${s.name}</code>`)} for requests to their sites.`
          : 'It uses no secrets.'}
        <a href="/secrets">${mine.length ? 'Change in Secrets' : 'Let it use one in Secrets'}</a>
      </div>`;
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

        ${this.renderWrites(e, set)}
        ${this.renderPages(e, set)}

        <div class="block">
          <div class="label">${e.audience === 'space' && e.sharedSpaceName ? 'Notify' : 'Notify my phone'}</div>
          <select .value=${e.notify} @change=${(ev) => set({ notify: ev.target.value })}>
            ${NOTIFY.map((n) => html`<option value=${n.id} ?selected=${e.notify === n.id}>${n.label}</option>`)}
          </select>
          ${e.notify === 'auto'
            ? html`<div class="hint-row">Say in the prompt when you want to hear, like “notify me only if Ada posted”.</div>`
            : ''}
          ${e.sharedSpaceName && e.notify !== 'never'
            ? html`
                <div class="audience">
                  <label class="check">
                    <input
                      type="checkbox"
                      .checked=${e.audience === 'space'}
                      @change=${(ev) => set({ audience: ev.target.checked ? 'space' : 'me' })}
                    />
                    Everyone in ${e.sharedSpaceName}
                  </label>
                  <div class="hint-row">
                    ${e.audience === 'space'
                      ? html`Each person’s phone shows what this Job sends, like “bins go out tonight”. Keep your private notes out of it: they’ll see whatever it says.`
                      : html`Send its notifications to the phones of everyone in ${e.sharedSpaceName}, not only yours.`}
                  </div>
                </div>
              `
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

  // The editor's "What it can change" block: Notes, Reader, and drives the Job may write.
  renderWrites(e, set) {
    const add = () => {
      const url = e.addDrive.trim();
      if (!url) return;
      if (e.drives.some((d) => d.url === url)) return set({ addDrive: '' });
      set({ drives: [...e.drives, { url, title: '', draft: true }], addDrive: '' });
    };
    const put = (i, patch) => set({ drives: e.drives.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
    return html`
      <div class="block">
        <div class="label">What it can change <span class="hint">It runs with nobody to ask, so it can change only what you tick here. It can always read your Notes and Reader.</span></div>
        <div class="grant-checks">
          <label class="check">
            <input type="checkbox" .checked=${e.notes} @change=${(ev) => set({ notes: ev.target.checked })} />
            Write my Notes
          </label>
          <label class="check">
            <input type="checkbox" .checked=${e.reader} @change=${(ev) => set({ reader: ev.target.checked })} />
            Change my Reader (follow, unfollow, mark read)
          </label>
          <label class="check">
            <input type="checkbox" .checked=${e.newDrives} @change=${(ev) => set({ newDrives: ev.target.checked })} />
            Make new drives
          </label>
        </div>
        ${e.drives.length
          ? html`<ul class="grant-drives">
              ${e.drives.map(
                (d, i) => html`<li>
                  <span class="fas fa-fw fa-hdd"></span>
                  <span class="drive-name" title=${d.url}>${d.title || d.url}</span>
                  <label class="check">
                    <input type="checkbox" .checked=${d.draft} @change=${(ev) => put(i, { draft: ev.target.checked })} />
                    Stage in a Draft
                  </label>
                  <button type="button" class="icon" title="Remove" aria-label="Stop letting it write ${d.title || d.url}" @click=${() => set({ drives: e.drives.filter((_, k) => k !== i) })}>
                    <span class="fas fa-fw fa-times"></span>
                  </button>
                </li>`
              )}
            </ul>`
          : ''}
        <div class="when sub">
          <input
            class="add-drive"
            placeholder="A drive it may write: hyper://… or one of your drive names"
            .value=${e.addDrive}
            @input=${(ev) => set({ addDrive: ev.target.value })}
            @keydown=${(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                add();
              }
            }}
          />
          <button type="button" @click=${add} ?disabled=${!e.addDrive.trim()}>Add drive</button>
        </div>
        ${e.drives.some((d) => d.draft)
          ? html`<div class="hint-row">With “Stage in a Draft”, its changes wait in the drive’s Draft until you publish them.</div>`
          : e.drives.length
            ? html`<div class="hint-row">Its changes go live in the drive right away.</div>`
            : ''}
      </div>
    `;
  }

  // The editor's "Web pages" block (ADR-0038): sites it may open signed in as the user, and where it
  // may click and type too. Run with me adds them as the Job asks.
  renderPages(e, set) {
    const add = () => {
      const site = e.addSite.trim();
      if (!site) return;
      if (e.pages.some((p) => p.site === site)) return set({ addSite: '' });
      set({ pages: [...e.pages, { site, control: false, actions: [] }], addSite: '' });
    };
    const put = (i, patch) => set({ pages: e.pages.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
    return html`
      <div class="block">
        <div class="label">Web pages <span class="hint">Sites it may open in a page of its own, signed in as you. Easiest: save it, then run it with you (<span class="fas fa-eye"></span>) and allow each site as it asks.</span></div>
        ${e.pages.length
          ? html`<ul class="grant-drives grant-pages">
              ${e.pages.map(
                (p, i) => html`<li>
                  <span class="fas fa-fw ${p.control ? 'fa-mouse-pointer' : 'fa-globe'}"></span>
                  <span class="drive-name" title=${p.site}>${p.site}</span>
                  <label class="check">
                    <input type="checkbox" .checked=${p.control} @change=${(ev) => put(i, { control: ev.target.checked, ...(ev.target.checked ? {} : { actions: [] }) })} />
                    Click and type
                  </label>
                  <button type="button" class="icon" title="Remove" aria-label="Stop letting it open ${p.site}" @click=${() => set({ pages: e.pages.filter((_, k) => k !== i) })}>
                    <span class="fas fa-fw fa-times"></span>
                  </button>
                  ${p.actions?.length
                    ? html`<ul class="page-actions">
                        ${p.actions.map(
                          (a, k) => html`<li>
                            <span class="muted">May also</span> ${a.label}
                            <button type="button" class="icon" title="Remove" aria-label="Stop letting it ${a.label}" @click=${() => put(i, { actions: p.actions.filter((_, x) => x !== k) })}>
                              <span class="fas fa-fw fa-times"></span>
                            </button>
                          </li>`
                        )}
                      </ul>`
                    : ''}
                </li>`
              )}
            </ul>`
          : ''}
        <div class="when sub">
          <input
            class="add-drive"
            placeholder="A site it may open: example.com"
            .value=${e.addSite}
            @input=${(ev) => set({ addSite: ev.target.value })}
            @keydown=${(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                add();
              }
            }}
          />
          <button type="button" @click=${add} ?disabled=${!e.addSite.trim()}>Add site</button>
        </div>
        ${e.pages.some((p) => p.control)
          ? html`<div class="hint-row">It never types passwords or card numbers. A click that buys, sends, posts or deletes waits for you, unless you allowed one like it on a run you watched.</div>`
          : ''}
      </div>
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
      drives: (j.writes?.drives || []).map((d) => ({ url: d.url, title: d.title || '', draft: !!d.draft })),
      notes: !!j.writes?.notes,
      reader: !!j.writes?.reader,
      newDrives: !!j.writes?.newDrives,
      pages: (j.writes?.pages || []).map((p) => ({ site: p.site, control: !!p.control, actions: p.actions || [] })),
      notify: j.notify,
      audience: j.audience === 'space' ? 'space' : 'me',
      sharedSpaceName: j.sharedSpaceName || null,
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
    this.editing = { ...blank(), sharedSpaceName: this.sharedSpace?.name || null, at: localInput(new Date(Date.now() + 3600e3)) };
  }

  async onOpen(j) {
    if (this.editing?.id === j.id) return;
    this.openId = this.openId === j.id ? null : j.id;
    this.runs = [];
    this.runFilter = 'all';
    this.runQuery = '';
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
        writes:
          e.notes || e.reader || e.newDrives || e.drives.length || e.pages.length
            ? {
                notes: e.notes,
                reader: e.reader,
                newDrives: e.newDrives,
                drives: e.drives.map((d) => ({ url: d.url, draft: d.draft })),
                pages: e.pages,
              }
            : null,
        schedule: this.schedule(e),
        notify: e.notify,
        ...(e.sharedSpaceName ? { audience: e.audience } : {}),
      });
      this.editing = null;
      this.openId = rec.id;
      await this.load();
      toast.create(e.id ? `Saved “${rec.title}”` : `Created “${rec.title}”`, 'success');
    } catch (err) {
      this.editing = { ...e, error: cleanError(err) };
    }
  }

  // `watch`: Run with me. Its page opens in a tab of this window, its chat in the window's AI
  // sidebar, and each site it reaches asks.
  async onRun(j, watch = false) {
    try {
      await nomad.vault.runJob(j.id, watch ? { watch: true } : undefined);
      if (this.openId !== j.id) await this.onOpen(j);
      // Its play button turns into Stop, and its progress shows here.
      await this.load();
      toast.create(
        watch
          ? `Running “${j.title}” with you: its page opens in a tab, and its chat in the AI sidebar`
          : `Running “${j.title}”…`
      );
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  // Stop the run going on now (or the one waiting to start). Its chat says it was stopped, and its
  // record keeps what it had written by then.
  async onStop(j) {
    this.stopping = new Set([...this.stopping, j.id]);
    try {
      const stopped = await nomad.vault.stopJob(j.id);
      if (!stopped) toast.create(`“${j.title}” isn’t running anymore`);
      else if (!j.running) toast.create(`“${j.title}” won’t run`);
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
    await this.load();
  }

  // A run going on now: its chat opens in this window's AI sidebar, and its page comes to the front
  // (a run nobody watched shows its page in a window of its own).
  async onWatch(j) {
    try {
      const shown = await nomad.vault.viewJob(j.id);
      if (!shown?.running) toast.create(`“${j.title}” isn’t running anymore`);
      else if (!shown.chat) toast.create('Couldn’t open the run’s chat here', 'error');
    } catch (err) {
      toast.create(cleanError(err), 'error');
    }
  }

  // A run someone watched: its chat, in this window's AI sidebar.
  async onOpenRunChat(j, r) {
    try {
      await nomad.vault.viewJob(j.id, { chat: r.chat });
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

  async onClearHistory(j) {
    const n = (this.runs || []).length;
    if (!confirm(`Clear the history of “${j.title}”? Its ${n} saved ${n === 1 ? 'run goes' : 'runs go'} from all your devices. The Job stays.`)) return;
    try {
      const gone = await nomad.vault.clearJobRuns(j.id);
      this.runs = [];
      this.runFilter = 'all';
      this.runQuery = '';
      await this.load();
      toast.create(`Cleared ${gone} ${gone === 1 ? 'run' : 'runs'} of “${j.title}”`, 'success');
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

// How a run went, after its time: by hand or on schedule, how long it took, where, and whether it
// notified.
function runMeta(r, j) {
  const parts = [r.trigger === 'manual' ? 'by hand' : 'on schedule'];
  if (r.stopped) parts.push('stopped');
  if (r.took) parts.push(`took ${r.took}`);
  if (r.deviceName && r.deviceName !== j.deviceName) parts.push(`on ${r.deviceName}`);
  if (r.notification) parts.push('notified');
  return parts.join(' · ');
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
