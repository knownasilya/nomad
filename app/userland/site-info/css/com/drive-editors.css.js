import { css } from 'lit';
import buttonsCSS from '../../../app-stdlib/css/buttons2.css.js';

const cssStr = css`
  ${buttonsCSS}

  :host {
    display: block;
    padding: 10px;
    --drive-editors-accent: #2864dc;
    --drive-editors-accent-bg: rgba(40, 100, 220, 0.08);
    --drive-editors-ok-bg: rgba(40, 150, 80, 0.08);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --drive-editors-accent: #8fb0ff;
      --drive-editors-accent-bg: rgba(120, 160, 255, 0.12);
      --drive-editors-ok-bg: rgba(90, 200, 120, 0.12);
    }
  }

  button {
    padding: 5px 8px;
    font-size: 11px;
    white-space: nowrap;
  }

  button.icon {
    padding: 5px 6px;
  }

  h4 {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-color--light);
  }

  .hint {
    font-size: 11px;
    color: var(--text-color--light);
  }

  .hint.foot {
    margin-top: 6px;
  }

  .muted {
    color: var(--text-color--light);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.4;
  }

  .card .fas {
    margin-top: 2px;
    color: var(--drive-editors-accent);
  }

  .card.invite {
    background: var(--drive-editors-accent-bg);
    align-items: center;
  }

  .card.ok {
    background: var(--drive-editors-ok-bg);
  }

  .list {
    border: 1px solid var(--border-color--default);
    border-radius: 6px;
    overflow: hidden;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    font-size: 12px;
  }

  .item + .item {
    border-top: 1px solid var(--border-color--default);
  }

  .item .grow > div:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
export default cssStr;
