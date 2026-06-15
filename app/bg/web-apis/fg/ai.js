// @ts-nocheck
import errors from 'beaker-error-constants';
import aiManifest from '../manifests/external/ai';
import { fromEventStream } from './event-target';

const RPC_OPTS = { timeout: false, errors };

export function setup(rpc) {
  const aiRPC = rpc.importAPI('ai', aiManifest, RPC_OPTS);

  return {
    ai: {
      chat(messages) {
        return streamToAsyncIterator(fromEventStream(aiRPC.chat(messages)));
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
    }
  });

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    },
  };
}
