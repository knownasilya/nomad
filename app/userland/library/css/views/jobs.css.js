import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Jobs reuse the Mods view's cards, switch, chips, fields and buttons (mods.css.js, applied first);
// this adds the schedule row and the runs.
const cssStr = css`
  :host {
    --jobs-ok: #16a34a;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --jobs-ok: #4ade80;
    }
  }

  select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 13px;
  }

  textarea {
    font-family: inherit;
    font-size: 13px;
  }

  .when {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  input.num {
    width: 70px;
  }

  .when {
    flex-wrap: wrap;
  }

  .when.sub {
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-color--light);
  }

  .when .check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .time-item {
    display: inline-flex;
    align-items: center;
  }

  input.text {
    flex: 1;
    min-width: 260px;
  }

  input.dates {
    width: 120px;
  }

  .preview {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .preview.err {
    color: var(--mods-err);
  }

  .days {
    margin-top: 8px;
    align-items: center;
  }

  .job-body {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
  }

  .job-body .label {
    margin-top: 6px;
  }

  .prompt {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .source {
    margin-bottom: 10px;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .source a {
    color: var(--text-color--link);
  }

  .source .hint-row {
    margin: 4px 0 6px;
  }

  .file {
    margin: 4px 0;
    font-size: 12px;
  }

  .file summary {
    cursor: pointer;
    font-family: ui-monospace, Menlo, monospace;
  }

  .file pre {
    margin: 4px 0 0;
    padding: 8px 10px;
    max-height: 260px;
    overflow: auto;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 12px;
    white-space: pre-wrap;
  }

  .update {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color--light);
  }

  .update .buttons {
    margin-top: 8px;
  }

  input.source-url {
    width: 100%;
    box-sizing: border-box;
  }

  .elsewhere,
  .hint-row {
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .hint-row {
    margin: 6px 0 0;
  }

  .hint-row a {
    color: var(--text-color--link);
  }

  .last-error {
    margin-top: 3px;
    font-size: 12px;
    color: var(--mods-err);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 6px 0 6px;
  }

  .job-body .history-head .label {
    margin: 0;
  }

  .history-head .count {
    font-size: 12px;
    color: var(--text-color--light);
  }

  .history-head .count .err {
    color: var(--mods-err);
  }

  .history-head .spacer {
    flex: 1;
  }

  input.history-search {
    width: 180px;
    height: 30px;
    box-sizing: border-box;
  }

  .seg {
    display: inline-flex;
  }

  .seg button {
    border-radius: 0;
  }

  .seg button:first-child {
    border-radius: 6px 0 0 6px;
  }

  .seg button:last-child {
    border-radius: 0 6px 6px 0;
    border-left: 0;
  }

  .seg button.on {
    background: var(--bg-color--semi-light);
    font-weight: 600;
  }

  .seg button[disabled] {
    cursor: default;
    opacity: 0.5;
  }

  button.clear:hover {
    color: var(--mods-err);
  }

  .run {
    border-top: 1px solid var(--border-color--very-light);
    padding: 6px 0;
    font-size: 13px;
  }

  .run summary {
    display: flex;
    align-items: baseline;
    gap: 6px;
    cursor: pointer;
    color: var(--text-color--default);
    list-style: none;
  }

  .run summary::-webkit-details-marker {
    display: none;
  }

  .run summary::before {
    content: '▸';
    width: 10px;
    flex: none;
    color: var(--text-color--light);
  }

  .run[open] summary::before {
    content: '▾';
  }

  .run-when,
  .run summary .muted {
    flex: none;
    white-space: nowrap;
  }

  .run-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-color--light);
  }

  .run.failed .run-preview {
    color: var(--mods-err);
  }

  .run[open] .run-preview {
    visibility: hidden;
  }

  .run-error {
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--mods-err);
    color: var(--mods-err);
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .running-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 6px;
    padding: 1px 7px 1px 4px;
    border-radius: 10px;
    background: var(--mods-accent-soft);
    color: var(--mods-accent);
    font-size: 11px;
    font-weight: 600;
    vertical-align: 1px;
  }

  .watch-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 28px;
    padding: 0 10px 0 7px;
    border: 1px solid var(--mods-accent);
    border-radius: 6px;
    background: var(--mods-accent-soft);
    color: var(--mods-accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .watch-btn:hover {
    filter: brightness(0.97);
  }

  .run-chat {
    margin-top: 6px;
  }

  .output.trimmed {
    color: var(--text-color--light);
  }

  .run .muted {
    color: var(--text-color--pretty-light);
  }

  .run .ok {
    color: var(--jobs-ok);
  }

  .run .err {
    color: var(--mods-err);
  }

  .output {
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .grant-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 13px;
  }

  .grant-checks .check,
  .grant-drives .check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .grant-drives,
  .grants,
  .changes ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    font-size: 13px;
  }

  .grant-drives li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-top: 1px solid var(--border-color--very-light);
  }

  .grant-drives .drive-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grant-drives .check {
    color: var(--text-color--light);
    font-size: 12px;
  }

  input.add-drive {
    flex: 1;
    min-width: 260px;
  }

  .grants {
    margin: 0 0 10px;
  }

  .grants li,
  .changes li {
    padding: 2px 0;
    overflow-wrap: anywhere;
  }

  .grants a,
  .changes a {
    color: var(--text-color--link);
  }

  .grants .muted,
  .changes .muted {
    color: var(--text-color--pretty-light);
  }

  .changes {
    margin-top: 8px;
  }

  .changes ul {
    margin-top: 2px;
  }

  /* Web pages (ADR-0038): a site's row wraps to list the clicks it may repeat. */
  .grant-pages li {
    flex-wrap: wrap;
  }

  .grant-pages .page-actions {
    flex-basis: 100%;
    list-style: none;
    margin: 0;
    padding: 0 0 0 26px;
  }

  .grant-pages .page-actions li {
    border: 0;
    padding: 0;
    gap: 4px;
    color: var(--text-color--default);
  }

  .grant-pages .page-actions .muted {
    color: var(--text-color--pretty-light);
  }

  .needs {
    margin-top: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 13px;
  }

  .needs ul {
    list-style: none;
    margin: 2px 0 6px;
    padding: 0;
  }

  .needs li {
    padding: 2px 0;
    overflow-wrap: anywhere;
  }

  .needs .label {
    margin-top: 0;
  }

  .needs .hint-row {
    margin: 0;
  }

  button.icon[disabled] {
    cursor: default;
    opacity: 0.7;
  }
`;
export default cssStr;
