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

  .run {
    border-top: 1px solid var(--border-color--very-light);
    padding: 6px 0;
    font-size: 13px;
  }

  .run summary {
    cursor: pointer;
    color: var(--text-color--default);
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

  .run .error {
    margin-top: 6px;
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

  button.icon[disabled] {
    cursor: default;
    opacity: 0.7;
  }
`;
export default cssStr;
