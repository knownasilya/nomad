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

  .bookmarks-header {
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

  .bookmarks-header .col {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color--pretty-light);
    letter-spacing: 0.3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmarks-header .col-icon {
    flex: 0 0 30px;
  }

  .bookmarks-header .col-title {
    flex: 1;
  }

  .bookmarks-header .col-url {
    flex: 1;
  }

  /* Bookmarks list */

  .bookmarks {
    font-size: 13px;
    user-select: none;
  }

  .bookmarks .empty {
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

  .bookmarks .empty .far,
  .bookmarks .empty .fas {
    font-size: 40px;
    color: var(--text-color--very-light);
  }

  /* Bookmark row */

  .bookmark {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 36px;
    color: var(--text-color--lightish);
    border-bottom: 1px solid var(--border-color--very-light);
    transition: background 0.08s;
  }

  :host(.top-border) .bookmark:first-child {
    border-top: 1px solid var(--border-color--very-light);
  }

  .bookmark:hover {
    text-decoration: none !important;
    background: var(--lib-row-hover-bg);
  }

  .bookmark > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bookmark .favicon {
    display: block;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    object-fit: contain;
    border-radius: 4px;
    margin-right: 10px;
  }

  .bookmark .title {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 8px;
  }

  .bookmark .href {
    flex: 1;
    font-size: 12px;
    color: var(--text-color--very-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmark .ctrls {
    flex: 0 0 30px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .bookmark:hover .ctrls {
    opacity: 1;
  }

  .bookmark .ctrls button {
    background: none;
    border: 0;
    box-shadow: none;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    color: var(--text-color--lightish);
    line-height: 1;
  }

  .bookmark .ctrls button:hover {
    background: var(--border-color--light);
  }

  /* Card view */

  .bookmarks.card-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    padding: 16px;
  }

  .bookmarks.card-view .bookmark {
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

  .bookmarks.card-view .bookmark:hover {
    background: var(--lib-row-hover-bg);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .bookmarks.card-view .bookmark .favicon {
    width: 32px;
    height: 32px;
    border-radius: 7px;
    flex: 0 0 32px;
    margin-right: 0;
    margin-bottom: 2px;
  }

  .bookmarks.card-view .bookmark .title {
    white-space: normal;
    line-height: 1.3;
    margin-right: 0;
  }

  .bookmarks.card-view .bookmark .href {
    font-size: 11px;
  }

  .bookmarks.card-view .bookmark .ctrls {
    position: absolute;
    top: 8px;
    right: 8px;
    opacity: 0;
    flex: none;
  }

  .bookmarks.card-view .bookmark:hover .ctrls {
    opacity: 1;
  }

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }

  /* Responsive */

  @media (max-width: 700px) {
    .bookmarks-header .col-url,
    .bookmark .href {
      display: none;
    }
  }
`;
export default cssStr;
