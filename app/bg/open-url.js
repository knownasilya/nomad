// @ts-nocheck
// handle OSX open-url event
import { BrowserWindow, ipcMain } from 'electron';
import * as windows from './ui/windows';
import * as tabManager from './ui/tabs/manager';
import { acceptUrlFor } from './hyper/invites';
var queue = [];
var isLoaded = false;
var isSetup = false;

export function setup() {
  if (isSetup) return;
  isSetup = true;
  ipcMain.on('shell-window:ready', function (e) {
    var win = BrowserWindow.fromWebContents(e.sender);
    queue.forEach((url) => tabManager.create(win, url));
    queue.length = 0;
    isLoaded = true;
  });
}

export function open(url, opts = {}) {
  setup();
  // An invite link (ADR-0040 §4) opens the page that reads it, never the link as a tab URL.
  url = acceptUrlFor(url) || url;
  var win = windows.getActiveWindow();
  if (isLoaded && win) {
    // send command now
    tabManager.create(win, url, opts);
    win.show();
  } else {
    // queue for later
    queue.push(url);

    // no longer loaded?
    if (isLoaded) {
      isLoaded = false;
      // spawn a new window
      windows.createShellWindow();
    }
  }
  return win && win.webContents;
}
