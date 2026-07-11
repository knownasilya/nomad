import { LitElement, html, css } from 'lit';
import * as bg from './bg-process-rpc';

// Minimize / maximize / close buttons for platforms without native window chrome.
// The shell window is created with titleBarStyle:'hidden' (bg/ui/windows.js): macOS keeps
// its native traffic lights, but Windows and Linux end up with NO window buttons — modern
// Electron honors the hidden title bar on Linux too, which is what removed the native
// frame there. This element supplies the buttons, fixed over the top-right of the tab
// strip. (It replaces <shell-window-win32>, a Beaker-era tag that had no implementation.)
class ShellWindowControls extends LitElement {
  render() {
    return html`
      <button title="Minimize" @click=${() => bg.beakerBrowser.minimizeWindow()}>
        <svg viewBox="0 0 10 10"><path d="M0 5 H10" /></svg>
      </button>
      <button title="Maximize" @click=${() => bg.beakerBrowser.toggleWindowMaximized()}>
        <svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" /></svg>
      </button>
      <button class="close" title="Close" @click=${() => bg.beakerBrowser.closeWindow()}>
        <svg viewBox="0 0 10 10"><path d="M0 0 L10 10 M10 0 L0 10" /></svg>
      </button>
    `;
  }
}
ShellWindowControls.styles = css`
  :host {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 100; /* above the tab strip, which reserves margin for us (see tabs.js) */
    display: flex;
    height: 34px; /* match .shell height in tabs.js */
    -webkit-app-region: no-drag;
  }
  button {
    width: 46px;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--text-color--default, #556);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: 0;
  }
  button:hover {
    background: var(--bg-color--semi-light, rgba(128, 128, 128, 0.2));
  }
  button.close:hover {
    background: #e81123;
    color: #fff;
  }
  svg {
    width: 10px;
    height: 10px;
    stroke: currentColor;
    stroke-width: 1;
  }
`;
customElements.define('shell-window-controls', ShellWindowControls);
