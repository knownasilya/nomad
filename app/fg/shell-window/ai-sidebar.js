import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import * as bg from './bg-process-rpc';
import { fromEventStream } from '../../bg/web-apis/fg/event-target';
import { streamToAsyncIterator } from '../../bg/web-apis/fg/ai-stream';
import { splitGenUi } from '../../lib/genui/segments.mjs';
import { mergeUserTurns } from '../../bg/ai/steering.mjs';
import './genui/index.js';

// Minimal markdown -> HTML (headings, lists, code fences, inline emphasis/code). Mirrors the
// renderer chat-bubble/ai-sidebar used before the two were unified into this component.
function mdToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    s
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const tokens = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code', code: codeLines.join('\n') });
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      tokens.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }
    if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      tokens.push({ type: 'list', items });
      continue;
    }
    if (line.trim() === '') {
      tokens.push({ type: 'blank' });
      i++;
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^[-*] /) &&
      !lines[i].match(/^#{1,3} /)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'para', lines: paraLines });
  }

  const parts = tokens.map((t) => {
    if (t.type === 'code') return `<pre><code>${esc(t.code)}</code></pre>`;
    if (t.type === 'heading') {
      const tag = `h${t.level}`;
      return `<${tag}>${inline(esc(t.text))}</${tag}>`;
    }
    if (t.type === 'list')
      return `<ul>${t.items.map((s) => `<li>${inline(esc(s))}</li>`).join('')}</ul>`;
    if (t.type === 'para') return `<p>${t.lines.map((l) => inline(esc(l))).join('<br>')}</p>`;
    return '';
  });
  return parts.join('') || `<p>${inline(esc(text))}</p>`;
}

// Puts text on the clipboard. Falls back to a selected textarea + execCommand('copy') if the
// async Clipboard API is refused (as app-stdlib/js/clipboard.js does).
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// "3:41 PM" today, "Yesterday", "Monday" this week, then "Oct 12" (or "Oct 12, 2025").
function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

class ShellWindowAiSidebar extends LitElement {
  static get properties() {
    return {
      activeTab: { type: Object },
      width: { type: Number },
      // Room to leave on the header's right for the in-app window controls (Windows), in px.
      headerInset: { type: Number },
      messages: { type: Array },
      draft: { type: String },
      streaming: { type: Boolean },
      sessionId: { type: String },
      _activity: { state: true },
      _model: { state: true },
      _think: { state: true },
      _effort: { state: true },
      _reasoningModel: { state: true },
      _visionModel: { state: true },
      _models: { state: true },
      _tools: { state: true },
      _toolsOpen: { state: true },
      _sessions: { state: true },
      _sessionsOpen: { state: true },
      _copied: { state: true },
      _queued: { state: true },
    };
  }

