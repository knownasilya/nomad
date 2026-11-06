import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

// Styled like the Names view: the shared tokens (app-stdlib/css/colors.css) and the Library's own
// --lib-* tokens (library/css/main.css), so it follows light and dark mode with the other views.
const cssStr = css`
  ${spinnerCSS}

  :host {
    display: block;
    max-width: 720px;
    padding: 6px 4px 40px;
    --share-fill: #4f46e5; /* white text reads on it in both modes */
    --share-accent: var(--lib-nav-active-text, #4f46e5);
    --share-accent-soft: var(--lib-nav-active-bg, #eef2ff);
    --share-err: #dc2626;
    --share-warn: #b45309;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --share-err: #f87171;
      --share-warn: #fbbf24;
    }
  }

  /* Two zones: "This Space" (a card topped with the Space's own color) and "Other Spaces" (open,
     set up a home, join), so what acts on this Space never blends with what makes another one. */
  .zone.current {
    overflow: hidden;
    border: 1px solid var(--border-color--very-light);
    border-top: 4px solid var(--space-color, var(--share-fill));
    border-radius: 12px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .space-head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 18px 14px;
    border-bottom: 1px solid var(--border-color--very-light);
  }

  .space-mark {
    display: inline-flex;
    flex: 0 0 44px;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--space-color, var(--share-fill));
    color: #fff;
    font-size: 19px;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  }

  .space-mark.small {
    flex-basis: 30px;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    font-size: 13px;
  }

  .head-text {
    min-width: 0;
  }

  .eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-color--pretty-light);
  }

  h2 {
    margin: 1px 0 3px;
    overflow: hidden;
    font-size: 20px;
    font-weight: 650;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: 12px;
    color: var(--text-color--light);
  }

  .status.on {
    color: var(--share-accent);
    font-weight: 500;
  }

  .zone-body {
    padding: 14px 18px 18px;
  }

  .zone-body > :first-child {
    margin-top: 0;
  }

  .intro {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .zone-body > .intro:last-child {
    margin-bottom: 0;
  }

  .zone.others {
    margin-top: 34px;
  }

  .zone-head {
    margin: 0 6px 12px;
    padding-top: 18px;
    border-top: 1px solid var(--border-color--semi-light);
  }

  .zone-head h2 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .zone-head p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .list.spaces {
    margin-bottom: 12px;
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .option {
    display: flex;
    flex-direction: column;
    padding: 14px;
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
  }

  .option-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .option-icon {
    display: inline-flex;
    flex: 0 0 30px;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--share-accent-soft);
    color: var(--share-accent);
    font-size: 13px;
  }

  .option-title {
    font-size: 13px;
    font-weight: 600;
  }

  .option-sub {
    font-size: 12px;
    color: var(--text-color--light);
  }

  .option label {
    margin: 8px 0 4px;
  }

  .option .what {
    margin-bottom: 4px;
  }

  .option-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: auto;
    padding-top: 12px;
  }

  .hint {
    margin-top: 6px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--share-warn);
  }

  .waiting {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--text-color--light);
  }

  /* Just set up a home: what's in it, and what to do next. */
  .notice.welcome {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.5;
    border-color: var(--share-accent);
    background: var(--share-accent-soft);
  }

  .notice.welcome .fas {
    margin-top: 3px;
    color: var(--share-accent);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .what strong {
    color: var(--text-color--default);
  }

  code {
    font-family: var(--code-font);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-color--light);
  }

  input {
    height: 30px;
    min-width: 0;
    padding: 0 9px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 13px;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: var(--share-accent);
    box-shadow: 0 0 0 3px var(--share-accent-soft);
    outline: none;
  }

  .fields input {
    flex: 1;
    min-width: 160px;
    max-width: 260px;
  }

  .option input {
    width: 100%;
    box-sizing: border-box;
  }

  input.code-input {
    font-family: var(--code-font);
  }

  select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--secondary);
    color: var(--text-color--default);
    font-size: 12px;
  }

  button {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-color--light);
    border-radius: 6px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    background: var(--lib-row-hover-bg, var(--bg-color--semi-light));
  }

  button[disabled] {
    opacity: 0.6;
    cursor: default;
  }

  button.primary {
    border-color: var(--share-fill);
    background: var(--share-fill);
    color: #fff;
  }

  button.primary:hover {
    filter: brightness(1.08);
  }

  button.icon {
    width: 30px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-color--light);
  }

  button.icon:hover {
    background: var(--lib-search-bg, var(--bg-color--semi-light));
    color: var(--text-color--default);
  }

  button.icon.danger:hover {
    color: var(--share-err);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 20px 0 8px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-color--light);
  }

  .section-title .fas {
    color: var(--share-accent);
  }

  .section-title.attention {
    color: var(--share-warn);
  }

  .section-title.attention .fas {
    color: var(--share-warn);
  }

  /* Bordered lists, rows split by hairlines (like the other Library views). */
  .list {
    overflow: hidden;
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    background: var(--bg-color--default);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 10px 14px;
    color: var(--text-color--default);
  }

  .row + .row {
    border-top: 1px solid var(--border-color--very-light);
  }

  .note {
    margin: 8px 2px 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-color--pretty-light);
  }

  .invite {
    margin-top: 6px;
  }

  .row > .fas {
    color: var(--text-color--light);
  }

  .meta {
    flex: 1;
    min-width: 0;
  }

  .title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color--light);
  }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--share-accent-soft);
    color: var(--share-accent);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    vertical-align: 1px;
  }

  .actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 6px;
  }

  .code {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border-radius: 6px;
    background: var(--bg-color--secondary);
    font-size: 12px;
    word-break: break-all;
    user-select: all;
  }

  .leave {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 20px -18px -18px;
    padding: 12px 18px;
    border-top: 1px solid var(--border-color--very-light);
    background: var(--bg-color--secondary);
  }

  .leave .sub {
    margin: 0;
  }

  button.danger {
    color: var(--share-err);
  }

  button.danger:hover {
    border-color: var(--share-err);
  }

  .notice {
    margin-bottom: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border-color--very-light);
    border-radius: 10px;
    background: var(--bg-color--default);
    color: var(--text-color--default);
    font-size: 13px;
  }

  .row-actions {
    margin: 0;
  }

  .fields .inline {
    margin-right: -2px;
  }

  .error {
    margin: 8px 6px 0;
    line-height: 1.45;
    font-size: 12px;
    color: var(--share-err);
  }

  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--text-color--pretty-light);
  }

  .spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 4px;
    vertical-align: -1px;
  }
`;
export default cssStr;
