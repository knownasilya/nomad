import { app } from 'electron';
import { parseDriveUrl } from '../../../lib/urls';
import * as drives from '../../hyper/drives';
import * as logLib from '../../logger';
import { EventEmitter } from 'events';

const logger = logLib.child({ category: 'pear', subcategory: 'api' });

// Track active update subscriptions so we can clean them up.
// Maps driveKey → array of EventEmitter instances
const updateSubscriptions = new Map();

function getDriveKey(callerUrl) {
  const urlp = parseDriveUrl(callerUrl);
  if (!urlp.hostname) throw new Error('Invalid pear:// URL: ' + callerUrl);
  return urlp.hostname;
}

export async function getConfig(callerUrl) {
  const host = getDriveKey(callerUrl);
  try {
    const driveKey = await drives.fromURLToKey(host, true);
    const drive = await drives.getOrLoadDrive(driveKey);
    const { checkoutFS } = await drives.getDriveCheckout(drive, undefined);

    // Try pear.json first, then fall back to index.json manifest fields
    let config = { key: driveKey };
    try {
      const pearJson = JSON.parse(await checkoutFS.pda.readFile('/pear.json'));
      Object.assign(config, pearJson);
    } catch (e) {
      // no pear.json
    }
    if (!config.name) {
      try {
        const manifest = await checkoutFS.pda.readManifest();
        if (manifest) Object.assign({ name: manifest.title }, config);
      } catch (e) {
        // ignore
      }
    }
    return config;
  } catch (err) {
    logger.warn('getConfig failed', { callerUrl, err });
    throw err;
  }
}

export async function getVersions(callerUrl) {
  const host = getDriveKey(callerUrl);
  try {
    const driveKey = await drives.fromURLToKey(host, true);
    const drive = await drives.getOrLoadDrive(driveKey);
    const { checkoutFS } = await drives.getDriveCheckout(drive, undefined);
    const driveVersion = await checkoutFS.session.drive.version();
    return {
      app: driveVersion,
      platform: app.getVersion(),
    };
  } catch (err) {
    logger.warn('getVersions failed', { callerUrl, err });
    throw err;
  }
}

// subscribeUpdates returns a readable stream (EventEmitter-based).
// pauls-electron-rpc will emit each value pushed via .push() as a stream event.
export function subscribeUpdates(callerUrl) {
  const emitter = new EventEmitter();
  emitter.readable = true; // signal to rpc layer this is a readable stream

  setImmediate(async () => {
    try {
      const host = getDriveKey(callerUrl);
      const driveKey = await drives.fromURLToKey(host, true);
      const drive = await drives.getOrLoadDrive(driveKey);

      const watcher = drive.pda.watch('/');
      watcher.on('invalidated', ({ path }) => {
        emitter.emit('data', { path });
      });
      emitter.on('close', () => watcher.close());

      if (!updateSubscriptions.has(driveKey)) {
        updateSubscriptions.set(driveKey, []);
      }
      updateSubscriptions.get(driveKey).push(emitter);
    } catch (err) {
      logger.warn('subscribeUpdates failed', { callerUrl, err });
      emitter.emit('error', err);
    }
  });

  return emitter;
}

export async function postMessage(callerUrl, message) {
  // IPC messaging between pear apps is not supported in browser context;
  // stub provided for API compatibility.
  logger.silly('postMessage (stub)', { callerUrl, message });
}

export default {
  getConfig,
  getVersions,
  subscribeUpdates,
  postMessage,
};
