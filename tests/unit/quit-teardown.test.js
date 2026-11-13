import { describe, it, expect, vi, afterEach } from 'vitest';
import { createQuitTeardown } from '../../app/bg/quit-teardown.mjs';

const event = () => ({
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
});
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe('createQuitTeardown', () => {
  it('lets the quit through when nothing needs closing', () => {
    const quit = vi.fn();
    const onWillQuit = createQuitTeardown({ needed: () => false, steps: [], quit });
    const e = event();
    onWillQuit(e);
    expect(e.prevented).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  });

  it('holds the quit, runs the steps in order, then quits once', async () => {
    const order = [];
    const quit = vi.fn();
    const onWillQuit = createQuitTeardown({
      needed: () => true,
      steps: [
        ['inbox', async () => order.push('inbox')],
        ['daemon', async () => order.push('daemon')],
      ],
      quit,
    });
    const e = event();
    onWillQuit(e);
    expect(e.prevented).toBe(true);
    await flush();
    expect(order).toEqual(['inbox', 'daemon']);
    expect(quit).toHaveBeenCalledTimes(1);

    // The quit that follows goes through, even though the daemon still says it needs closing.
    const again = event();
    onWillQuit(again);
    expect(again.prevented).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('still quits when a step throws, and runs the steps after it', async () => {
    const quit = vi.fn();
    const daemon = vi.fn();
    const warn = vi.fn();
    const onWillQuit = createQuitTeardown({
      needed: () => true,
      steps: [
        [
          'inbox',
          async () => {
            throw new Error('boom');
          },
        ],
        ['daemon', daemon],
      ],
      quit,
      logger: { warn, info() {} },
    });
    onWillQuit(event());
    await flush();
    expect(daemon).toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Quit: inbox failed to close', { error: 'boom' });
  });

  it('quits anyway when a step never finishes', async () => {
    vi.useFakeTimers();
    const quit = vi.fn();
    const after = vi.fn();
    const onWillQuit = createQuitTeardown({
      needed: () => true,
      steps: [
        ['daemon', () => new Promise(() => {})],
        ['after', after],
      ],
      quit,
      timeoutMs: 5000,
    });
    onWillQuit(event());
    await vi.advanceTimersByTimeAsync(4999);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
  });

  it('holds a second quit while closing, without running the steps twice', async () => {
    let finish;
    const step = vi.fn(() => new Promise((r) => (finish = r)));
    const quit = vi.fn();
    const onWillQuit = createQuitTeardown({ needed: () => true, steps: [['daemon', step]], quit });
    onWillQuit(event());
    const second = event();
    onWillQuit(second);
    expect(second.prevented).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
