import { css } from 'lit';

export default css`
  :host {
    display: block;
    /* Design tokens for modal context (no lib vars available in modal window) */
    --m-border: #e2e2ea;
    --m-border-strong: #ccccd6;
    --m-bg-secondary: #f7f7fa;
    --m-text-default: #1a1a22;
    --m-text-light: #5a5a6e;
    --m-text-very-light: #9090a2;
    --m-blue: #4040e7;
    --m-blue-hover: #3232c8;
    --m-focus-ring: rgba(64, 64, 231, 0.18);
    --m-radius: 6px;
    --m-radius-sm: 4px;
  }

  .wrapper {
    padding: 0;
    user-select: none;
    color: var(--m-text-default);
    font-size: 13px;
  }

  h1.title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.1px;
    padding: 14px 20px 13px;
    margin: 0;
    border-bottom: 1px solid var(--m-border);
    color: var(--m-text-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .help-text {
    color: var(--m-text-light);
    font-style: italic;
    font-size: 12px;
  }

  .footnote {
    position: fixed;
    bottom: 50px;
    width: 90%;
    font-size: 11px;
    color: var(--m-text-very-light);
  }

  form {
    padding: 14px 20px;
  }

  form label {
    display: block;
    font-weight: 500;
    font-size: 12px;
    color: var(--m-text-light);
    margin-bottom: 4px;
    letter-spacing: 0.1px;
  }

  form textarea,
  form input:not([type='checkbox']):not([type='radio']),
  form .input {
    display: block;
    width: 100%;
    box-sizing: border-box;
  }

  form textarea {
    resize: none;
    padding: 7px 10px;
    height: 55px;
  }

  details input,
  details textarea,
  details .input {
    margin-bottom: 0;
  }

  details summary {
    outline: 0;
    font-size: 12px;
    color: var(--m-text-light);
    cursor: pointer;
  }

  .form-actions {
    text-align: right;
  }

  a {
    color: var(--m-blue);
    cursor: pointer;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .error {
    color: #d93229;
    font-size: 12px;
    margin: -8px 0 10px;
  }

  hr {
    border: 0;
    border-top: 1px solid var(--m-border);
    margin: 14px 0;
  }
`;
