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

  /* Column header */

  .history-header {
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

  .history-header .col {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-color--pretty-light);
    letter-spacing: 0.3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-header .col-icon { flex: 0 0 30px; }
  .history-header .col-title { flex: 1; }
  .history-header .col-url { flex: 1; }

  /* Links list */

  .links {
    font-size: 13px;
    user-select: none;
  }

  .links .empty {
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

  .links .empty .fas {
    font-size: 40px;
    color: var(--text-color--very-light);
  }

  /* Link row */

  .link {
    display: flex;
    align-items: center;
    padding: 0 14px;
    height: 36px;
    color: var(--text-color--lightish);
    border-bottom: 1px solid var(--border-color--very-light);
    transition: background 0.08s;
  }

  :host(.top-border) .link:first-child {
    border-top: 1px solid var(--border-color--very-light);
  }

  .link:hover {
    text-decoration: none;
    background: var(--lib-row-hover-bg);
  }

  .link > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link img {
    display: block;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    object-fit: contain;
    border-radius: 4px;
    margin-right: 10px;
  }

  .link .title {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
    margin-right: 8px;
  }

  .link .url {
    flex: 1;
    font-size: 12px;
    color: var(--text-color--very-light);
  }

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }

  /* Responsive */

  @media (max-width: 700px) {
    .history-header .col-url,
    .link .url {
      display: none;
    }
  }
`;
export default cssStr;
