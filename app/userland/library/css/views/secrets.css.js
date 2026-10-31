import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Secrets reuse the Mods view's cards, switch, chips, fields and buttons (mods.css.js) and the Jobs
// view's select and hint rows (jobs.css.js), applied first; this adds the value field and the
// list of Jobs.
const cssStr = css`
  :host {
    --secrets-warn-bg: #fef3c7;
    --secrets-warn-text: #92400e;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --secrets-warn-bg: #3b2f12;
      --secrets-warn-text: #fcd34d;
    }
  }

  .title code {
    font-family: var(--code-font);
    font-size: 13px;
  }

  .notice {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--secrets-warn-bg);
    color: var(--secrets-warn-text);
    font-size: 13px;
  }

  input.secret-name {
    width: 220px;
    font-family: var(--code-font);
    text-transform: uppercase;
  }

  input.value {
    width: 100%;
    font-family: var(--code-font);
  }

  input.hosts,
  input.inject-name,
  input.format {
    font-family: var(--code-font);
  }

  input.hosts {
    width: 100%;
  }

  input.format {
    width: 200px;
  }

  .send-as {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .job-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  .job-list label,
  label.check {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .job-list input,
  label.check input {
    height: auto;
  }

  .value-state {
    font-size: 12px;
    color: var(--text-color--pretty-light);
  }
`;
export default cssStr;
