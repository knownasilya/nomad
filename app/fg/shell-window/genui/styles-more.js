// Styles for the second set of components (ADR-0048; genui/more.js, forms.js) and for what the
// first set gained: colors, styles and sizes, icons and slots. A color class (.primary, .info, …)
// only sets variables (--callout-fg, -bg, -border, and --c-solid with --c-on for a filled one),
// as in styles.js; the component decides what to paint with them.

import { css } from 'lit';

export default css`
  :host {
    --genui-primary: var(--genui-accent);
    --genui-primary-bg: color-mix(in srgb, var(--genui-accent) 11%, transparent);
    --genui-primary-border: color-mix(in srgb, var(--genui-accent) 32%, transparent);
    --genui-info-solid: #2466c2;
    --genui-success-solid: #1f7d3d;
    --genui-warning-solid: #9a6400;
    --genui-error-solid: #b42a2a;
    --genui-neutral-solid: #5b5b66;
    --genui-on-solid: #fff;
    --genui-field-bg: var(--bg-color--foreground, #fff);
    --genui-item-gap: 0px;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --genui-primary: #9cb8ff;
      --genui-primary-bg: color-mix(in srgb, var(--genui-accent) 20%, transparent);
      --genui-primary-border: color-mix(in srgb, var(--genui-accent) 45%, transparent);
      --genui-info-solid: #2f6fd0;
      --genui-success-solid: #2a8a48;
      --genui-warning-solid: #a36d00;
      --genui-error-solid: #c0392b;
      --genui-neutral-solid: #6b6b76;
    }
  }

  .primary {
    --callout-fg: var(--genui-primary);
    --callout-bg: var(--genui-primary-bg);
    --callout-border: var(--genui-primary-border);
    --c-solid: var(--genui-accent);
  }
  .info {
    --c-solid: var(--genui-info-solid);
  }
  .success {
    --c-solid: var(--genui-success-solid);
  }
  .warning {
    --c-solid: var(--genui-warning-solid);
  }
  .error,
  .danger {
    --c-solid: var(--genui-error-solid);
  }
  .neutral {
    --c-solid: var(--genui-neutral-solid);
  }

  .icon-btn {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--genui-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--ai-hover, rgba(0, 0, 0, 0.05));
    color: inherit;
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible,
  .control:focus-visible {
    outline: 2px solid var(--genui-accent);
    outline-offset: 1px;
  }
  .slot-text {
    font-size: 12px;
    color: var(--genui-muted);
  }
  .trailing {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 55%;
    margin-left: auto;
  }
  .trailing .buttons {
    flex-wrap: nowrap;
  }
  .leading {
    flex: none;
    display: flex;
    align-items: center;
  }
  .chev {
    flex: none;
    font-size: 10px;
    color: var(--genui-muted);
    transition: transform 0.12s;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }

  /* — layout — */

  .stack.packed > *,
  .stack.row.packed > *,
  .stack.row.wrap.packed > * {
    flex: 0 1 auto;
  }
  .grid-wrap {
    container-type: inline-size;
    min-width: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
    gap: 12px;
    align-items: stretch;
    --genui-item-gap: 0px;
  }
  /* Children of a row are as tall as the tallest, a GridItem's one child included. */
  .grid-item > *,
  .grid-item > slot::slotted(*) {
    flex: 1 1 auto;
  }
  .grid.c1 {
    --cols: 1;
  }
  .grid.c3 {
    --cols: 3;
  }
  .grid.c4 {
    --cols: 4;
  }
  .grid > * {
    min-width: 0;
  }
  .grid-item.span2 {
    grid-column: span 2;
  }
  .grid-item.span3 {
    grid-column: span 3;
  }
  .grid-item.span4 {
    grid-column: span 4;
  }
  @container (max-width: 760px) {
    .grid.c3,
    .grid.c4 {
      --cols: 2;
    }
    .grid-item.span3,
    .grid-item.span4 {
      grid-column: 1 / -1;
    }
  }
  @container (max-width: 280px) {
    .grid.c2,
    .grid.c3,
    .grid.c4 {
      --cols: 1;
    }
    .grid .grid-item {
      grid-column: auto;
    }
  }
  /* Cards of different heights pack top to bottom, so a short one leaves no gap. */
  .columns {
    columns: var(--col-count, 3) 280px;
    column-gap: var(--col-gap, 16px);
    margin-bottom: calc(-1 * var(--col-gap, 16px));
    --genui-item-gap: var(--col-gap, 16px);
    --genui-span-gap: var(--col-gap, 16px);
  }
  .columns > *,
  .columns > slot::slotted(*) {
    break-inside: avoid;
    margin-bottom: var(--col-gap, 16px);
  }
  .columns > .stack,
  .columns > .card {
    display: flex;
  }
  .stack,
  .grid {
    --genui-item-gap: 0px;
    --genui-span-gap: 0px;
  }
  /* Stats side by side at the end of a row keep room for their labels. */
  .stack.row.packed > .stat {
    min-width: 132px;
  }

  .card.soft {
    border-color: var(--callout-border);
    background: var(--callout-bg);
  }
  .card.striped {
    border-left: 3px solid var(--callout-fg);
  }
  .card-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 2px -12px -12px;
    padding: 9px 12px;
    border-top: 1px solid var(--genui-border);
  }
  .card.clear .card-footer {
    margin: 0;
    padding: 9px 0 0;
  }
  .card-header.row {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .card-header-text {
    min-width: 0;
  }
  .card-header-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--genui-primary-bg);
    color: var(--genui-primary);
    font-size: 12px;
  }

  .tabs.pill .tab-bar {
    gap: 4px;
    padding: 3px;
    border: 0;
    border-radius: 9px;
    background: var(--genui-neutral-bg);
  }
  .tabs.pill .tab {
    margin: 0;
    padding: 4px 10px;
    border: 0;
    border-radius: 7px;
  }
  .tabs.pill .tab.on {
    background: var(--bg-color--foreground);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .tab .fas {
    margin-right: 5px;
    font-size: 11px;
  }

  .accordion {
    border: 1px solid var(--genui-border);
    border-radius: 10px;
    overflow: hidden;
  }
  .acc-item + .acc-item {
    border-top: 1px solid var(--genui-border);
  }
  .acc-head,
  .col-head,
  .tree-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .acc-head {
    padding: 9px 12px;
    font-weight: 600;
  }
  .acc-head:hover,
  .col-head:hover,
  button.tree-row:hover {
    background: var(--ai-hover, rgba(0, 0, 0, 0.05));
  }
  .acc-label {
    flex: 1;
    min-width: 0;
  }
  .acc-icon {
    color: var(--genui-muted);
    font-size: 12px;
  }
  .acc-item.open .chev {
    transform: rotate(180deg);
  }
  .acc-body {
    padding: 2px 12px 12px;
  }
  .col-head {
    padding: 4px 6px;
    border-radius: 6px;
    color: var(--genui-accent);
  }
  .collapsible.open .chev,
  .chev.open {
    transform: rotate(90deg);
  }
  .col-body {
    margin-top: 8px;
    padding-left: 14px;
    border-left: 2px solid var(--genui-border);
  }

  .carousel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .carousel-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .carousel-dots {
    display: flex;
    gap: 5px;
  }
  .carousel-dots .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--genui-border);
  }
  .carousel-dots .dot.on {
    background: var(--genui-accent);
  }

  .sep-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--genui-muted);
  }
  .sep-label::before,
  .sep-label::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--genui-border);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .header-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--genui-primary-bg);
    color: var(--genui-primary);
    font-size: 16px;
  }
  .header-text {
    flex: 1;
    min-width: 0;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--genui-primary);
  }
  .header-title {
    font-size: 18px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .header-desc {
    margin-top: 2px;
    color: var(--genui-muted);
    line-height: 1.45;
  }
  .header-actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* — content — */

  .text.t-muted {
    color: var(--genui-muted);
  }
  .text.t-primary {
    color: var(--genui-primary);
  }
  .text.t-success {
    color: var(--genui-success);
  }
  .text.t-warning {
    color: var(--genui-warning);
  }
  .text.t-error {
    color: var(--genui-error);
  }

  .callout-body {
    flex: 1;
    min-width: 0;
  }
  .callout .buttons {
    margin-top: 8px;
  }
  .callout.outline {
    background: none;
  }
  .callout.solid {
    border-color: var(--c-solid);
    background: var(--c-solid);
    color: var(--genui-on-solid);
  }
  .callout.solid .fas,
  .callout.solid .title {
    color: inherit;
  }
  .callout.solid .btn {
    border-color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.14);
    color: inherit;
  }

  .tag .fas {
    margin-right: 4px;
    font-size: 10px;
  }
  .tag.outline {
    background: none;
  }
  .tag.solid {
    border-color: var(--c-solid);
    background: var(--c-solid);
    color: var(--genui-on-solid);
  }

  .icon {
    display: inline-grid;
    place-items: center;
    color: var(--callout-fg, var(--genui-muted));
    font-size: 13px;
  }
  .icon.sz-s {
    font-size: 11px;
  }
  .icon.sz-l {
    font-size: 18px;
  }

  .avatar {
    position: relative;
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--callout-border);
    background: var(--callout-bg);
    color: var(--callout-fg);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
  .avatar.sz-s {
    width: 22px;
    height: 22px;
    font-size: 9.5px;
  }
  .avatar.sz-l {
    width: 40px;
    height: 40px;
    font-size: 14px;
  }
  .avatar .status {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--genui-surface, #fff);
    background: var(--genui-muted);
  }
  .avatar .status.online {
    background: var(--genui-success-solid);
  }
  .avatar .status.away {
    background: #d99a00;
  }
  .avatar .status.busy {
    background: var(--genui-error-solid);
  }
  .avatar-group {
    display: inline-flex;
    align-items: center;
  }
  /* Opaque, so the one underneath doesn't show through the tint. */
  .avatar-group .avatar {
    box-shadow: 0 0 0 2px var(--genui-surface, #fff);
    background:
      linear-gradient(var(--callout-bg), var(--callout-bg)),
      var(--genui-surface, #fff);
  }
  .avatar-group .avatar + .avatar {
    margin-left: -4px;
  }

  .user {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .user-text {
    flex: 1;
    min-width: 0;
  }
  .user-name {
    display: block;
    max-width: 100%;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-desc {
    font-size: 12px;
    color: var(--genui-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kbds {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  kbd {
    min-width: 20px;
    padding: 1px 5px;
    border: 1px solid var(--genui-border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--genui-neutral-bg);
    font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: center;
  }
  .kbds .plus {
    color: var(--genui-muted);
    font-size: 11px;
  }
  .inline-link .fas {
    font-size: 11px;
  }

  .breadcrumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 12px;
    color: var(--genui-muted);
  }
  .crumb.current {
    color: var(--ai-text, inherit);
    font-weight: 600;
  }
  .crumb-sep {
    font-size: 8px;
    opacity: 0.7;
  }

  .code {
    border: 1px solid var(--genui-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .code-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px 3px 10px;
    border-bottom: 1px solid var(--genui-border);
    background: var(--genui-neutral-bg);
    font-size: 11.5px;
    color: var(--genui-muted);
  }
  .code pre {
    margin: 0;
    padding: 9px 11px;
    background: var(--ai-code-bg, rgba(0, 0, 0, 0.045));
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 20px 14px;
    border: 1px dashed var(--genui-border);
    border-radius: 10px;
    text-align: center;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--genui-neutral-bg);
    color: var(--genui-muted);
    font-size: 15px;
  }
  .empty-title {
    font-weight: 600;
  }
  .empty-desc {
    max-width: 320px;
    color: var(--genui-muted);
    line-height: 1.45;
  }
  .empty .buttons {
    justify-content: center;
    margin-top: 4px;
  }

  .feature {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  button.feature {
    width: 100%;
    padding: 8px;
    margin: -8px;
    border-radius: 9px;
    cursor: pointer;
  }
  button.feature:hover {
    background: var(--ai-hover, rgba(0, 0, 0, 0.05));
  }
  button.feature:hover .feature-title {
    color: var(--genui-accent);
  }
  .feature-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--callout-bg);
    color: var(--callout-fg);
    font-size: 13px;
  }
  .feature-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .feature-title {
    font-weight: 600;
    line-height: 1.35;
  }
  .feature-desc {
    color: var(--genui-muted);
    line-height: 1.45;
  }

  /* — lists — */

  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 7px 0;
  }
  .list.divided .li + .li {
    border-top: 1px solid var(--genui-border);
  }
  .list.divided .li:first-child {
    padding-top: 0;
  }
  .list.divided .li:last-child {
    padding-bottom: 0;
  }
  .list.plain .li {
    padding: 4px 0;
  }
  .list.cards {
    gap: 6px;
  }
  .list.cards .li {
    padding: 8px 10px;
    border: 1px solid var(--genui-border);
    border-radius: 9px;
  }
  .li-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  button.li-main {
    cursor: pointer;
  }
  button.li-main:hover .li-title {
    color: var(--genui-accent);
    text-decoration: underline;
  }
  .li-title {
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .li-desc {
    font-size: 12px;
    color: var(--genui-muted);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .leading .icon {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--callout-bg, var(--genui-neutral-bg));
  }

  .data-cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px 14px;
    margin: 0;
  }
  .data-cols dt {
    font-size: 11.5px;
    color: var(--genui-muted);
  }
  .data-cols dd {
    margin: 1px 0 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .steps .n .fas {
    font-size: 10px;
  }
  .steps li.done .n {
    border-color: var(--genui-success-border);
    background: var(--genui-success-bg);
    color: var(--genui-success);
  }
  .steps li.current .n {
    border-color: var(--genui-accent);
    background: var(--genui-accent);
    color: #fff;
  }
  .steps li.todo .title,
  .steps li.todo .n {
    color: var(--genui-muted);
    font-weight: 400;
  }

  .tree {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tree .tree {
    margin-left: 9px;
    padding-left: 9px;
    border-left: 1px solid var(--genui-border);
  }
  .tree-row {
    padding: 3px 6px;
    border-radius: 6px;
    line-height: 1.4;
  }
  .tree-row.leaf {
    padding-left: 22px;
    cursor: default;
  }
  .tree-icon {
    color: var(--genui-muted);
    font-size: 12px;
  }

  .tl-dot .fas {
    display: none;
  }
  .tl-dot.with-icon {
    left: -22px;
    top: 0;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    background: var(--c-solid, var(--genui-neutral-solid));
    color: var(--genui-on-solid);
    font-size: 8.5px;
  }
  .timeline li.neutral .tl-dot.with-icon {
    background: var(--genui-neutral-solid);
  }
  .tl-dot.with-icon .fas {
    display: inline-block;
  }

  /* — numbers — */

  .stat.info,
  .stat.success,
  .stat.warning,
  .stat.error,
  .stat.primary {
    border-color: var(--callout-border);
    background: var(--callout-bg);
  }
  .stat-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .stat-head .label {
    flex: 1;
    min-width: 0;
  }
  .stat-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: -2px -2px 0 0;
    border-radius: 6px;
    background: var(--callout-bg, var(--genui-neutral-bg));
    color: var(--callout-fg, var(--genui-muted));
    font-size: 11px;
  }
  .stat-spark {
    margin-top: 6px;
  }
  .stat-spark .spark {
    width: 100%;
    height: 26px;
  }

  .progress .caption,
  .ring-caption {
    margin-top: 3px;
    font-size: 11.5px;
    color: var(--genui-muted);
  }
  .progress.info .fill,
  .progress.success .fill,
  .progress.warning .fill,
  .progress.error .fill,
  .progress.neutral .fill,
  .progress.primary .fill {
    background: var(--c-solid);
  }
  .ring {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .ring svg {
    flex: none;
  }
  .ring-track,
  .ring-fill {
    fill: none;
    stroke-width: 6;
  }
  .ring-track {
    stroke: var(--genui-neutral-bg);
  }
  .ring-fill {
    stroke: var(--c-solid, var(--genui-c1));
    stroke-linecap: round;
  }
  .ring-text {
    font-size: 13px;
    font-weight: 600;
    fill: var(--ai-text, currentColor);
    font-variant-numeric: tabular-nums;
  }
  .ring-label {
    font-weight: 600;
    line-height: 1.3;
  }

  .spark {
    display: inline-block;
    width: 72px;
    height: 22px;
    vertical-align: middle;
    --spark: var(--c-solid, var(--genui-c1));
  }
  .spark svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .spark-line {
    fill: none;
    stroke: var(--spark);
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .spark-area {
    fill: var(--spark);
    opacity: 0.14;
  }
  .spark-bar {
    fill: var(--spark);
  }

  .calendar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .cal-title {
    font-weight: 600;
  }
  .cal-grid {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .cal-grid th {
    padding-bottom: 4px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--genui-muted);
  }
  .cal-grid td {
    padding: 1px 0;
    text-align: center;
  }
  .cal-day {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid transparent;
  }
  .cal-day.today {
    border-color: var(--genui-accent);
    font-weight: 600;
  }
  .cal-day.marked {
    border-color: var(--callout-border);
    background: var(--callout-bg);
    color: var(--callout-fg);
    font-weight: 600;
  }
  .cal-marks {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }
  .cal-marks li {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .cal-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c-solid, var(--genui-accent));
  }
  .cal-date {
    min-width: 16px;
    color: var(--genui-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* — tables — */

  .genui-table caption {
    padding: 7px 10px;
    border-bottom: 1px solid var(--genui-border);
    font-weight: 600;
    text-align: left;
  }
  .genui-table.striped tbody tr:nth-child(even) {
    background: var(--genui-sunk);
  }
  .genui-table td > .avatar,
  .genui-table td > .spark,
  .genui-table td > .icon {
    vertical-align: middle;
  }
  .th-sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    font-weight: 600;
    color: inherit;
    cursor: pointer;
  }
  .th-sort:hover {
    color: var(--ai-text, inherit);
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    margin-top: -6px;
    font-size: 11.5px;
    color: var(--genui-muted);
  }
  .pager-text {
    margin-right: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* — buttons — */

  .btn.s {
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .btn.l {
    padding: 8px 16px;
    font-size: 14px;
  }
  .btn .fas.lead {
    margin: 0 6px 0 0;
    font-size: 11px;
    opacity: 0.85;
  }

  /* — forms — */

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    margin: 0;
    padding: 12px;
    border: 1px solid var(--genui-border);
    border-radius: 10px;
  }
  .form-title {
    font-size: 13.5px;
    font-weight: 600;
  }
  .form-desc {
    margin-top: -8px;
    color: var(--genui-muted);
    line-height: 1.45;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .field .label {
    padding: 0;
    font-size: 12px;
    font-weight: 600;
  }
  .field .hint {
    font-size: 11.5px;
    color: var(--genui-muted);
  }
  .control {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--genui-border);
    border-radius: 7px;
    background: var(--genui-field-bg);
    color: var(--ai-text, inherit);
    font: inherit;
  }
  textarea.control {
    resize: vertical;
    min-height: 60px;
    line-height: 1.45;
  }
  .control:disabled {
    opacity: 0.6;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .choice input,
  .field input[type='range'] {
    margin: 0;
    accent-color: var(--genui-accent);
  }
  .field input[type='range'] {
    width: 100%;
  }
  .slider-label {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .slider-label .v {
    font-weight: 400;
    color: var(--genui-muted);
    font-variant-numeric: tabular-nums;
  }
  .switch-field {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .switch-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .switch {
    position: relative;
    flex: none;
    width: 32px;
    height: 18px;
  }
  .switch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .switch .track {
    position: absolute;
    inset: 0;
    border-radius: 9px;
    background: var(--genui-neutral-solid);
    opacity: 0.55;
    transition: background 0.12s;
  }
  .switch .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.12s;
  }
  .switch input:checked + .track {
    background: var(--genui-accent);
    opacity: 1;
  }
  .switch input:checked + .track::after {
    transform: translateX(14px);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--genui-accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch .track,
    .switch .track::after {
      transition: none;
    }
  }

  /* — the home page's widgets, anywhere but the home page — */

  .home-widget {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 12px;
    border: 1px dashed var(--genui-border);
    border-radius: 10px;
    color: var(--genui-muted);
    font-size: 12px;
  }
  .home-widget .hw-name {
    white-space: nowrap;
    font-weight: 600;
    color: var(--ai-text, inherit);
  }
`;
