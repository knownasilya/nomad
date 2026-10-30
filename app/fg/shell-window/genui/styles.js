// Styles for <nomad-genui> and the charts and maps inside it. Colors come from the sidebar's --ai-*
// variables and the shell's tokens; the chart slots (--genui-c1…8) and status colors are here,
// with their own dark steps.

import { css, unsafeCSS } from 'lit';
import leafletCss from 'leaflet/dist/leaflet.css?raw';

export default [
  unsafeCSS(leafletCss),
  css`
    :host {
      display: block;
      margin: 0 0 10px;
      --genui-surface: var(--bg-color--background);
      --genui-border: var(--ai-border, #e2e2e8);
      --genui-muted: var(--ai-text-muted, #6e6e78);
      --genui-grid: rgba(0, 0, 0, 0.07);
      --genui-band: rgba(0, 0, 0, 0.04);
      --genui-sunk: rgba(0, 0, 0, 0.035);
      --genui-accent: var(--ai-accent, #2864dc);
      /* Categorical slots, in this order (light). */
      --genui-c1: #2a78d6;
      --genui-c2: #eb6834;
      --genui-c3: #1baf7a;
      --genui-c4: #eda100;
      --genui-c5: #e87ba4;
      --genui-c6: #008300;
      --genui-c7: #6250d6;
      --genui-c8: #e34948;
      /* Status: text, background, border. */
      --genui-info: #1f5fb8;
      --genui-info-bg: #edf4fd;
      --genui-info-border: #c7dbf6;
      --genui-success: #1e7a3b;
      --genui-success-bg: #ecf7ef;
      --genui-success-border: #c3e5cc;
      --genui-warning: #8a5a00;
      --genui-warning-bg: #fdf5e4;
      --genui-warning-border: #f0dcae;
      --genui-error: #a12121;
      --genui-error-bg: #fdeeee;
      --genui-error-border: #f1c6c6;
      --genui-neutral: var(--ai-text, #333);
      --genui-neutral-bg: rgba(0, 0, 0, 0.045);
      --genui-neutral-border: var(--genui-border);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --genui-grid: rgba(255, 255, 255, 0.08);
        --genui-band: rgba(255, 255, 255, 0.05);
        --genui-sunk: rgba(255, 255, 255, 0.04);
        --genui-c1: #3987e5;
        --genui-c2: #d95926;
        --genui-c3: #199e70;
        --genui-c4: #c98500;
        --genui-c5: #d55181;
        --genui-c6: #008300;
        --genui-c7: #9085e9;
        --genui-c8: #e66767;
        --genui-info: #9cc3f5;
        --genui-info-bg: #1b2a3e;
        --genui-info-border: #2c4566;
        --genui-success: #8fd4a0;
        --genui-success-bg: #18301f;
        --genui-success-border: #2a5234;
        --genui-warning: #ecc06e;
        --genui-warning-bg: #352a14;
        --genui-warning-border: #5c4820;
        --genui-error: #ffb4b4;
        --genui-error-bg: #352121;
        --genui-error-border: #5e2a2a;
        --genui-neutral-bg: rgba(255, 255, 255, 0.07);
      }
    }
    :host(:last-child) {
      margin-bottom: 0;
    }

    * {
      box-sizing: border-box;
    }
    button {
      font: inherit;
      color: inherit;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .stack.row {
      flex-direction: row;
    }
    .stack.row.wrap {
      flex-wrap: wrap;
    }
    .stack.row > * {
      flex: 1 1 0;
      min-width: 0;
    }
    .stack.row.wrap > * {
      flex-basis: 120px;
    }
    .stack > nomad-genui-chart,
    .stack > nomad-genui-map {
      display: block;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--genui-border);
      border-radius: 10px;
    }
    .card.sunk {
      background: var(--genui-sunk);
    }
    .card.clear {
      padding: 0;
      border: 0;
    }
    .card-header .title {
      font-size: 13.5px;
      font-weight: 600;
      line-height: 1.3;
    }
    .card-header .subtitle {
      margin-top: 2px;
      font-size: 12px;
      color: var(--genui-muted);
    }

    .text {
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .text.small {
      font-size: 12px;
      color: var(--genui-muted);
    }
    .text.small-heavy {
      font-size: 12px;
      font-weight: 600;
    }
    .text.large {
      font-size: 15px;
    }
    .text.large-heavy {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
    }

    hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--genui-border);
      margin: 2px 0;
    }

    .callout {
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--callout-border);
      background: var(--callout-bg);
      display: flex;
      gap: 9px;
    }
    .callout .fas {
      margin-top: 2px;
      color: var(--callout-fg);
    }
    .callout .title {
      font-weight: 600;
      color: var(--callout-fg);
    }
    .callout .description {
      margin-top: 2px;
      line-height: 1.45;
    }
    .info {
      --callout-fg: var(--genui-info);
      --callout-bg: var(--genui-info-bg);
      --callout-border: var(--genui-info-border);
    }
    .success {
      --callout-fg: var(--genui-success);
      --callout-bg: var(--genui-success-bg);
      --callout-border: var(--genui-success-border);
    }
    .warning {
      --callout-fg: var(--genui-warning);
      --callout-bg: var(--genui-warning-bg);
      --callout-border: var(--genui-warning-border);
    }
    .error,
    .danger {
      --callout-fg: var(--genui-error);
      --callout-bg: var(--genui-error-bg);
      --callout-border: var(--genui-error-border);
    }
    .neutral {
      --callout-fg: var(--genui-neutral);
      --callout-bg: var(--genui-neutral-bg);
      --callout-border: var(--genui-neutral-border);
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .tag {
      display: inline-block;
      max-width: 100%;
      padding: 1px 8px;
      border-radius: 10px;
      border: 1px solid var(--callout-border);
      background: var(--callout-bg);
      color: var(--callout-fg);
      font-size: 11.5px;
      line-height: 17px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
    }

    .steps {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .steps li {
      display: flex;
      gap: 10px;
    }
    .steps .n {
      flex: none;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--genui-neutral-bg);
      border: 1px solid var(--genui-border);
      font-size: 11.5px;
      font-weight: 600;
      line-height: 20px;
      text-align: center;
    }
    .steps .title {
      font-weight: 600;
      line-height: 22px;
    }
    .steps .details {
      color: var(--genui-muted);
      line-height: 1.45;
    }

    .stat {
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--genui-border);
      border-radius: 10px;
    }
    .stat .label {
      font-size: 11.5px;
      color: var(--genui-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stat .value {
      margin-top: 2px;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .stat .change {
      margin-top: 3px;
      font-size: 12px;
      color: var(--genui-muted);
    }
    .stat .change.up {
      color: var(--genui-success);
    }
    .stat .change.down {
      color: var(--genui-error);
    }
    .stat .caption {
      margin-top: 3px;
      font-size: 11.5px;
      color: var(--genui-muted);
    }

    .progress .head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .progress .head .v {
      color: var(--genui-muted);
      font-variant-numeric: tabular-nums;
    }
    .progress .bar {
      height: 6px;
      border-radius: 3px;
      background: var(--genui-neutral-bg);
      overflow: hidden;
    }
    .progress .fill {
      height: 100%;
      border-radius: 3px;
      background: var(--genui-c1);
    }

    .tabs .tab-bar {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--genui-border);
      margin-bottom: 10px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs .tab {
      flex: none;
      padding: 6px 10px;
      margin-bottom: -1px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--genui-muted);
      cursor: pointer;
    }
    .tabs .tab:hover {
      color: inherit;
    }
    .tabs .tab.on {
      color: inherit;
      font-weight: 600;
      border-bottom-color: var(--genui-accent);
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .buttons.column {
      flex-direction: column;
      align-items: stretch;
    }
    .btn {
      padding: 5px 12px;
      border: 1px solid var(--genui-border);
      border-radius: 8px;
      background: var(--bg-color--foreground);
      cursor: pointer;
      text-align: left;
      line-height: 1.4;
    }
    .btn:hover:not(:disabled) {
      background: var(--ai-hover, rgba(0, 0, 0, 0.05));
    }
    .btn.primary {
      border-color: var(--genui-accent);
      background: var(--genui-accent);
      color: #fff;
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--ai-accent--hover, #1f55c0);
    }
    .btn.tertiary {
      border-color: transparent;
      background: none;
      color: var(--genui-accent);
    }
    .btn:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .btn .fas {
      margin-left: 4px;
      font-size: 10px;
      opacity: 0.7;
    }

    .genui-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--genui-border);
      border-radius: 8px;
      scrollbar-width: thin;
    }
    .genui-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .genui-table th,
    .genui-table td {
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--genui-border);
    }
    .genui-table th {
      font-weight: 600;
      color: var(--genui-muted);
      white-space: nowrap;
    }
    .genui-table tr:last-child td {
      border-bottom: 0;
    }
    .genui-table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .genui-empty,
    .genui-pending {
      padding: 10px 12px;
      border: 1px dashed var(--genui-border);
      border-radius: 8px;
      color: var(--genui-muted);
      font-size: 12px;
    }
    .genui-source {
      margin: 0;
      padding: 10px 12px;
      border: 1px solid var(--genui-border);
      border-radius: 8px;
      background: var(--ai-code-bg);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-x: auto;
    }

    /* — charts — */

    nomad-genui-chart {
      display: block;
      min-width: 0;
    }
    .genui-chart {
      position: relative;
    }
    .genui-chart svg {
      display: block;
      overflow: visible;
    }
    .genui-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .genui-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .genui-swatch {
      flex: none;
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 2px;
    }
    .genui-axis {
      font-size: 11px;
      fill: var(--genui-muted);
    }
    .genui-axis-title {
      font-size: 11px;
      fill: var(--genui-muted);
    }
    .genui-value {
      font-size: 11px;
      fill: var(--ai-text, currentColor);
      font-variant-numeric: tabular-nums;
    }
    .genui-grid {
      stroke: var(--genui-grid);
      stroke-width: 1;
    }
    .genui-baseline {
      stroke: var(--genui-border);
      stroke-width: 1;
    }
    .genui-crosshair {
      stroke: var(--genui-muted);
      stroke-width: 1;
      stroke-dasharray: 3 3;
    }
    .genui-band {
      fill: transparent;
    }
    .genui-band.on {
      fill: var(--genui-band);
    }
    .genui-marks {
      pointer-events: none;
    }
    .genui-seg {
      stroke: var(--genui-surface);
      stroke-width: 1;
    }
    .genui-line {
      fill: none;
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .genui-area {
      opacity: 0.16;
    }
    .genui-area.stacked {
      opacity: 0.85;
      stroke: var(--genui-surface);
      stroke-width: 1;
    }
    .genui-dot,
    .genui-point {
      stroke: var(--genui-surface);
      stroke-width: 2;
    }
    .genui-point {
      pointer-events: all;
      cursor: default;
    }
    .genui-hit {
      fill: transparent;
    }
    .genui-slice {
      stroke: var(--genui-surface);
      stroke-width: 2;
    }
    .genui-slice.on {
      opacity: 0.85;
    }
    .genui-pie {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .genui-pie.side {
      flex-direction: row;
      align-items: center;
      gap: 18px;
    }
    .genui-pie-legend {
      flex: 1;
      min-width: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }
    .genui-pie-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 1px 4px;
      border-radius: 4px;
    }
    .genui-pie-row.on {
      background: var(--genui-band);
    }
    .genui-pie-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .genui-pie-value {
      color: var(--genui-muted);
      font-variant-numeric: tabular-nums;
    }
    .genui-pie-total {
      font-size: 16px;
      font-weight: 600;
      fill: var(--ai-text, currentColor);
    }
    .genui-tip {
      position: absolute;
      z-index: 2;
      min-width: 110px;
      max-width: 200px;
      padding: 6px 8px;
      border: 1px solid var(--genui-border);
      border-radius: 6px;
      background: var(--bg-color--foreground);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      font-size: 11.5px;
      pointer-events: none;
      transform: translateY(-100%);
    }
    .genui-tip-title {
      font-weight: 600;
      margin-bottom: 3px;
      overflow-wrap: anywhere;
    }
    .genui-tip-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .genui-tip-name {
      flex: 1;
      min-width: 0;
      color: var(--genui-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .genui-tip-value {
      font-variant-numeric: tabular-nums;
    }
    .genui-data-toggle {
      margin-top: 4px;
      padding: 2px 6px;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--genui-muted);
      font-size: 11.5px;
      cursor: pointer;
    }
    .genui-data-toggle:hover {
      background: var(--ai-hover, rgba(0, 0, 0, 0.05));
      color: inherit;
    }
    .genui-data-toggle + .genui-table-wrap {
      margin-top: 6px;
    }

    /* — maps — */

    nomad-genui-map {
      display: block;
    }
    .genui-map {
      height: 240px;
      border-radius: 8px;
      border: 1px solid var(--genui-border);
      overflow: hidden;
      background: var(--genui-neutral-bg);
      font: inherit;
      z-index: 0;
    }
    .genui-pin-wrap {
      background: none;
      border: 0;
    }
    .genui-pin {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--genui-c1);
      border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      line-height: 18px;
      text-align: center;
    }
    .genui-route {
      stroke: var(--genui-c1);
      stroke-dasharray: 6 6;
      opacity: 0.8;
    }
    .genui-map .leaflet-popup-content-wrapper,
    .genui-map .leaflet-popup-tip {
      background: var(--bg-color--foreground);
      color: var(--ai-text, #333);
    }
    .genui-map .leaflet-popup-content {
      margin: 8px 12px;
      font-size: 12px;
      line-height: 1.4;
    }
    .genui-popup-title {
      font-weight: 600;
    }
    .genui-popup-details {
      color: var(--genui-muted);
      margin-top: 2px;
    }
    .genui-map .leaflet-control-attribution {
      font-size: 10px;
    }
    @media (prefers-color-scheme: dark) {
      /* OpenStreetMap has no dark tiles: invert the light ones. */
      .genui-map .leaflet-tile-pane {
        filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9);
      }
      .genui-map .leaflet-control-attribution,
      .genui-map .leaflet-bar a {
        background: #2a2a2a;
        color: #ccc;
        border-color: #3a3a3a;
      }
      .genui-map .leaflet-control-attribution a {
        color: #9cc3f5;
      }
    }
  `,
];
