import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Shared by the AI page's views: cards, buttons, switches and fields, styled like My Library → Mods.
// Colors are the app-stdlib tokens plus the page's --ai-* tokens (ai/css/main.css), so light and dark
// both follow the OS.
const cssStr = css`
  :host {
    display: block;
    color: var(--text-color--default);
  }

  * {
    box-sizing: border-box;
  }

  a {
    color: var(--ai-accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  code {
    font-family: var(--code-font);
    font-size: 12px;
    color: var(--text-color--default);
  }

  h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }

  .intro {
    max-width: 680px;
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .group-head {
    margin: 18px 4px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-color--pretty-light);
  }

  .card {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 8px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .card.editing,
  .card.open {
    border-color: var(--border-color--light);
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .row-icon {
    flex: 0 0 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--ai-accent-soft);
    color: var(--ai-accent);
    font-size: 12px;
  }

  .meta {
    flex: 1;
    min-width: 0;
  }

  .meta.clickable {
    cursor: pointer;
  }

  .title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary {
    overflow: hidden;
    font-size: 12px;
    color: var(--text-color--pretty-light);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet {
    margin-top: 3px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-color--lightish);
  }

  mark {
    padding: 0 1px;
    border-radius: 2px;
    background: var(--ai-mark-bg);
    color: inherit;
  }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 9px;
    background: var(--ai-accent-soft);
    color: var(--ai-accent);
    font-size: 10px;
    font-weight: 600;
    vertical-align: 1px;
  }

  .actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
  }

  .switch {
    position: relative;
    flex: 0 0 32px;
    height: 18px;
  }

  .switch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .switch .track {
    position: absolute;
    inset: 0;
    border-radius: 9px;
    background: var(--border-color--light);
    transition: background 0.15s;
    pointer-events: none;
  }

  .switch .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: transform 0.15s;
  }

  .switch input:checked + .track {
    background: var(--ai-fill);
  }

  .switch input:checked + .track::after {
    transform: translateX(14px);
  }

  .switch input:focus-visible + .track {
    box-shadow: 0 0 0 3px var(--ai-accent-soft);
  }

  input,
  textarea,
  select {
    padding: 0 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  input,
  select {
    height: 30px;
  }

  textarea {
    width: 100%;
    padding: 8px 9px;
    resize: vertical;
    line-height: 1.45;
  }

  input:focus,
  textarea:focus,
  select:focus {
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-soft);
  }

  button {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    background: var(--ai-row-hover-bg, var(--bg-color--semi-light));
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  button.primary {
    border-color: var(--ai-fill);
    background: var(--ai-fill);
    color: #fff;
  }

  button.primary:hover {
    filter: brightness(1.08);
  }

  button.danger-text {
    color: var(--ai-err);
  }

  button.link {
    height: auto;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ai-accent);
  }

  button.icon {
    width: 30px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-color--light);
  }

  button.icon:hover {
    background: var(--ai-search-bg, var(--bg-color--semi-light));
    color: var(--text-color--default);
  }

  button.icon.danger:hover {
    color: var(--ai-err);
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  .error {
    font-size: 12px;
    color: var(--ai-err);
  }

  .notice {
    padding: 48px 20px;
    text-align: center;
    color: var(--text-color--pretty-light);
  }

  .notice .notice-icon {
    margin-bottom: 10px;
    font-size: 26px;
    color: var(--text-color--very-light);
  }

  .notice h3 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color--lightish);
  }

  .notice p {
    max-width: 380px;
    margin: 0 auto 12px;
    line-height: 1.45;
  }
`;
export default cssStr;
