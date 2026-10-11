import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Styled like the Listings view: the shared tokens (app-stdlib/css/colors.css) and the Library's
// own --lib-* tokens (library/css/main.css), so it follows light and dark mode with the other views.
const cssStr = css`
  :host {
    display: block;
    padding: 6px 4px 40px;
    --names-fill: #4f46e5; /* white text reads on it in both modes */
    --names-accent: var(--lib-nav-active-text, #4f46e5);
    --names-accent-soft: var(--lib-nav-active-bg, #eef2ff);
    --names-err: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --names-err: #f87171;
    }
  }

  .intro {
    max-width: 640px;
    margin: 4px 6px 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .intro code {
    color: var(--text-color--default);
  }

  .add,
  .row {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 12px 14px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .add {
    margin-bottom: 14px;
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .prefix {
    font-family: var(--code-font);
    font-size: 12px;
    color: var(--text-color--pretty-light);
  }

  input {
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 13px;
    outline: none;
  }

  input:focus {
    border-color: var(--names-accent);
    box-shadow: 0 0 0 3px var(--names-accent-soft);
  }

  input.name {
    width: 140px;
    font-family: var(--code-font);
  }

  input.url {
    flex: 1;
    min-width: 220px;
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
    cursor: pointer;
  }

  button:hover {
    background: var(--lib-row-hover-bg, var(--bg-color--semi-light));
  }

  button.primary {
    border-color: var(--names-fill);
    background: var(--names-fill);
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
    color: var(--names-err);
  }

  .error {
    margin-top: 8px;
    font-size: 12px;
    color: var(--names-err);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name-chip {
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--names-accent-soft);
    color: var(--names-accent);
    font-family: var(--code-font);
    font-size: 12px;
    font-weight: 600;
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

  .target {
    overflow: hidden;
    font-family: var(--code-font);
    font-size: 11px;
    color: var(--text-color--pretty-light);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
  }

  .row .fields {
    margin-top: 10px;
  }

  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--text-color--pretty-light);
  }
`;
export default cssStr;
