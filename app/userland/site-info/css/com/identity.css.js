import { css } from 'lit';
import buttonsCSS from '../../../app-stdlib/css/buttons2.css.js';
import formCSS from '../form.css.js';

const cssStr = css`
  ${formCSS}
  ${buttonsCSS}

p {
    margin: 5px 0;
  }

  a {
    cursor: pointer;
    color: var(--text-color--link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  button {
    font-size: 11px;
  }

  .field-group {
    position: relative;
    display: block;
    padding: 12px 18px;
    border: 0;
  }

  .field-group:empty {
    display: none;
  }

  .field-group > div {
    margin-bottom: 5px;
  }

  .identity {
    font-size: 13px;
  }

  .verifier,
  .verifier a {
    color: var(--text-color--verifier);
  }

  .person-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .person-actions > div {
    margin: 0;
  }

  .vouch-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .vouches-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-color--light);
  }

  .vouch-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .vouch {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
  }

  .vouch-avatar {
    flex: 0 0 22px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }

  .vouch-avatar.initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    background: var(--bg-color--light);
    border: 1px solid var(--border-color--default);
    color: var(--text-color--default);
    font-size: 11px;
    font-weight: 600;
  }

  .vouch-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .vouch-note {
    color: var(--text-color--default);
    overflow-wrap: anywhere;
  }

  .vouch-text code {
    font-size: 10.5px;
  }

  .muted {
    color: var(--text-color--light);
  }

  .link-btn {
    margin-top: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-color--link);
    font-size: 12px;
    cursor: pointer;
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .vouches-hint {
    margin-top: 8px;
    font-size: 11px;
  }

  .toggle-save-contact-btn {
    position: absolute;
    top: 8px;
    right: 5px;
  }
`;
export default cssStr;
