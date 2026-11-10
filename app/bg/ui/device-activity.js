// When the user last used this computer, and whether a notification should show here or on the
// Device they're using instead (rules: shared/device-activity.mjs). The others learn it from this
// computer's device-presence HELLO (bg/hyper/device-presence.js).
//
// "Used" is any keyboard or mouse input, in any app (Electron's powerMonitor idle time): someone
// working in another app still sees this computer's notifications. While the screen is locked it
// stays where it was when it locked, so a mouse bumped on the lock screen doesn't count. Where the OS
// can't tell the idle time (it reads 0 forever, as on some Wayland desktops), a focused Nomad
// window counts instead.

import { BrowserWindow, powerMonitor } from 'electron';
import * as devicePresence from '../hyper/device-presence';
import * as da from '../../../shared/device-activity.mjs';

const POLL_MS = 5e3;
// The idle time read 0 every time for this long since start: the OS doesn't report it.
const UNSUPPORTED_AFTER_MS = 5 * 60e3;

let started = 0;
let idleSeen = false; // the idle time read more than 0 at least once
let locked = false;
let lastActiveAt = null;
let sentLastActiveAt = null;

export function setup() {
  if (started) return;
  started = Date.now();
  lastActiveAt = started; // Nomad just started: someone opened it
  devicePresence.setActivitySource(() => da.activityFrame(read(), Date.now()));
  try {
    powerMonitor.on('lock-screen', () => {
      read();
      locked = true;
      maybeAnnounce();
    });
    powerMonitor.on('unlock-screen', () => {
      locked = false;
      lastActiveAt = Date.now();
      maybeAnnounce();
    });
    powerMonitor.on('suspend', () => {
      read();
      locked = true;
    });
    powerMonitor.on('resume', () => {
      locked = false;
      read();
      maybeAnnounce();
    });
  } catch {}
  setInterval(maybeAnnounce, POLL_MS).unref?.();
}

// When the user last used this computer (this computer's clock).
function read() {
  if (!started || locked) return lastActiveAt;
  const now = Date.now();
  let idleMs = null;
  try {
    const s = powerMonitor.getSystemIdleState(1);
    if (s === 'locked') return lastActiveAt;
    idleMs = powerMonitor.getSystemIdleTime() * 1000;
  } catch {}
  if (typeof idleMs === 'number' && idleMs > 0) idleSeen = true;
  if (typeof idleMs !== 'number' || (!idleSeen && now - started > UNSUPPORTED_AFTER_MS)) {
    if (BrowserWindow.getFocusedWindow()) lastActiveAt = now;
    return lastActiveAt;
  }
  const at = now - idleMs;
  // Never back: the idle time can only say the user was here later than we knew.
  if (lastActiveAt === null || at > lastActiveAt) lastActiveAt = at;
  return lastActiveAt;
}

function maybeAnnounce() {
  const at = read();
  if (!da.needsResend(at, sentLastActiveAt)) return;
  sentLastActiveAt = at;
  devicePresence.announce();
}

// Whether a notification shows on this computer: not when the user is on another of their Devices.
export function notifyHere() {
  return da.notifyHere({ self: read(), others: devicePresence.lastActive(), now: Date.now() });
}
