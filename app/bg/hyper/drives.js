// @ts-nocheck
import emitStream from 'emit-stream';
import EventEmitter from 'events';
import b4a from 'b4a';
import { parseDriveUrl } from '../../lib/urls';
import { wait } from '../../lib/functions';
import * as logLib from '../logger';
const baseLogger = logLib.get();
const logger = baseLogger.child({ category: 'hyper', subcategory: 'drives' });

// dbs
import * as archivesDb from '../dbs/archives';
import * as hyperDnsDb from '../dbs/dat-dns';

// hyperdrive modules
import * as daemon from './daemon';
import * as driveAssets from './assets';
import * as hyperDns from './dns';

// fs modules
import * as filesystem from '../filesystem/index';

// constants
import {
  HYPERDRIVE_HASH_REGEX,
} from '../../lib/const';
import { InvalidURLError, TimeoutError } from 'beaker-error-constants';

// globals
var driveLoadPromises = {}; // key -> promise
var drivesEvents = new EventEmitter();

// exported API
export const on = drivesEvents.on.bind(drivesEvents);
export const addListener = drivesEvents.addListener.bind(drivesEvents);
export const removeListener = drivesEvents.removeListener.bind(drivesEvents);

export async function setup() {
  await daemon.setup();
  logger.info('Initialized hyper stack');
}

/**
 * Ensure the given drive keys are being announced on the swarm.
 * @param {string[]} keys
 */
export async function ensureHosting(keys) {
  for (const key of keys) {
    const sess = daemon.getHyperdriveSession({ key });
    if (!sess) {
      try {
        await getOrLoadDrive(key);
        logger.silly(`Joined swarm for drive ${key}`);
      } catch (e) {
        logger.debug(`Failed to join swarm for drive ${key}`, { error: e });
      }
    }
  }
}

export function createEventStream() {
  return emitStream.toStream(drivesEvents);
}

export function getDebugLog(key) {
  return '';
}

/**
 * Read drive metadata and persist it to the archives DB.
 */
export async function pullLatestDriveMeta(drive, { updateMTime, updateAssets } = {}) {
  try {
    const key = b4a.toString(drive.key, 'hex');
    const version = drive.drive.version;
    if (version === drive.lastMetaPullVersion) return;
    const lastMetaPullVersion = drive.lastMetaPullVersion;
    drive.lastMetaPullVersion = version;

    if (lastMetaPullVersion) {
      if (updateAssets) {
        const hasAssetUpdates = await driveAssets.hasUpdates(drive, lastMetaPullVersion);
        if (hasAssetUpdates) await driveAssets.update(drive);
      } else {
        driveAssets.hasUpdates(drive, lastMetaPullVersion).then((hasAssetUpdates) => {
          if (hasAssetUpdates) driveAssets.update(drive);
        });
      }
    } else {
      await driveAssets.update(drive);
    }

    const [meta, oldMeta] = await Promise.all([
      _readIndexJson(drive).catch(() => ({})),
      archivesDb.getMeta(key),
    ]);
    const { title, description, type, author, forkOf } = meta || {};
    const writable = drive.writable;
    const mtime = Date.now();
    const details = { title, description, type, forkOf, mtime, size: 0, author, writable };

    if (!hasMetaChanged(details, oldMeta)) return;

    await archivesDb.setMeta(key, details);
    details.url = 'hyper://' + key + '/';
    drivesEvents.emit('updated', { key, details, oldMeta });
    logger.info('Updated drive metadata', { key, details });
    return details;
  } catch (e) {
    console.error('Error pulling drive meta', e);
  }
}

// drive creation
// =

export async function createNewRootDrive() {
  const drive = await loadDrive(null, { visibility: 'private' });
  await pullLatestDriveMeta(drive);
  return drive;
}

/**
 * @param {Object} [meta]
 * @returns {Promise<DriveSession>}
 */
export async function createNewDrive(meta = {}) {
  const drive = await loadDrive(null);
  // Write index.json if any metadata was supplied
  if (meta && Object.keys(meta).length > 0) {
    await drive.drive.put('/index.json', b4a.from(JSON.stringify(meta, null, 2)));
  }
  await pullLatestDriveMeta(drive);
  return drive;
}

