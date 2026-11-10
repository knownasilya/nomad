// nomad/shared/device-activity.mjs
//
// Which of the user's Devices they're using right now, so a notification shows on that one and not
// on the others (desktop app/bg/ui/device-activity.js, the phone's backend). No imports and no
// globals beyond Math/Number: it also runs on the phone's Bare worklet.
//
// Each Device knows when the user last used it, on its own clock (`lastActiveAt`): a computer from
// the OS's idle time (any input, in any app; frozen while the screen is locked), the phone from the
// app being on screen. It tells the Devices it's connected to in its `nomad/device-presence` HELLO
// (shared/device-presence.mjs) as `activity: { idleMs }`, never as a time, so clocks never have to
// agree: the receiver puts it on its own clock as `receivedAt - idleMs`. A Device sends a new HELLO
// whenever its lastActiveAt moved by RESEND_MS or more, so a Device that's in use is never more than
// about RESEND_MS stale on the others, and one left alone sends nothing.
//
// The rule (`notifyHere`): a Device skips a notification when another of the user's Devices was
// used in the last ACTIVE_WINDOW_MS, and more recently than this one (by more than TIE_MS). If none
// was, or this one is the newest, it shows as before. So when nobody has used anything for two
// minutes, every Device notifies; Devices that aren't connected right now never silence anything.
//
// Like presence itself this is a hint, not a grant: a peer that knows the Vault key could claim to be
// active. The worst it can do is keep a notification off this Device, which the item itself (a Job
// run, a Message) still shows in its app.

export const ACTIVE_WINDOW_MS = 2 * 60e3;
export const RESEND_MS = 20e3;
// Two Devices used within this of each other both notify: neither clearly has the user.
export const TIE_MS = 5e3;
const MAX_IDLE_MS = 7 * 24 * 3600e3;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// The `activity` to send in a HELLO, or null while this Device doesn't know (never used yet).
export function activityFrame(lastActiveAt, now) {
  if (!finite(lastActiveAt) || !finite(now)) return null;
  return { idleMs: Math.round(Math.min(MAX_IDLE_MS, Math.max(0, now - lastActiveAt))) };
}

// A HELLO's `activity`, checked: { idleMs } or null on anything else.
export function readActivity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { idleMs } = raw;
  if (!finite(idleMs) || idleMs < 0) return null;
  return { idleMs: Math.min(MAX_IDLE_MS, Math.round(idleMs)) };
}

// When the sender was last used, on the receiver's clock.
export function lastActiveFrom(activity, receivedAt) {
  const a = readActivity(activity);
  return a && finite(receivedAt) ? receivedAt - a.idleMs : null;
}

// Whether to send a new HELLO: lastActiveAt moved (either way: used again, or the screen locked)
// by RESEND_MS since the one the others have.
export function needsResend(lastActiveAt, sentLastActiveAt) {
  if (!finite(lastActiveAt)) return false;
  if (!finite(sentLastActiveAt)) return true;
  return Math.abs(lastActiveAt - sentLastActiveAt) >= RESEND_MS;
}

// Whether this Device shows a notification. `self` is when it was last used, `others` when each
// connected Device was (all on this Device's clock).
/** @param {{ self?: number | null, others?: Iterable<number | null>, now: number, window?: number }} opts */
export function notifyHere({ self = null, others = [], now, window = ACTIVE_WINDOW_MS }) {
  if (!finite(now)) return true;
  let newest = null;
  for (const t of others) {
    if (!finite(t) || now - t >= window) continue;
    if (newest === null || t > newest) newest = t;
  }
  if (newest === null) return true;
  return finite(self) && self + TIE_MS >= newest;
}
