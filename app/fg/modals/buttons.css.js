import { css } from 'lit';

export default css`
  button {
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    outline: 0;
  }

  button:disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .btn {
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
    white-space: nowrap;
    letter-spacing: 0;
    transition: background 0.08s, border-color 0.08s;
  }

  .btn:hover {
    text-decoration: none;
    background: #f4f4f8;
    border-color: #c8c8d4;
  }

  .btn:active {
    background: #eeeef4;
    transform: scale(0.98);
  }

  .btn:focus {
    box-shadow: 0 0 0 3px rgba(64, 64, 231, 0.2);
    outline: 0;
  }

  .btn.small {
    height: 26px;
    font-size: 11px;
    padding: 0 9px;
  }

  .btn.plain {
    background: none;
    border: none;
    box-shadow: none;
    color: #5a5a6e;
    padding: 0 6px;
  }

  .btn.plain:hover {
    color: #1a1a22;
    background: #f4f4f8;
    border-radius: 4px;
  }

  .btn.plain:focus {
    box-shadow: none;
  }

  .btn.cancel {
    color: #5a5a6e;
  }

  .btn.pressed,
  .btn:active {
    background: #eeeef4;
    border-color: #c8c8d4;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
    transform: none;
  }

  .btn[disabled='disabled'],
  .btn.disabled,
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
    pointer-events: none;
  }

  .btn.full-width {
    width: 100%;
  }

  .btn.center {
    text-align: center;
  }

  .btn.thick {
    height: 34px;
    font-size: 13px;
    padding: 0 14px;
  }

  .btn.warning {
    color: #fff;
    background: #d93229;
    border-color: #c42d25;
  }

  .btn.warning:hover {
    background: #c42d25;
    border-color: #b0261e;
  }

  .btn.success {
    background: #41bb56;
    color: #fff;
    border-color: #38a34b;
  }

  .btn.success:hover {
    background: #38a34b;
  }

  .btn.transparent {
    border-color: transparent;
    background: none;
    box-shadow: none;
    color: #5a5a6e;
  }

  .btn.transparent:hover {
    background: #f4f4f8;
    border-color: transparent;
  }

  .btn.primary {
    background: #4040e7;
    border-color: #3535c4;
    color: #fff;
    box-shadow: 0 1px 3px rgba(64, 64, 231, 0.3);
  }

  .btn.primary:hover {
    background: #3535cc;
    border-color: #2b2baa;
  }

  .btn.primary:focus {
    box-shadow: 0 0 0 3px rgba(64, 64, 231, 0.2);
  }
`;
