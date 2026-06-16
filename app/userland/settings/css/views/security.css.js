import { css } from 'lit';
import colorsCSS from '../../../app-stdlib/css/colors.css.js';
import buttonsCSS from '../../../app-stdlib/css/buttons2.css.js';

const cssStr = css`
  ${colorsCSS}
  ${buttonsCSS}

  :host {
    display: block;
    max-width: 600px;
  }

  .form-group {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }

  .form-group h2 {
    margin: 0;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color);
  }

  .empty-state {
    padding: 20px 0 12px;
    color: var(--text-color--light);
    font-size: 13px;
  }

  .domain-list {
    margin-top: 8px;
  }

  .domain-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 0;
    border-bottom: 1px solid var(--border-color--light);
    font-size: 13px;
  }

  .domain-row:last-child {
    border-bottom: none;
  }

  .domain-name {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-color--default);
    word-break: break-all;
  }

  .remove-btn {
    flex-shrink: 0;
    margin-left: 12px;
    color: var(--text-color--very-light);
    cursor: pointer;
    font-size: 11px;
    background: none;
    border: none;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .remove-btn:hover {
    color: var(--red);
    background: var(--bg-color--light);
  }

  .hint {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-color--light);
    line-height: 1.5;
  }
`;
export default cssStr;
