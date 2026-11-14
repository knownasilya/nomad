// `ai` (and `?`): the user's own assistant, asked from the terminal. It is the AI Sidebar's turn
// (bg/web-apis/bg/ai-shell.ts with `terminal`), about the drive and page under the terminal, so it
// reads and changes the drive with the same tools and permission prompts. The answer streams in
// as Markdown; the steps it takes show above it; Ctrl+C stops it. The terminal keeps one
// conversation until `ai -n`, and saves it with the sidebar's chats (`ai --open` opens it there).

import { LitElement, html } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { unsafeHTML } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/unsafe-html.js';
import markdownit from 'nomad://app-stdlib/vendor/markdown-it.js';
import { friendlyError } from '../lib/errors.js';

const icon = (name, regular = false) =>
  html`<span class="${regular ? 'far' : 'fas'} fa-${name}" aria-hidden="true"></span>`;

const md = markdownit({ html: false, linkify: true, breaks: false });
const escAttr = (s) => md.utils.escapeHtml(String(s));

// A shell block gets a button that puts it in the prompt (lines joined with &&); every block can
// be copied. Both are buttons the terminal's click handler knows (data-fill, data-copy).
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const code = t.content;
  const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
  const runnable = ['', 'sh', 'bash', 'shell', 'console', 'zsh', 'terminal'].includes(lang);
  const lines = code
    .split('\n')
    .map((l) => l.replace(/^\s*\$\s+/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
  const fill = lines.join(' && ');
  const tools =
    (runnable && fill && fill.length < 2000
      ? `<button class="icon-btn small" data-fill="${escAttr(fill)}" title="Put it in the prompt" aria-label="Put it in the prompt"><span class="fas fa-terminal" aria-hidden="true"></span></button>`
      : '') +
    `<button class="icon-btn small" data-copy="${escAttr(code)}" title="Copy" aria-label="Copy"><span class="far fa-copy" aria-hidden="true"></span></button>`;
  return `<div class="fence"><div class="fence-tools">${tools}</div><pre><code>${md.utils.escapeHtml(code)}</code></pre></div>`;
};

export async function ai(opts = {}, question = '') {
  const a = this.term.ai;
  if (opts.open) {
    if (!a.id) throw new Error('No AI chat yet: ask something first, like ? what is in this drive');
    await nomad.aiChats.open(a.id);
    return html`<div class="notice"><span class="icon">${icon('check')}</span><span>Opened this chat in the AI sidebar</span></div>`;
  }
  if (opts.new) a.reset();
  const q = String(question || '').trim();
  if (!q) {
    if (opts.new) {
      return html`<div class="notice"><span class="icon">${icon('robot')}</span><span>Started a new AI chat</span></div>`;
    }
    const err = new Error('Ask what? ai {question}');
    err.tip = html`Try <a class="link" data-fill="? what does this site do">? what does this site do</a>`;
    throw err;
  }
  return a.ask(q, this);
}

export class TermAI {
  constructor(term) {
    this.term = term;
    this.reset();
  }

  reset() {
    this.id = null;
    this.messages = [];
    this.privateData = false;
    if (this.term) this.term.requestUpdate();
  }

  get active() {
    return this.messages.length > 0;
  }

  async ask(question, ctx) {
    // `api` can be set to stand in for nomad.aiTerminal (screenshots and tests).
    const api = this.api || nomad.aiTerminal;
    if (!api) throw new Error('The AI isn’t available in this window');
    const prefs = await api.getPrefs().catch(() => ({}));
    if (!this.id) this.id = await api.newSession().catch(() => null);

    // When the last command failed, the AI hears about it ("why did that fail?").
    let content = question;
    const last = ctx.term.lastRun();
    if (last && !last.ok && last.error && !/^(ai|\?)\s/.test(last.input)) {
      content = `${question}\n\n(The last command I ran in the terminal was \`${last.input}\`, and it failed: ${last.error})`;
    }
    const messages = [...this.messages, { role: 'user', content }];
    const view = document.createElement('term-ai-answer');
    ctx.out(view);

    const iterator = api.chat(
      messages.map((m) => ({ role: m.role, content: m.content })),
      {
        model: prefs.model || undefined,
        think: prefs.think,
        cwd: ctx.term.cwd(),
        chatId: this.id || undefined,
        privateData: this.privateData,
        onToolEvent: (e) => {
          if (e && e.phase === 'private') this.privateData = true;
          view.tool(e);
        },
        onReasoning: () => view.think(),
      }
    );
    const stop = () => iterator.return && iterator.return();
    const signal = ctx.term.signal;
    if (signal) signal.addEventListener('abort', stop);
    let text = '';
    try {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) break;
        text += value;
        view.write(text);
      }
      if (signal && signal.aborted) view.finish('stopped');
      else view.finish('done');
    } catch (err) {
      if (signal && signal.aborted) {
        view.finish('stopped');
      } else {
        view.fail(err);
        err.shown = true;
        throw err;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', stop);
    }
    this.messages = [...messages, { role: 'assistant', content: text || (signal && signal.aborted ? '_Stopped._' : ''), steps: view.savedSteps() }];
    this.term.requestUpdate();
    const first = this.messages.find((m) => m.role === 'user');
    api.saveSession(this.id, { title: first ? first.content.trim().slice(0, 60) : '', messages: this.messages }).catch(() => {});
    return undefined;
  }
}

