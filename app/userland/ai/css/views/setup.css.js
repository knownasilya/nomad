import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import buttonsCSS from 'nomad://app-stdlib/css/buttons2.css.js';

const cssStr = css`
  ${buttonsCSS}

  :host {
    display: block;
    color: var(--text-color--default);
  }

  :host > * {
    max-width: 680px;
  }

  h2 {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }

  a {
    color: var(--ai-accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .form-group {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 0 12px 10px;
    margin-bottom: 16px;
    background: var(--bg-color--default);
  }

  .form-group h2 {
    margin: 0;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color--semi-light);
  }

  .form-group .section {
    margin-bottom: 0;
    padding: 0 10px 4px;
  }

  .form-group .section:not(:last-child) {
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color--semi-light);
  }

  .form-group .section > :first-child {
    margin-top: 16px;
  }

  label {
    font-weight: 600;
    display: block;
    margin-bottom: 4px;
  }

  p.description {
    margin: 4px 0 8px;
    color: var(--text-color--light);
    font-size: 13px;
  }

  input[type='text'],
  input[type='password'],
  select {
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--border-color--light);
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font: inherit;
    font-size: 13px;
    box-sizing: border-box;
  }

  input[type='text']:focus,
  input[type='password']:focus,
  select:focus {
    outline: 0;
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-soft);
  }

  input[type='checkbox'],
  input[type='radio'] {
    accent-color: var(--ai-fill);
  }

  .btn {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
    box-shadow: none;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
  }

  .btn:hover {
    background: var(--ai-row-hover-bg);
  }

  .server-add,
  .server-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .server-add input[type='text'],
  .server-edit input[type='text'],
  .server-edit input[type='password'],
  .server-add input[type='password'] {
    width: 160px;
  }

  .server-add input[type='text']:nth-of-type(2),
  .server-edit input[type='text']:nth-of-type(2) {
    flex: 1;
    min-width: 220px;
    width: auto;
  }

  .runtime {
    padding: 6px 0;
  }

  .runtime-pick {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }

  .runtime-kind {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 400;
    color: var(--text-color--light);
  }

  .test-status {
    margin: 6px 0 0;
    font-size: 13px;
  }

  .test-status.ok {
    color: var(--ai-ok);
  }

  .test-status.err {
    color: var(--ai-err);
  }

  /* The keep-awake sub-setting, indented under "Share this device's AI". */
  .sub-setting {
    margin-left: 22px;
  }

  label.sub-setting {
    display: block;
    margin-top: 10px;
  }

  input[type='checkbox']:disabled + * ,
  label.sub-setting input[type='checkbox']:disabled {
    opacity: 0.5;
  }

  .keep-awake-status {
    margin: 4px 0 0 22px;
    font-size: 13px;
  }

  .keep-awake-status.ok {
    color: var(--ai-ok);
  }

  .keep-awake-status.warn {
    color: var(--ai-warn);
  }

  .badge-experimental {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--ai-fill);
    color: #fff;
    vertical-align: middle;
    letter-spacing: 0.3px;
  }
`;
export default cssStr;
