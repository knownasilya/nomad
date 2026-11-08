import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// My Library → Personas, on top of the Mods view's styles (cards, fields, buttons). Colors are the
// shared tokens and the Library's --lib-* tokens, so it follows light and dark mode.
const cssStr = css`
  :host {
    --personas-ok: #15803d;
    --personas-warn: #b45309;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --personas-ok: #4ade80;
      --personas-warn: #fbbf24;
    }
  }

  .notice {
    max-width: 680px;
    margin: 0 6px 14px;
    padding: 8px 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 8px;
    background: var(--bg-color--secondary);
    font-size: 12px;
    color: var(--text-color--light);
  }

  .notice .fas {
    margin-right: 4px;
  }

  .section {
    margin-top: 22px;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--light);
  }

  .avatar {
    flex: 0 0 36px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar.large {
    flex-basis: 56px;
    width: 56px;
    height: 56px;
  }

  .avatar.initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--mods-fill);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }

  .avatar.large.initial {
    font-size: 22px;
  }

  .chip-label {
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid var(--border-color--light);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color--light);
  }

  .badge {
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--mods-accent-soft);
    color: var(--mods-accent);
    font-size: 11px;
    font-weight: 600;
  }

  .summary .state.foreign-writers {
    color: var(--personas-warn);
  }

  /* The editor: one column, max 520px, in two groups (public profile, private). */
  .persona-form {
    max-width: 520px;
    margin-top: 16px;
    gap: 18px;
  }

  .persona-form fieldset {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .persona-form legend {
    width: 100%;
    margin-bottom: 12px;
    padding: 0 0 6px;
    border-bottom: 1px solid var(--border-color--very-light);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color--default);
  }

  .persona-form legend .legend-hint {
    margin-left: 6px;
    font-weight: 400;
    color: var(--text-color--pretty-light);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-color--default);
  }

  .field-label .optional {
    margin-left: 4px;
    font-weight: 400;
    color: var(--text-color--pretty-light);
  }

  .field input,
  .field textarea {
    width: 100%;
  }

  .field textarea {
    font-family: inherit;
  }

  .field input:disabled,
  .field textarea:disabled {
    opacity: 0.6;
  }

  .field-hint {
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-color--pretty-light);
  }

  .notice-hint {
    color: var(--text-color--light);
  }

  .field input.drive-url {
    font-family: var(--code-font);
    font-size: 12px;
  }

  .picture-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .picture-row .avatar.large {
    flex-basis: 64px;
    width: 64px;
    height: 64px;
  }

  .picture-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    min-width: 0;
  }

  /* Looks like a button; the real file input stays focusable for the keyboard. */
  .file-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-color--default);
    cursor: pointer;
  }

  .file-btn:hover {
    background: var(--lib-row-hover-bg, var(--bg-color--semi-light));
  }

  .file-btn:focus-within {
    border-color: var(--mods-accent);
    box-shadow: 0 0 0 3px var(--mods-accent-soft);
  }

  .file-btn .fas {
    color: var(--text-color--light);
  }

  .file-btn.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .file-btn.disabled:hover {
    background: none;
  }

  .file-btn input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .drive-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 4px 4px 10px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 12px;
  }

  .drive-label {
    flex: 0 0 auto;
    color: var(--text-color--light);
  }

  .drive-key {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--text-color--default);
  }

  .drive-row button.icon {
    height: 26px;
    width: 26px;
  }

  .icon-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--text-color--light);
    text-decoration: none;
  }

  .icon-link:hover {
    background: var(--lib-search-bg, var(--bg-color--semi-light));
    color: var(--text-color--default);
  }

  .hint-row {
    font-size: 12px;
    color: var(--text-color--pretty-light);
  }

  .hint-row code {
    color: var(--text-color--light);
    font-size: 11px;
  }

  .hint-row a {
    text-decoration: none;
  }

  .card.list {
    padding: 2px 0;
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    font-size: 13px;
  }

  .list-row + .list-row {
    border-top: 1px solid var(--border-color--very-light);
  }

  .list-row .grow {
    flex: 1;
    min-width: 0;
  }

  .list-row .hint {
    margin-left: 4px;
    font-size: 11px;
  }

  .dot {
    flex: 0 0 10px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  select {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 12px;
  }

  .favicon {
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
  }

  .meta-col .title {
    font-weight: 500;
  }

  .meta-col .title code {
    font-size: 12px;
  }

  .site-link {
    color: inherit;
    text-decoration: none;
  }

  .site-link:hover code {
    text-decoration: underline;
  }

  .inbox-row .summary {
    font-size: 12px;
    color: var(--text-color--light);
  }

  .toolbar a.link {
    margin-left: auto;
    font-size: 12px;
    text-decoration: none;
  }

  .empty.small {
    padding: 14px 6px;
    text-align: left;
    font-size: 12px;
  }

  /* Vouches (ADR-0045) */
  .toolbar button.link {
    margin-left: auto;
    font-size: 12px;
  }

  .subsection-title {
    margin: 12px 6px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-color--pretty-light);
  }

  .avatar.small {
    flex-basis: 28px;
    width: 28px;
    height: 28px;
  }

  .avatar.small.initial {
    font-size: 12px;
  }

  .vouch-row {
    align-items: flex-start;
  }

  .vouch-row .avatar {
    margin-top: 2px;
  }

  .vouch-row .note {
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--text-color--default);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .vouch-row .summary {
    font-size: 12px;
    color: var(--text-color--light);
  }

  .vouch-row .summary code {
    font-size: 11px;
  }

  .vouch-row.is-done .meta-col {
    opacity: 0.65;
  }

  .vouch-row .state.warn {
    color: var(--personas-warn);
  }

  .row-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
  }

  .notice.warn-notice {
    border-color: var(--personas-warn);
    color: var(--text-color--default);
  }

  .notice.warn-notice .fas {
    color: var(--personas-warn);
  }

  .vouch-form {
    margin-top: 0;
  }

  .form-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color--default);
  }

  .guest-line code {
    font-size: 11px;
  }
`;
export default cssStr;
