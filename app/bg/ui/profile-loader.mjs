// Opening a Persona's Profile Drive for its check, with a time limit that doesn't lose the drive.
//
// A Profile Drive this Device made can take longer than the limit to open at launch, while the Vault,
// the Spaces and every other drive load at once (15 s was seen). The check can't wait that long, so
// it reports the drive as not ready yet; but the load goes on, and when it finishes `onLate(key)` runs
// so the check is made again. Without that, the Persona kept "hasn't got the profile drive" and no
// picture until something else in the Vault changed.

/**
 * @param {{ load: (key: string) => Promise<any>, timeoutMs: number, onLate: (key: string, sess: any) => void }} o
 */
export function createProfileLoader({ load, timeoutMs, onLate }) {
  const waiting = new Map(); // drive key -> the load still going after its check gave up
  const TIMED_OUT = Symbol('timed out');

  // { sess, pending }: `sess` when the drive opened in time, else null; `pending` when it is still
  // opening (onLate follows), not when it failed.
  async function open(key) {
    const loading =
      waiting.get(key) ||
      Promise.resolve()
        .then(() => load(key))
        .catch(() => null);
    let timer;
    const first = await Promise.race([
      loading,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    if (first !== TIMED_OUT) return { sess: first || null, pending: false };
    if (!waiting.has(key)) {
      waiting.set(key, loading);
      loading.then((sess) => {
        waiting.delete(key);
        if (sess) onLate(key, sess);
      });
    }
    return { sess: null, pending: true };
  }

  return { open, isWaiting: (key) => waiting.has(key) };
}
