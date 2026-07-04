import errors from 'beaker-error-constants';
import aiManifest from '../manifests/external/ai';
import { fromEventStream } from './event-target';

const RPC_OPTS = { timeout: false, errors };

export function setup(rpc) {
  const aiRPC = rpc.importAPI('ai', aiManifest, RPC_OPTS);

  return {
    ai: {
      // opts (optional): { driveUrl, allowWrite, context, onToolEvent }
      //   driveUrl / allowWrite / context are forwarded to bg (see bg/ai.ts).
      //   onToolEvent(e) fires for each tool the agent runs that reports state —
      //     currently writeDriveFile, with e.path / e.priorContent for undo.
      chat(messages, opts = {}) {
        const eventTarget = fromEventStream(
          aiRPC.chat(messages, {
            driveUrl: opts.driveUrl,
            allowWrite: opts.allowWrite,
            context: opts.context,
          })
        );
        if (typeof opts.onToolEvent === 'function') {
          eventTarget.addEventListener('tool', (e) => opts.onToolEvent(e));
        }
        return streamToAsyncIterator(eventTarget);
      },
      testConnection(baseUrl) {
        return aiRPC.testConnection(baseUrl);
      },
    },
  };
}

function streamToAsyncIterator(eventTarget) {
  const queue = [];
  let done = false;
  let error = null;
  let pendingResolve = null;
  let pendingReject = null;

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
  };
}