  static styles = css`
    /* Colors come from the shell's tokens (assets/css/design-tokens.css). The few the shell has no
       token for are --ai-* variables here, with their dark values below. */
    :host {
      --ai-text: var(--text-color--input);
      --ai-text-muted: #6e6e78;
      --ai-accent: #2864dc;
      --ai-accent--hover: #1f55c0;
      --ai-surface: var(--bg-color--foreground);
      --ai-border: #e2e2e8;
      --ai-hover: rgba(0, 0, 0, 0.05);
      --ai-code-bg: rgba(0, 0, 0, 0.045);
      --ai-inline-code-bg: rgba(0, 0, 0, 0.065);
      --ai-success: #2f9a4c;
      --ai-warning: #9a6700;
      --ai-error-bg: #fdeeee;
      --ai-error-border: #f1c6c6;
      --ai-error-text: #a12121;

      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      box-sizing: border-box;
      background: var(--bg-color--background);
      border-left: 1px solid var(--border-color--navbar);
      color: var(--ai-text);
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      font-size: 13px;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --ai-text-muted: #9d9da6;
        --ai-accent: #3f7bf0;
        --ai-accent--hover: #5a8ff5;
        --ai-border: #3a3a3a;
        --ai-hover: rgba(255, 255, 255, 0.07);
        --ai-code-bg: rgba(255, 255, 255, 0.05);
        --ai-inline-code-bg: rgba(255, 255, 255, 0.1);
        --ai-success: #67bf6b;
        --ai-warning: #e0a94a;
        --ai-error-bg: #352121;
        --ai-error-border: #5e2a2a;
        --ai-error-text: #ffb4b4;
      }
    }

    button {
      font: inherit;
      color: inherit;
    }

    .resize-handle {
      position: absolute;
      left: -2px;
      top: 0;
      bottom: 0;
      width: 5px;
      cursor: ew-resize;
      z-index: 2;
      transition: background 0.15s;
    }
    .resize-handle:hover,
    .resize-handle:active {
      background: var(--highlight-color--tab--current, #005aff);
      opacity: 0.35;
    }

    /* Thin scrollbars in the chrome's colors, like the tab sidebar's. */
    .messages,
    .sessions,
    .tools-panel,
    .input {
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    /* — header: the navbar's height and colors, so the two read as one bar — */

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      height: 41px;
      padding: 0 6px 0 14px;
      background: var(--bg-color--foreground);
      border-bottom: 1px solid var(--border-color--navbar);
      flex-shrink: 0;
      -webkit-app-region: drag;
    }
    .title {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .title .fas {
      color: var(--ai-accent);
      font-size: 14px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      -webkit-app-region: no-drag;
    }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-color--navbar-btn);
      font-size: 13px;
      cursor: pointer;
      opacity: 0.75;
      transition:
        background 0.12s,
        opacity 0.12s;
    }
    .icon-btn:hover:not(:disabled) {
      opacity: 1;
      background: var(--ai-hover);
    }
    .icon-btn.pressed {
      opacity: 1;
      color: var(--ai-accent);
      background: var(--ai-hover);
    }
    .icon-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }
    button:focus-visible,
    .select:focus-visible,
    .chip:has(input:focus-visible) {
      outline: 2px solid var(--ai-accent);
      outline-offset: 1px;
    }

    /* — chat history — */

    .sessions {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .sessions-heading {
      padding: 6px 8px 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ai-text-muted);
    }
    .sessions-manage {
      padding: 2px 6px 8px;
    }

    .link-btn {
      background: none;
      border: 0;
      padding: 4px 6px;
      font: inherit;
      font-size: 12px;
      color: var(--text-color--link, #4040e7);
      cursor: pointer;
      border-radius: 4px;
    }

    .link-btn:hover {
      text-decoration: underline;
    }

    .link-btn .fas {
      font-size: 10px;
      margin-left: 2px;
    }

    .session-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 6px 8px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .session-row:hover {
      background: var(--ai-hover);
    }
    .session-row.current {
      background: var(--bg-color--tab--current);
      box-shadow: inset 2px 0 0 var(--highlight-color--tab--current, #005aff);
    }
    .session-row > .fas {
      color: var(--ai-text-muted);
      font-size: 12px;
    }
    .session-row .info {
      flex: 1;
      min-width: 0;
    }
    .session-row .session-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-row .session-time {
      margin-top: 1px;
      font-size: 11px;
      color: var(--ai-text-muted);
    }
    .session-row .icon-btn {
      opacity: 0;
      width: 26px;
      height: 26px;
      font-size: 12px;
    }
    .session-row:hover .icon-btn {
      opacity: 0.6;
    }
    .session-row .icon-btn:hover {
      opacity: 1;
    }

    /* — empty states — */

    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 24px 28px;
      text-align: center;
      color: var(--ai-text-muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .empty-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      margin-bottom: 6px;
      border-radius: 50%;
      background: var(--ai-surface);
      border: 1px solid var(--ai-border);
      color: var(--ai-accent);
      font-size: 18px;
    }
    .empty-title {
      color: var(--ai-text);
      font-size: 14px;
      font-weight: 600;
    }
    .empty-text {
      max-width: 260px;
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      width: 100%;
      max-width: 260px;
      margin-top: 14px;
    }
    .suggestion {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--ai-border);
      border-radius: 8px;
      background: var(--ai-surface);
      color: var(--ai-text);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: border-color 0.12s;
    }
    .suggestion:hover {
      border-color: var(--ai-accent);
    }
    .suggestion .fas {
      color: var(--ai-text-muted);
      width: 14px;
      text-align: center;
    }

    /* — the conversation — */

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 14px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .messages > * {
      flex-shrink: 0;
    }
    .msg {
      line-height: 1.55;
      word-break: break-word;
      white-space: normal;
    }
    .msg.user {
      align-self: flex-end;
      max-width: 85%;
      margin-top: 6px;
      padding: 8px 12px;
      border-radius: 14px 14px 4px 14px;
      background: var(--ai-accent);
      color: #fff;
      white-space: pre-wrap;
    }
    .msg.user:first-child {
      margin-top: 0;
    }
    /* The assistant's replies are plain text across the full width, which reads better than a
       bubble in a narrow sidebar. */
    .msg.assistant {
      align-self: stretch;
      padding: 0 2px;
    }
    .msg.error {
      display: flex;
      gap: 8px;
      align-self: stretch;
      padding: 9px 12px;
      border-radius: 8px;
      background: var(--ai-error-bg);
      border: 1px solid var(--ai-error-border);
      color: var(--ai-error-text);
    }
    .msg.error .fas {
      margin-top: 3px;
    }
    .msg.streaming > :last-child:not(nomad-genui)::after {
      content: '';
      display: inline-block;
      width: 7px;
      height: 14px;
      margin-left: 2px;
      vertical-align: text-bottom;
      border-radius: 1px;
      background: var(--ai-accent);
      animation: blink 1s steps(2, start) infinite;
    }
    @keyframes blink {
      to {
        visibility: hidden;
      }
    }

    .msg.assistant p,
    .msg.assistant ul,
    .msg.assistant pre {
      margin: 0 0 10px;
    }
    .msg.assistant ul {
      padding-left: 20px;
    }
    .msg.assistant li {
      margin: 2px 0;
    }
    .msg.assistant li::marker {
      color: var(--ai-text-muted);
    }
    .msg.assistant h1,
    .msg.assistant h2,
    .msg.assistant h3 {
      margin: 14px 0 6px;
      line-height: 1.3;
      font-weight: 600;
    }
    .msg.assistant h1 {
      font-size: 16px;
    }
    .msg.assistant h2 {
      font-size: 15px;
    }
    .msg.assistant h3 {
      font-size: 14px;
    }
    .msg.assistant > *:first-child {
      margin-top: 0;
    }
    .msg.assistant > *:last-child {
      margin-bottom: 0;
    }
    .msg code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .msg.assistant code {
      background: var(--ai-inline-code-bg);
      border-radius: 4px;
      padding: 1px 5px;
    }
    .msg.assistant pre {
      background: var(--ai-code-bg);
      border: 1px solid var(--ai-border);
      border-radius: 8px;
      padding: 10px 12px;
      overflow-x: auto;
      line-height: 1.45;
    }
    .msg.assistant pre code {
      background: none;
      padding: 0;
    }

    /* Tool calls while the reply hasn't started yet. */
    .activity {
      align-self: stretch;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 2px;
      font-size: 12px;
      color: var(--ai-text-muted);
    }
    .activity-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .activity-item.active {
      color: var(--ai-text);
    }
    .activity-item .fa-spinner {
      color: var(--ai-accent);
    }
    .activity-item .fa-check {
      color: var(--ai-success);
    }
    .activity-item .fa-exclamation-circle {
      color: var(--ai-error-text);
    }

    .reasoning {
      align-self: stretch;
      font-size: 12px;
      color: var(--ai-text-muted);
    }
    .reasoning summary {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px 3px 6px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      list-style: none;
    }
    .reasoning summary::-webkit-details-marker {
      display: none;
    }
    .reasoning summary:hover {
      background: var(--ai-hover);
      color: var(--ai-text);
    }
    .reasoning summary .fa-chevron-right {
      font-size: 9px;
      transition: transform 0.15s;
    }
    .reasoning[open] summary .fa-chevron-right {
      transform: rotate(90deg);
    }
    .reasoning .body {
      white-space: pre-wrap;
      margin: 6px 0 2px 10px;
      padding-left: 10px;
      border-left: 2px solid var(--ai-border);
      line-height: 1.5;
    }

    .screenshots {
      align-self: flex-start;
      max-width: 90%;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .screenshot {
      display: block;
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--ai-border);
      cursor: zoom-in;
    }

    /* A turn's edits, with Revert. */
    .checkpoint {
      align-self: stretch;
      border: 1px solid var(--ai-border);
      border-radius: 8px;
      background: var(--ai-surface);
      font-size: 12px;
      overflow: hidden;
    }
    .checkpoint.reverted {
      opacity: 0.6;
    }
    .checkpoint-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 6px 6px 10px;
      border-bottom: 1px solid var(--ai-border);
      color: var(--ai-text-muted);
    }
    .checkpoint-header .label {
      flex: 1;
      font-weight: 600;
    }
    .checkpoint-files {
      padding: 4px 0;
    }
    .checkpoint-file {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 3px 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .checkpoint-file .fas {
      flex: none;
      font-size: 10px;
    }
    .checkpoint-file .fa-plus {
      color: var(--ai-success);
    }
    .checkpoint-file .fa-pen {
      color: var(--ai-warning);
    }
    .checkpoint-file .path {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .checkpoint-drive {
      color: var(--ai-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .revert-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: transparent;
      border: 1px solid var(--ai-border);
      border-radius: 6px;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
      color: var(--ai-text);
    }
    .revert-btn:hover:not(:disabled) {
      background: var(--ai-hover);
    }
    .revert-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .reverted-label {
      font-style: italic;
      padding-right: 4px;
    }

    /* Per-message actions (Copy) under a message: quiet until the message is hovered, except on
       the latest answer and right after a click. */
    .msg-actions {
      display: flex;
      gap: 2px;
      margin: -8px 0 -4px;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .msg-actions.user {
      align-self: flex-end;
    }
    .msg-actions.assistant,
    .msg-actions.error {
      align-self: flex-start;
      margin-left: -4px;
    }
    .msg:hover + .msg-actions,
    .msg-actions:hover,
    .msg-actions:focus-within,
    .msg-actions.latest,
    .msg-actions.copied {
      opacity: 1;
    }
    .msg-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 24px;
      min-width: 24px;
      padding: 0 7px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ai-text-muted);
      font-size: 11px;
      cursor: pointer;
    }
    .msg-action:hover {
      background: var(--ai-hover);
      color: var(--ai-text);
    }
    .msg-actions.copied .msg-action {
      color: var(--ai-success);
    }

    /* A message sent while the assistant works, waiting for its next step. */
    .msg.user.queued {
      background: transparent;
      color: var(--ai-text);
      border: 1px dashed var(--ai-accent);
    }
    .queued-note {
      align-self: flex-end;
      display: flex;
      align-items: center;
      gap: 4px;
      margin: -6px 0 -2px;
      color: var(--ai-text-muted);
      font-size: 11px;
    }
    .queued-note .send-now {
      color: var(--ai-accent);
      font-weight: 600;
    }
    .queued-note .send-now:hover {
      color: var(--ai-accent--hover);
    }

    /* — tools — */

    .tools-panel {
      margin: 8px 10px;
      padding: 10px 12px;
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid var(--ai-border);
      border-radius: 10px;
      background: var(--ai-surface);
      font-size: 12px;
      flex-shrink: 0;
    }
    .tools-panel h4 {
      margin: 10px 0 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ai-text-muted);
    }
    .tools-panel h4:first-child {
      margin-top: 0;
    }
    .tools-panel .tool {
      padding: 2px 0;
      line-height: 1.4;
    }
    .tools-panel .tool code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
    }
    .tools-panel .tool .d {
      color: var(--ai-text-muted);
    }
    .tools-panel .note {
      margin-top: 6px;
      color: var(--ai-warning);
    }
    .tools-panel a {
      display: inline-block;
      margin-top: 6px;
      color: var(--ai-accent);
      text-decoration: none;
    }
    .tools-panel a:hover {
      text-decoration: underline;
    }

    /* — composer: one card holding the input, its options and Send — */

    .composer {
      margin: 0 10px 10px;
      border: 1px solid var(--border-color--input);
      border-radius: 12px;
      background: var(--bg-color--input);
      flex-shrink: 0;
      transition:
        border-color 0.12s,
        box-shadow 0.12s;
    }
    .composer:focus-within {
      border-color: var(--border-color--input--focused);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--border-color--input--focused) 18%, transparent);
    }
    .input {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      max-height: 200px;
      resize: none;
      background: transparent;
      color: var(--ai-text);
      border: 0;
      padding: 11px 12px 4px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.45;
      outline: none;
    }
    .input::placeholder {
      color: var(--ai-text-muted);
    }
    .input:disabled {
      opacity: 0.6;
    }
    .composer-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px 6px 6px;
    }
    .options {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: wrap;
    }
    .select {
      appearance: none;
      max-width: 140px;
      height: 26px;
      padding: 0 20px 0 8px;
      border: 0;
      border-radius: 6px;
      background: transparent
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23888'/%3E%3C/svg%3E")
        no-repeat right 7px center;
      color: var(--ai-text-muted);
      font: inherit;
      font-size: 12px;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .select:hover:not(:disabled) {
      background-color: var(--ai-hover);
      color: var(--ai-text);
    }
    .select option {
      background: var(--bg-color--input);
      color: var(--ai-text);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ai-text-muted);
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    .chip input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .chip:hover {
      background: var(--ai-hover);
      color: var(--ai-text);
    }
    .chip.on,
    .chip:has(input:checked) {
      color: var(--ai-accent);
    }
    .chip:has(input:disabled),
    .select:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .send-btn {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--ai-accent);
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      transition:
        background 0.12s,
        opacity 0.12s;
    }
    .send-btn:hover:not(:disabled) {
      background: var(--ai-accent--hover);
    }
    .send-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .send-btn.stop-btn {
      background: var(--ai-text);
      color: var(--bg-color--input);
    }
    .stop-icon {
      width: 10px;
      height: 10px;
      background: currentColor;
      border-radius: 2px;
    }
  `;

