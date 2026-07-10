// @ts-nocheck
import { BrowserWindow } from 'electron';
import EventEmitter from 'events';
import { debounce } from '../../lib/async';
import { defaultPageState } from './default-state';

const SNAPSHOT_PATH = 'shell-window-state.json';
var lastRecordedPositioning = {};

// exported api
// =

export default class SessionWatcher {
  static get emptySnapshot() {
    return {
      windows: [],
      // Tabs of recently-closed windows (most-recent first, capped), kept so a soft close never
      // loses its tabs: restored on dock-reopen, or on next launch if every window was closed
      // before quitting. Persisted, unlike an in-memory-only stack.
      closedWindows: [],
      backgroundTabs: [],
      // We set this to false by default and clean this up when the session
      // exits. If we ever open up a snapshot and this isn't cleaned up assume
      // there was a crash
      cleanExit: false,
    };
  }

  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.snapshot = SessionWatcher.emptySnapshot;
    this.recording = true;
    this.watchers = {};
  }

  startRecording() {
    this.recording = true;
  }
  stopRecording() {
    this.recording = false;
  }

  updateBackgroundTabs(tabs) {
    this.snapshot.backgroundTabs = tabs.map((tab) => tab.getSessionSnapshot());
    this.writeSnapshot();
  }

  watchWindow(win, initialState) {
    const winId = win.id;
    let state = initialState;
    this.snapshot.windows.push(state);
    let watcher = new WindowWatcher(win, initialState);
    this.watchers[winId] = watcher;

    watcher.on('change', (nextState) => {
      if (this.recording) {
        let { windows } = this.snapshot;
        let i = windows.indexOf(state);
        if (i === -1) return;
        state = windows[i] = nextState;
        this.writeSnapshot();
      }
    });

    watcher.on('remove', () => {
      if (this.recording) {
        let i = this.snapshot.windows.indexOf(state);
        this.snapshot.windows.splice(i, 1);
        // Remember the closed window's tabs (persisted + capped) so they can be restored.
        this.snapshot.closedWindows = [state, ...(this.snapshot.closedWindows || [])].slice(0, 10);
        this.writeSnapshot();
      }
      delete this.watchers[winId];
      watcher.removeAllListeners();
    });
  }

  exit() {
    this.snapshot.cleanExit = true;
    this.writeSnapshot();
  }

  writeSnapshot() {
    this.userDataDir.write(SNAPSHOT_PATH, this.snapshot, { atomic: true });
  }

  getState(winId) {
    if (winId && typeof winId === 'object') {
      // window object
      winId = winId.id;
    }
    return this.watchers[winId].snapshot;
  }

  updateState(winId, state) {
    if (winId && typeof winId === 'object') {
      // window object
      winId = winId.id;
    }
    return this.watchers[winId].update(state);
  }

  getBackgroundTabsState() {
    return this.snapshot.backgroundTabs || [];
  }

  popLastClosedWindow() {
    const state = (this.snapshot.closedWindows || []).shift();
    if (state) this.writeSnapshot();
    return state;
  }
}

export function getLastRecordedPositioning() {
  return lastRecordedPositioning;
}

// internal methods
// =

class WindowWatcher extends EventEmitter {
  constructor(win, initialState) {
    super();
    this.handleClosed = this.handleClosed.bind(this);
    this.handlePagesUpdated = this.handlePagesUpdated.bind(this);
    this.handlePositionChange = this.handlePositionChange.bind(this);
    this.handleAlwaysOnTopChanged = this.handleAlwaysOnTopChanged.bind(this);

    // right now this class trusts that the initial state is correctly formed by this point
    this.snapshot = JSON.parse(JSON.stringify(initialState));
    this.winId = win.id;
    win.on('closed', this.handleClosed);
    win.on('resize', debounce(this.handlePositionChange, 1000));
    win.on('moved', this.handlePositionChange);
    win.on('always-on-top-changed', this.handleAlwaysOnTopChanged);
    win.on('custom-pages-updated', this.handlePagesUpdated);
  }

  getWindow() {
    return BrowserWindow.fromId(this.winId);
  }

  update(state) {
    for (let k in state) {
      this.snapshot[k] = state[k];
    }
    this.emit('change', this.snapshot);
  }

  // handlers

  handleClosed() {
    var win = BrowserWindow.fromId(this.winId);
    if (win) win.removeListener('custom-pages-updated', this.handlePagesUpdated);
    this.emit('remove');
  }

  handlePagesUpdated(payload) {
    const pages = Array.isArray(payload) ? payload : payload?.pages || [];
    const groups = Array.isArray(payload) ? [] : payload?.groups || [];
    if (
      JSON.stringify(pages) === JSON.stringify(this.snapshot.pages) &&
      JSON.stringify(groups) === JSON.stringify(this.snapshot.groups)
    )
      return;
    this.snapshot.pages = pages && pages.length ? pages : defaultPageState();
    this.snapshot.groups = groups;
    this.emit('change', this.snapshot);
  }

  handlePositionChange() {
    lastRecordedPositioning = this.getWindow().getBounds();
    Object.assign(this.snapshot, lastRecordedPositioning);
    this.emit('change', this.snapshot);
  }

  handleAlwaysOnTopChanged(e, isAlwaysOnTop) {
    this.snapshot.isAlwaysOnTop = isAlwaysOnTop;
    this.emit('change', this.snapshot);
  }
}
