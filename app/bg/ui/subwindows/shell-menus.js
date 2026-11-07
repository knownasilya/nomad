// @ts-nocheck
/**
 * Shell Menus
 *
 * NOTES
 * - There can only ever be one Shell Menu view for a given browser window
 * - Shell Menu views are created with each browser window and then shown/hidden as needed
 * - The Shell Menu view contains the UIs for multiple menus and swaps between them as needed
 * - When unfocused, the Shell Menu view is hidden (it's meant to act as a popup menu)
 * - A press anywhere else in the window hides it too (popup-close.mjs): focus doesn't always move
 *   on such a press, so the blur alone can leave the menu open
 */

import path from 'path';
import Events from 'events';
import { BrowserView } from 'electron';
import * as rpc from 'pauls-electron-rpc';
import { createShellWindow } from '../windows';
import * as tabManager from '../tabs/manager';
import * as modals from './modals';
import { triggerMenuItemById } from '../window-menu';
import shellMenusRPCManifest from '../../rpc-manifests/shell-menus';
import { findWebContentsParentWindow } from '../../lib/electron';
import * as historyDb from '../../dbs/history';
import * as settingsDb from '../../dbs/settings';
import { isNewTabPage } from '../../../lib/command-palette';
import { watchOutsidePress, createReopenGuard } from './popup-close.mjs';

// globals
// =

const IS_OSX = process.platform === 'darwin';
const MARGIN_SIZE = 10;
const PALETTE_WIDTH = 620;
const PALETTE_HEIGHT = 460;
const PALETTE_RECENT_VISITS = 300; // this Space's newest visits, filtered as you type
const IS_RIGHT_ALIGNED = ['browser', 'bookmark', 'peers', 'share', 'site', 'donate', 'spaces', 'draft', 'mods', 'persona'];
var events = new Events();
var views = {}; // map of {[parentWindow.id] => BrowserView}
var reopenGuards = {}; // map of {[parentWindow.id] => createReopenGuard()}

// exported api
// =

export function setup(parentWindow) {
  var view = (views[parentWindow.id] = new BrowserView({
    webPreferences: {
      defaultEncoding: 'utf-8',
      contextIsolation: false,
      preload: path.join(__dirname, 'fg', 'shell-menus', 'index.build.js'),
    },
  }));
  view.webContents.on('console-message', (e) => {
    console.log('Shell-Menus window says:', e.message);
  });
  view.webContents.loadURL('nomad://shell-menus/');
}

export function destroy(parentWindow) {
  if (get(parentWindow)) {
    get(parentWindow).stopOutsidePress?.();
    get(parentWindow).webContents.destroy();
    delete views[parentWindow.id];
  }
}

export function get(parentWindow) {
  return views[parentWindow.id];
}

export function reposition(parentWindow) {
  var view = get(parentWindow);
  if (view) {
    const setBounds = (b) => {
      if (view.currentDimensions) {
        Object.assign(b, view.currentDimensions);
      } else {
        adjustDimensions(b);
      }
      adjustPosition(b, view, parentWindow);
      view.setBounds(b);
    };
    if (view.menuId === 'command-palette') {
      // Centered near the top of the window, over the page (fg/shell-menus/command-palette.js)
      const parentBounds = parentWindow.getContentBounds();
      const b = { width: PALETTE_WIDTH, height: PALETTE_HEIGHT };
      if (view.currentDimensions) Object.assign(b, view.currentDimensions);
      else adjustDimensions(b);
      b.width = Math.min(b.width, Math.max(320, parentBounds.width - 40));
      view.setBounds({
        x: Math.max(0, Math.round((parentBounds.width - b.width) / 2)),
        y: Math.min(90, Math.max(10, Math.round(parentBounds.height * 0.12))),
        width: b.width,
        height: b.height,
      });
    } else if (view.menuId === 'background-tray') {
      setBounds({
        x: IS_OSX ? 75 : 10,
        y: 33,
        width: 400,
        height: 350,
      });
    } else if (view.menuId === 'browser') {
      setBounds({
        x: view.boundsOpt?.rightOffset ?? 10,
        y: view.boundsOpt?.top ?? 72,
        width: 270,
        height: 350,
      });
    } else if (view.menuId === 'bookmark') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt?.top ?? 72,
        width: 250,
        height: 195,
      });
    } else if (view.menuId === 'bookmark-edit') {
      setBounds({
        x: view.boundsOpt.left,
        y: view.boundsOpt.top,
        width: 250,
        height: 195,
      });
    } else if (view.menuId === 'donate') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt?.top ?? 72,
        width: 350,
        height: 90,
      });
    } else if (view.menuId === 'share') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt?.top ?? 72,
        width: 310,
        height: 120,
      });
    } else if (view.menuId === 'peers') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt?.top ?? 72,
        width: 200,
        height: 350,
      });
    } else if (view.menuId === 'site') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt?.top ?? 72,
        width: 250,
        height: 350,
      });
    } else if (view.menuId === 'draft') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt.top ?? 72,
        width: 280,
        height: 260,
      });
    } else if (view.menuId === 'mods') {
      setBounds({
        x: view.boundsOpt.rightOffset,
        y: view.boundsOpt.top ?? 72,
        width: 300,
        height: 320,
      });
    } else if (view.menuId === 'persona') {
      // Under the location bar's Persona icon (rightOffset + top), or above the sidebar's Spaces
      // button (left + bottom: the menu grows upward from there).
      const bo = view.boundsOpt || {};
      const b = { x: bo.left ?? bo.rightOffset ?? 10, y: bo.top ?? 72, width: 280, height: 260 };
      if (view.currentDimensions) Object.assign(b, view.currentDimensions);
      else adjustDimensions(b);
      if (bo.bottom !== undefined) b.y = Math.max(0, bo.bottom - b.height);
      adjustPosition(b, view, parentWindow);
      view.setBounds(b);
    } else if (view.menuId === 'spaces') {
      const bo = view.boundsOpt;
      if (bo?.left !== undefined) {
        // Above the sidebar's Spaces button (left + bottom): the menu grows upward from there,
        // and stays inside the window.
        const b = { x: bo.left, y: bo.top ?? 34, width: 200, height: 300 };
        if (view.currentDimensions) Object.assign(b, view.currentDimensions);
        else adjustDimensions(b);
        if (bo.bottom !== undefined) b.y = Math.max(0, bo.bottom - b.height);
        const parentBounds = parentWindow.getContentBounds();
        b.x = Math.max(0, Math.min(b.x, parentBounds.width - b.width));
        view.setBounds(b);
      } else {
        setBounds({ x: bo?.rightOffset || 10, y: 34, width: 200, height: 300 });
      }
    }
  }
}

