// Keeping this Device awake while it serves as an AI Provider (ADR-0013 §7 amendment).
//
// A sleeping laptop is not an AI Provider: the Bridge is a LIVE channel with no store-and-forward
// (ADR-0013 §3/§5), so the moment the machine suspends, its Hyperswarm connections die, the Client
// sees UNAVAILABLE/no-provider, and any in-flight turn rejects with "AI Provider disconnected".
// This module holds an Electron powerSaveBlocker so an idle-but-sharing Device stays reachable.
//
// Two independent holds, refcounted by reason string:
//   REASON_PROVIDER — standing hold while the user opts in to sharing + keep-awake. This is the one
//                     that actually buys reachability: the machine must already be awake to receive
//                     a REQUEST frame at all.
//   REASON_TURN     — held for the duration of one served turn. Buys nothing for reachability, but
//                     stops idle sleep from cutting a slow turn mid-stream (see the 15s HEARTBEAT in
//                     hyper/ai-bridge.js, which exists because a turn can run minutes with no output).
//
// The battery gate applies to the STANDING hold only. Pinning a laptop awake on battery is how a
// user returns to a dead machine. A turn is bounded to minutes, and suspending mid-answer is a worse
// trade than a little battery — so REASON_TURN is exempt.
//
// Platform reality, which is uglier than the API suggests:
//   * macOS — 'prevent-app-suspension' maps to kIOPMAssertionTypePreventUserIdleSystemSleep. It
//     blocks the IDLE sleep timer only. A lid close or an explicit Sleep still suspends. So this
//     delivers "open on the desk, untouched, still reachable" and NOT "closed in a bag".
//   * macOS — battery transitions are event-driven ('on-battery' / 'on-ac').
//   * Linux — powerMonitor emits NEITHER event ('on-ac' is darwin,win32; 'on-battery' is darwin
//     only), so battery state is POLLED. See pollMs.
//   * Linux — Chromium picks its inhibit backend from the DETECTED DESKTOP ENVIRONMENT, not by
//     probing the bus, and does not use systemd-logind at all. On an unrecognised session (sway, i3,
//     Hyprland, a bare session) powerSaveBlocker is a SILENT no-op: start() still returns an id and
//     isStarted() still reports true. We cannot detect that through the API, so we call it anyway and
//     report the likely no-op via getStatus().unsupported rather than failing quietly.
//     A real fix means a logind inhibitor (org.freedesktop.login1.Manager.Inhibit, what=idle:sleep,
//     mode=block, holding the returned fd) via a pure-JS D-Bus client. That is a drop-in extra
//     backend behind this same start/stop surface — deliberately left as a seam, not built here.
//
// Pure-DI factory with no `electron` import, so it unit-tests with plain fakes — same shape as
// web-apis/bg/fs-write-guard.js. hyper/ai-bridge.js and web-apis/bg/ai.ts share ONE instance,
// constructed in ai.ts (the AI composition root) and injected, the same way serveChat already is.

import fs from 'fs';

export const REASON_PROVIDER = 'ai-provider';
export const REASON_TURN = 'ai-turn';

// Reasons that survive running on battery (see header).
const BATTERY_EXEMPT = new Set([REASON_TURN]);

// Sessions where Chromium's power_save_blocker_linux.cc has an inhibit backend: the GNOME family
// (org.gnome.SessionManager) and KDE/XFCE (org.freedesktop.PowerManagement). Heuristic, and used
// ONLY to phrase a warning — never to skip the call, so a wrong guess costs nothing.
const LINUX_INHIBIT_DESKTOPS = /gnome|unity|cinnamon|kde|plasma|xfce/i;

const LINUX_UNSUPPORTED_NOTE =
  'This desktop session has no sleep-inhibit backend Nomad can reach, so keep-awake probably has no effect here.';

/**
 * @typedef {object} AwakeDeps
 * @property {any} [powerSaveBlocker] Electron's powerSaveBlocker (injected so this module stays testable).
 * @property {any} [powerMonitor] Electron's powerMonitor.
 * @property {(fn: () => void) => any} [onWillQuit] Registers a teardown hook (app.on('will-quit')).
 * @property {string} [platform] process.platform, overridable in tests.
 * @property {string} [desktopEnv] XDG_CURRENT_DESKTOP / DESKTOP_SESSION.
 * @property {() => (boolean|null)} [readAcState] true = on AC, false = on battery, null = unknown
 *   (caller falls through to powerMonitor).
 * @property {number} [pollMs] Linux battery poll interval.
 * @property {(fn: () => void, ms: number) => any} [setIntervalFn]
 * @property {(handle: any) => void} [clearIntervalFn]
 * @property {any} [logger]
 */

