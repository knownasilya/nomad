import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Styled like the Names view: the shared tokens (app-stdlib/css/colors.css) and the Library's own
// --lib-* tokens (library/css/main.css), so it follows light and dark mode with the other views.
const cssStr = css`
  :host {
    display: block;
    padding: 6px 4px 40px;
    --mods-fill: #4f46e5; /* white text reads on it in both modes */
    --mods-accent: var(--lib-nav-active-text, #4f46e5);
    --mods-accent-soft: var(--lib-nav-active-bg, #eef2ff);
    --mods-err: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --mods-err: #f87171;
    }
  }

  .intro {
    max-width: 680px;
    margin: 4px 6px 14px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .intro code,
  .hint code {
    color: var(--text-color--default);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 2px 12px;
    font-size: 13px;
    color: var(--text-color--light);
  }

  .site-filter strong {
    color: var(--text-color--default);
  }

  .group {
    margin-bottom: 18px;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 4px 6px;
  }

  .group-head .site {
    font-family: var(--code-font);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--light);
  }

  .card {
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 8px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .card.editing {
    border-color: var(--border-color--light);
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .meta {
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary {
    font-size: 12px;
    color: var(--text-color--pretty-light);
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
    background: var(--mods-fill);
  }

  .switch input:checked + .track::after {
    transform: translateX(14px);
  }

  .switch input:focus-visible + .track {
    box-shadow: 0 0 0 3px var(--mods-accent-soft);
  }

  .editor {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .fields label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .label {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--light);
  }

  .hint {
    margin-left: 6px;
    font-weight: 400;
    color: var(--text-color--pretty-light);
  }

  input,
  textarea {
    padding: 0 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  input {
    height: 30px;
  }

  textarea {
    width: 100%;
    padding: 8px 9px;
    resize: vertical;
    line-height: 1.45;
  }

  .code {
    font-family: var(--code-font);
    font-size: 12px;
  }

  input:focus,
  textarea:focus {
    border-color: var(--mods-accent);
    box-shadow: 0 0 0 3px var(--mods-accent-soft);
  }

  input.name {
    width: 220px;
  }

  input.site {
    width: 220px;
    font-family: var(--code-font);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border: 1px solid var(--border-color--light);
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }

  .chip input {
    display: none;
  }

  .chip.on {
    border-color: var(--mods-fill);
    background: var(--mods-fill);
    color: #fff;
  }

  .selectors {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .selectors li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px 2px 8px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
  }

  .selectors code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .add-selector {
    display: flex;
    gap: 8px;
  }

  .add-selector input {
    flex: 1;
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
    border-color: var(--mods-fill);
    background: var(--mods-fill);
    color: #fff;
  }

  button.primary:hover {
    filter: brightness(1.08);
  }

  button.link {
    height: auto;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--mods-accent);
  }

  button.icon {
    width: 30px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-color--light);
  }

  .selectors button.icon {
    height: 24px;
    width: 24px;
  }

  button.icon:hover {
    background: var(--lib-search-bg, var(--bg-color--semi-light));
    color: var(--text-color--default);
  }

  button.icon.danger:hover {
    color: var(--mods-err);
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  .error {
    font-size: 12px;
    color: var(--mods-err);
  }

  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--text-color--pretty-light);
  }
`;
export default cssStr;
