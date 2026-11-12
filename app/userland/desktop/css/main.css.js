import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import commonCSS from 'nomad://app-stdlib/css/common.css.js';
import buttonsCSS from 'nomad://app-stdlib/css/buttons2.css.js';
import tooltipCSS from 'nomad://app-stdlib/css/tooltip.css.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

const cssStr = css`
  ${commonCSS}
  ${buttonsCSS}
${tooltipCSS}
${spinnerCSS}

:host {
    display: block;
  }

  a:hover {
    text-decoration: underline;
  }

  .hidden {
    display: none !important;
  }

  input:focus {
    border-color: var(--border-color--focused);
    box-shadow: 0 0 2px #7599ff77;
  }

  #topright {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 101;
  }

  #topright a {
    margin-left: 10px;
    font-size: 12px;
    opacity: 0.85;
  }

  #topright a span {
    opacity: 0.8;
    font-size: 11px;
  }

  #support-banner {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    text-align: center;
    padding: 28px;
    background: var(--bg-color--light);
    color: var(--text-color--link);
    font-size: 16px;
  }

  #support-banner .dismiss {
    color: var(--text-color--light);
    margin-left: 5px;
  }

  .release-notice {
    width: 100%;
    font-size: 14px;
    letter-spacing: 0.5px;
    text-align: center;
  }

  .release-notice .view-release-notes:hover {
    text-decoration: underline;
  }

  .release-notice .fa-rocket {
    margin-right: 5px;
  }

  .pins {
    position: relative;
    display: grid;
    margin: 24px auto 28px;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    grid-gap: 15px;
    width: 100%;
    max-width: 1000px;
    user-select: none;
  }

  .pin {
    cursor: pointer;
    position: relative;
    border-radius: 3px;
    color: inherit;
    border-radius: 3px;
    overflow: hidden;
    user-select: none;
    min-height: 100px;
  }

  .pin:hover {
    text-decoration: none;
  }

  .pin .thumb {
    display: block;
    margin: 0 auto;
    border-radius: 4px;
    width: 130px;
    height: 90px;
    line-height: 90px;
    object-fit: cover;
    object-position: top center;
    border: 1px solid var(--border-color--default);
  }

  .pin:hover .thumb {
    border-color: #889;
  }

  .pin .details {
    padding: 10px 2px 10px;
  }

  .pin .details > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pin .title {
    font-size: 12px;
    line-height: 20px;
    text-align: center;
  }

  .pin.add {
    font-size: 21px;
    color: rgba(0, 0, 150, 0.35);
    cursor: pointer;
    text-decoration: none;
  }

  .pin.add .thumb {
    background: var(--bg-color--semi-light);
    border: 0;
  }

  .pin.add:hover {
    color: rgba(0, 0, 150, 0.5);
  }

  @media (prefers-color-scheme: dark) {
    .pin.add {
      color: #89899e;
    }

    .pin.add:hover {
      color: #aeaec1;
    }
  }

  /* the dashboard (shared/home-dashboard.mjs) */

  main {
    max-width: 1080px;
    margin: 0 auto;
    padding: 64px 24px 56px;
    box-sizing: border-box;
  }

  .hello h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }

  .hello .sub {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-color--light);
  }

  .hello .space {
    color: var(--text-color--lightish);
    font-weight: 500;
  }

  .release-notice {
    margin-top: 18px;
    text-align: left;
  }

  /* Cards of different heights pack into columns, so a short one leaves no gap. */
  .board {
    columns: 3 300px;
    column-gap: 16px;
  }

  .board-loading,
  .board-failed {
    padding: 40px;
    text-align: center;
    color: var(--text-color--light);
  }

  /* The layout (ADR-0048): <nomad-genui host> places the page's parts, which stay this page's own
     elements and keep its look. Its own components (a layout the AI made can use any) take the
     page's colors. */
  nomad-genui {
    --ai-text: var(--text-color--default);
    --ai-text-muted: var(--text-color--light);
    --ai-border: var(--border-color--semi-light);
    --ai-accent: var(--home-accent);
    --ai-accent--hover: var(--home-accent);
    --ai-hover: var(--home-row-hover);
    --ai-code-bg: var(--home-soft);
    --genui-surface: var(--home-card-bg);
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-color--default);
  }

  .board.extra {
    margin-top: 16px;
    --genui-span-gap: 16px;
  }

  .layout-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 9px 14px;
    border: 1px solid var(--home-warn-border);
    border-radius: 10px;
    background: var(--home-warn-soft);
    font-size: 12.5px;
  }

  .layout-note .fas {
    color: var(--home-warn);
  }

  #topright .customize {
    font-size: 12px;
    color: inherit;
    opacity: 0.85;
  }

  #topright .customize:hover {
    color: inherit;
    opacity: 1;
  }

  #topright .customize .fas {
    font-size: 11px;
    opacity: 0.8;
  }

  /* A part keeps the gap of whatever the layout put it in: a column board, a grid, a stack. */
  .card {
    break-inside: avoid;
    margin-bottom: var(--genui-item-gap, 16px);
    background: var(--home-card-bg);
    border: 1px solid var(--border-color--semi-light);
    border-radius: 10px;
    overflow: hidden;
    min-width: 0;
  }

  .card > header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border-color--very-light);
  }

  .card > header .icon {
    width: 16px;
    text-align: center;
    color: var(--home-accent);
    font-size: 13px;
  }

  .card h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .card .count {
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--home-accent-soft);
    color: var(--home-accent);
    font-size: 11px;
    font-weight: 600;
  }

  .card .spacer {
    flex: 1;
  }

  .card .see-all {
    font-size: 12px;
    color: var(--text-color--link);
  }

  .sublabel,
  .rows .day {
    padding: 10px 14px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-color--pretty-light);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 14px;
    color: inherit;
    box-sizing: border-box;
  }

  a.row:hover,
  .row:has(a.main:hover) {
    background: var(--home-row-hover);
    text-decoration: none;
  }

  .row .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    color: inherit;
  }

  .row .main:hover {
    text-decoration: none;
  }

  .row .title,
  .row .snippet {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row .title {
    font-size: 13px;
    font-weight: 500;
  }

  .row .snippet {
    margin-top: 1px;
    font-size: 12px;
    color: var(--text-color--light);
  }

  .row .meta {
    flex-shrink: 0;
    font-size: 11.5px;
    color: var(--text-color--pretty-light);
    white-space: nowrap;
  }

  .lead {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--home-accent-soft);
    color: var(--home-accent);
    font-size: 12px;
  }

  .lead.failed {
    background: var(--home-err-soft);
    color: var(--home-err);
  }

  .lead.space {
    background: var(--home-green-soft);
    color: var(--home-green);
  }

  .lead.message {
    background: var(--home-pink-soft);
    color: var(--home-pink);
  }

  /* A card the user pinned: its program, in the page's frame, with its menu in the corner. */
  .card.pinned {
    position: relative;
    display: block;
    padding: 14px;
    overflow: visible;
  }

  /* A wide card spans the board it is in. In a column board the gap above it is its own: the
     margin under the card before it ends with that card's column. */
  .card.wide {
    column-span: all;
    grid-column: 1 / -1;
    margin-top: var(--genui-span-gap, 0px);
  }

  .card-menu {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    border: 1px solid var(--border-color--semi-light);
    background: var(--home-card-bg);
    opacity: 0;
  }

  .card.pinned:hover .card-menu,
  .card-menu:focus-visible {
    opacity: 1;
  }

  .card-menu:hover {
    background: var(--home-row-hover);
  }

  .card.pinned > .empty {
    padding: 0 28px 0 0;
  }

  .card.add-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
    min-height: 44px;
    padding: 0 14px;
    border-style: dashed;
    background: transparent;
    box-shadow: none;
    color: var(--text-color--light);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .card.add-card:hover {
    background: var(--home-soft);
    color: var(--text-color--default);
  }

  /* Needs you: what waits on the user, across the top. */
  .card.needs {
    border-color: var(--home-warn-border);
  }

  .card.needs > header {
    background: var(--home-warn-soft);
  }

  .card.needs > header .icon {
    color: var(--home-warn);
  }

  .card.needs .count {
    background: var(--home-warn-soft);
    color: var(--home-warn);
  }

  .lead.waiting {
    background: var(--home-warn-soft);
    color: var(--home-warn);
  }

  .lead.waiting.ai {
    background: var(--home-accent-soft);
    color: var(--home-accent);
  }

  .needs .row .title,
  .needs .row .snippet {
    white-space: normal;
  }

  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .actions .btn {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border-color--default);
    border-radius: 6px;
    background: var(--home-card-bg);
    box-shadow: none;
    color: var(--text-color--default);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .actions .btn:hover {
    background: var(--home-row-hover);
    text-decoration: none;
  }

  .actions .btn.primary {
    border-color: var(--home-accent);
    background: var(--home-accent);
    color: var(--home-on-accent);
  }

  .actions .btn.primary:hover {
    filter: brightness(1.08);
  }

  .actions .btn[disabled] {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 700px) {
    .needs .row {
      flex-wrap: wrap;
    }

    .needs .actions {
      margin-left: 38px;
    }
  }

  .lead .spinner.small {
    width: 10px;
    height: 10px;
    color: var(--home-accent);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    color: var(--text-color--light);
    cursor: pointer;
    font-size: 11px;
  }

  .icon-btn:hover {
    background: var(--home-soft);
    color: var(--text-color--default);
  }

  /* A notification's dismiss button shows on hover or keyboard focus. */
  .row.notice .dismiss {
    opacity: 0;
    margin-right: -6px;
  }

  .row.notice:hover .dismiss,
  .row.notice .dismiss:focus-visible {
    opacity: 1;
  }

  .link-btn {
    border: 0;
    padding: 0;
    background: none;
    box-shadow: none;
    color: var(--text-color--light);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .link-btn:hover {
    background: none;
    color: var(--text-color--default);
    text-decoration: underline;
  }

  .icon-btn.danger:hover {
    color: var(--home-err);
  }

  .events .time {
    flex-shrink: 0;
    width: 62px;
    font-size: 12px;
    color: var(--text-color--lightish);
    font-variant-numeric: tabular-nums;
  }

  .events .time.now {
    color: var(--home-accent);
    font-weight: 600;
  }

  .events .bar {
    flex-shrink: 0;
    align-self: stretch;
    width: 3px;
    margin: 2px 0;
    border-radius: 2px;
    background: var(--home-accent);
  }

  .files {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 12px 14px 14px;
  }

  .file {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    color: inherit;
  }

  .file:hover {
    text-decoration: none;
  }

  .file-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-color--semi-light);
    color: var(--text-color--light);
    font-size: 20px;
    border: 1px solid var(--border-color--very-light);
  }

  .file:hover .file-thumb {
    border-color: var(--border-color--default);
  }

  .file-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .file-name {
    font-size: 11px;
    color: var(--text-color--lightish);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    margin: 0;
    padding: 14px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .empty a {
    color: var(--text-color--link);
  }

  @media (max-width: 700px) {
    main {
      padding-top: 48px;
    }
  }
`;
export default cssStr;
