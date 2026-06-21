import { css } from 'lit';
import colorsCSS from '../../../app-stdlib/css/colors.css.js';
import buttonsCSS from '../../../app-stdlib/css/buttons2.css.js';
import tooltipCSS from '../../../app-stdlib/css/tooltip.css.js';
import spinnerCSS from '../../../app-stdlib/css/com/spinner.css.js';

const cssStr = css`
  ${colorsCSS}
  ${buttonsCSS}
  ${tooltipCSS}
  ${spinnerCSS}

  :host {
    display: block;
    max-width: 600px;
  }

  a {
    color: var(--blue);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }

  h2 {
    font-size: 16px;
    margin: 0 0 12px;
  }

  .section {
    margin-bottom: 32px;
  }

  .hint {
    color: var(--text-color--light);
    font-size: 13px;
    line-height: 1.5;
    margin: 8px 0 0;
  }

  .message {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 1em 0;
    padding: 10px 12px;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.5;
  }
  .message.warning {
    background: #fff8e1;
    color: #5f4e06;
  }
  .message.error {
    background: #fdecea;
    color: #8d2b20;
  }

  /* device + request rows */
  .list {
    border: 1px solid var(--border-color--light);
    border-radius: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
  }
  .row + .row {
    border-top: 1px solid var(--border-color--light);
  }
  .row .icon {
    font-size: 18px;
    color: var(--text-color--light);
    width: 22px;
    text-align: center;
  }
  .row .body {
    flex: 1;
    min-width: 0;
  }
  .row .name {
    font-weight: 500;
  }
  .row .meta {
    color: var(--text-color--light);
    font-size: 12px;
    margin-top: 2px;
  }
  .row .tag {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--bg-color--light);
    color: var(--text-color--light);
  }
  .row .tag.this {
    background: var(--blue);
    color: #fff;
  }

  .empty-state {
    color: var(--text-color--light);
    font-size: 14px;
    padding: 16px;
    text-align: center;
    border: 1px dashed var(--border-color--light);
    border-radius: 4px;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-color--light);
    padding: 12px 0;
  }

  /* invite */
  .invite-code {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 12px 0;
  }
  .invite-code code {
    flex: 1;
    font-family: var(--code-font, monospace);
    font-size: 13px;
    word-break: break-all;
    background: var(--bg-color--light);
    border: 1px solid var(--border-color--light);
    border-radius: 4px;
    padding: 10px 12px;
  }
  .qr {
    margin: 12px 0;
    padding: 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 4px;
    text-align: center;
  }
  .qr canvas,
  .qr img {
    width: 180px;
    height: 180px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .join-form {
    display: flex;
    gap: 8px;
    margin: 12px 0;
  }
  .join-form input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 13px;
  }

  .rename-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 14px;
  }
`;
export default cssStr;