export async function toggle(parentWindow, menuId, opts) {
  var view = get(parentWindow);
  if (view) {
    if (view.isVisible) {
      return hide(parentWindow);
    } else if (guard(parentWindow).shouldIgnoreToggle(toggleKey(menuId, opts))) {
      // the press on this menu's button already closed it; this is that press's click
      return;
    } else {
      return show(parentWindow, menuId, opts);
    }
  }
}

export async function update(parentWindow, opts) {
  var view = get(parentWindow);
  if (view && view.isVisible) {
    view.boundsOpt = opts && opts.bounds ? opts.bounds : view.boundsOpt;
    reposition(parentWindow);
    var params = opts && opts.params ? opts.params : {};
    await view.webContents.executeJavaScript(`updateMenu(${JSON.stringify(params)}); undefined`);
  }
}

export async function show(parentWindow, menuId, opts) {
  var view = get(parentWindow);
  if (view) {
    view.menuId = menuId;
    view.boundsOpt = opts && opts.bounds;
    view.toggleKey = toggleKey(menuId, opts);
    parentWindow.addBrowserView(view);
    reposition(parentWindow);
    view.isVisible = true;
    guard(parentWindow).clear();
    view.stopOutsidePress?.();
    view.stopOutsidePress = watchOutsidePress(parentWindow, view.webContents, () => {
      if (view.isVisible) hide(parentWindow, { byPress: true });
    });

    var params = opts && opts.params ? opts.params : {};
    await view.webContents.executeJavaScript(
      `openMenu('${menuId}', ${JSON.stringify(params)}); undefined`
    );
    view.webContents.focus();

    // await till hidden
    await new Promise((resolve) => {
      events.once('hide', resolve);
    });
  }
}

// `byPress`: closed by a press outside it or by its blur, so a toggle of the same menu right after
// is the click of that press (see popup-close.mjs).
export function hide(parentWindow, { byPress = false } = {}) {
  var view = get(parentWindow);
  if (view) {
    view.stopOutsidePress?.();
    view.stopOutsidePress = null;
    if (byPress && view.isVisible) guard(parentWindow).closedByPress(view.toggleKey);
    view.webContents.executeJavaScript(`reset('${view.menuId}'); undefined`);
    parentWindow.removeBrowserView(view);
    view.currentDimensions = null;
    view.isVisible = false;
    events.emit('hide');
  }
}

// rpc api
// =

