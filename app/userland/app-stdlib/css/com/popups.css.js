import { css } from '../../vendor/lit-element/lit-element.js';
import buttonscss from '../buttons2.css.js';
import inputscss from '../inputs.css.js';
const cssStr = css`
  ${buttonscss}
  ${inputscss}

  .popup-wrapper {
    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: 6000;
    background: rgba(0, 0, 0, 0.35);
    font-style: normal;
    overflow-y: auto;
  }

  .popup-inner {
    background: var(--bg-color--default);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid var(--border-color--semi-light);
    border-radius: 8px;
    width: 450px;
    margin: 80px auto;
    overflow: hidden;
  }

  .popup-inner .error {
    color: #d93229 !important;
    margin: 8px 0 !important;
    font-size: 12px;
  }

  .popup-inner .head {
    position: relative;
    background: var(--bg-color--default);
    padding: 13px 16px 12px;
    border-bottom: 1px solid var(--border-color--semi-light);
  }

  .popup-inner .head .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color--default);
    letter-spacing: -0.1px;
  }

  .popup-inner .head .close-btn {
    position: absolute;
    top: 10px;
    right: 14px;
    cursor: pointer;
    font-size: 18px;
    color: var(--text-color--pretty-light);
    line-height: 1;
    transition: color 0.1s;
  }

  .popup-inner .head .close-btn:hover {
    color: var(--text-color--default);
  }

  .popup-inner .body {
    padding: 14px 16px;
  }

  .popup-inner .body > div:not(:first-child) {
    margin-top: 16px;
  }

  .popup-inner p:first-child {
    margin-top: 0;
  }

  .popup-inner p:last-child {
    margin-bottom: 0;
  }

  .popup-inner textarea,
  .popup-inner label:not(.checkbox-container),
  .popup-inner select,
  .popup-inner input {
    display: block;
    width: 100%;
  }

  .popup-inner label.toggle {
    display: flex;
    justify-content: flex-start;
  }

  .popup-inner label.toggle .text {
    margin-right: 10px;
  }

  .popup-inner label.toggle input {
    display: none;
  }

  .popup-inner label {
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-color--light);
  }

  .popup-inner textarea,
  .popup-inner input:not([type='checkbox']):not([type='radio']) {
    margin-bottom: 10px;
    height: 30px;
    padding: 0 10px;
  }

  .popup-inner textarea {
    height: 60px;
    resize: vertical;
    padding: 8px 10px;
  }

  .popup-inner .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color--semi-light);
    gap: 6px;
  }

  .popup-inner .actions .left,
  .popup-inner .actions .link,
  .popup-inner .actions .delete {
    margin-right: auto;
  }

  .popup-inner .actions .spinner {
    width: 10px;
    height: 10px;
    border-width: 1.2px;
  }

  /* Button overrides inside popups to match modal design */

  .popup-inner .actions button,
  .popup-inner .actions .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    border: 1px solid var(--border-color--semi-light);
    background: var(--bg-color--default);
    color: var(--text-color--default);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    transition: background 0.08s;
  }

  .popup-inner .actions button:hover,
  .popup-inner .actions .btn:hover {
    background: var(--bg-color--semi-light);
  }

  .popup-inner .actions button.primary,
  .popup-inner .actions .btn.primary {
    background: #4040e7;
    border-color: #3535c4;
    color: #fff;
    box-shadow: 0 1px 3px rgba(64, 64, 231, 0.3);
  }

  .popup-inner .actions button.primary:hover,
  .popup-inner .actions .btn.primary:hover {
    background: #3535cc;
  }

  .popup-inner .actions button.delete,
  .popup-inner .actions .btn.delete {
    color: #d93229;
    border-color: rgba(217, 50, 41, 0.3);
    background: rgba(217, 50, 41, 0.05);
  }

  .popup-inner .actions button.delete:hover,
  .popup-inner .actions .btn.delete:hover {
    background: rgba(217, 50, 41, 0.1);
  }
`;
export default cssStr;
