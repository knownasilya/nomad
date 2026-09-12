// Wraps an AI chat stream's EventTarget (chunk/done/error events — from fromEventStream() over
// the RPC readable stream) into an async iterator. This is the contract both window.nomad.ai.chat()
// (fg/ai.ts, for content pages) and the shell AI sidebar's chat() (ai-shell.ts, consumed by
// fg/shell-window/ai-sidebar.js) give their callers, including .return() support so a Stop click
// aborts the in-flight turn server-side. Kept in one place so a fix to cancellation/error
// semantics never has to be applied twice.
export function streamToAsyncIterator(eventTarget) {
  const queue: any[] = [];
  let done = false;
  let error: any = null;
  let pendingResolve: any = null;
  let pendingReject: any = null;

  eventTarget.addEventListener('chunk', (e) => {
    const item = { value: e.text, done: false };
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      r(item);
    } else {
      queue.push(item);
    }
  });

  eventTarget.addEventListener('done', () => {
    done = true;
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      r({ value: undefined, done: true });
    }
  });

  eventTarget.addEventListener('error', (e) => {
    const err = new Error(e.message || 'AI stream error');
    if (pendingReject) {
      const r = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      r(err);
    } else {
      // No consumer is currently awaiting — remember the error so the next
      // next() call surfaces it instead of hanging forever.
      error = err;
    }
  });

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (error) {
        const e = error;
        error = null;
        return Promise.reject(e);
      }
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    },
    // Called when the consumer stops early (`break`, or an explicit .return() from a Stop
    // button). Closes the RPC stream, which bg turns into an AbortController.abort() on the
    // in-flight turn (see chat() in bg/ai.ts).
    return(value) {
      done = true;
      try {
        eventTarget.close();
      } catch {
        /* already closed */
      }
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        r({ value: undefined, done: true });
      }
      return Promise.resolve({ value, done: true });
    },
  };
}
