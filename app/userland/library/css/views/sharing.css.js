import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

// Styled like the Names view: the shared tokens (app-stdlib/css/colors.css) and the Library's own
// --lib-* tokens (library/css/main.css), so it follows light and dark mode with the other views.
const cssStr = css`
  ${spinnerCSS}

  :host {
    display: block;
    max-width: 720px;
    padding: 6px 4px 40px;
    --share-fill: #4f46e5; /* white text reads on it in both modes */
    --share-accent: var(--lib-nav-active-text, #4f46e5);
    --share-accent-soft: var(--lib-nav-active-bg, #eef2ff);
    --share-err: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --share-err: #f87171;
    }
  }

  .intro {
    margin: 4px 6px 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .intro strong {
    color: var(--text-color--default);
  }

  .card,
  .row,
  .notice {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .card {
    margin: 14px 0;
  }

  .card-title {
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
  }

  .card-title .fas {
    color: var(--share-accent);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .what strong {
    color: var(--text-color--default);
  }

  code {
    font-family: var(--code-font);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  label {
    font-size: 12px;
    color: var(--text-color--light);
  }

  input {
    height: 30px;
    min-width: 0;
    padding: 0 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 13px;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: var(--share-accent);
    box-shadow: 0 0 0 3px var(--share-accent-soft);
    outline: none;
  }

  input.code-input {
    flex: 1;
    min-width: 200px;
    font-family: var(--code-font);
  }

  select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 12px;
  }

  button {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    background: var(--lib-row-hover-bg, var(--bg-color--semi-light));
  }

  button[disabled] {
    opacity: 0.6;
    cursor: default;
  }

  button.primary {
    border-color: var(--share-fill);
    background: var(--share-fill);
    color: #fff;
  }

  button.primary:hover {
    filter: brightness(1.08);
  }

  button.icon {
    width: 30px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-color--light);
  }

  button.icon:hover {
    background: var(--lib-search-bg, var(--bg-color--semi-light));
    color: var(--text-color--default);
  }

  button.icon.danger:hover {
    color: var(--share-err);
  }

  .section-title {
    margin: 18px 6px 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-color--light);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .row > .fas {
    color: var(--text-color--light);
  }

  .meta {
    flex: 1;
    min-width: 0;
  }

  .title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--share-accent-soft);
    color: var(--share-accent);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    vertical-align: 1px;
  }

  .actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 6px;
  }

  .code {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 12px;
    word-break: break-all;
    user-select: all;
  }

  .leave {
    margin: 22px 6px 0;
  }

  .leave .sub {
    margin-top: 6px;
  }

  .notice {
    margin-bottom: 10px;
    font-size: 13px;
  }

  .row-actions {
    margin: 0 0 14px;
  }

  .error {
    margin: 8px 6px 0;
    font-size: 12px;
    color: var(--share-err);
  }

  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--text-color--pretty-light);
  }

  .spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 4px;
    vertical-align: -1px;
  }
`;
export default cssStr;
