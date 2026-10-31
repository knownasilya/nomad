// Updating this computer from the user's phone (shared/device-updates.mjs). The phone writes an
// update request for this Device into the Vault; this module takes it, downloads the newest release
// with the built-in updater (browser.js), writes how it goes to this Device's update-status record,
// and restarts into the new version. Session restore brings the windows and tabs back.
//
// Who can ask: only a Device in the user's Vault. The Vault is an Autobase whose writers are exactly
// the user's linked Devices, so nobody else can write a request into it, and judgeRequest also
// drops one from a Device the Vault no longer lists, one this Device wrote for itself, and one
// older than REQUEST_TTL_MS (a computer that slept through it updates on its own schedule).
// The `remote_update_enabled` setting (Settings → General → Auto Updater) turns it off.

import { app, Notification } from 'electron';
import b4a from 'b4a';
import * as vault from './hyper/vault';
import * as settingsDb from './dbs/settings';
import * as browser from './browser';
import * as logLib from './logger';
import * as du from '../../shared/device-updates.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'remote-update' });

const SETTING = 'remote_update_enabled';
// Set just before an update restart, read once on the next start (finishRestart).
const RESTARTING_SETTING = 'remote_update_restarting';
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

let watchedBase = null;
let refreshTimer = null;
let busy = false;
const taken = new Set(); // requestedAt of each request taken, until its delete lands

export function setup() {
  refresh();
  vault.events.on('changed', () => refresh());
  // After a restart this module asked for: say the update landed.
  setTimeout(() => finishRestart().catch(() => {}), 10_000);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 500);
}

function ownKeyOf(sess) {
  return sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
}

async function enabled() {
  return Number((await settingsDb.get(SETTING)) ?? 1) !== 0;
}

async function writeStatus(own, fields) {
  try {
    await vault.putAppRecord(du.statusPath(own), du.makeStatus({ device: own, ...fields }));
  } catch (err) {
    logger.warn('Could not write update status', { error: err?.message });
  }
}

export async function refresh() {
  let sess = null;
  try {
    sess = await vault.getVault();
  } catch {
    return;
  }
  if (!sess) return;
  if (sess.base !== watchedBase) {
    if (watchedBase) watchedBase.removeListener('update', scheduleRefresh);
    watchedBase = sess.base;
    watchedBase.on('update', scheduleRefresh);
  }
  const own = ownKeyOf(sess);
  if (!own || busy) return;
  const req = await vault.readAppRecord(du.requestPath(own)).catch(() => null);
  if (!req || taken.has(req.requestedAt)) return;
  const devices = await vault.listDevices().catch(() => []);
  const verdict = du.judgeRequest(req, { ownKey: own, devices });
  if (verdict.reason === 'other') return;
  taken.add(req.requestedAt);
  // Taken once, whatever happens next.
  try {
    await vault.delAppRecord(du.requestPath(own));
  } catch (err) {
    taken.delete(req.requestedAt);
    logger.warn('Could not take an update request', { error: err?.message });
    return;
  }
  if (!verdict.ok) {
    logger.info('Ignored an update request', { reason: verdict.reason, by: req?.by });
    return;
  }
  const from = devices.find((d) => d.key === req.by);
  logger.info('Update requested by another device', {
    by: req.by,
    name: from?.name,
    version: req.version,
  });
  if (!(await enabled())) {
    await writeStatus(own, { state: 'off', request: req, version: app.getVersion() });
    return;
  }
  busy = true;
  try {
    await update(own, req, from?.name || 'your other device');
  } finally {
    busy = false;
  }
}

async function update(own, req, fromName) {
  await writeStatus(own, { state: 'checking', request: req, version: app.getVersion() });
  const onState = ({ state }) => {
    if (state === 'downloading')
      writeStatus(own, { state: 'downloading', request: req, version: req.version });
  };
  browser.onUpdaterState(onState);
  let result;
  try {
    result = await Promise.race([
      browser.downloadUpdateNow({ prerelease: !!req.prerelease }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('The download took too long')), DOWNLOAD_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    const unsupported = err?.code === 'unsupported';
    logger.warn('Update for another device failed', { error: err?.message });
    await writeStatus(own, {
      state: unsupported ? 'unsupported' : 'failed',
      request: req,
      error: err?.message,
    });
    return;
  } finally {
    browser.offUpdaterState(onState);
  }
  if (!result.downloaded) {
    await writeStatus(own, { state: 'current', request: req, version: app.getVersion() });
    return;
  }
  const version = result.version || req.version;
  await writeStatus(own, { state: 'restarting', request: req, version });
  await settingsDb
    .set(RESTARTING_SETTING, JSON.stringify({ version, requestedAt: req.requestedAt, by: req.by }))
    .catch(() => {});
  try {
    new Notification({
      title: `Updating Nomad to ${version}`,
      body: `Asked for by ${fromName}. Nomad restarts in ${Math.round(du.RESTART_DELAY_MS / 1000)} seconds and reopens your tabs.`,
    }).show();
  } catch {}
  setTimeout(() => {
    if (!browser.installUpdateAndRestart()) browser.restartBrowser();
  }, du.RESTART_DELAY_MS);
}

// The first run after a restart for an update: write 'updated' (or 'failed', if the version didn't
// change) so the phone stops showing "Restarting…".
async function finishRestart() {
  const raw = await settingsDb.get(RESTARTING_SETTING).catch(() => null);
  if (!raw) return;
  await settingsDb.set(RESTARTING_SETTING, '').catch(() => {});
  let pending = null;
  try {
    pending = JSON.parse(raw);
  } catch {
    return;
  }
  const sess = await vault.getVault().catch(() => null);
  const own = ownKeyOf(sess);
  if (!own) return;
  const now = app.getVersion();
  const landed = !pending.version || du.compareVersions(now, pending.version) >= 0;
  await vault.publishOwnVersion(now).catch(() => {});
  await writeStatus(own, {
    state: landed ? 'updated' : 'failed',
    version: now,
    request: { requestedAt: pending.requestedAt, by: pending.by },
    error: landed ? null : `Nomad restarted but still runs ${now}`,
  });
}