/**
 * @param {string} srcDriveUrl
 * @param {Object} [opts]
 * @returns {Promise<DriveSession>}
 */
export async function forkDrive(srcDriveUrl, opts = {}) {
  srcDriveUrl = fromKeyToURL(srcDriveUrl);

  let srcDrive;
  const downloadRes = await Promise.race([
    (async () => {
      srcDrive = await getOrLoadDrive(srcDriveUrl);
      if (!srcDrive) throw new Error('Invalid drive key');
    })(),
    new Promise((r) => setTimeout(() => r('timeout'), 60e3)),
  ]);
  if (downloadRes === 'timeout') throw new TimeoutError('Timed out while downloading source drive');

  const srcMeta = await _readIndexJson(srcDrive).catch(() => ({}));
  const dstMeta = {
    title: opts.title || srcMeta.title,
    description: opts.description || srcMeta.description,
    forkOf: opts.detached ? undefined : fromKeyToURL(srcDriveUrl),
  };
  for (const k in srcMeta) {
    if (k === 'author') continue;
    if (!dstMeta[k]) dstMeta[k] = srcMeta[k];
  }

  const dstDrive = await createNewDrive(dstMeta);

  // Copy all files from src to dst
  const ignore = new Set(['/.dat', '/.git', '/index.json']);
  for await (const entry of srcDrive.drive.list('/')) {
    if (ignore.has(entry.key)) continue;
    const buf = await srcDrive.drive.get(entry.key);
    if (buf) {
      await dstDrive.drive.put(entry.key, buf, { metadata: entry.value?.metadata });
    }
  }

  return dstDrive;
}

// drive management
// =

export async function loadDrive(key, opts) {
  if (key) {
    if (!Buffer.isBuffer(key)) {
      key = await fromURLToKey(key, true);
      if (!HYPERDRIVE_HASH_REGEX.test(key)) throw new InvalidURLError();
      key = b4a.from(key, 'hex');
    }
  }

  const keyStr = key ? b4a.toString(key, 'hex') : null;
  if (keyStr && keyStr in driveLoadPromises) return driveLoadPromises[keyStr];

  const p = _loadDriveInner(key, opts);
  if (key) driveLoadPromises[keyStr] = p;
  p.catch((err) => console.error('Failed to load drive', keyStr, err.toString()));

  if (key) {
    const clear = () => delete driveLoadPromises[keyStr];
    p.then(clear, clear);
  }

  return p;
}

