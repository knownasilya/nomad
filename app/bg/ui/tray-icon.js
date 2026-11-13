import { app, Tray, Menu, BrowserWindow } from 'electron';
import path from 'path';
import { createShellWindow, restoreLastShellWindow } from './windows';
import * as tabManager from './tabs/manager';
import * as settingsDb from '../dbs/settings';

const IS_MAC = process.platform === 'darwin';

// globals
// =

var tray;

// exported api
// =

export function setup() {
  tray = new Tray(path.join(__dirname, getIcon()));
  tray.setToolTip('Nomad Browser');
  tray.on('click', (e) => tray.popUpContextMenu());
  settingsDb.on('set:run_background', buildMenu);
  buildMenu();
}

// internal
// =

function getIcon() {
  // On macOS a "…Template" image (black + alpha, with an @2x) is tinted by the system to fit a
  // light or dark menu bar, so it needs no theme switching; its source is build/tray-icon.svg.
  // Elsewhere use the colored app icon, which shows on light and dark taskbars alike.
  if (IS_MAC) return 'assets/img/tray-iconTemplate.png';
  return 'assets/img/tray-icon.png';
}

async function buildMenu() {
  var runBackground = !!(await settingsDb.get('run_background'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open new tab', click: onClickOpen },
    { label: 'Restore last window', click: onClickRestore },
    { type: 'separator' },
    {
      type: 'checkbox',
      label: 'Let Nomad run in the background',
      checked: runBackground,
      click: () => onTogglePersist(!runBackground),
    },
    { label: 'Quit Nomad', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

function onClickOpen() {
  var win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.show();
    tabManager.create(win, undefined, { setActive: true });
  } else {
    createShellWindow();
  }
}

function onClickRestore() {
  restoreLastShellWindow();
}

function onTogglePersist(v) {
  settingsDb.set('run_background', v ? 1 : 0);
}
