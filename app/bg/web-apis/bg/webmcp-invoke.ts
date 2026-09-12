// The bg→renderer invoke state machine for the WebMCP bridge, factored out of
// bg/model-context.ts so it can be unit-tested without Electron / emit-stream.
//
// `invoke()` pushes one `['invoke', {callId, name, argsJson}]` frame through the caller's
// `send` fn and returns a promise the renderer settles via `resolve()`. Pending calls are
// keyed `"<wcId>:<seq>"` so `rejectForWc()` can drop a whole page's calls on reload/close.

const DEFAULT_TIMEOUT_MS = 30_000;

type SendFn = (frame: [string, any]) => void;
type Pending = {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createInvokeRegistry() {
  const pending = new Map<string, Pending>();
  let seq = 0;

  function invoke(
    wcId: number,
    name: string,
    args: any,
    send: SendFn,
    opts: { signal?: any; timeoutMs?: number } = {}
  ): Promise<any> {
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
    const callId = wcId + ':' + ++seq;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));

      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error(`Page tool "${name}" timed out`));
      }, timeoutMs);
      pending.set(callId, { resolve, reject, timer });

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            const p = pending.get(callId);
            if (!p) return;
            clearTimeout(p.timer);
            pending.delete(callId);
            p.reject(new Error('aborted'));
          },
          { once: true }
        );
      }

      let argsJson = '{}';
      try {
        argsJson = JSON.stringify(args ?? {});
      } catch {
        argsJson = '{}';
      }
      send(['invoke', { callId, name, argsJson }]);
    });
  }

  function resolve(callId: string, ok: boolean, result?: any, error?: string) {
    const p = pending.get(callId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(callId);
    if (ok) p.resolve(result);
    else p.reject(new Error(error || 'The page tool failed'));
  }

  function rejectForWc(wcId: number, reason: string) {
    for (const [callId, p] of pending) {
      if (callId.startsWith(wcId + ':')) {
        clearTimeout(p.timer);
        p.reject(new Error(reason));
        pending.delete(callId);
      }
    }
  }

  return {
    invoke,
    resolve,
    rejectForWc,
    get pendingCount() {
      return pending.size;
    },
  };
}
