// Widevine, the DRM module Prime Video, Netflix, Disney+ and other streaming sites need to decrypt
// video. Stock Electron doesn't ship it: those sites' players ask for the `com.widevine.alpha` key
// system, get nothing, and show a generic playback error. castLabs' build of Electron ("ECS",
// https://github.com/castlabs/electron-releases) adds a `components` API that downloads and installs
// the Widevine CDM through Chromium's component updater. On stock Electron `components` is undefined
// and everything here is a no-op.
//
// The CDM has to be registered before a renderer starts, or that renderer never sees it, so main.js
// starts this as early as it can and waits (with a time limit) before the first browser window opens.
// On first launch this downloads the CDM; after that it is already on disk and ready at once.
//
// Production streaming services also check the app's VMP signature (Verified Media Path). The release
// build signs it with castLabs EVS in scripts/afterPackHook.js (see docs/releasing.md).

import * as electron from 'electron';
import * as logLib from './logger';

const logger = logLib.child({ category: 'browser', subcategory: 'widevine' });

// How long to hold the first browser window for the CDM download on a first launch. A slower download
// carries on in the background; tabs opened after it lands can play protected video.
const WAIT_MS = 15e3;

let ready = null;

export function hasComponentsApi() {
  return !!(electron.components && typeof electron.components.whenReady === 'function');
}

// Starts installing the Widevine CDM. Returns a promise that resolves (never rejects) when it's done
// or has failed.
export function setup() {
  if (ready) return ready;
  if (!hasComponentsApi()) {
    logger.info('No Widevine: this Electron build has no components API (not a castLabs build)');
    ready = Promise.resolve(false);
    return ready;
  }
  ready = electron.components
    .whenReady()
    .then(() => {
      logger.info('Widevine ready', { status: electron.components.status() });
      return true;
    })
    .catch((e) => {
      logger.warn('Widevine failed to install', {
        error: e && e.toString(),
        errors: e && e.errors ? e.errors.map(String) : undefined,
        status: safeStatus(),
      });
      return false;
    });
  return ready;
}

// Waits for setup() up to WAIT_MS, so the first browser window's renderers can use the CDM.
export async function waitBriefly() {
  if (!ready) setup();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), WAIT_MS);
  });
  const res = await Promise.race([ready, timeout]);
  clearTimeout(timer);
  if (res === 'timeout') logger.info('Widevine is still installing; opening windows without waiting');
  return res === true;
}

function safeStatus() {
  try {
    return electron.components.status();
  } catch (e) {
    return undefined;
  }
}
