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

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }
`;
export default cssStr;