  constructor() {
    super();
    this.activeTab = null;
    this.width = 380;
    this.headerInset = 0;
    this.messages = [];
    this.draft = '';
    this.streaming = false;
    this.sessionId = '';
    this._loadedTabUrl = undefined;
    // { url, writable } for the Drive the active tab is really about — resolved async via
    // _loadDriveInfo() since for nomad://editor/explorer it isn't derivable from activeTab.url
    // alone (that's the app's own URL, never the Drive it has open — see ai-shell.ts).
    this._driveUrl = null;
    this._driveWritable = false;
    // Drives this conversation already started a Draft for (see _send).
    this._draftDrives = new Set();
    this._activity = [];
    this._model = '';
    this._think = true;
    this._effort = '';
    this._reasoningModel = null;
    this._visionModel = false; // conservative default — never offer screenshots until confirmed
    // The user's own "this model can see images", per model id ('' is the Settings default).
    this._visionByModel = {};
    this._modelInfoCache = new Map();
    this._models = null;
    this._tools = null;
    this._toolsParamsKey = null;
    this._toolsOpen = false;
    this._sessions = [];
    this._sessionsOpen = false;
    // Messages sent while a turn runs, waiting for the assistant's next step: { id, text }
    // (bg/ai/steering.mjs). _turnId names the running turn to bg.
    this._queued = [];
    this._turnId = null;
    // The assistant is the user's, not a tab's (ADR-0021): one conversation and one model choice,
    // whatever tab is open.
    this._loadModels();
    this._loadPrefs();
    // Resolves once the last chat is loaded, so openChat() from the AI page lands after it.
    this._sessionReady = this._loadSession();
  }

  // The AI page (nomad://ai/chats) opened a chat here: switch to it, or to a new chat for null.
  async openChat(sessionId) {
    await this._sessionReady;
    if (this.streaming) return;
    if (sessionId) await this._switchToSession(sessionId);
    else await this._newSession();
    this._sessionsOpen = false;
    this.requestUpdate();
  }

  // A chat was renamed or deleted on the AI page. A deleted chat that is open here starts a new one,
  // so the next save doesn't bring it back.
  async onChatsChanged(change = {}) {
    await this._sessionReady;
    if (change.deleted && change.deleted === this.sessionId && !this.streaming) {
      await this._newSession();
    }
    if (this._sessionsOpen) {
      try {
        this._sessions = await bg.aiShell.listSessions();
      } catch {
        this._sessions = [];
      }
    }
  }

  get _driveBase() {
    if (!this._driveUrl || !this._driveUrl.startsWith('hyper://')) return null;
    try {
      return new URL(this._driveUrl).origin;
    } catch {
      return null;
    }
  }

