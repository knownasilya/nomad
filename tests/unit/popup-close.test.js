import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  watchOutsidePress,
  createReopenGuard,
  REOPEN_GRACE_MS,
} from '../../app/bg/ui/subwindows/popup-close.mjs';

function wc() {
  const e = new EventEmitter();
  e.destroyed = false;
  e.isDestroyed = () => e.destroyed;
  return e;
}

function windowWith(...views) {
  return { webContents: wc(), getBrowserViews: () => views };
}

const press = (target, type = 'mouseDown') => target.emit('input-event', {}, { type });

describe('watchOutsidePress', () => {
  it('fires on a press in the shell or another view, never in its own view', () => {
    const own = { webContents: wc() };
    const page = { webContents: wc() };
    const win = windowWith(own, page);
    const onPress = vi.fn();
    watchOutsidePress(win, own.webContents, onPress);

    press(own.webContents);
    expect(onPress).not.toHaveBeenCalled();
    press(win.webContents);
    press(page.webContents);
    press(page.webContents, 'touchStart');
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it("can leave out the shell itself (for the shell's own popups)", () => {
    const page = { webContents: wc() };
    const win = windowWith(page);
    const onPress = vi.fn();
    watchOutsidePress(win, win.webContents, onPress);
    press(win.webContents);
    expect(onPress).not.toHaveBeenCalled();
    press(page.webContents);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores moves, releases and keys', () => {
    const page = { webContents: wc() };
    const onPress = vi.fn();
    watchOutsidePress(windowWith(page), null, onPress);
    for (const type of ['mouseMove', 'mouseUp', 'keyDown', 'mouseWheel'])
      press(page.webContents, type);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('stops watching, and skips views already gone', () => {
    const page = { webContents: wc() };
    const gone = { webContents: wc() };
    gone.webContents.destroyed = true;
    const win = windowWith(page, gone);
    const onPress = vi.fn();
    const stop = watchOutsidePress(win, null, onPress);
    expect(gone.webContents.listenerCount('input-event')).toBe(0);

    stop();
    press(win.webContents);
    press(page.webContents);
    expect(onPress).not.toHaveBeenCalled();
    expect(page.webContents.listenerCount('input-event')).toBe(0);
  });
});

describe('createReopenGuard', () => {
  it('drops the click of the press that closed the same popup', () => {
    let t = 1000;
    const g = createReopenGuard(() => t);
    g.closedByPress('spaces:null');
    t += 150;
    expect(g.shouldIgnoreToggle('spaces:null')).toBe(true);
    // one click only: the next one opens it
    expect(g.shouldIgnoreToggle('spaces:null')).toBe(false);
  });

  it('lets another popup, a later click, or a cleared guard through', () => {
    let t = 0;
    const g = createReopenGuard(() => t);
    g.closedByPress('spaces:null');
    expect(g.shouldIgnoreToggle('persona:{"left":4}')).toBe(false);

    g.closedByPress('spaces:null');
    t += REOPEN_GRACE_MS;
    expect(g.shouldIgnoreToggle('spaces:null')).toBe(false);

    g.closedByPress('spaces:null');
    g.clear();
    expect(g.shouldIgnoreToggle('spaces:null')).toBe(false);
  });
});
