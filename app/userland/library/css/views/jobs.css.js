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

  button.icon[disabled] {
    cursor: default;
    opacity: 0.7;
  }
`;
export default cssStr;
