// @ts-nocheck
import { app } from 'electron';
import path from 'path';
import { randomBytes } from 'crypto';
import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import Hyperdrive from 'hyperdrive';
import b4a from 'b4a';
import EventEmitter from 'events';
import * as logLib from '../logger';

const baseLogger = logLib.get();
const logger = baseLogger.child({ category: 'hyper', subcategory: 'daemon' });

const GARBAGE_COLLECT_INTERVAL = 30e3;
const MAX_SESSION_AGE = 300e3; // 5 min

// globals
var store; // Corestore instance
var swarm; // Hyperswarm instance
var sessions = {}; // sessionKey -> DriveSession
var discoveries = {}; // discoveryKeyHex -> Hyperswarm Discovery
var events = new EventEmitter();

export const on = events.on.bind(events);

export function isActive() {
  return !!store;
}

export function requiresShutdown() {
  return !!store;
}

export function getCorestore() {
  return store;
}

export function getSwarm() {
  return swarm;
}

export async function getDaemonStatus() {
  if (!swarm) return { active: false };
  const conns = swarm.connections ? [...swarm.connections] : [];
  return {
    active: true,
    connections: conns.length,
    relayed: conns.some((c) => c.relayedThrough),
  };
}

export async function setup() {
  const storagePath = path.join(app.getPath('userData'), 'corestore');
  logger.info('Initializing Corestore', { path: storagePath });

  store = new Corestore(storagePath);
  await store.ready();

  swarm = new Hyperswarm();
  swarm.on('connection', (conn) => {
    logger.debug('Swarm connection', { remoteAddress: conn.rawStream?.remoteHost });
    store.replicate(conn);
  });

  const gc = setInterval(_garbageCollect, GARBAGE_COLLECT_INTERVAL);
  gc.unref();

  logger.info('Hyper stack ready');
  events.emit('ready');
}

export async function shutdown() {
  if (swarm) { await swarm.destroy(); swarm = null; }
  if (store) {
    try { await store.close(); } catch (e) {
      if (e.code !== 'REQUEST_CANCELLED') throw e;
    }
    store = null;
  }
}

/**
 * @param {Object|string} opts
 * @returns {DriveSession|undefined}
 */
export function getHyperdriveSession(opts) {
  return sessions[_sessionKey(opts)];
}

/**
 * Open or create a Hyperdrive v11 session.
 *
 * @param {Object} opts
 * @param {Buffer|string} [opts.key]      - hex key or Buffer; omit to create new
 * @param {number}        [opts.version]  - if set, returns a read-only checkout
 * @param {boolean}       [opts.writable] - unused (writable is derived from key ownership)
 * @param {string}        [opts.domain]   - DNS alias for the URL
 * @returns {Promise<DriveSession>}
 */
export async function createHyperdriveSession(opts) {
  const sessKey = _sessionKey(opts);
  if (sessions[sessKey]) {
    sessions[sessKey]._lastUsed = Date.now();
    return sessions[sessKey];
  }

  const keyBuf = opts.key
    ? (Buffer.isBuffer(opts.key) ? opts.key : b4a.from(opts.key, 'hex'))
    : undefined;

  if (opts.version) {
    // Versioned checkout — ensure base session exists first
    const baseOpts = { key: keyBuf, domain: opts.domain };
    const baseKey = _sessionKey(baseOpts);
    if (!sessions[baseKey]) {
      await createHyperdriveSession(baseOpts);
    }
    const base = sessions[baseKey];
    const checkout = base.drive.checkout(opts.version);
    const sess = _makeSession(sessKey, base.key, base.discoveryKey, checkout, opts.domain, false);
    sess._isCheckout = true;
    sessions[sessKey] = sess;
    logger.debug(`Opened drive checkout ${sessKey}`);
    return sess;
  }

  // Base session
  // Each new drive needs a unique Corestore namespace so their internal 'db' Hyperbees
  // don't share the same exclusive write lock (which would deadlock on the second drive).
  const driveStore = keyBuf ? store : store.namespace(randomBytes(32));
  const drive = keyBuf ? new Hyperdrive(store, keyBuf) : new Hyperdrive(driveStore);
  await drive.ready();

  const keyStr = b4a.toString(drive.key, 'hex');
  const discKeyStr = b4a.toString(drive.discoveryKey, 'hex');

  // Join swarm for this drive (idempotent per discovery key)
  if (!discoveries[discKeyStr]) {
    discoveries[discKeyStr] = swarm.join(drive.discoveryKey);
    logger.debug(`Joined swarm for drive ${keyStr}`);
  }

  const sess = _makeSession(keyStr, drive.key, drive.discoveryKey, drive, opts.domain, drive.writable);
  sessions[keyStr] = sess;
  logger.debug(`Opened drive session ${keyStr}`);
  return sess;
}

