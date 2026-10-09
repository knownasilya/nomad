// @ts-nocheck
//
// Settings that follow the user to each of their Devices, through the Vault (ADR-0006). Code keeps
// reading them from settingsDb as usual; this module keeps settingsDb and the Vault's
// /.vault/settings/<key>.json records in step, both ways:
//   - a local change (Settings UI, nomad.browser.setSetting) is written to the Vault;
//   - a change from another Device lands in settingsDb, which fires the usual 'set:<key>' event.
// With no Vault (an unpaired Device) the settings are simply local.

import * as logLib from '../logger';
import * as settingsDb from '../dbs/settings';
import * as vault from './vault';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'synced-settings' });

// Each key here must also be in settingsDb's GLOBAL_SETTINGS: a synced setting can't be per-Space.
export const SYNCED_SETTINGS = ['crawler_enabled'];

const POLL_MS = 60_000; // until the Vault exists (pairing can happen later), check again this often

let applying = false; // true while writing a value that came from the Vault, so it isn't sent back
let watchedBase = null;
let pullTimer = null;

export function setup() {
  for (const key of SYNCED_SETTINGS) {
    settingsDb.on('set:' + key, (value) => {
      if (applying) return;
      vault
        .putSyncedSetting(key, value)
        .catch((err) => logger.warn('Could not sync setting to the Vault', { key, error: err?.message }));
    });
  }
  pull();
  // Cheap when nothing changed (getVault is cached); it also picks up a Vault created or joined
  // after startup.
  setInterval(pull, POLL_MS).unref?.();
}

// Apply the Vault's values locally, and follow the Vault for later changes.
async function pull() {
  let sess;
  try {
    sess = await vault.getVault();
  } catch {
    return;
  }
  if (!sess) return;
  watch(sess);
  let remote;
  try {
    remote = await vault.listSyncedSettings();
  } catch (err) {
    logger.warn('Could not read synced settings', { error: err?.message });
    return;
  }
  for (const key of SYNCED_SETTINGS) {
    if (!(key in remote)) continue; // never set on any Device: the default applies everywhere
    const local = await settingsDb.get(key);
    if (sameValue(local, remote[key])) continue;
    applying = true;
    try {
      await settingsDb.set(key, remote[key]);
      logger.info('Applied synced setting', { key, value: remote[key] });
    } finally {
      applying = false;
    }
  }
}

// Another Device's write shows up as an Autobase 'update'; re-read then, rather than wait for the
// next poll. Bursts (a whole sync catching up) are collapsed into one read.
function watch(sess) {
  const base = sess.base;
  if (!base || base === watchedBase) return;
  watchedBase = base;
  base.on('update', () => {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(pull, 500);
  });
}

// settingsDb stores values as text, so 1, '1' and true are the same setting.
function sameValue(a, b) {
  return String(normalize(a)) === String(normalize(b));
}
function normalize(v) {
  if (v === true || v === 'true') return 1;
  if (v === false || v === 'false') return 0;
  return v;
}