  get _writable() {
    return !!(this._driveBase && this._driveWritable);
  }

  updated(changedProperties) {
    this.style.width = `${this.width}px`;
    const tabUrl = this.activeTab?.url || '';
    if (tabUrl !== this._loadedTabUrl) {
      // A tab change doesn't touch the conversation or a running turn: the assistant can look at
      // the new tab with currentTab. Only the Drive info below follows the tab.
      this._loadedTabUrl = tabUrl;
      this._loadDriveInfo();
    }
    if (changedProperties.has('messages') || changedProperties.has('streaming')) {
      this._scrollToBottom();
    }
    if (changedProperties.has('draft')) this._autosize();
  }

  // Resolves _driveUrl/_driveWritable for the active tab. A plain hyper:// tab resolves locally;
  // nomad://editor and nomad://explorer ask the host app itself — see ai-shell.ts's
  // resolveActiveDrive, which this mirrors so the sidebar starts a Draft for the Drive the
  // backend sees.
  async _loadDriveInfo() {
    const tabUrl = this.activeTab?.url || '';
    let driveUrl = null;
    let writable = false;
    if (tabUrl.startsWith('nomad://editor') || tabUrl.startsWith('nomad://explorer')) {
      try {
        const info = await bg.aiShell.getActiveDriveInfo();
        driveUrl = info?.url || null;
        writable = !!info?.writable;
      } catch {
        /* leave null */
      }
    } else if (tabUrl.startsWith('hyper://')) {
      driveUrl = tabUrl;
      writable = !!this.activeTab?.writable;
    }
    if ((this.activeTab?.url || '') !== tabUrl) return; // tab changed again while we were loading
    this._driveUrl = driveUrl;
    this._driveWritable = writable;
  }

  // — preferences: one model/thinking/effort choice for the sidebar, saved on this device
  // (ADR-0021). It applies going forward, isn't reset by "New session" or reopening an older chat,
  // and isn't part of any session's data. —

  async _loadPrefs() {
    let prefs = null;
    try {
      prefs = await bg.aiShell.getPrefs();
    } catch {
      /* none saved yet */
    }
    this._model = prefs?.model || '';
    this._think = prefs?.think !== false;
    this._effort = prefs?.effort || '';
    this._visionByModel = prefs?.vision || {};
    // Vision: prefer a saved manual choice (needed on servers modelInfo can't probe, e.g. LM
    // Studio / llama.cpp — anything without Ollama's /api/show); _refreshModelInfo() below will
    // still override this with a confident auto-detected answer when the probe succeeds.
    this._visionModel = this._visionByModel[this._model] === true;
    this._refreshModelInfo();
  }

  async _savePrefs() {
    try {
      await bg.aiShell.savePrefs({
        model: this._model,
        think: this._think,
        effort: this._effort,
        vision: this._visionByModel,
      });
    } catch {
      /* non-fatal */
    }
  }

  // — session persistence (one list, hyper://private/.ai-chat/sessions/) —

  async _loadSession() {
    this.streaming = false;
    try {
      const lastId = await bg.aiShell.getLastSessionId();
      if (lastId) {
        const data = await bg.aiShell.loadSession(lastId);
        if (data) {
          this.sessionId = lastId;
          this.messages = data.messages || [];
          return;
        }
      }
    } catch {
      /* fall through to a fresh session */
    }
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
  }

  // Always takes explicit (sessionId, messages) rather than reading live state — a save triggered
  // from a turn must land on the session it belongs to (see _send()'s captured turnSessionId).
  async _saveSession(sessionId, messages) {
    if (!sessionId) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser ? firstUser.content.trim().slice(0, 60) : '';
    try {
      await bg.aiShell.saveSession(sessionId, { title, messages });
    } catch {
      /* non-fatal */
    }
  }

  async _newSession() {
    if (this.streaming) return;
    this.sessionId = await bg.aiShell.newSession();
    this.messages = [];
    this._draftDrives = new Set();
    this._sessionsOpen = false;
    this.requestUpdate();
  }

  async _toggleSessions() {
    this._sessionsOpen = !this._sessionsOpen;
    if (this._sessionsOpen) {
      try {
        this._sessions = await bg.aiShell.listSessions();
      } catch {
        this._sessions = [];
      }
    }
  }

  async _switchToSession(id) {
    if (this.streaming || id === this.sessionId) {
      this._sessionsOpen = false;
      return;
    }
    const data = await bg.aiShell.loadSession(id);
    if (!data) return;
    this.sessionId = id;
    this.messages = data.messages || [];
    this._draftDrives = new Set();
    this._sessionsOpen = false;
  }

  async _deleteSession(e, id) {
    e.stopPropagation();
    try {
      await bg.aiShell.deleteSession(id);
    } catch {
      /* non-fatal */
    }
    this._sessions = this._sessions.filter((s) => s.id !== id);
    if (id === this.sessionId) await this._newSession();
  }

  // — model / thinking / tools —

  async _loadModels() {
    if (!this._models) {
      try {
        const { models, labels } = await bg.aiShell.listModels();
        this._modelLabels = labels || {};
        this._models = models || [];
      } catch {
        this._models = [];
      }
    }
    this._refreshModelInfo();
  }

  // Vision is only ever set here when the probe actually confirms an answer (probed:true) —
  // otherwise this._visionModel is left as whatever the caller (a saved site pref, or a reset to
  // false on manual model change) already put there, since plenty of servers (LM Studio,
  // llama.cpp, anything without Ollama's /api/show) can't be probed at all and a wrong "no
  // vision" from a failed probe shouldn't stomp a preference the user set by hand.
  async _refreshModelInfo() {
    const m = this._model;
    if (!m) {
      this._reasoningModel = true;
      return;
    }
    if (this._modelInfoCache.has(m)) {
      const cached = this._modelInfoCache.get(m);
      this._reasoningModel = cached.reasoning;
      if (cached.probed) this._visionModel = cached.vision;
      return;
    }
    try {
      const info = await bg.aiShell.modelInfo(m);
      const cached = {
        reasoning: info?.reasoning !== false,
        vision: info?.vision === true,
        probed: !!info?.probed,
      };
      this._modelInfoCache.set(m, cached);
      if (this._model === m) {
        this._reasoningModel = cached.reasoning;
        if (cached.probed) this._visionModel = cached.vision;
      }
    } catch {
      this._reasoningModel = true;
    }
  }

  async _onModelChange(e) {
    this._model = e.target.value;
    // Vision is a per-model fact: start from the user's own choice for this model. If the new
    // model's probe is confident, _refreshModelInfo() below overrides it.
    this._visionModel = this._visionByModel[this._model] === true;
    // Awaited — saving prefs before the probe resolves would persist this reset-to-false instead
    // of whatever the (possibly async, possibly confident) probe determines a moment later.
    await this._refreshModelInfo();
    this._savePrefs();
  }

  _onThinkChange(e) {
    this._think = e.target.checked;
    this._savePrefs();
  }

