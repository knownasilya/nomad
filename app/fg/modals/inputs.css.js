import { css } from 'lit';

export default css`
  input:not([type='checkbox']):not([type='radio']):not([type='file']),
  textarea,
  select {
    height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    color: #1a1a22;
    background: #fff;
    border: 1px solid #d8d8e2;
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
    transition: border-color 0.08s, box-shadow 0.08s;
  }

  input:not([type='checkbox']):not([type='radio']):not([type='file']):focus,
  textarea:focus,
  select:focus {
    outline: 0;
    border-color: #4040e7;
    box-shadow: 0 0 0 3px rgba(64, 64, 231, 0.18);
  }

  input.has-error,
  textarea.has-error {
    border-color: #d93229;
  }

  .error {
    color: #d93229;
    font-size: 12px;
    margin: -8px 0 10px;
  }

  label {
    font-weight: 500;
    font-size: 12px;
    color: #5a5a6e;
    display: block;
    margin-bottom: 4px;
  }

  textarea {
    height: auto;
    padding: 8px 10px;
  }

  select {
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%235a5a6e' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
    cursor: pointer;
  }

  /* Toggle switch */

  .toggle {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    cursor: pointer;
    gap: 8px;
  }

  .toggle.non-fullwidth {
    justify-content: initial;
  }

  .toggle input {
    display: none;
  }

  .toggle .text {
    font-weight: 400;
    font-size: 13px;
    color: #1a1a22;
  }

  .toggle .switch {
    display: inline-block;
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
  }

  .toggle .switch:before,
  .toggle .switch:after {
    position: absolute;
    display: block;
    content: '';
  }

  .toggle .switch:before {
    width: 100%;
    height: 100%;
    border-radius: 40px;
    background: #d8d8e2;
    transition: background 0.15s;
  }

  .toggle .switch:after {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    left: 3px;
    top: 3px;
    background: #fff;
    transition: transform 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .toggle input:checked:not(:disabled) + .switch:before {
    background: #4040e7;
  }

  .toggle input:checked:not(:disabled) + .switch:after {
    transform: translateX(14px);
  }

  .toggle.disabled {
    opacity: 0.5;
    cursor: default;
  }

  input[type='checkbox'] {
    width: 14px;
    height: 14px;
    accent-color: #4040e7;
    cursor: pointer;
    margin: 0;
  }

  input[disabled][data-tooltip],
  label[disabled][data-tooltip] {
    cursor: help;
  }
`;
