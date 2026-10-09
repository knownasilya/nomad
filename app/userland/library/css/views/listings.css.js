import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Colors come from the shared tokens (app-stdlib/css/colors.css) and the Library's own --lib-*
// tokens (library/css/main.css), so the view follows light and dark mode with the other views.
const cssStr = css`
  :host {
    display: block;
    padding: 6px 4px 40px;
    /* Solid fills (toggle, Save) keep one indigo: white on it reads in both modes. */
    --listing-fill: #4f46e5;
    --listing-accent: var(--lib-nav-active-text, #4f46e5);
    --listing-accent-soft: var(--lib-nav-active-bg, #eef2ff);
    --listing-ok: #16a34a;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --listing-ok: #4ade80;
    }
  }

  .intro {
    color: var(--text-color--light);
    font-size: 13px;
    line-height: 1.5;
    margin: 4px 6px 16px;
    max-width: 640px;
  }

  .intro strong {
    color: var(--text-color--default);
  }

  .empty {
    color: var(--text-color--pretty-light);
    text-align: center;
    padding: 40px 0;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }
  .row.listed {
    border-color: var(--listing-accent);
    box-shadow: 0 0 0 1px var(--listing-accent-soft) inset;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    color: var(--text-color--default);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--listing-accent);
    background: var(--listing-accent-soft);
    border-radius: 999px;
    padding: 1px 7px;
  }
  .url {
    font-size: 12px;
    color: var(--text-color--pretty-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: 12px;
    color: var(--text-color--pretty-light);
    flex-shrink: 0;
  }
  .row.listed .state {
    color: var(--listing-accent);
    font-weight: 600;
  }

  /* toggle switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 22px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch {
    position: absolute;
    inset: 0;
    background: var(--border-color--default);
    border-radius: 999px;
    transition: background 0.15s;
  }
  .switch::before {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.15s;
  }
  .toggle input:checked + .switch {
    background: var(--listing-fill);
  }
  .toggle input:checked + .switch::before {
    transform: translateX(16px);
  }
  .toggle input:focus-visible + .switch {
    outline: 2px solid var(--listing-accent);
    outline-offset: 2px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }
  .fields label {
    display: block;
  }
  .flabel {
    display: block;
    font-size: 12px;
    color: var(--text-color--lightish);
    margin-bottom: 4px;
  }
  .flabel em {
    color: var(--text-color--pretty-light);
    font-style: normal;
  }
  .fields input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-color--default);
    background: var(--bg-color--secondary);
  }
  .fields input::placeholder {
    color: var(--text-color--pretty-light);
  }
  .fields input:focus {
    outline: none;
    border-color: var(--listing-accent);
    box-shadow: 0 0 0 2px var(--listing-accent-soft);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .actions button {
    cursor: pointer;
    padding: 6px 14px;
    border: 1px solid var(--listing-fill);
    background: var(--listing-fill);
    color: #fff;
    border-radius: 6px;
    font-size: 13px;
  }
  .actions button[disabled] {
    opacity: 0.6;
    cursor: default;
  }
  .status {
    font-size: 12px;
    color: var(--listing-ok);
  }
`;

export default cssStr;