rpc.exportAPI('background-process-shell-menus', shellMenusRPCManifest, {
  // `opts.blur`: the menu closed itself because it lost focus (fg/shell-menus/index.js)
  async close(opts) {
    hide(findWebContentsParentWindow(this.sender), { byPress: !!opts?.blur });
  },

  // Swap the open menu for another in the same spot (the site menu's Mods item opens the Mods menu).
  // The opener's toggle() keeps waiting until this one hides.
  async switchMenu(menuId, params) {
    var win = findWebContentsParentWindow(this.sender);
    var view = win ? views[win.id] : undefined;
    if (!view || !view.isVisible || !IS_RIGHT_ALIGNED.includes(menuId)) return;
    view.webContents.executeJavaScript(`reset('${view.menuId}'); undefined`);
    view.menuId = menuId; // keeps the opener's toggleKey: its button still closes this one
    view.currentDimensions = null;
    reposition(win);
    await view.webContents.executeJavaScript(
      `openMenu('${menuId}', ${JSON.stringify(params || {})}); undefined`
    );
  },

  async createWindow(opts) {
    createShellWindow(opts);
  },

  async createTab(url) {
    var win = findWebContentsParentWindow(this.sender);
    hide(win); // always close the menu
    tabManager.create(win, url, { setActive: true });
  },

  async createModal(name, opts) {
    return modals.create(this.sender, name, opts);
  },

  async loadURL(url) {
    var win = findWebContentsParentWindow(this.sender);
    hide(win); // always close the menu
    tabManager.getActive(win).loadURL(url);
  },

  async resizeSelf(dimensions) {
    var win = findWebContentsParentWindow(this.sender);
    var view = win ? views[win.id] : undefined;
    if (!view || !view.isVisible) return;
    adjustDimensions(dimensions);
    view.currentDimensions = dimensions;
    reposition(findWebContentsParentWindow(this.sender));
  },

  async showInpageFind() {
    var win = findWebContentsParentWindow(this.sender);
    var tab = tabManager.getActive(win);
    if (tab) tab.showInpageFind();
  },

  async triggerWindowMenuItemById(menu, id) {
    return triggerMenuItemById(menu, id);
  },

  // The command palette (Cmd/Ctrl+K): what it lists is the window's current Space's, its tabs in
  // this window and the history visited in it (app/lib/command-palette.ts).
  async getPalette() {
    var win = findWebContentsParentWindow(this.sender);
    if (!win) return null;
    const space = tabManager.getWindowActiveSpace(win);
    const spaceId = tabManager.getWindowActiveSpaceId(win);
    const tabs = tabManager.getVisibleTabs(win).map((tab, index) => ({
      index,
      url: tab.url || tab.loadingURL || '',
      title: tab.title || '',
      isActive: !!tab.isActive,
      isPinned: !!tab.isPinned,
    }));
    const [recent, engines] = await Promise.all([
      historyDb.getVisitHistory(0, { limit: PALETTE_RECENT_VISITS }, spaceId).catch(() => []),
      settingsDb.getForSpace(spaceId, 'search_engines').catch(() => null),
    ]);
    const list = Array.isArray(engines) ? engines : [];
    const engine = list.find((se) => se && se.selected) || list[0] || null;
    return {
      space: space ? { id: space.id, name: space.name, color: space.color, icon: space.icon } : null,
      tabs,
      recent: (recent || []).map((v) => ({ url: v.url, title: v.title, ts: v.ts })),
      searchEngine: engine ? { name: engine.name, url: engine.url } : null,
    };
  },

  // Older history in the current Space for what's typed (the newest visits come with getPalette).
  async searchPaletteHistory(query) {
    var win = findWebContentsParentWindow(this.sender);
    if (!win || !query || typeof query !== 'string') return [];
    const spaceId = tabManager.getWindowActiveSpaceId(win);
    try {
      const rows = await historyDb.getVisitHistory(0, { search: query, limit: 40 }, spaceId);
      return rows.map((v) => ({ url: v.url, title: v.title, ts: v.ts }));
    } catch (e) {
      return []; // a query sqlite's full-text search can't parse
    }
  },

  // Switch to one of the current Space's tabs (its index in getPalette's `tabs`).
  async switchToTab(index) {
    var win = findWebContentsParentWindow(this.sender);
    hide(win);
    const tab = tabManager.getByIndex(win, index);
    if (tab) tabManager.setActive(win, tab);
  },

  // Open an address from the palette: in a new tab in the current Space, or in this tab when it's
  // the new tab page or `here` is set (Shift+Enter).
  async openFromPalette(url, opts = {}) {
    var win = findWebContentsParentWindow(this.sender);
    hide(win);
    if (!win || !url || typeof url !== 'string') return;
    const active = tabManager.getActive(win);
    if (active && (opts.here || isNewTabPage(active.url || active.loadingURL))) {
      active.primaryPane.loadURL(url);
      active.primaryPane.webContents?.focus();
    } else {
      tabManager.create(win, url, { setActive: true });
    }
  },
});

// internal methods
// =

function guard(parentWindow) {
  return (reopenGuards[parentWindow.id] = reopenGuards[parentWindow.id] || createReopenGuard());
}

// One menu id opens from several buttons (the Persona menu: location bar, Spaces button, sidebar),
// each with its own bounds, so the button is part of the key.
function toggleKey(menuId, opts) {
  return `${menuId}:${JSON.stringify(opts?.bounds || null)}`;
}

function adjustPosition(bounds, view, parentWindow) {
  if (view.boundsOpt?.left !== undefined) {
    // Explicit position provided (e.g. sidebar spaces button) — use as-is.
    return;
  }
  if (IS_RIGHT_ALIGNED.includes(view.menuId)) {
    let parentBounds = parentWindow.getContentBounds();
    bounds.x = parentBounds.width - bounds.width - bounds.x + MARGIN_SIZE;
  } else {
    bounds.x = bounds.x - MARGIN_SIZE;
  }
}

function adjustDimensions(bounds) {
  bounds.width = bounds.width + MARGIN_SIZE * 2;
  bounds.height = bounds.height + MARGIN_SIZE;
}
