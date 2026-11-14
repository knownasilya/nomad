import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

// The terminal's look. Its colors are its own (--term-*), set for light here and for dark under
// prefers-color-scheme, and every part takes them from there.
const cssStr = css`
  ${spinnerCSS}

  :host {
    --term-bg: #fbfbfd;
    --term-surface: #f1f2f7;
    --term-surface-2: #e8eaf1;
    --term-border: #dcdfe8;
    --term-fg: #262a35;
    --term-muted: #646a7b;
    --term-faint: #9aa0b0;
    --term-accent: #3b5bdb;
    --term-path: #0c7c74;
    --term-caret: #7048e8;
    --term-dir: #3456c9;
    --term-link: #3b5bdb;
    --term-success: #2b8a3e;
    --term-warning: #a85b00;
    --term-error: #c92a2a;
    --term-error-bg: #fff1f1;
    --term-add: #2b8a3e;
    --term-add-bg: #ebf9ee;
    --term-del: #c92a2a;
    --term-del-bg: #fdeeee;
    --term-mark: #fff0a8;
    --term-selection: rgba(59, 91, 219, 0.18);
    --term-shadow: 0 6px 24px rgba(20, 24, 40, 0.12);
    --font: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, 'Liberation Mono',
      'DejaVu Sans Mono', monospace;

    /* Aliases older page commands use (color-*, bg-*, border-*). */
    --default: var(--term-fg);
    --background: var(--term-bg);
    --lightgray: var(--term-muted);
    --gray: var(--term-faint);
    --darkgray: var(--term-border);
    --error: var(--term-error);
    --success: var(--term-success);
    --warning: var(--term-warning);
    --info: var(--term-caret);

    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100vh;
    font-family: var(--font);
    font-size: 12.5px;
    line-height: 1.55;
    background: var(--term-bg);
    color: var(--term-fg);
    color-scheme: light;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --term-bg: #18191d;
      --term-surface: #212328;
      --term-surface-2: #2a2c33;
      --term-border: #33363e;
      --term-fg: #dcdee5;
      --term-muted: #9b9fab;
      --term-faint: #686c78;
      --term-accent: #8ca4ff;
      --term-path: #5fd4c4;
      --term-caret: #b39dfc;
      --term-dir: #8ca4ff;
      --term-link: #8ca4ff;
      --term-success: #74d68a;
      --term-warning: #ffc078;
      --term-error: #ff8a8a;
      --term-error-bg: #2c1d20;
      --term-add: #74d68a;
      --term-add-bg: #1b2a20;
      --term-del: #ff8a8a;
      --term-del-bg: #2f1d20;
      --term-mark: #5a4a12;
      --term-selection: rgba(140, 164, 255, 0.25);
      --term-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      color-scheme: dark;
    }
  }

  ::selection {
    background: var(--term-selection);
  }

  * {
    box-sizing: border-box;
  }

  a {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  a:hover {
    text-decoration: underline;
  }

  img,
  video,
  audio {
    max-width: 100%;
    border-radius: 6px;
  }

  pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    word-break: break-word;
  }

  code {
    font: inherit;
  }

  /* The bar at the top: where you are, and the controls. */

  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--term-border);
    background: var(--term-surface);
    font-size: 12px;
    user-select: none;
  }

  .bar .where {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
  }

  .bar .where .drive {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar .where .path {
    color: var(--term-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    height: 18px;
    border-radius: 9px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    border: 1px solid var(--term-border);
    color: var(--term-muted);
    background: var(--term-bg);
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .badge.edit {
    color: var(--term-success);
    border-color: color-mix(in srgb, var(--term-success) 40%, transparent);
  }
  .badge.chat {
    color: var(--term-caret);
    border-color: color-mix(in srgb, var(--term-caret) 40%, transparent);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--term-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--term-surface-2);
    color: var(--term-fg);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--term-accent);
    outline-offset: -2px;
  }
  .icon-btn.small {
    width: 22px;
    height: 22px;
    font-size: 11px;
  }

  /* The scrolling part: what ran, then the prompt. */

  .screen {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 14px 14px;
    scrollbar-width: thin;
    scrollbar-color: var(--term-border) transparent;
  }
  .screen::-webkit-scrollbar {
    width: 10px;
  }
  .screen::-webkit-scrollbar-thumb {
    background: var(--term-border);
    border-radius: 5px;
    border: 3px solid var(--term-bg);
  }
  .screen::-webkit-scrollbar-track {
    background: transparent;
  }

  .welcome {
    margin: 2px 0 10px;
    color: var(--term-muted);
  }
  .welcome .title {
    color: var(--term-fg);
    font-weight: 600;
  }
  .welcome .title .logo {
    color: var(--term-caret);
  }
  .welcome .tips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 4px;
  }

  kbd {
    display: inline-block;
    padding: 0 5px;
    min-width: 18px;
    line-height: 16px;
    text-align: center;
    border: 1px solid var(--term-border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--term-surface);
    color: var(--term-fg);
    font: inherit;
    font-size: 11px;
  }

  .block {
    position: relative;
    margin: 0 -6px 4px;
    padding: 2px 6px 4px;
    border-radius: 6px;
  }
  .block:hover {
    background: color-mix(in srgb, var(--term-surface) 60%, transparent);
  }
  .block .tools {
    position: absolute;
    top: 1px;
    right: 2px;
    display: none;
    gap: 2px;
    background: var(--term-surface);
    border-radius: 6px;
  }
  .block:hover .tools,
  .block:focus-within .tools {
    display: flex;
  }

  .ps {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 6px;
    min-width: 0;
  }
  .ps .drive {
    color: var(--term-accent);
    font-weight: 600;
  }
  .ps .path {
    color: var(--term-path);
  }
  .ps .lock {
    color: var(--term-faint);
    font-size: 10px;
  }
  .ps .caret {
    color: var(--term-caret);
    font-weight: 700;
  }
  .ps .caret.failed {
    color: var(--term-error);
  }
  .block .ps .cmd {
    color: var(--term-fg);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .block .ps .took {
    margin-left: auto;
    color: var(--term-faint);
    font-size: 11px;
  }

  .out {
    padding: 2px 0 0;
    word-break: break-word;
  }
  .out:empty {
    display: none;
  }
  .out .entry + .entry {
    margin-top: 2px;
  }

  /* The prompt. */

  .prompt {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    padding: 2px 0;
  }
  .prompt .ps {
    flex: 0 1 auto;
    flex-wrap: nowrap;
    max-width: 55%;
    overflow: hidden;
    white-space: nowrap;
  }
  .prompt .ps .path {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line {
    position: relative;
    flex: 1;
    min-width: 40px;
  }
  .line input,
  .line .ghost {
    font: inherit;
    letter-spacing: inherit;
    padding: 0;
    margin: 0;
    border: 0;
    line-height: 20px;
    height: 20px;
  }
  .line input {
    position: relative;
    z-index: 1;
    width: 100%;
    background: transparent;
    color: var(--term-fg);
    outline: 0;
    caret-color: var(--term-caret);
  }
  .line .ghost {
    position: absolute;
    inset: 0;
    white-space: pre;
    overflow: hidden;
    color: var(--term-faint);
    pointer-events: none;
  }
  .line .ghost .typed {
    visibility: hidden;
  }
  .prompt.busy .line input {
    color: var(--term-muted);
  }

  .search-mode {
    color: var(--term-muted);
    white-space: nowrap;
  }
  .search-mode strong {
    color: var(--term-caret);
  }

  .hint {
    margin: 2px 0 0;
    color: var(--term-faint);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint strong {
    color: var(--term-muted);
    font-weight: 600;
  }

  /* Tab completion. */

  .menu {
    margin: 6px 0 2px;
    padding: 4px;
    border: 1px solid var(--term-border);
    border-radius: 8px;
    background: var(--term-surface);
    box-shadow: var(--term-shadow);
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1px 6px;
    max-width: 960px;
  }
  .menu .item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 1px 6px;
    border-radius: 5px;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    color: var(--term-fg);
  }
  .menu .item:hover {
    background: var(--term-surface-2);
  }
  .menu .item.selected {
    background: var(--term-accent);
    color: var(--term-bg);
  }
  .menu .item.selected .help,
  .menu .item.selected .icon {
    color: inherit;
    opacity: 0.85;
  }
  .menu .item .name strong {
    color: var(--term-caret);
  }
  .menu .item.selected .name strong {
    color: inherit;
  }
  .menu .item .icon {
    color: var(--term-faint);
    width: 14px;
    text-align: center;
  }
  .menu .item.dir .name {
    color: var(--term-dir);
  }
  .menu .item.selected.dir .name {
    color: inherit;
  }
  .menu .item .help {
    color: var(--term-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
  }
  .menu .more {
    grid-column: 1 / -1;
    padding: 2px 6px;
    color: var(--term-faint);
  }

  /* Output parts the commands use. */

  .muted,
  .color-gray,
  .color-lightgray {
    color: var(--term-muted);
  }
  .faint {
    color: var(--term-faint);
  }
  .color-default {
    color: var(--term-fg);
  }
  .ok,
  .color-success {
    color: var(--term-success);
  }
  .warn,
  .color-warning {
    color: var(--term-warning);
  }
  .bad,
  .color-error {
    color: var(--term-error);
  }
  .color-info {
    color: var(--term-caret);
  }
  .color-darkgray {
    color: var(--term-faint);
  }
  .bg-default {
    background: var(--term-fg);
  }
  .bg-background {
    background: var(--term-bg);
  }
  .bg-error {
    background: var(--term-error);
  }
  .bg-success {
    background: var(--term-success);
  }
  .bg-warning {
    background: var(--term-warning);
  }
  .bg-info {
    background: var(--term-caret);
  }
  .border-default,
  .border-gray,
  .border-lightgray,
  .border-darkgray {
    border: 1px solid var(--term-border);
    border-radius: 6px;
  }
  .border-error {
    border: 1px solid var(--term-error);
    border-radius: 6px;
  }
  .border-success {
    border: 1px solid var(--term-success);
    border-radius: 6px;
  }
  .border-warning {
    border: 1px solid var(--term-warning);
    border-radius: 6px;
  }
  .border-info {
    border: 1px solid var(--term-caret);
    border-radius: 6px;
  }
  .weight-thin {
    font-weight: 400;
  }
  .weight-normal {
    font-weight: 500;
  }
  .weight-bold {
    font-weight: 600;
  }

  .dir,
  a.dir {
    color: var(--term-dir);
    font-weight: 600;
  }
  .hidden-file {
    color: var(--term-faint);
  }
  .link {
    color: var(--term-link);
  }
  .k {
    color: var(--term-caret);
  }
  .num {
    color: var(--term-path);
    font-variant-numeric: tabular-nums;
  }
  mark {
    background: var(--term-mark);
    color: inherit;
    border-radius: 2px;
  }

  .ls-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--col, 160px), 1fr));
    gap: 0 18px;
  }
  .ls-grid > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  table.rows {
    border-collapse: collapse;
  }
  table.rows td {
    padding: 0 16px 0 0;
    vertical-align: top;
    white-space: nowrap;
  }
  table.rows td.wrap {
    white-space: normal;
    word-break: break-word;
  }
  table.rows td.r {
    text-align: right;
  }
  table.rows th {
    text-align: left;
    padding: 0 16px 2px 0;
    font-weight: 600;
    color: var(--term-muted);
  }

  .tree .branch {
    color: var(--term-faint);
    white-space: pre;
  }

  .code {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 12px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--term-surface);
    overflow-x: auto;
  }
  .code.plain {
    display: block;
  }
  .code .n {
    color: var(--term-faint);
    text-align: right;
    user-select: none;
  }

  .diff {
    border: 1px solid var(--term-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .diff .file {
    padding: 3px 10px;
    background: var(--term-surface);
    border-bottom: 1px solid var(--term-border);
    color: var(--term-muted);
    display: flex;
    gap: 12px;
  }
  .diff .h {
    padding: 2px 10px;
    color: var(--term-caret);
    background: color-mix(in srgb, var(--term-caret) 8%, transparent);
  }
  .diff .l {
    display: grid;
    grid-template-columns: 3.5em 3.5em 1.2em 1fr;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .diff .l .n {
    color: var(--term-faint);
    text-align: right;
    padding-right: 6px;
    user-select: none;
  }
  .diff .l .op {
    text-align: center;
    user-select: none;
  }
  .diff .l.add {
    background: var(--term-add-bg);
  }
  .diff .l.add .op,
  .diff .l.add .t {
    color: var(--term-add);
  }
  .diff .l.del {
    background: var(--term-del-bg);
  }
  .diff .l.del .op,
  .diff .l.del .t {
    color: var(--term-del);
  }

  .error {
    display: flex;
    gap: 8px;
    padding: 4px 10px;
    border-left: 3px solid var(--term-error);
    border-radius: 0 6px 6px 0;
    background: var(--term-error-bg);
    color: var(--term-fg);
  }
  .error .icon {
    color: var(--term-error);
    padding-top: 1px;
  }
  .error .msg {
    color: var(--term-error);
    font-weight: 600;
  }
  .error .tip {
    color: var(--term-muted);
  }
  .error code,
  .tip code,
  .help-cmd code {
    color: var(--term-accent);
  }

  .notice {
    display: flex;
    gap: 8px;
    color: var(--term-muted);
  }
  .notice .icon {
    color: var(--term-success);
  }

  .help-group + .help-group {
    margin-top: 8px;
  }
  .help-group h4 {
    margin: 0 0 2px;
    font-size: inherit;
    color: var(--term-caret);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    font-size: 10.5px;
  }
  .help-cmd {
    display: grid;
    grid-template-columns: var(--w, 12ch) 1fr;
    gap: 0 12px;
  }
  .help-cmd .name {
    color: var(--term-accent);
    font-weight: 600;
  }
  .help-cmd .desc {
    color: var(--term-muted);
  }
  .usage {
    margin: 2px 0 6px;
  }
  .usage .label {
    color: var(--term-faint);
  }

  /* AI answers. */

  .ai {
    border-left: 2px solid color-mix(in srgb, var(--term-caret) 55%, transparent);
    padding: 2px 0 2px 12px;
    margin: 2px 0;
  }
  .ai .who {
    color: var(--term-caret);
    font-weight: 600;
    font-size: 11px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ai .steps {
    margin: 2px 0;
  }
  .ai .step {
    color: var(--term-muted);
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .ai .step .mark {
    width: 12px;
    text-align: center;
    flex: 0 0 auto;
  }
  .ai .step.done .mark {
    color: var(--term-success);
  }
  .ai .step.failed .mark {
    color: var(--term-error);
  }
  .ai .thinking {
    color: var(--term-faint);
    font-style: italic;
  }
  .ai .md {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.55;
  }
  .ai .md > :first-child {
    margin-top: 0;
  }
  .ai .md > :last-child {
    margin-bottom: 0;
  }
  .ai .md p,
  .ai .md ul,
  .ai .md ol {
    margin: 4px 0;
  }
  .ai .md ul,
  .ai .md ol {
    padding-left: 20px;
  }
  .ai .md h1,
  .ai .md h2,
  .ai .md h3,
  .ai .md h4 {
    font-size: 13px;
    margin: 10px 0 4px;
  }
  .ai .md a {
    color: var(--term-link);
    text-decoration: underline;
  }
  .ai .md code {
    font-family: var(--font);
    font-size: 12px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--term-surface-2);
  }
  .ai .md .fence {
    position: relative;
    margin: 6px 0;
  }
  .ai .md .fence pre {
    font-family: var(--font);
    font-size: 12px;
    padding: 8px 10px;
    padding-right: 64px;
    border-radius: 6px;
    background: var(--term-surface);
    border: 1px solid var(--term-border);
    white-space: pre-wrap;
  }
  .ai .md .fence pre code {
    padding: 0;
    background: none;
  }
  .ai .md .fence .fence-tools {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
  }
  .ai .md table {
    border-collapse: collapse;
  }
  .ai .md th,
  .ai .md td {
    border: 1px solid var(--term-border);
    padding: 2px 8px;
  }
  .ai .md blockquote {
    margin: 4px 0;
    padding-left: 10px;
    border-left: 3px solid var(--term-border);
    color: var(--term-muted);
  }

  .subprompt {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }
  .subprompt .q {
    color: var(--term-warning);
    font-weight: 600;
  }
  .subprompt .def {
    color: var(--term-faint);
  }
  .subprompt input {
    flex: 1;
    font: inherit;
    border: 0;
    border-bottom: 1px dashed var(--term-border);
    background: transparent;
    color: var(--term-fg);
    outline: 0;
    caret-color: var(--term-caret);
  }
  .subprompt input:disabled {
    border-bottom-color: transparent;
    color: var(--term-muted);
  }

  input,
  textarea {
    font: inherit;
    color: var(--term-fg);
    background: var(--term-bg);
    border: 1px solid var(--term-border);
    border-radius: 4px;
  }
  button {
    font: inherit;
    color: var(--term-fg);
    background: var(--term-surface);
    border: 1px solid var(--term-border);
    border-radius: 5px;
    padding: 1px 8px;
    cursor: pointer;
  }
  button:hover {
    background: var(--term-surface-2);
  }
  button.icon-btn {
    border: 0;
    background: transparent;
    padding: 0;
  }
  button.icon-btn:hover {
    background: var(--term-surface-2);
  }
`;
export default cssStr;
