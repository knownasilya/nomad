import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// Passkeys reuse the Mods view's groups, cards and buttons (mods.css.js, applied first) and the
// Secrets view's notice (secrets.css.js); this adds the site's icon and the account's key.
const cssStr = css`
  .group-head img {
    width: 16px;
    height: 16px;
    margin-right: 4px;
    border-radius: 3px;
  }

  .row-head .key {
    display: inline-flex;
    flex: 0 0 30px;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--mods-accent-soft);
    color: var(--mods-accent);
  }

  .meta {
    cursor: default;
  }

  .title .sub {
    font-weight: 400;
    color: var(--text-color--light);
  }
`;
export default cssStr;
