import * as base32 from 'base32.js';
import * as crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { PermissionsError } from 'beaker-error-constants';
import { parseDriveUrl } from '../../lib/urls';
import { TOKEN_BYTES, capToken, keptPicked, MAX_PICKED_PER_ORIGIN } from './capability-rules.mjs';

// Capability URLs (nomad.capabilities): `hyper://<token>.cap/…` stands in for a drive, or for one
// file or folder in it, without naming the drive's key. The rules are capability-rules.mjs.
//
// Two kinds:
// - A page's own (`nomad.capabilities.create`): a whole drive, in memory, gone on restart.
// - Picked: the user chose a file or folder in the picker (`selectFileDialog({ capability: true })`).
//   It covers only that item, can reach the user's private drive, and is kept on this computer:
//
//   <userData>/capabilities.json   { version: 1, caps: [{ token, owningOrigin, target, title, … }] }
//
// Only the site that owns one can modify or delete it; the user removes picked ones in site-info.

// typedefs
// =

/**
 * @typedef {Object} CapabilityMapping
 * @prop {String} owningOrigin
 * @prop {String} token
 * @prop {Object} target
 * @prop {String} target.key
 * @prop {String} target.version
 * @prop {String} target.path - '/' for the whole drive, '/dir/' for a folder, '/file' for a file
 * @prop {Boolean} [picked] - chosen by the user in the file picker
 * @prop {String} [title] - the picked item's name
 * @prop {String} [driveTitle]
 * @prop {Number} [createdAt]
 */

// globals
// =

const FILE = 'capabilities.json';

// Emits 'changed' when a picked capability is added or removed.
export const events = new EventEmitter();

/** @type CapabilityMapping[] */
var capabilities = [];
var loaded = false;
var writes = Promise.resolve();

function filePath() {
  return path.join(app.getPath('userData'), FILE);
}

// The picked ones come back from disk the first time anything looks a capability up.
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    const known = new Set(capabilities.map((c) => c.token));
    for (const c of keptPicked(data?.caps)) if (!known.has(c.token)) capabilities.push(c);
  } catch {
    /* no file yet, or unreadable: start with none */
  }
}

function savePicked() {
  events.emit('changed');
  const caps = capabilities.filter((c) => c.picked);
  const text = JSON.stringify({ version: 1, caps }, null, 2);
  writes = writes
    .catch(() => {})
    .then(() => fs.promises.writeFile(filePath(), text, { mode: 0o600 }));
  return writes;
}

// exported api
// =

/**
 * @param {string} capUrl
 * @returns {CapabilityMapping}
 */
export function lookupCap(capUrl) {
  load();
  var token = extractToken(capUrl);
  if (!token) throw new Error('Invalid capability URL');
  return capabilities.find((c) => c.token === token);
}

/**
 * @param {String} origin
 * @param {String} target
 * @returns {String}
 */
export function createCap(origin, target) {
  load();
  var token = generateToken();
  capabilities.push({
    owningOrigin: origin,
    token,
    target: parseTarget(target),
    createdAt: Date.now(),
  });
  return `hyper://${token}.cap/`;
}

/**
 * A capability for one file or folder the user picked. One per site and item: picking the same
 * item again gives the same capability back.
 * @param {String} origin
 * @param {{ key: String, path: String }} target - the drive's hex key and the item's scope
 * @param {{ title?: String, driveTitle?: String }} [meta]
 * @returns {Promise<CapabilityMapping>}
 */
export async function createPickedCap(origin, target, meta = {}) {
  load();
  const key = String(target.key).toLowerCase();
  const same = capabilities.find(
    (c) =>
      c.picked && c.owningOrigin === origin && c.target.key === key && c.target.path === target.path
  );
  if (same) return same;
  const cap = {
    owningOrigin: origin,
    token: generateToken(),
    target: { key, version: null, path: target.path },
    picked: true,
    title: meta.title || '',
    driveTitle: meta.driveTitle || '',
    createdAt: Date.now(),
  };
  capabilities.push(cap);
  // Keep the newest MAX_PICKED_PER_ORIGIN for this site.
  const mine = capabilities.filter((c) => c.picked && c.owningOrigin === origin);
  if (mine.length > MAX_PICKED_PER_ORIGIN) {
    const drop = new Set(
      mine
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, mine.length - MAX_PICKED_PER_ORIGIN)
        .map((c) => c.token)
    );
    capabilities = capabilities.filter((c) => !drop.has(c.token));
  }
  await savePicked();
  return cap;
}

/**
 * A site's capabilities.
 * @param {String} origin
 * @returns {CapabilityMapping[]}
 */
export function listCaps(origin) {
  load();
  return capabilities.filter((c) => c.owningOrigin === origin);
}

/**
 * @param {String} origin
 * @param {String} capUrl
 * @param {String} target
 * @returns {Void}
 */
export function modifyCap(origin, capUrl, target) {
  load();
  var token = extractToken(capUrl);
  if (!token) throw new Error('Invalid capability URL');
  var cap = capabilities.find((c) => c.token === token);
  if (!cap) throw new Error('Capability does not exist');

  if (cap.owningOrigin !== origin) {
    throw new PermissionsError('Cannot modify unowned capability');
  }
  if (cap.picked) {
    // The user chose what it covers; the site can't point it somewhere else.
    throw new PermissionsError('Cannot modify a capability the user picked');
  }

  cap.target = parseTarget(target);
}

/**
 * @param {String} origin - the owning site, or null for the user (site-info)
 * @param {String} capUrl
 * @returns {Promise<Void>}
 */
export async function deleteCap(origin, capUrl) {
  load();
  var token = extractToken(capUrl);
  if (!token) throw new Error('Invalid capability URL');
  var capIndex = capabilities.findIndex((c) => c.token === token);
  if (capIndex === -1) throw new Error('Capability does not exist');

  if (origin !== null && capabilities[capIndex].owningOrigin !== origin) {
    throw new PermissionsError('Cannot modify unowned capability');
  }

  const [cap] = capabilities.splice(capIndex, 1);
  if (cap.picked) await savePicked();
}

// internal methods
// =

function generateToken() {
  var buf = crypto.randomBytes(TOKEN_BYTES);
  var encoder = new base32.Encoder({ type: 'rfc4648', lc: true });
  return encoder.write(buf).finalize();
}

function extractToken(capUrl) {
  return capToken(capUrl);
}

function parseTarget(target) {
  try {
    var urlp = parseDriveUrl(target);
    if (urlp.protocol !== 'hyper:') throw new Error();
    return { key: urlp.hostname, version: urlp.version, path: '/' };
  } catch (e) {
    throw new Error('Invalid target hyper:// URL');
  }
}