// One answer: the steps, then the text, rendered in the terminal's own styles (light DOM).
class TermAiAnswer extends LitElement {
  static get properties() {
    return { status: { type: String } };
  }

  constructor() {
    super();
    this.status = 'thinking'; // thinking | writing | done | stopped | error
    this.text = '';
    this.steps = [];
    this.error = null;
    this._raf = 0;
  }

  createRenderRoot() {
    return this;
  }

  think() {
    if (this.status === 'thinking') this.requestUpdate();
  }

  write(text) {
    this.text = text;
    this.status = 'writing';
    this.steps = this.steps.map((s) => (s.done ? s : { ...s, done: true }));
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        // The terminal keeps the newest output in view.
        this.requestUpdate();
        this.updateComplete.then(() => {
          const host = this.getRootNode()?.host;
          if (host && host.stick) host.updated();
        });
      });
    }
  }

  tool(e) {
    if (!e) return;
    if (e.phase === 'start' || e.phase === 'note') {
      this.steps = [
        ...this.steps.map((s) => (s.id ? s : { ...s, done: true })),
        { id: e.phase === 'start' ? e.id : null, label: String(e.summary || e.name || 'Working…').slice(0, 200), done: e.phase === 'note' },
      ];
    } else if (e.phase === 'end') {
      this.steps = this.steps.map((s) => (s.id && s.id === e.id ? { ...s, done: true, failed: !!e.error } : s));
    } else if (e.phase === 'detail' && e.summary) {
      this.steps = this.steps.map((s) => (s.id && s.id === e.id ? { ...s, label: String(e.summary) } : s));
    } else if (e.phase === 'write' && e.path) {
      // The step that wrote it ("Writing /app.js") keeps the file, for diff after the answer.
      const where = e.drive ? String(e.drive).replace(/\/$/, '') + e.path : e.path;
      const last = this.steps[this.steps.length - 1];
      const wrote = { wrote: e.path, where, ...(e.draft ? { label: `${last ? last.label : 'Wrote ' + e.path} (in its Draft)` } : {}) };
      this.steps = last && !last.wrote ? [...this.steps.slice(0, -1), { ...last, ...wrote }] : [...this.steps, { label: `Wrote ${e.path}`, done: true, ...wrote }];
    } else {
      return;
    }
    this.requestUpdate();
  }

  finish(status) {
    this.status = status;
    this.steps = this.steps.map((s) => ({ ...s, done: true }));
    this.requestUpdate();
  }

  fail(err) {
    this.error = friendlyError(err);
    this.finish('error');
  }

  savedSteps() {
    return this.steps.map((s) => ({ label: s.label, done: true, ...(s.failed ? { error: true } : {}) }));
  }

  render() {
    const running = this.status === 'thinking' || this.status === 'writing';
    const wrote = this.steps.filter((s) => s.wrote);
    return html`<div class="ai">
      <div class="who">${icon('robot')} AI ${running ? html`<span class="spinner" style="width: 10px; height: 10px"></span>` : ''}</div>
      ${this.steps.length
        ? html`<div class="steps">
            ${this.steps.map(
              (s) => html`<div class="step ${s.failed ? 'failed' : s.done ? 'done' : ''}">
                <span class="mark">${s.failed ? '✗' : s.done ? '✓' : html`<span class="spinner" style="width: 8px; height: 8px"></span>`}</span>
                <span>${s.label}</span>
              </div>`
            )}
          </div>`
        : ''}
      ${!this.text && this.status === 'thinking' ? html`<div class="thinking">Thinking…</div>` : ''}
      ${this.text ? html`<div class="md">${unsafeHTML(md.render(this.text))}</div>` : ''}
      ${this.status === 'stopped' ? html`<div class="faint">Stopped.</div>` : ''}
      ${this.error
        ? html`<div class="error" role="alert">
            <span class="icon">${icon('exclamation-triangle')}</span>
            <div>
              <div class="msg">${this.error.message}</div>
              ${this.error.tip ? html`<div class="tip">${this.error.tip}</div>` : ''}
            </div>
          </div>`
        : ''}
      ${wrote.length && this.status !== 'thinking' && this.status !== 'writing'
        ? html`<div class="faint">
            Changed ${wrote.length} file${wrote.length === 1 ? '' : 's'} ·
            ${wrote.slice(0, 3).map((s, i) => html`${i ? ' · ' : ''}<a class="link" data-run=${'diff ' + s.where}>diff ${s.wrote}</a>`)}
          </div>`
        : ''}
    </div>`;
  }
}

customElements.define('term-ai-answer', TermAiAnswer);
