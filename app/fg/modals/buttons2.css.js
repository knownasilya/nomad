import { css } from 'lit';

const cssStr = css`
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0 12px;
    background: #fff;
    border: 1px solid #d8d8e2;
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    color: #1a1a22;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    outline: 0;
    white-space: nowrap;
    transition:
      background 0.08s,
      border-color 0.08s;
  }

  button:hover {
    background: #f4f4f8;
    border-color: #c8c8d4;
  }

  button:active {
    background: #eeeef4;
    transform: scale(0.98);
  }

  button:focus-visible {
    box-shadow: 0 0 0 3px rgba(64, 64, 231, 0.2);
  }

  button[disabled],
  button:disabled {
    opacity: 0.45;
    cursor: default;
    pointer-events: none;
  }

  button.primary {
    background: #4040e7;
    border-color: #3535c4;
    color: #fff;
    box-shadow: 0 1px 3px rgba(64, 64, 231, 0.3);
  }

  button.primary:hover {
    background: #3535cc;
    border-color: #2b2baa;
  }

  button.primary:active {
    background: #2b2baa;
  }

  button.cancel {
    color: #5a5a6e;
  }

  button.transparent {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
    color: #5a5a6e;
  }

  button.transparent:hover {
    background: #f4f4f8;
    border-color: transparent;
  }

  button.pressed {
    background: #e8e8f0;
    border-color: #c8c8d4;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .btn-group {
    display: flex;
    gap: 6px;
  }

  .radio-group button {
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  .radio-group button.pressed {
    background: #e8e8f0;
    border-radius: 20px;
  }
`;
export default cssStr;
