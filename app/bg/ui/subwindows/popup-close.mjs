// Closing popup subwindows (shell menus, site info) on a press outside them.
//
// A popup view closes itself on its page's `blur`, but that only fires when focus moves, and a
// press in another view of the window doesn't always move it (the shell's own chrome, a page that
// doesn't take focus). So bg also watches presses: while a popup is open, a mouse or touch press in
// the shell window or any other view of that window closes it.
//
// That press lands before the click it starts. When the press is on the button that opened the
// popup, the click then asks to toggle it again, and would reopen what the press just closed.
// `createReopenGuard` remembers which popup an outside press (or a blur) closed, for a moment, so
// that toggle is dropped.

const PRESS_TYPES = new Set(['mouseDown', 'touchStart']);

// How long after a popup closed on a press or blur a toggle of the same popup is the same click.
export const REOPEN_GRACE_MS = 500;

/**
 * Calls `onPress` when the user presses anywhere in `parentWindow` outside `own` (the popup's
 * webContents): the window's own webContents (the shell) and every other view attached to it
 * (pages, panes, subwindows). Returns a function that stops watching.
 */
export function watchOutsidePress(parentWindow, own, onPress) {
  const targets = [];
  const add = (wc) => {
    if (wc && wc !== own && !wc.isDestroyed?.() && !targets.includes(wc)) targets.push(wc);
  };
  add(parentWindow.webContents);
  for (const view of parentWindow.getBrowserViews?.() || []) add(view.webContents);
  const listener = (_e, input) => {
    if (PRESS_TYPES.has(input?.type)) onPress();
  };
  for (const wc of targets) wc.on('input-event', listener);
  return () => {
    for (const wc of targets) {
      if (!wc.isDestroyed?.()) wc.removeListener('input-event', listener);
    }
  };
}

/**
 * Remembers the popup a press or blur closed. `shouldIgnoreToggle(id)` is true for a toggle of
 * that popup within REOPEN_GRACE_MS: the click whose press closed it.
 */
export function createReopenGuard(now = () => Date.now()) {
  let closed = null; // { id, at }
  return {
    closedByPress(id) {
      closed = { id, at: now() };
    },
    shouldIgnoreToggle(id) {
      if (!closed || closed.id !== id) return false;
      const ignore = now() - closed.at < REOPEN_GRACE_MS;
      closed = null; // one click at most
      return ignore;
    },
    clear() {
      closed = null;
    },
  };
}