/**
 * Close a drive session. Safe to call if the session doesn't exist.
 * @param {Object|string} opts
 */
export function closeHyperdriveSession(opts) {
  const key = _sessionKey(opts);
  if (!sessions[key]) return;
  logger.debug(`Closing drive session ${key}`);
  sessions[key]._close();
  delete sessions[key];
}

/**
 * Configure swarm announce/lookup for a drive.
 * @param {Buffer|string} discoveryKey
 * @param {{ announce: boolean, lookup: boolean }} opts
 */
export async function configureNetwork(discoveryKey, { announce, lookup }) {
  const keyBuf = Buffer.isBuffer(discoveryKey) ? discoveryKey : b4a.from(discoveryKey, 'hex');
  const discKeyStr = b4a.toString(keyBuf, 'hex');

  if (discoveries[discKeyStr]) {
    await discoveries[discKeyStr].destroy();
    delete discoveries[discKeyStr];
  }

  if (announce || lookup) {
    discoveries[discKeyStr] = swarm.join(keyBuf, { server: announce, client: lookup });
  }
}

/**
 * @param {Buffer|string} key
 * @returns {Array<{remoteAddress: string, type: string}>|undefined}
 */
export function listPeerAddresses(key) {
  if (!swarm) return undefined;
  return [...swarm.connections].map((c) => ({
    remoteAddress: c.rawStream?.remoteHost || 'unknown',
    type: c.relayedThrough ? 'relay' : 'direct',
  }));
}

// internal
// =

function _makeSession(sessKey, key, discoveryKey, drive, domain, writable) {
  const keyStr = b4a.toString(key, 'hex');
  const url = `hyper://${domain || keyStr}/`;
  return {
    key,
    discoveryKey,
    url,
    writable,
    domain,
    persistSession: false,
    drive,
    _lastUsed: Date.now(),
    _isCheckout: false,

    async getInfo() {
      this._lastUsed = Date.now();
      return { version: drive.version };
    },

    _close() {
      // Checkouts share the base drive's discovery; only the base session owns it
      if (!this._isCheckout) {
        const discKeyStr = b4a.toString(this.discoveryKey, 'hex');
        if (discoveries[discKeyStr]) {
          discoveries[discKeyStr].destroy().catch(() => {});
          delete discoveries[discKeyStr];
        }
      }
      drive.close().catch(() => {});
    },
  };
}

function _sessionKey(opts) {
  if (typeof opts === 'string') return opts;
  const key = Buffer.isBuffer(opts.key)
    ? b4a.toString(opts.key, 'hex')
    : (opts.key || '');
  let k = key;
  if (opts.version) k += `+${opts.version}`;
  return k;
}

function _garbageCollect() {
  const now = Date.now();
  let closed = 0;
  for (const key in sessions) {
    const sess = sessions[key];
    if (sess.persistSession) continue;
    if (now - sess._lastUsed < MAX_SESSION_AGE) continue;
    closeHyperdriveSession(key);
    closed++;
  }
  if (closed > 0) logger.debug(`GC closed ${closed} idle session(s)`);
}
