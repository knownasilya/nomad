// The bg→renderer invoke state machine for the WebMCP bridge
// (app/bg/web-apis/bg/webmcp-invoke.ts). Pure — no Electron / emit-stream.

import { describe, it, expect, vi } from 'vitest';
import { createInvokeRegistry } from '../../app/bg/web-apis/bg/webmcp-invoke.js';

describe('createInvokeRegistry', () => {
  it('pushes one invoke frame and resolves it via resolve()', async () => {
    const reg = createInvokeRegistry();
    const sent = [];
    const p = reg.invoke(7, 'echo', { msg: 'hi' }, (frame) => sent.push(frame));

    expect(sent).toHaveLength(1);
    const [type, payload] = sent[0];
    expect(type).toBe('invoke');
    expect(payload).toMatchObject({ name: 'echo', argsJson: '{"msg":"hi"}' });
    expect(payload.callId).toMatch(/^7:/);
    expect(reg.pendingCount).toBe(1);

    reg.resolve(payload.callId, true, { content: [{ type: 'text', text: 'ok' }] });
    await expect(p).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(reg.pendingCount).toBe(0);
  });

  it('rejects when resolve() reports failure', async () => {
    const reg = createInvokeRegistry();
    let callId;
    const p = reg.invoke(1, 't', {}, ([, payload]) => (callId = payload.callId));
    reg.resolve(callId, false, undefined, 'tool blew up');
    await expect(p).rejects.toThrow('tool blew up');
  });

  it('times out a call that is never resolved', async () => {
    vi.useFakeTimers();
    try {
      const reg = createInvokeRegistry();
      const p = reg.invoke(1, 'slow', {}, () => {}, { timeoutMs: 5000 });
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
      expect(reg.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const reg = createInvokeRegistry();
    const ac = new AbortController();
    ac.abort();
    const sent = [];
    await expect(
      reg.invoke(1, 't', {}, (f) => sent.push(f), { signal: ac.signal })
    ).rejects.toThrow('aborted');
    expect(sent).toHaveLength(0);
  });

  it('rejects a pending call when its signal aborts', async () => {
    const reg = createInvokeRegistry();
    const ac = new AbortController();
    const p = reg.invoke(1, 't', {}, () => {}, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow('aborted');
    expect(reg.pendingCount).toBe(0);
  });

  it('rejectForWc() drops every pending call for one webContents', async () => {
    const reg = createInvokeRegistry();
    const ids = [];
    const grab = ([, payload]) => ids.push(payload.callId);
    const a = reg.invoke(10, 't', {}, grab);
    const b = reg.invoke(10, 't', {}, grab);
    const other = reg.invoke(11, 't', {}, grab);
    expect(reg.pendingCount).toBe(3);

    reg.rejectForWc(10, 'page navigated');
    await expect(a).rejects.toThrow('page navigated');
    await expect(b).rejects.toThrow('page navigated');
    expect(reg.pendingCount).toBe(1);

    // the wc 11 call is untouched
    reg.resolve(ids[2], true, 'ok');
    await expect(other).resolves.toBe('ok');
  });
});