async function _loadDriveInner(key, opts) {
  try {
    const domain = await hyperDns.reverseResolve(key);
    const drive = await daemon.createHyperdriveSession({ key, domain });
    drive.pullLatestDriveMeta = (o) => pullLatestDriveMeta(drive, o);
    key = drive.key;

    if (opts?.persistSession) drive.persistSession = true;

    archivesDb.touch(drive.key).catch((err) =>
      console.error('Failed to update lastAccessTime', drive.key, err)
    );

    if (!drive.writable) {
      // Trigger a get of index.json to warm up sparse replication — 5s timeout so we don't hang on unreachable drives
      await Promise.race([
        drive.drive.get('/index.json').catch(() => {}),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    }
    await drive.pullLatestDriveMeta();
    driveAssets.update(drive);
    return drive;
  } catch (e) {
    if (
      e.toString().includes('daemon has shut down') ||
      e.toString().includes('RPC stream destroyed')
    ) {
      // suppress, app is shutting down
    } else {
      throw e;
    }
  }
}

export function getDrive(key) {
  key = fromURLToKey(key);
  return daemon.getHyperdriveSession({ key });
}

export async function getDriveCheckout(drive, version) {
  let isHistoric = false;
  let checkoutFS = drive;
  if (typeof version !== 'undefined' && version !== null) {
    const seq = parseInt(version);
    if (Number.isNaN(seq)) {
      if (version !== 'latest') throw new Error('Invalid version identifier: ' + version);
    } else {
      const latestVersion = drive.drive.version;
      if (seq <= latestVersion) {
        checkoutFS = await daemon.createHyperdriveSession({
          key: drive.key,
          version: seq,
          domain: drive.domain,
        });
        isHistoric = true;
      }
    }
  }
  return { isHistoric, checkoutFS };
}

export async function getOrLoadDrive(key, opts) {
  key = await fromURLToKey(key, true);
  const drive = getDrive(key);
  if (drive) return drive;
  return loadDrive(key, opts);
}

export async function unloadDrive(key) {
  key = fromURLToKey(key, false);
  daemon.closeHyperdriveSession({ key });
}

export function isDriveLoaded(key) {
  key = fromURLToKey(key);
  return !!daemon.getHyperdriveSession({ key });
}

// drive fetch/query
// =

export async function getDriveInfo(key, { ignoreCache, onlyCache } = {}) {
  var meta;
  try {
    key = await fromURLToKey(key, true);
    var drive;
    if (!onlyCache) {
      drive = getDrive(key);
      if (!drive && ignoreCache) drive = await loadDrive(key);
    }

    const domain = drive ? drive.domain : await hyperDns.reverseResolve(key);
    const url = `hyper://${domain || key}/`;

    var indexMeta, driveInfo;
    if (drive) {
      await drive.pullLatestDriveMeta();
      [meta, indexMeta, driveInfo] = await Promise.all([
        archivesDb.getMeta(key),
        _readIndexJson(drive).catch(() => ({})),
        drive.getInfo(),
      ]);
    } else {
      meta = await archivesDb.getMeta(key);
      driveInfo = { version: undefined };
      indexMeta = {};
    }

    if (filesystem.isRootUrl(url) && !meta.title) meta.title = 'My Private Drive';
    meta.key = key;
    meta.discoveryKey = drive ? drive.discoveryKey : undefined;
    meta.url = url;
    meta.links = indexMeta?.links || {};
    meta.manifest = indexMeta || {};
    meta.version = driveInfo.version;
    meta.peers = daemon.listPeerAddresses(key)?.length || 0;
  } catch (e) {
    meta = { key, url: `hyper://${key}/`, writable: false, version: 0, title: '', description: '' };
  }
  meta.title = meta.title || '';
  meta.description = meta.description || '';
  return meta;
}

export async function clearFileCache(key) {
  return {};
}

export async function getPrimaryUrl(url) {
  const key = await fromURLToKey(url, true);
  const datDnsRecord = await hyperDnsDb.getCurrentByKey(key);
  if (!datDnsRecord) return `hyper://${key}/`;
  return `hyper://${datDnsRecord.name}/`;
}

export async function confirmDomain(key) {
  // DISABLED — hyper: does not currently use DNS
}

// helpers
// =

export function fromURLToKey(url, lookupDns = false) {
  if (Buffer.isBuffer(url)) return url;
  if (HYPERDRIVE_HASH_REGEX.test(url)) return url;

  const urlp = parseDriveUrl(url);
  if (urlp.protocol !== 'hyper:' && urlp.protocol !== 'dat:') {
    throw new InvalidURLError('URL must be a hyper: or dat: scheme');
  }
  if (!HYPERDRIVE_HASH_REGEX.test(urlp.host)) {
    if (!lookupDns) throw new InvalidURLError('Hostname is not a valid hash');
    return hyperDns.resolveName(urlp.host);
  }
  return urlp.host;
}

export function fromKeyToURL(key) {
  if (typeof key !== 'string') key = b4a.toString(key, 'hex');
  if (!key.startsWith('hyper://')) return `hyper://${key}/`;
  return key;
}

// internal helpers
// =

/**
 * Read /index.json from a drive session (replaces readManifest).
 */
async function _readIndexJson(drive) {
  const buf = await drive.drive.get('/index.json');
  if (!buf) return {};
  return JSON.parse(b4a.toString(buf));
}

function hasMetaChanged(m1, m2) {
  for (const k of ['title', 'description', 'forkOf', 'size', 'author', 'writable', 'mtime']) {
    if (!m1[k]) m1[k] = undefined;
    if (!m2[k]) m2[k] = undefined;
    if (k === 'forkOf') {
      if (!_urlsEq(m1[k], m2[k])) return true;
    } else {
      if (m1[k] !== m2[k]) return true;
    }
  }
  return false;
}

const _urlsEqRe = /([0-9a-f]{64})/i;
function _urlsEq(a, b) {
  if (!a && !b) return true;
  if (typeof a !== typeof b) return false;
  const ma = _urlsEqRe.exec(a);
  const mb = _urlsEqRe.exec(b);
  return ma && mb && ma[1] === mb[1];
}