  _onEffortChange(e) {
    this._effort = e.target.value;
    this._savePrefs();
  }

  _onVisionChange(e) {
    this._visionModel = e.target.checked;
    this._visionByModel = { ...this._visionByModel, [this._model]: this._visionModel };
    this._savePrefs();
  }

  async _toggleTools() {
    this._toolsOpen = !this._toolsOpen;
    // Re-fetch not just on first open but whenever what would be offered has actually changed
    // (switching models can flip vision support; navigating can flip writability) — otherwise a
    // panel opened once early keeps showing a stale list for the rest of the tab's lifetime.
    const params = { allowVision: this._visionModel === true };
    const paramsKey = JSON.stringify(params);
    if (this._toolsOpen && (!this._tools || this._toolsParamsKey !== paramsKey)) {
      try {
        this._tools = await bg.aiShell.listTools(params);
        this._toolsParamsKey = paramsKey;
      } catch {
        this._tools = { builtin: [], page: [] };
      }
    }
  }

  _openInspector() {
    let origin = '';
    try {
      origin = new URL(this.activeTab?.url || '').origin;
    } catch {
      /* no tab */
    }
    bg.views.createTab('nomad://webmcp?origin=' + encodeURIComponent(origin), {
      setActive: true,
    });
  }

  // — resize (mirrors shell-window-sidebar's drag handle) —

