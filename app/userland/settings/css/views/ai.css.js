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

  a {
    color: var(--blue);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .form-group {
    border: 1px solid var(--border-color--semi-light);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }

  .form-group h2 {
    margin: 0;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color--semi-light);
  }

  .form-group .section {
    margin-bottom: 0;
    padding: 0 10px 4px;
  }

  .form-group .section:not(:last-child) {
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color--semi-light);
  }

  .form-group .section > :first-child {
    margin-top: 16px;
  }

  label {
    font-weight: 600;
    display: block;
    margin-bottom: 4px;
  }

  p.description {
    margin: 4px 0 8px;
    color: var(--text-color--light);
    font-size: 13px;
  }

  input[type='text'] {
    height: 24px;
    padding: 0 7px;
    border-radius: 4px;
    color: rgba(51, 51, 51, 0.95);
    border: 1px solid #d9d9d9;
    box-shadow: inset 0 1px 2px #0001;
  }

  input[type='text']:focus {
    outline: 0;
    border: 1px solid rgba(41, 95, 203, 0.8);
    box-shadow: 0 0 0 2px rgba(41, 95, 203, 0.2);
  }

  .badge-experimental {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--blue, #4a7fcb);
    color: #fff;
    vertical-align: middle;
    letter-spacing: 0.3px;
  }
`;
export default cssStr;
