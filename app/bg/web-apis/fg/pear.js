import { EventTargetFromStream } from './event-target';
import pearManifest from '../manifests/external/pear';

export const setup = function (rpc) {
  const bgPear = rpc.importAPI('pear', pearManifest, { timeout: 30e3 });

  // Pear.updates() returns an AsyncIterable that yields { path } objects
  // when the app's drive content changes.
  function makeUpdatesIterable(opts = {}) {
    const stream = bgPear.subscribeUpdates(window.location.href);
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise((resolve, reject) => {
              stream.once('data', (value) => resolve({ value, done: false }));
              stream.once('error', reject);
              stream.once('end', () => resolve({ value: undefined, done: true }));
            });
          },
          return() {
            stream.destroy && stream.destroy();
            return Promise.resolve({ done: true });
          },
        };
      },
    };
  }

  // Pear.messages() — IPC messaging between pear app instances.
  // Not supported in browser context; returns an empty async iterable.
  function makeMessagesIterable() {
    return {
      [Symbol.asyncIterator]() {
        return {
          next() { return Promise.resolve({ done: true }); },
        };
      },
    };
  }

  const teardownHandlers = [];

  const Pear = {
    // Synchronous config accessor — resolved on first access via the bg API.
    // Async helper provided as Pear.getConfig() for explicit awaiting.
    getConfig() {
      return bgPear.getConfig(window.location.href);
    },

    versions() {
      return bgPear.getVersions(window.location.href);
    },

    updates(opts) {
      return makeUpdatesIterable(opts);
    },

    messages(pattern, opts) {
      return makeMessagesIterable();
    },

    teardown(fn) {
      teardownHandlers.push(fn);
      window.addEventListener('beforeunload', fn, { once: true });
    },

    // Lifecycle stubs — meaningful in the Pear desktop runtime;
    // in the browser these are graceful no-ops.
    shutdown() {
      return Promise.resolve();
    },

    exit(code) {
      return Promise.resolve();
    },

    restart(opts) {
      return Promise.resolve();
    },
  };

  // Wire up teardown handlers on page unload.
  window.addEventListener('beforeunload', () => {
    teardownHandlers.forEach((fn) => {
      try { fn(); } catch (e) { /* ignore */ }
    });
  });

  return Pear;
};
