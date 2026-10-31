import { css } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import spinnerCSS from 'nomad://app-stdlib/css/com/spinner.css.js';

const cssStr = css`
  ${spinnerCSS}

  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-color--secondary);
    overflow: hidden;
  }

  a {
    color: var(--text-color--link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  /* Header */

  header {
    display: grid;
    grid-template-columns: 180px 1fr auto;
    align-items: center;
    height: 50px;
    padding: 0 10px 0 0;
    background: var(--ai-header-bg);
    border-bottom: 1px solid var(--border-color--semi-light);
    position: sticky;
    top: 0;
    z-index: 10;
    flex: 0 0 50px;
  }

  header .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 14px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color--default);
    letter-spacing: -0.1px;
    white-space: nowrap;
  }

  header .brand img {
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }

  header .search-ctrl {
    position: relative;
  }

  header .search-ctrl .fa-search {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 12px;
    color: var(--text-color--pretty-light);
    pointer-events: none;
  }

  header .search-ctrl input {
    width: 100%;
    height: 30px;
    padding: 0 10px 0 32px;
    background: var(--ai-search-bg);
    border: 0;
    border-radius: 6px;
    box-shadow: none;
    font-size: 13px;
    color: var(--text-color--default);
    box-sizing: border-box;
  }

  header .search-ctrl input:focus {
    outline: 2px solid var(--text-color--link);
    outline-offset: -1px;
  }

  header .search-ctrl input::placeholder {
    color: var(--text-color--pretty-light);
    letter-spacing: 0;
  }

  header .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 0 0 10px;
  }

  header .new-action-btn {
    height: 30px;
    padding: 0 14px;
    font-size: 12px;
    font-weight: 500;
    background: var(--ai-fill);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: 0.1px;
  }

  header .new-action-btn:hover {
    opacity: 0.88;
  }

  header .new-action-btn:active {
    transform: scale(0.98);
  }

  /* Layout */

  .layout {
    display: grid;
    grid-template-columns: 180px 1fr;
    flex: 1;
    overflow: hidden;
  }

  /* Sidebar */

  nav {
    background: var(--ai-sidebar-bg);
    border-right: 1px solid var(--border-color--semi-light);
    overflow-y: auto;
    padding: 6px 0;
  }

  nav .page-nav a {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 11px;
    margin: 1px 6px;
    border-radius: 6px;
    color: var(--text-color--lightish);
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.1s, color 0.1s;
    user-select: none;
  }

  nav .page-nav a:hover {
    background: var(--ai-nav-hover-bg);
    text-decoration: none;
  }

  nav .page-nav a.current {
    background: var(--ai-nav-active-bg);
    color: var(--ai-nav-active-text);
    font-weight: 500;
  }

  nav .page-nav a .fa-fw {
    font-size: 13px;
    width: 15px;
    text-align: center;
    flex: 0 0 15px;
  }

  /* Main */

  main {
    overflow-y: auto;
    background: var(--bg-color--secondary);
  }

  main > * {
    display: block;
    max-width: 860px;
    padding: 16px 20px 80px;
  }

  nav hr {
    border: 0;
    border-top: 1px solid var(--border-color--semi-light);
    margin: 8px 12px;
  }

  nav .page-nav a .ext {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-color--pretty-light);
  }

  header .search-ctrl.hidden {
    visibility: hidden;
  }

  /* Responsive: medium */

  @media (max-width: 800px) {
    header {
      grid-template-columns: 140px 1fr auto;
    }

    .layout {
      grid-template-columns: 140px 1fr;
    }
  }

  /* Responsive: mobile */

  @media (max-width: 600px) {
    header {
      grid-template-columns: auto 1fr auto;
      padding: 0 8px;
    }

    header .brand {
      padding: 0 8px;
      font-size: 13px;
    }

    header .brand img {
      display: none;
    }

    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      overflow: visible;
    }

    nav {
      border-right: 0;
      border-bottom: 1px solid var(--border-color--semi-light);
      padding: 4px 6px;
    }

    nav .page-nav {
      display: flex;
    }

    nav hr,
    nav .page-nav a .ext {
      display: none;
    }

    nav .page-nav a {
      flex: 1;
      justify-content: center;
      gap: 6px;
      margin: 0;
      padding: 7px 8px;
      border-radius: 5px;
    }

    main {
      max-height: calc(100vh - 110px);
    }

    main > * {
      padding: 12px 10px 60px;
    }
  }

  @media (max-width: 420px) {
    nav .page-nav a .label {
      display: none;
    }

    nav .page-nav a .fa-fw {
      font-size: 15px;
    }
  }
`;
export default cssStr;
