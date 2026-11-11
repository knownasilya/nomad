// A Persona's Profile Drive that opens after the check's time limit is checked again once it opens,
// instead of staying "This device hasn't got the Persona's profile drive yet." (app/bg/ui/profile-loader.mjs).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProfileLoader } from '../../app/bg/ui/profile-loader.mjs';

const KEY = 'a'.repeat(64);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('createProfileLoader', () => {
  it('gives the drive when it opens in time, with no late call', async () => {
    const onLate = vi.fn();
    const sess = { keyStr: KEY };
    const loader = createProfileLoader({
      load: async () => sess,
      timeoutMs: 1000,
      onLate,
    });
    expect(await loader.open(KEY)).toEqual({ sess, pending: false });
    expect(onLate).not.toHaveBeenCalled();
  });

  it('reports a slow open as pending, then calls onLate once it opens', async () => {
    vi.useFakeTimers();
    const d = deferred();
    const onLate = vi.fn();
    const load = vi.fn(() => d.promise);
    const loader = createProfileLoader({ load, timeoutMs: 8000, onLate });

    const first = loader.open(KEY);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await first).toEqual({ sess: null, pending: true });
    expect(loader.isWaiting(KEY)).toBe(true);

    // A second check while it is still opening waits on the same load and doesn't start another.
    const second = loader.open(KEY);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await second).toEqual({ sess: null, pending: true });
    expect(load).toHaveBeenCalledTimes(1);

    const sess = { keyStr: KEY };
    d.resolve(sess);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLate).toHaveBeenCalledTimes(1);
    expect(onLate).toHaveBeenCalledWith(KEY, sess);
    expect(loader.isWaiting(KEY)).toBe(false);
  });

  it('treats a failed open as not pending, and a late failure calls nothing', async () => {
    const onLate = vi.fn();
    const failing = createProfileLoader({
      load: async () => {
        throw new Error('nope');
      },
      timeoutMs: 1000,
      onLate,
    });
    expect(await failing.open(KEY)).toEqual({ sess: null, pending: false });

    vi.useFakeTimers();
    const d = deferred();
    const slow = createProfileLoader({
      load: () => d.promise,
      timeoutMs: 8000,
      onLate,
    });
    const r = slow.open(KEY);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await r).toEqual({ sess: null, pending: true });
    d.reject(new Error('gone'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onLate).not.toHaveBeenCalled();
    expect(slow.isWaiting(KEY)).toBe(false);
  });
});
