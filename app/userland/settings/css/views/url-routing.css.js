import { css } from 'lit';
import colorsCSS from '../../../app-stdlib/css/colors.css.js';
import buttonsCSS from '../../../app-stdlib/css/buttons2.css.js';

const cssStr = css`
  ${colorsCSS}
  ${buttonsCSS}

  :host {
    display: block;
    max-width: 700px;
  }

  .section {
    margin-bottom: 16px;
  }

  .message {
    margin: 0 0 16px;
    background: var(--bg-color--message, var(--bg-color--semi-light));
    padding: 10px 12px;
    border-radius: 4px;
    color: var(--text-color--light);
  }

  .message a {
    color: var(--text-color--link);
  }

  .empty {
    color: var(--text-color--light);
    padding: 14px 0;
  }

  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

  .rule-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border-color--semi-light);
    border-radius: 4px;
    background: var(--bg-color--default);
  }

  .rule-row.disabled {
    opacity: 0.55;
  }

  .rule-row.dragging {
    opacity: 0.4;
  }

  .rule-row.drop-before {
    box-shadow: 0 -2px 0 0 var(--blue);
  }

  .rule-row.drop-after {
    box-shadow: 0 2px 0 0 var(--blue);
  }

  .rule-row .drag-handle {
    flex: 0 0 auto;
    color: var(--text-color--pretty-light);
    cursor: grab;
  }

  .rule-row .drag-handle:hover {
    color: var(--text-color--default);
  }

  .rule-row .drag-handle:active {
    cursor: grabbing;
  }

  .rule-row input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border-radius: 4px;
    color: var(--text-color--default);
    background: var(--bg-color--default);
    border: 1px solid var(--border-color--default);
  }

  .rule-row input[type='text']:focus {
    outline: 0;
    border-color: var(--blue);
  }

  .rule-row select {
    flex: 0 0 auto;
    height: 26px;
    max-width: 160px;
    border-radius: 4px;
    color: var(--text-color--default);
    background: var(--bg-color--default);
    border: 1px solid var(--border-color--default);
  }

  .rule-row .arrow {
    color: var(--text-color--pretty-light);
    flex: 0 0 auto;
  }

  .rule-row .reorder-btns {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
  }

  .rule-row .reorder-btns a {
    color: var(--text-color--pretty-light);
    cursor: pointer;
    line-height: 1;
    padding: 1px 2px;
  }

  .rule-row .reorder-btns a.disabled {
    color: var(--text-color--very-light);
    cursor: default;
    pointer-events: none;
  }

  .rule-row .enabled-toggle {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  .rule-row .remove-btn {
    flex: 0 0 auto;
    color: var(--text-color--pretty-light);
    cursor: pointer;
    padding: 2px 4px;
  }

  .rule-row .remove-btn:hover {
    color: var(--text-color--default);
  }

  .add-rule-form {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .add-rule-form input[type='text'] {
    flex: 1 1 220px;
    min-width: 160px;
    height: 26px;
    padding: 0 8px;
    border-radius: 4px;
    color: var(--text-color--default);
    background: var(--bg-color--default);
    border: 1px solid var(--border-color--default);
  }

  .add-rule-form select {
    flex: 0 0 auto;
    height: 26px;
    max-width: 160px;
    border-radius: 4px;
    color: var(--text-color--default);
    background: var(--bg-color--default);
    border: 1px solid var(--border-color--default);
  }

  .hint {
    color: var(--text-color--pretty-light);
    font-size: 12px;
    margin-top: 6px;
  }
`;
export default cssStr;
