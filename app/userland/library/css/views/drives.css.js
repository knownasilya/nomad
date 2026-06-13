import { css } from 'beaker://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'beaker://app-stdlib/css/com/spinner.css.js';

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
    text-decoration: underline;
    cursor: pointer;
  }

  /* Column header */

  .drives-header {
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 30px;
    border-bottom: 1px solid var(--border-color--semi-light);
    background: var(--bg-color--secondary);
    position: sticky;
    top: 0;
    z-index: 1;
    user-select: none;
  }

  .drives-header .col {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color--pretty-light);
    letter-spacing: 0.3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drives-header .col-icon {
    flex: 0 0 30px;
  }

  .drives-header .col-title {
    flex: 1;
  }

  .drives-header .col-owner {
    flex: 0 0 44px;
    text-align: right;
  }

  .drives-header .col-updated {
    flex: 0 0 80px;
    text-align: right;
  }

  .drives-header .col-peers {
    flex: 0 0 60px;
    text-align: right;
    padding-right: 36px;
  }

  /* Drive rows */

  .drives {
    font-size: 13px;
    user-select: none;
  }

  .drives .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    color: var(--text-color--light);
    font-size: 14px;
    text-align: center;
    gap: 12px;
  }

  .drives .empty .fas {
    font-size: 40px;
    color: var(--text-color--very-light);
  }

  :host(.top-border) .drive:first-child {
    border-top: 1px solid var(--border-color--very-light);
  }

  .drive {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 36px;
    color: var(--text-color--lightish);
    border-bottom: 1px solid var(--border-color--very-light);
    transition: background 0.08s;
  }

  :host([simple]) .drive {
    border: 0;
    padding: 6px 8px;
    height: auto;
  }

  .drive:hover {
    text-decoration: none !important;
    background: var(--lib-row-hover-bg);
  }

  .drive > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Icon */

  .drive .favicon {
    display: block;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    object-fit: contain;
    border-radius: 4px;
    margin-right: 10px;
  }

  :host([simple]) .drive .favicon {
    margin-right: 8px;
  }

  /* Title */

  .drive .title {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .drive .title .drive-name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .drive .title a {
    color: var(--text-color--default);
    letter-spacing: 0;
    font-weight: 500;
  }

  .drive .fork-label {
    font-size: 11px;
    color: var(--text-color--pretty-light);
    font-weight: 400;
    flex-shrink: 0;
  }

  /* Tags */

  .tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    background: var(--bg-color--semi-light);
    color: var(--text-color--light);
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    flex-shrink: 0;
  }

  /* Owner */

  .drive .owner {
    flex: 0 0 44px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color--very-light);
    text-align: right;
    letter-spacing: 0.2px;
  }

  .drive .owner.mine {
    color: var(--lib-nav-active-text);
  }

  /* Updated */

  .drive .updated {
    flex: 0 0 80px;
    font-size: 11px;
    color: var(--text-color--very-light);
    text-align: right;
  }

  /* Forks - hidden, shown inline in title */

  .drive .forks {
    display: none;
  }

  /* Peers */

  .drive .peers {
    flex: 0 0 60px;
    font-size: 11px;
    color: var(--text-color--very-light);
    text-align: right;
    min-width: 50px;
  }

  /* Controls - appears on row hover */

  .drive .ctrls {
    flex: 0 0 30px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .drive:hover .ctrls {
    opacity: 1;
  }

  .drive .ctrls button {
    background: none;
    border: 0;
    box-shadow: none;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    color: var(--text-color--lightish);
    line-height: 1;
  }

  .drive .ctrls button:hover {
    background: var(--border-color--light);
  }

  /* Forks container (child drives indented) */

  .forks-container {
    position: relative;
    border-left: 2px solid var(--border-color--very-light);
    margin-left: 24px;
  }

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }

  /* Card view */

  .drives.card-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    padding: 16px;
  }

  .drives.card-view .drive {
    flex-direction: column;
    align-items: flex-start;
    height: auto;
    padding: 14px;
    border: 1px solid var(--border-color--very-light);
    border-radius: 8px;
    background: var(--bg-color--default);
    gap: 6px;
    transition: box-shadow 0.12s, background 0.08s;
  }

  .drives.card-view .drive:hover {
    background: var(--lib-row-hover-bg);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .drives.card-view .drive .favicon {
    width: 32px;
    height: 32px;
    border-radius: 7px;
    flex: 0 0 32px;
    margin-right: 0;
    margin-bottom: 2px;
  }

  .drives.card-view .drive .title {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    white-space: normal;
    margin-right: 0;
    line-height: 1.3;
  }

  .drives.card-view .drive .card-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-color--very-light);
    margin-top: 2px;
  }

  .drives.card-view .drive .card-meta span::after {
    content: '·';
    margin-left: 6px;
  }

  .drives.card-view .drive .card-meta span:last-child::after {
    content: none;
  }

  .drives.card-view .drive .ctrls {
    position: absolute;
    top: 8px;
    right: 8px;
    flex: none;
  }

  .drives.card-view .drive .owner,
  .drives.card-view .drive .updated,
  .drives.card-view .drive .peers {
    display: none;
  }

  /* Responsive */

  @media (max-width: 700px) {
    .drives-header .col-updated,
    .drive .updated {
      display: none;
    }

    .drive {
      height: 40px;
    }

    .drive .peers {
      flex: 0 0 50px;
    }

    .drives-header .col-peers {
      flex: 0 0 50px;
      padding-right: 30px;
    }
  }

  @media (max-width: 480px) {
    .drives-header .col-owner,
    .drive .owner {
      display: none;
    }

    .drives-header .col-peers,
    .drive .peers {
      display: none;
    }
  }
`;
export default cssStr;
