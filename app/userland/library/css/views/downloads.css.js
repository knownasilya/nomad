import { css } from 'beaker://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'beaker://app-stdlib/css/com/spinner.css.js';

const cssStr = css`
  ${spinnerCSS}

  :host {
    display: block;
  }

  a {
    text-decoration: none;
  }

  a[href]:hover {
    text-decoration: underline;
  }

  /* Downloads list */

  .downloads {
    font-size: 13px;
  }

  .downloads .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    color: var(--text-color--light);
    font-size: 14px;
    text-align: center;
  }

  /* Download row */

  .download {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    color: var(--text-color--default);
    border-bottom: 1px solid var(--border-color--very-light);
    gap: 12px;
    transition: background 0.08s;
  }

  .download:hover {
    background: var(--lib-row-hover-bg);
  }

  .download .title {
    flex: 1;
    min-width: 0;
  }

  .download .title strong {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color--default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .download .title .url {
    font-size: 11px;
    color: var(--text-color--very-light);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .download .metadata {
    flex: 0 0 260px;
    font-size: 12px;
    color: var(--text-color--light);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .download .metadata progress {
    width: 80px;
    height: 4px;
    accent-color: var(--text-color--link);
  }

  .download .link {
    color: var(--text-color--link);
    cursor: pointer;
    font-size: 12px;
  }

  .download .link:hover {
    text-decoration: underline;
  }

  .download .controls {
    flex: 0 0 60px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }

  .download .controls button {
    background: none;
    border: 0;
    box-shadow: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    color: var(--text-color--lightish);
    line-height: 1;
    font-size: 13px;
  }

  .download .controls button:hover {
    background: var(--border-color--light);
  }

  /* Loading */

  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
  }
`;
export default cssStr;