/** @param {AwakeDeps} [deps] */
export function createAwakeController({
  powerSaveBlocker,
  powerMonitor,
  onWillQuit = () => {},
  platform = process.platform,
  desktopEnv = process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '',
  readAcState = () => null,
  pollMs = 60000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = { info() {}, warn() {} },
} = {}) {
  const held = new Set();
  let blockerId = null;
  let onBattery = false;
  let poll = null;

  const isLinux = platform === 'linux';

  // Reading battery state
  // =

  // sysfs first on Linux: Chromium's power monitor is weakest there, and a flat `false` from
  // isOnBatteryPower() would defeat the gate on exactly the machine that needs it (an unplugged
  // laptop). sysfs is definitive when present; the Electron API is the fallback.
  function readBatteryState() {
    if (isLinux) {
      const ac = readAcState();
      if (ac !== null) return !ac;
    }
    try {
      return !!powerMonitor.isOnBatteryPower();
    } catch (err) {
      logger.warn('awake: isOnBatteryPower failed', { error: err?.toString() });
      return false;
    }
  }

  function refreshBattery() {
    const next = readBatteryState();
    if (next === onBattery) return;
    onBattery = next;
    logger.info('awake: power source changed', { onBattery });
    apply();
  }

  // The blocker itself
  // =

  function shouldHold() {
    for (const reason of held) {
      if (!onBattery || BATTERY_EXEMPT.has(reason)) return true;
    }
    return false;
  }

  function apply() {
    const want = shouldHold();
    if (want && blockerId === null) {
      try {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
        logger.info('awake: holding', { blockerId, reasons: [...held], unsupported: unsupportedNote() });
      } catch (err) {
        blockerId = null;
        logger.warn('awake: powerSaveBlocker.start failed', { error: err?.toString() });
      }
      return;
    }
    if (!want && blockerId !== null) {
      try {
        if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
      } catch (err) {
        logger.warn('awake: powerSaveBlocker.stop failed', { error: err?.toString() });
      }
      logger.info('awake: released', { reasons: [...held], onBattery });
      blockerId = null;
    }
  }

  // Polling exists only for Linux's missing power events, and only while something is held.
  function syncPoll() {
    const wanted = isLinux && held.size > 0;
    if (wanted && poll === null) {
      poll = setIntervalFn(refreshBattery, pollMs);
      if (typeof poll?.unref === 'function') poll.unref();
    } else if (!wanted && poll !== null) {
      clearIntervalFn(poll);
      poll = null;
    }
  }

  function unsupportedNote() {
    if (!isLinux) return null;
    return LINUX_INHIBIT_DESKTOPS.test(desktopEnv) ? null : LINUX_UNSUPPORTED_NOTE;
  }

  // Public surface
  // =

  return {
    // Read the initial power source and subscribe to what this platform actually reports. Neither
    // macOS event fires until a TRANSITION, so the initial read is not optional.
    setup() {
      onBattery = readBatteryState();
      try {
        // darwin-only per the Electron typings; harmless no-ops elsewhere.
        powerMonitor.on('on-battery', refreshBattery);
        powerMonitor.on('on-ac', refreshBattery);
        // A blocker does not survive a suspend we failed to prevent (lid close, explicit Sleep), and
        // the power source may well have changed while we were down.
        powerMonitor.on('resume', refreshBattery);
      } catch (err) {
        logger.warn('awake: powerMonitor subscribe failed', { error: err?.toString() });
      }
      onWillQuit(() => {
        held.clear();
        apply();
      });
      logger.info('awake: ready', { onBattery, unsupported: unsupportedNote() });
    },

    start(reason) {
      if (held.has(reason)) return;
      held.add(reason);
      syncPoll();
      refreshBattery(); // also applies
      apply();
    },

    stop(reason) {
      if (!held.delete(reason)) return;
      apply();
      syncPoll();
    },

    // Shown in Settings → AI so a gate that fires is visible rather than looking broken from the
    // phone. `paused` means: the user asked for keep-awake, and the battery gate is holding it off.
    getStatus() {
      const wantedByUser = held.has(REASON_PROVIDER);
      return {
        holding: blockerId !== null,
        reasons: [...held],
        onBattery,
        paused: wantedByUser && onBattery,
        unsupported: unsupportedNote(),
      };
    },
  };
}

// Singleton holder.
//
// web-apis/bg/ai.ts constructs the controller (it owns the `electron` import) and registers it
// here. A consumer that only needs to READ the status — bg/browser.js, for Settings → AI — then
// imports THIS module, which depends on nothing, instead of reaching into the AI layer. Importing
// ai.ts from browser.js would close an import cycle: browser → ai → ui/tabs/manager → ui/tabs/pane
// → browser.
const IDLE_STATUS = Object.freeze({
  holding: false,
  reasons: [],
  onBattery: false,
  paused: false,
  unsupported: null,
});

let current = null;

export function setCurrent(controller) {
  current = controller;
}

export function getStatus() {
  return current ? current.getStatus() : IDLE_STATUS;
}

// The Linux AC probe injected as `readAcState` above. Returns true (on AC), false (on battery) or
// null (cannot tell — caller falls back to powerMonitor). `root` is a parameter so this is testable
// against a fixture directory.
export function readLinuxAcState(root = '/sys/class/power_supply') {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  let sawMains = false;
  let sawBattery = false;
  let mainsOnline = false;
  for (const name of names) {
    const type = readTrimmed(`${root}/${name}/type`);
    if (type === 'Mains') {
      sawMains = true;
      if (readTrimmed(`${root}/${name}/online`) === '1') mainsOnline = true;
    } else if (type === 'Battery') {
      sawBattery = true;
    }
  }
  if (mainsOnline) return true;
  // No battery device at all: a desktop or a server. It is never "on battery", which is what makes
  // an always-on Provider work with no special-casing.
  if (!sawBattery) return true;
  if (sawMains) return false; // battery present, every mains offline
  return null; // battery but no mains device — cannot tell
}

function readTrimmed(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}