  _onResizeMousedown(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.width;
    const onMove = (ev) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW - (ev.clientX - startX)));
      this.width = w;
      bg.views.setAiSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      bg.beakerBrowser.setSetting('ai_sidebar_width', String(this.width));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // — render —

  render() {
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="resize-handle" @mousedown=${this._onResizeMousedown}></div>
      <div class="header" style=${this.headerInset ? `padding-right: ${this.headerInset}px` : ''}>
        <span class="title">
          ${this._sessionsOpen
            ? html`<span class="fas fa-fw fa-history"></span> Chat history`
            : html`<span class="fas fa-fw fa-robot"></span> AI`}
        </span>
        <span class="header-actions">
          <button
            class="icon-btn ${this._sessionsOpen ? 'pressed' : ''}"
            title="Chat history"
            @click=${this._toggleSessions}
          >
            <span class="fas fa-fw fa-history"></span>
          </button>
          <button
            class="icon-btn"
            title="New chat"
            @click=${this._newSession}
            ?disabled=${this.streaming}
          >
            <span class="fas fa-fw fa-plus"></span>
          </button>
          <button
            class="icon-btn"
            title="Close"
            @click=${() => bg.views.toggleAiSidebarOpen('active')}
          >
            <span class="fas fa-fw fa-times"></span>
          </button>
        </span>
      </div>
      ${!this.activeTab
        ? html`<div class="empty">No active tab</div>`
        : this._sessionsOpen
          ? this._renderSessions()
          : this._renderChat()}
    `;
  }

  _renderSessions() {
    if (!this._sessions.length) {
      return html`<div class="empty">
        <div class="empty-icon"><span class="fas fa-history"></span></div>
        <div class="empty-title">No past chats yet</div>
        <div class="empty-text">Your conversations with the assistant show up here.</div>
      </div>`;
    }
    return html`
      <div class="sessions">
        <div class="sessions-manage">
          <button class="link-btn" @click=${() => bg.views.createTab('nomad://ai/chats', { setActive: true })}>
            Search, rename and manage chats on the AI page
            <span class="fas fa-fw fa-external-link-alt"></span>
          </button>
        </div>
        ${this._sessions.map(
          (s) => html`
            <div
              class="session-row ${s.id === this.sessionId ? 'current' : ''}"
              @click=${() => this._switchToSession(s.id)}
            >
              <span class="fas fa-fw fa-comment-alt"></span>
              <div class="info">
                <div class="session-title">${s.title || 'New chat'}</div>
                <div class="session-time">${s.updatedAt ? formatTime(s.updatedAt) : ''}</div>
              </div>
              <button class="icon-btn" title="Delete" @click=${(e) => this._deleteSession(e, s.id)}>
                <span class="fas fa-fw fa-trash-alt"></span>
              </button>
            </div>
          `
        )}
      </div>
    `;
  }

  _renderChat() {
    const canThink = this._think && this._reasoningModel !== false;
    return html`
      ${this.messages.length === 0
        ? this._renderEmpty()
        : html`<div class="messages">
            ${this.messages.map((m, i) => this._renderMessage(m, i))}
            ${this.streaming && !(this.messages[this.messages.length - 1]?.content || '').trim()
              ? this._renderActivity()
              : ''}
            ${this._queued.map((q) => this._renderQueued(q))}
          </div>`}
      ${this._toolsOpen ? this._renderTools() : ''}
      <div class="composer">
        <textarea
          class="input"
          rows="1"
          .value=${this.draft}
          placeholder=${this.streaming
            ? 'Steer the assistant while it works…'
            : 'Ask about this tab, or anything…'}
          @input=${this._onInput}
          @keydown=${this._onKeydown}
        ></textarea>
        <div class="composer-bar">
          <div class="options">
            <select
              class="select"
              title="Model"
              .value=${this._model}
              @change=${this._onModelChange}
              ?disabled=${this.streaming}
            >
              <option value="">Default model</option>
              ${[...new Set([...(this._models || []), ...(this._model ? [this._model] : [])])].map(
                (m) =>
                  html`<option value=${m} ?selected=${m === this._model}>
                    ${this._modelLabels?.[m] || m}
                  </option>`
              )}
            </select>
            <label
              class="chip"
              title="Let the model show its reasoning; turn off to ask it to skip thinking"
            >
              <input
                type="checkbox"
                .checked=${this._think}
                @change=${this._onThinkChange}
                ?disabled=${this.streaming}
              />
              <span class="fas fa-fw fa-lightbulb"></span>
              ${canThink ? '' : 'Think'}
            </label>
            ${canThink
              ? html`<select
                  class="select"
                  title="Reasoning effort"
                  .value=${this._effort}
                  @change=${this._onEffortChange}
                  ?disabled=${this.streaming}
                >
                  <option value="">Effort</option>
                  <option value="low" ?selected=${this._effort === 'low'}>Low</option>
                  <option value="medium" ?selected=${this._effort === 'medium'}>Medium</option>
                  <option value="high" ?selected=${this._effort === 'high'}>High</option>
                </select>`
              : ''}
            <label
              class="chip"
              title="Vision: offer the screenshot tool for this model. Auto-detected on servers that support it (Ollama); switch on by hand elsewhere if your model supports image input."
            >
              <input
                type="checkbox"
                .checked=${this._visionModel === true}
                @change=${this._onVisionChange}
                ?disabled=${this.streaming}
              />
              <span class="fas fa-fw fa-eye"></span>
            </label>
            <button
              class="chip ${this._toolsOpen ? 'on' : ''}"
              title=${this._toolsOpen ? 'Hide tools' : 'Show the tools the assistant can use'}
              @click=${this._toggleTools}
            >
              <span class="fas fa-fw fa-wrench"></span>
            </button>
          </div>
          ${this.streaming
            ? html`<button class="send-btn stop-btn" @click=${this._stop} title="Stop">
                <span class="stop-icon"></span>
              </button>`
            : ''}
          ${!this.streaming || this.draft.trim()
            ? html`<button
                class="send-btn"
                title=${this.streaming
                  ? 'Send now (Enter). The assistant reads it at its next step.'
                  : 'Send (Enter)'}
                @click=${this._send}
                ?disabled=${!this.draft.trim()}
              >
                <span class="fas fa-arrow-up"></span>
              </button>`
            : ''}
        </div>
      </div>
    `;
  }

  _renderEmpty() {
    const suggestions = [
      ['fa-align-left', 'Summarize this page'],
      ['fa-question', 'What can you do?'],
      ['fa-pen', 'Help me edit this drive'],
    ];
    return html`<div class="empty">
      <div class="empty-icon"><span class="fas fa-robot"></span></div>
      <div class="empty-title">How can I help?</div>
      <div class="empty-text">
        The assistant can see the tab you're on and work with any drive you name. Use Revert to undo
        a turn's edits.
      </div>
      <div class="suggestions">
        ${suggestions.map(
          ([icon, text]) => html`<button
            class="suggestion"
            @click=${() => this._useSuggestion(text)}
          >
            <span class="fas ${icon}"></span>${text}
          </button>`
        )}
      </div>
    </div>`;
  }

  _renderTools() {
    const t = this._tools;
    if (!t) return html`<div class="tools-panel">Loading…</div>`;
    const tool = (x) =>
      html`<div class="tool"><code>${x.name}</code> <span class="d">${x.description}</span></div>`;
    return html`
      <div class="tools-panel">
        <h4>Built-in</h4>
        ${(t.builtin || []).map(tool)}
        ${t.capabilities && t.capabilities.length
          ? html`
              <h4>Capabilities</h4>
              ${t.capabilities.map(tool)}
            `
          : ''}
        ${t.page && t.page.length
          ? html`
              <h4>From this page (${t.page.length})</h4>
              ${t.page.map(tool)}
              ${t.pageGranted !== 1
                ? html`<div class="note">The assistant will ask before using these.</div>`
                : ''}
              <a
                href="#"
                @click=${(e) => {
                  e.preventDefault();
                  this._openInspector();
                }}
                >Open in WebMCP Inspector →</a
              >
            `
          : ''}
      </div>
    `;
  }

  _renderMessage(m, i) {
    const streamingLast = i === this.messages.length - 1 && this.streaming;
    const body =
      m.role === 'assistant'
        ? this._renderAnswer((m.content || '').trim(), streamingLast)
        : m.role === 'error'
          ? html`<span class="fas fa-exclamation-circle"></span
              ><span>${(m.content || '').trim()}</span>`
          : (m.content || '').trim();
    const reasoning =
      m.role === 'assistant' && m.reasoning && m.reasoning.trim()
        ? html`<details class="reasoning" ?open=${streamingLast && !m.content}>
            <summary><span class="fas fa-chevron-right"></span> Thoughts</summary>
            <div class="body">${m.reasoning.trim()}</div>
          </details>`
        : '';
    return html`
      ${reasoning}
      ${m.images && m.images.length
        ? html`<div class="screenshots">
            ${m.images.map(
              (src) => html`<img
                class="screenshot"
                src=${src}
                title="Click to open full size in a new tab"
                @click=${() => bg.views.createTab(src, { setActive: true })}
              />`
            )}
          </div>`
        : ''}
      ${m.role === 'assistant' && !(m.content || '').trim()
        ? ''
        : html`<div class="msg ${m.role}${streamingLast ? ' streaming' : ''}">${body}</div>`}
      ${!streamingLast && (m.content || '').trim()
        ? html`<div
            class="msg-actions ${m.role}${this._isLatestAnswer(i) ? ' latest' : ''}${this
              ._copied === i
              ? ' copied'
              : ''}"
          >
            <button
              class="msg-action"
              title=${m.role === 'user' ? 'Copy your message' : 'Copy the answer as Markdown'}
              @click=${() => this._copyMessage(m, i)}
            >
              ${this._copied === i
                ? html`<span class="fas fa-fw fa-check"></span> Copied`
                : html`<span class="far fa-fw fa-copy"></span> Copy`}
            </button>
          </div>`
        : ''}
      ${m.files && m.files.length ? this._renderCheckpoint(m, i) : ''}
    `;
  }

  // An answer is Markdown with OpenUI Lang programs fenced in it (ADR-0027); each program is drawn
  // by <nomad-genui>.
  _renderAnswer(text, streaming) {
    const segments = splitGenUi(text);
    if (!segments.some((s) => s.type === 'ui')) return unsafeHTML(mdToHtml(text));
    return segments.map((s) =>
      s.type === 'md'
        ? unsafeHTML(mdToHtml(s.text.trim()))
        : html`<nomad-genui
            .source=${s.source}
            .streaming=${streaming && !s.closed}
            .disabled=${this.streaming}
            @genui-action=${this._onGenUiAction}
          ></nomad-genui>`
    );
  }

  // A Button or link in a drawn answer. @ToAssistant sends its message as the user's next one;
  // @OpenUrl opens a web or hyper:// page in a new tab. Only on a click, and never mid-turn.
  async _onGenUiAction(e) {
    for (const step of e.detail?.steps || []) {
      if (step.type === 'open_url') {
        let url;
        try {
          url = new URL(step.url);
        } catch {
          continue;
        }
        if (['http:', 'https:', 'hyper:'].includes(url.protocol)) {
          bg.views.createTab(url.href, { setActive: true });
        }
      } else if (step.type === 'continue_conversation' && step.message.trim()) {
        if (this.streaming) return;
        this.draft = step.message.trim();
        await this._send();
      }
    }
  }

  // The last message, when it is a finished answer: its Copy shows without a hover.
  _isLatestAnswer(i) {
    return (
      i === this.messages.length - 1 && !this.streaming && this.messages[i].role === 'assistant'
    );
  }

  // A prompt is copied as typed, an answer as the Markdown it arrived in.
  async _copyMessage(m, i) {
    await writeClipboard((m.content || '').trim());
    this._copied = i;
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => (this._copied = null), 1500);
  }

  _renderActivity() {
    const items = this._activity;
    return html`
      <div class="activity">
        ${items.length === 0
          ? html`<div class="activity-item active">
              <span class="fas fa-fw fa-spinner fa-spin"></span> Thinking…
            </div>`
          : items.map((a, i) => {
              // A step with an id runs until its `end` event. One without (from an older
              // Provider over the AI Bridge) runs until the next step starts.
              const running = a.id ? !a.done : i === items.length - 1;
              const icon = running
                ? 'fa-spinner fa-spin'
                : a.error
                  ? 'fa-exclamation-circle'
                  : 'fa-check';
              return html`<div
                class="activity-item ${running ? 'active' : ''}"
                title=${a.error || ''}
              >
                <span class="fas fa-fw ${icon}"></span>
                ${a.summary}
              </div>`;
            })}
        ${items.length && items.every((a) => a.id && a.done)
          ? // Every tool ended: the model is working out what to do next.
            html`<div class="activity-item active">
              <span class="fas fa-fw fa-spinner fa-spin"></span> Thinking…
            </div>`
          : ''}
      </div>
    `;
  }

  // A message sent while the assistant works, until its next step reads it.
  // Send now stops what the assistant is doing at this moment, so it reads the message at once.
  _renderQueued(q) {
    return html`
      <div class="msg user queued">${q.text}</div>
      <div class="queued-note">
        ${q.now
          ? html`<span class="fas fa-fw fa-spinner fa-spin"></span> Sending now…`
          : html`<span class="far fa-fw fa-clock"></span> Queued for the assistant's next step
              <button
                class="msg-action send-now"
                title="Stop what the assistant is doing and send this now"
                @click=${() => this._sendNow(q.id)}
              >
                <span class="fas fa-fw fa-paper-plane"></span> Send now
              </button>`}
        <button class="msg-action" title="Take back this message" @click=${() => this._unqueue(q.id)}>
          <span class="fas fa-fw fa-times"></span>
        </button>
      </div>
    `;
  }

  _renderCheckpoint(m, i) {
    const n = m.files.length;
    return html`
      <div class="checkpoint ${m.reverted ? 'reverted' : ''}">
        <div class="checkpoint-header">
          <span class="fas fa-fw fa-file-alt"></span>
          <span class="label">${n === 1 ? '1 file changed' : `${n} files changed`}</span>
          ${m.reverted
            ? html`<span class="reverted-label">Reverted</span>`
            : html`<button
                class="revert-btn"
                @click=${() => this._revertTurn(i)}
                ?disabled=${this.streaming}
              >
                <span class="fas fa-undo"></span> Revert
              </button>`}
        </div>
        <div class="checkpoint-files">
          ${m.files.map(
            (f) => html`<div class="checkpoint-file" title=${f.drive ? f.drive + f.path : f.path}>
              <span class="fas fa-fw fa-${f.priorContent === null ? 'plus' : 'pen'}"></span>
              <span class="path">${f.path}</span>
              ${f.drive && f.drive !== this._driveBase
                ? html`<span class="checkpoint-drive"
                    >in
                    ${f.drive.replace(
                      /^hyper:\/\/([0-9a-f]{6})[0-9a-f]{58}$/i,
                      'hyper://$1…'
                    )}</span
                  >`
                : ''}
            </div>`
          )}
        </div>
      </div>
    `;
  }

  // — events —

  _onInput(e) {
    this.draft = e.target.value;
    this._autosize();
  }

  // The input grows with its text, up to its CSS max-height, then scrolls.
  _autosize() {
    const el = this.renderRoot?.querySelector('.input');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  async _useSuggestion(text) {
    this.draft = text;
    await this.updateComplete;
    const el = this.renderRoot.querySelector('.input');
    el?.focus();
    el?.setSelectionRange(text.length, text.length);
  }

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  async _send() {
    const text = this.draft.trim();
    if (!text || !this.activeTab) return;
    if (this.streaming) return this._steer(text);
    this.draft = '';
    await this._runTurn([text]);
  }

  // A message sent while the assistant works. bg's turn reads it at its next step: after the tool
  // it's running, or before it would stop (bg/ai/steering.mjs). Its `steer` event puts it in the
  // transcript. One it never reads is sent as the next turn when this one ends.
  async _steer(text) {
    const item = { id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, text };
    this._queued = [...this._queued, item];
    this.draft = '';
    await this.updateComplete;
    this._autosize();
    this._scrollToBottom();
    try {
      await bg.aiShell.steer(this._turnId, item.id, text);
    } catch (e) {
      console.warn('[ai-sidebar] steer failed', e);
    }
  }

  async _sendNow(id) {
    this._queued = this._queued.map((q) => (q.id === id ? { ...q, now: true } : q));
    try {
      await bg.aiShell.steerNow(this._turnId, id);
    } catch (e) {
      console.warn('[ai-sidebar] send now failed', e);
    }
  }

  async _unqueue(id) {
    this._queued = this._queued.filter((q) => q.id !== id);
    try {
      await bg.aiShell.unsteer(this._turnId, id);
    } catch {
      /* the turn ended; nothing to take back */
    }
  }

  async _runTurn(texts) {
    if (!texts.length || this.streaming || !this.activeTab) return;

    // Captured once, up front — this turn belongs to THIS session. A tab switch doesn't change
    // that (ADR-0021). The live this.messages only gets touched while isCurrent() holds; the turn
    // always keeps mutating its own local turnMessages regardless, and the final save (in
    // `finally`) always targets turnSessionId, never live state.
    const turnSessionId = this.sessionId;
    const isCurrent = () => this.sessionId === turnSessionId;

    // Draft Mode (ADR-0012): the first time this conversation is used on a writable Drive, start
    // a Draft for it, so the agent's writes there stage privately — the user reviews the whole
    // Draft and Publishes/Discards.
    const tabDrive = this._writable ? this._driveBase : null;
    if (tabDrive && !this._draftDrives.has(tabDrive)) {
      this._draftDrives.add(tabDrive);
      try {
        await bg.fs.beginDraft(this._driveUrl);
      } catch (e) {
        console.warn('[ai-sidebar] beginDraft failed', e);
      }
    }

    this.streaming = true;
    this._activity = [];
    const turnId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this._turnId = turnId;

    let turnMessages = [...this.messages, ...texts.map((content) => ({ role: 'user', content }))];
    let assistantIdx = turnMessages.length;
    // one Checkpoint per assistant turn: files[] captures {path, priorContent}
    turnMessages = [...turnMessages, { role: 'assistant', content: '', reasoning: '', files: [] }];
    this.messages = turnMessages;
    await this.updateComplete;

    // Mirror the turn's local state into the live UI — but only while we're still looking at the
    // tab this turn started on; otherwise this.messages belongs to whatever tab is active now.
    const sync = () => {
      if (!isCurrent()) return;
      this.messages = turnMessages;
      this.requestUpdate();
    };

    const onToolEvent = (e) => {
      if (e.phase === 'start') {
        if (isCurrent()) {
          this._activity = [...this._activity, { id: e.id, name: e.name, summary: e.summary }];
        }
      } else if (e.phase === 'end' && e.id) {
        // The call with this id finished (AG-UI's TOOL_CALL_END). A call made inside `execute`
        // ends before `execute` does, so several steps can run at once.
        if (isCurrent()) {
          this._activity = this._activity.map((a) =>
            a.id === e.id ? { ...a, done: true, error: e.error || null } : a
          );
        }
      } else if (e.phase === 'detail' && e.summary) {
        // A page action names the control once it has found it ("Clicking button “Sign in”"):
        // it replaces the step's first words.
        if (isCurrent()) {
          const last = this._activity[this._activity.length - 1];
          this._activity = e.id
            ? this._activity.map((a) => (a.id === e.id ? { ...a, summary: e.summary } : a))
            : last && last.name === e.name
              ? [...this._activity.slice(0, -1), { ...last, summary: e.summary }]
              : this._activity;
        }
      } else if (e.phase === 'write' && e.path) {
        // Each file keeps its drive: the assistant can write to any drive the user names.
        const msg = turnMessages[assistantIdx];
        const drive = e.drive || tabDrive || this._driveBase;
        if (msg && !msg.files.some((f) => f.path === e.path && f.drive === drive)) {
          turnMessages = [...turnMessages];
          turnMessages[assistantIdx] = {
            ...msg,
            files: [...msg.files, { drive, path: e.path, priorContent: e.priorContent ?? null }],
          };
        }
      } else if (e.phase === 'screenshot' && e.imageDataUrl) {
        // The model only gets a text description back from the tool call — show the actual
        // image to the human here, since otherwise nobody but the model ever sees it.
        const msg = turnMessages[assistantIdx];
        if (msg) {
          turnMessages = [...turnMessages];
          turnMessages[assistantIdx] = { ...msg, images: [...(msg.images || []), e.imageDataUrl] };
        }
      }
      sync();
    };

    const onReasoning = (chunk) => {
      const cur = turnMessages[assistantIdx];
      if (!cur) return;
      turnMessages = [...turnMessages];
      turnMessages[assistantIdx] = { ...cur, reasoning: (cur.reasoning || '') + chunk };
      sync();
    };

    // The turn read messages the user sent while it ran: they go in the transcript where the model
    // read them, and what it writes from here on is a new answer (with its own Checkpoint).
    const onSteer = (e) => {
      const ids = Array.isArray(e?.ids) ? e.ids : [];
      const sent = (Array.isArray(e?.texts) ? e.texts : []).filter((t) => typeof t === 'string');
      if (this._turnId === turnId) this._queued = this._queued.filter((q) => !ids.includes(q.id));
      if (!sent.length) return;
      const cur = turnMessages[assistantIdx];
      const unused =
        cur &&
        cur.role === 'assistant' &&
        !(cur.content || '').trim() &&
        !(cur.reasoning || '').trim() &&
        !cur.files?.length &&
        !cur.images?.length;
      turnMessages = unused ? turnMessages.slice(0, assistantIdx) : [...turnMessages];
      for (const content of sent) turnMessages.push({ role: 'user', content });
      assistantIdx = turnMessages.length;
      turnMessages.push({ role: 'assistant', content: '', reasoning: '', files: [] });
      if (isCurrent()) this._activity = [];
      sync();
    };

    let stopped = false;
    let failed = false;
    let iterator = null;
    try {
      // 'error' is a UI-only pseudo-role (a failed turn's bubble) — the runtime only accepts
      // system/user/assistant/tool/developer, so a past failure must never be replayed as history.
      const history = mergeUserTurns(
        turnMessages
          .slice(0, assistantIdx)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
      );

      const eventTarget = fromEventStream(
        bg.aiShell.chat(history, {
          model: this._model || undefined,
          think: this._think,
          effort: this._think ? this._effort || undefined : undefined,
          allowVision: this._visionModel === true,
          turnId,
          // A page-action confirm can allow similar clicks for the rest of this chat.
          chatId: turnSessionId || undefined,
        })
      );
      eventTarget.addEventListener('tool', (e) => onToolEvent(e));
      eventTarget.addEventListener('steer', (e) => onSteer(e));
      eventTarget.addEventListener('reasoning', (e) => onReasoning(e.text));
      iterator = streamToAsyncIterator(eventTarget);
      this._stopChat = () => {
        stopped = true;
        iterator.return?.();
      };

      let lastPaint = performance.now();
      while (true) {
        const { value: chunk, done } = await iterator.next();
        if (done) break;
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = {
          ...turnMessages[assistantIdx],
          content: (turnMessages[assistantIdx].content || '') + chunk,
        };
        const now = performance.now();
        if (now - lastPaint >= 16) {
          sync();
          await this.updateComplete;
          await new Promise((r) => requestAnimationFrame(r));
          lastPaint = performance.now();
        }
      }
      sync();
      await this.updateComplete;
    } catch (err) {
      failed = true;
      if (!stopped) {
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = {
          role: 'error',
          content: `Error: ${err.message}`,
          files: turnMessages[assistantIdx]?.files || [],
        };
      }
    } finally {
      iterator?.return?.();
      this._stopChat = null;
      // Messages the turn never read. After an answer they go as the next turn; after a Stop or an
      // error they go back in the input, for the user to send or not.
      const left = this._turnId === turnId ? this._queued.map((q) => q.text) : [];
      if (this._turnId === turnId) {
        this._queued = [];
        this._turnId = null;
      }
      if (isCurrent()) {
        this.streaming = false;
        this._activity = [];
      }
      const cur = turnMessages[assistantIdx];
      if (stopped && cur && cur.role === 'assistant' && !cur.content) {
        turnMessages = [...turnMessages];
        turnMessages[assistantIdx] = { ...cur, content: '_Stopped._' };
      }
      sync();
      await this._saveSession(turnSessionId, turnMessages);
      if (left.length) {
        if (stopped || failed || !isCurrent()) {
          this.draft = [...left, this.draft.trim()].filter(Boolean).join('\n\n');
          await this.updateComplete;
          this._autosize();
        } else {
          this._runTurn(left);
        }
      }
    }
  }

  _stop() {
    if (this._stopChat) this._stopChat();
  }

  async _revertTurn(msgIndex) {
    const msg = this.messages[msgIndex];
    if (!msg || !msg.files || msg.reverted || this.streaming) return;
    const sessionId = this.sessionId;
    for (const f of [...msg.files].reverse()) {
      const base = f.drive;
      if (!base) continue;
      try {
        const fileUrl = base + f.path;
        if (f.priorContent === null) {
          await bg.fs.unlink(fileUrl);
        } else {
          await bg.fs.writeFile(fileUrl, f.priorContent);
        }
        // Mirrors the 'write' tool-event tap in a live turn — lets editor/explorer reload the
        // affected buffer/listing after a revert, same as after the original write.
        await bg.aiShell.notifyAgentWroteFile(f.path, base);
      } catch (e) {
        console.error('[ai-sidebar] revert failed for', f.path, e);
      }
    }
    // Switched sessions mid-revert: the files were still restored above, but the live transcript
    // is another session now — leave it alone.
    if (this.sessionId !== sessionId) return;
    msg.reverted = true;
    this.messages = [...this.messages];
    await this._saveSession(sessionId, this.messages);
    this.requestUpdate();
  }

  _scrollToBottom() {
    const el = this.renderRoot?.querySelector('.messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

customElements.define('shell-window-ai-sidebar', ShellWindowAiSidebar);
