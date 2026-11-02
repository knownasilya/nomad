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

  .fields label.grow,
  .profile-row label.grow {
    flex: 1;
    min-width: 220px;
  }

  .fields input.drive-url {
    width: 100%;
    font-family: var(--code-font);
  }

  .profile-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .profile-row label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .picture {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .file-btn {
    font-size: 12px;
    color: var(--mods-accent);
    cursor: pointer;
  }

  .file-btn.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .file-btn input {
    display: none;
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

  .empty.small {
    padding: 14px 6px;
    text-align: left;
    font-size: 12px;
  }
`;
export default cssStr;
