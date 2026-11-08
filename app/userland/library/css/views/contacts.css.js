import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

const cssStr = css`
  ${spinnerCSS}

  :host {
    display: block;
  }

  a {
    text-decoration: none;
    cursor: initial;
  }

  a[href]:hover {
    text-decoration: none;
    cursor: pointer;
  }

  .contacts {
    font-size: 13px;
    user-select: none;
  }

  .contacts .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    color: var(--text-color--light);
    font-size: 14px;
    text-align: center;
    gap: 10px;
  }

  .contacts .empty .far,
  .contacts .empty .fas {
    font-size: 40px;
    color: var(--text-color--very-light);
  }

  .contacts .empty .empty-hint {
    font-size: 12px;
    color: var(--text-color--very-light);
  }

  /* Contact row (list view) */

  .contact {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 48px;
    color: var(--text-color--lightish);
    border-bottom: 1px solid var(--border-color--very-light);
    transition: background 0.08s;
  }

  .contact:hover {
    background: var(--lib-row-hover-bg);
  }

  .contact .avatar {
    display: block;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 50%;
    margin-right: 12px;
    background: var(--bg-color--secondary);
  }

  .contact .info {
    flex: 1;
    min-width: 0;
  }

  .contact .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contact .sub {
    font-size: 12px;
    color: var(--text-color--very-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contact .peers {
    font-size: 11px;
    color: var(--text-color--light);
    margin-top: 2px;
  }

  .contact .ctrls {
    flex: 0 0 30px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .contact:hover .ctrls {
    opacity: 1;
  }

  .contact .ctrls button {
    background: none;
    border: 0;
    box-shadow: none;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    color: var(--text-color--lightish);
    line-height: 1;
  }

  .contact .ctrls button:hover {
    background: var(--border-color--light);
  }

  /* Card view */

  .contacts.card-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding: 16px;
  }

  .contacts.card-view .contact {
    flex-direction: column;
    align-items: center;
    text-align: center;
    height: auto;
    padding: 20px 14px 16px;
    border: 1px solid var(--border-color--very-light);
    border-radius: 8px;
    background: var(--bg-color--default);
    gap: 4px;
    transition: box-shadow 0.12s, background 0.08s;
  }

  .contacts.card-view .contact:hover {
    background: var(--lib-row-hover-bg);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .contacts.card-view .contact .avatar {
    width: 56px;
    height: 56px;
    flex: 0 0 56px;
    margin-right: 0;
    margin-bottom: 8px;
  }

  .contacts.card-view .contact .info {
    width: 100%;
  }

  .contacts.card-view .contact .ctrls {
    position: absolute;
    top: 8px;
    right: 8px;
    opacity: 0;
    flex: none;
  }

  .contacts.card-view .contact:hover .ctrls {
    opacity: 1;
  }

  /* Household contacts (the Space's address book) */

  :host {
    --hc-fill: #4f46e5; /* white text reads on it in both modes */
    --hc-err: #dc2626;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --hc-err: #f87171;
    }
  }

  .section-title {
    margin: 0;
    padding: 18px 16px 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color--default);
  }

  .household {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color--very-light);
  }

  .household-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-right: 16px;
  }

  .household-head button {
    margin-top: 14px;
  }

  .household-hint {
    padding: 0 16px 8px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .household button {
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

  .household button:hover {
    background: var(--lib-row-hover-bg, var(--bg-color--semi-light));
  }

  .household button[disabled] {
    opacity: 0.6;
    cursor: default;
  }

  .household button.primary {
    border-color: var(--hc-fill);
    background: var(--hc-fill);
    color: #fff;
  }

  .household button.icon {
    width: 28px;
    height: 28px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-color--light);
  }

  .household button.icon:hover {
    background: var(--border-color--light);
    color: var(--text-color--default);
  }

  .household button.icon.danger:hover {
    color: var(--hc-err);
  }

  .hc-empty {
    padding: 4px 16px 10px;
    font-size: 12px;
    color: var(--text-color--very-light);
  }

  .hc {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-color--very-light);
  }

  .hc:hover {
    background: var(--lib-row-hover-bg);
  }

  .hc-avatar {
    flex: 0 0 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-color--secondary);
    color: var(--text-color--lightish);
    font-weight: 600;
  }

  .hc-info {
    flex: 1;
    min-width: 0;
  }

  .hc-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
  }

  .hc-role {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-color--secondary);
    color: var(--text-color--light);
    font-size: 11px;
    font-weight: 500;
  }

  .hc-lines {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-color--lightish);
  }

  .hc-lines a {
    color: inherit;
  }

  .hc-lines a:hover {
    color: var(--text-color--link, var(--text-color--default));
    text-decoration: underline;
  }

  .hc-lines .fas,
  .hc-lines .far {
    margin-right: 3px;
    color: var(--text-color--very-light);
  }

  .hc-notes,
  .hc-by {
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-color--light);
    white-space: pre-wrap;
  }

  .hc-by {
    color: var(--text-color--very-light);
  }

  .hc-ctrls {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .hc:hover .hc-ctrls,
  .hc-ctrls:focus-within {
    opacity: 1;
  }

  .hc-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
    margin: 4px 16px 12px;
    padding: 14px;
    border: 1px solid var(--border-color--light);
    border-radius: 8px;
    background: var(--bg-color--default);
  }

  .hc-form .wide {
    grid-column: 1 / -1;
  }

  .hc-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .hc-field input,
  .hc-field textarea {
    padding: 6px 8px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font: inherit;
    font-size: 13px;
    resize: vertical;
  }

  .hc-field input:focus,
  .hc-field textarea:focus {
    outline: 0;
    border-color: var(--border-color--focused, var(--hc-fill));
  }

  .hc-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .form-error {
    padding: 0 16px;
    font-size: 12px;
    color: var(--hc-err);
  }

  .hc-form .form-error {
    padding: 0;
  }

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }
`;
export default cssStr;
