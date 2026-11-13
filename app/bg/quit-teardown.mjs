// What happens between "Nomad is quitting" and the process ending (main.js 'will-quit').
//
// Quitting waits for the hyper daemon and the Inbox to close: will-quit is prevented, the steps
// run, and app.quit() is called again. That second quit must always come. When it didn't (a step
// threw, or unannouncing from the DHT never finished), Nomad sat with no windows and never exited.
// On macOS that also stops an update: Squirrel's ShipIt installs only once the old process is gone,
// and only then relaunches, so "Restart to update" closed every window and never came back.
//
// So the teardown here runs once, logs and skips a step that fails, gives up waiting after
// `timeoutMs`, and then always quits.

export const TEARDOWN_TIMEOUT_MS = 10_000;

/**
 * @param {object} o
 * @param {() => boolean} o.needed Whether anything needs tearing down (the daemon is running).
 * @param {Array<[string, () => any]>} o.steps Named steps, run in order.
 * @param {() => void} o.quit Called once the steps finish or time out (app.quit()).
 * @param {number} [o.timeoutMs]
 * @param {{ info?: Function, warn?: Function }} [o.logger]
 * @param {() => number} [o.now]
 * @returns {(e: { preventDefault(): void }) => void} The 'will-quit' listener.
 */
export function createQuitTeardown({
  needed,
  steps,
  quit,
  timeoutMs = TEARDOWN_TIMEOUT_MS,
  logger,
  now = Date.now,
}) {
  let state = 'idle'; // 'running' while the steps run, 'done' once they have (the next quit goes through)

  async function run() {
    const started = now();
    let timer;
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });
    const work = (async () => {
      for (const [name, step] of steps) {
        if (timedOut) return;
        const t = now();
        try {
          await step();
          logger?.info?.(`Quit: ${name} closed`, { ms: now() - t });
        } catch (err) {
          logger?.warn?.(`Quit: ${name} failed to close`, { error: err?.message || String(err) });
        }
      }
    })();
    await Promise.race([work, timeout]);
    clearTimeout(timer);
    if (timedOut) logger?.warn?.('Quit: teardown took too long, quitting anyway', { timeoutMs });
    else logger?.info?.('Quit: teardown done', { ms: now() - started });
  }

  return function onWillQuit(e) {
    if (state === 'done') return;
    if (state === 'running') {
      // Asked to quit again while closing: wait for the teardown, which quits when it ends.
      e.preventDefault();
      return;
    }
    if (!needed()) return;
    e.preventDefault();
    state = 'running';
    run()
      .catch(() => {})
      .finally(() => {
        state = 'done';
        quit();
      });
  };
}
