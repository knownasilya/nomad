import { css } from 'lit';
import editorsCSS from './drive-editors.css.js';

// The Online tab shares the Editors tab's cards and lists, and adds a switch.
const cssStr = css`
  ${editorsCSS}

  :host {
    --drive-online-warn-bg: rgba(220, 140, 20, 0.1);
    --drive-online-warn: #b06a00;
    --drive-online-ok: #2a8a4a;
    --drive-online-switch-off: #c9ccd3;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --drive-online-warn-bg: rgba(240, 170, 60, 0.14);
      --drive-online-warn: #f0b860;
      --drive-online-ok: #6fd08f;
      --drive-online-switch-off: #4a4d55;
    }
  }

  .card.warn {
    background: var(--drive-online-warn-bg);
  }

  .card.warn .fas {
    color: var(--drive-online-warn);
  }

  .card.ok .fas {
    color: var(--drive-online-ok);
  }

  .list {
    margin-top: 2px;
  }

  .foot a {
    color: var(--text-color--link);
  }

  .toggle {
    position: relative;
    display: inline-block;
    width: 30px;
    height: 17px;
    flex: none;
    cursor: pointer;
  }

  .toggle input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .toggle .switch {
    position: absolute;
    inset: 0;
    border-radius: 9px;
    background: var(--drive-online-switch-off);
    transition: background 0.15s;
    pointer-events: none;
  }

  .toggle .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }

  .toggle input:checked + .switch {
    background: var(--drive-editors-accent);
  }

  .toggle input:checked + .switch::after {
    transform: translateX(13px);
  }

  .toggle input:disabled + .switch {
    opacity: 0.55;
  }

  .toggle input:focus-visible + .switch {
    box-shadow: 0 0 0 2px var(--drive-editors-accent-bg);
  }
`;
export default cssStr;
