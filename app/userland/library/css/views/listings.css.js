import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

const cssStr = css`
  :host {
    display: block;
    padding: 6px 4px 40px;
  }

  .intro {
    color: #64748b;
    font-size: 13px;
    line-height: 1.5;
    margin: 4px 6px 16px;
    max-width: 640px;
  }

  .empty {
    color: #94a3b8;
    text-align: center;
    padding: 40px 0;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    background: #fff;
  }
  .row.listed {
    border-color: #c7d2fe;
    box-shadow: 0 0 0 1px #eef2ff inset;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #4f46e5;
    background: #eef2ff;
    border-radius: 999px;
    padding: 1px 7px;
  }
  .url {
    font-size: 12px;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: 12px;
    color: #94a3b8;
    flex-shrink: 0;
  }
  .row.listed .state {
    color: #4f46e5;
    font-weight: 600;
  }

  /* toggle switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 22px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch {
    position: absolute;
    inset: 0;
    background: #cbd5e1;
    border-radius: 999px;
    transition: background 0.15s;
  }
  .switch::before {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.15s;
  }
  .toggle input:checked + .switch {
    background: #4f46e5;
  }
  .toggle input:checked + .switch::before {
    transform: translateX(16px);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }
  .fields label {
    display: block;
  }
  .flabel {
    display: block;
    font-size: 12px;
    color: #334155;
    margin-bottom: 4px;
  }
  .flabel em {
    color: #94a3b8;
    font-style: normal;
  }
  .fields input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .actions button {
    cursor: pointer;
    padding: 6px 14px;
    border: 1px solid #4f46e5;
    background: #4f46e5;
    color: #fff;
    border-radius: 6px;
    font-size: 13px;
  }
  .actions button[disabled] {
    opacity: 0.6;
    cursor: default;
  }
  .status {
    font-size: 12px;
    color: #16a34a;
  }
`;

export default cssStr;
