import { BrowserWindow } from 'electron';
import { join as joinPath } from 'path';
import b4a from 'b4a';
import * as logLib from '../logger';
import hyper from '../hyper/index';
import * as db from '../dbs/profile-data-db';
import * as archivesDb from '../dbs/archives';
import * as spacesDb from '../dbs/spaces';
import * as trash from './trash';
import * as modals from '../ui/subwindows/modals';
import lock from '../../lib/lock';
import { isSameOrigin } from '../../lib/urls';
import { HYPERDRIVE_HASH_REGEX } from '../../lib/const';
import * as autobases from '../hyper/autobases';
import * as vault from '../hyper/vault';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'filesystem' });

// typedefs
// =

/**
 * @typedef {import('../dbs/archives').LibraryArchiveMeta} LibraryArchiveMeta
 *
 * @typedef {Object} DriveConfig
 * @property {string} key
 * @property {string[]} tags
 * @property {Object} [forkOf]
 * @property {string} [forkOf.key]
 * @property {string} [forkOf.label]
 *
 * @typedef {Object} DriveIdent
 * @property {boolean} internal
 * @property {boolean} system
 */

// globals
var browsingProfile;
var rootDrive;
var drives = [];
var spaceRootDrives = {}; // {[spaceId]: DriveSession}
var webContentsSpaceMap = new Map(); // {[webContentsId]: spaceId}

// exported api
// =

export function get() {
  return rootDrive;
}

export function isRootUrl(url) {
  return isSameOrigin(url, browsingProfile.url) || isSameOrigin(url, 'hyper://private/');
}

export async function setup() {
  trash.setup();

  var isInitialCreation = false;
  browsingProfile = await db.get(`SELECT * FROM profiles WHERE id = 0`);
  if (
    !browsingProfile.url ||
    (typeof browsingProfile.url === 'string' && browsingProfile.url.startsWith('dat:'))
  ) {
    const drive = await _createRootDrive();
    logger.info('Root drive created', { url: drive.url });
    await db.run(`UPDATE profiles SET url = ? WHERE id = 0`, [drive.url]);
    browsingProfile.url = drive.url;
    isInitialCreation = true;
  }
  if (!browsingProfile.url.endsWith('/')) browsingProfile.url += '/';

  logger.info('Loading root drive', { url: browsingProfile.url });
  rootDrive = await _loadRootDrive(browsingProfile.url);

  // Recreate the root drive when the stored one can't serve as our writable Autobase:
  //  - not writable (keypair not in this Corestore), OR
  //  - writable but its linearised view is empty (ADR-0010): a profile created BEFORE the
  //    Autobase re-home stored a Hyperdrive URL; opening that key as an Autobase yields a
  //    writable-but-empty base, and writing to it hangs. An owned Autobase root always has local
  //    content, so writable+empty means stale/incompatible — mint a fresh one instead of hanging.
  const rootUnusable =
    !rootDrive.writable || (!isInitialCreation && autobases.viewEmpty(rootDrive));
  if (rootUnusable) {
    logger.info(
      'Root drive not a usable Autobase (missing keypair or empty view) — creating a fresh one',
      {
        writable: rootDrive.writable,
      }
    );
    const newDrive = await _createRootDrive();
    await db.run(`UPDATE profiles SET url = ? WHERE id = 0`, [newDrive.url]);
    browsingProfile.url = newDrive.url;
    if (!browsingProfile.url.endsWith('/')) browsingProfile.url += '/';
    rootDrive = newDrive;
    isInitialCreation = true;
  }

  hyper.dns.setLocal('private', browsingProfile.url);

  if (isInitialCreation) {
    await _driveWriteFile(rootDrive, `/bookmarks/nomad-dev-docs-templates.goto`, '', {
      href: 'https://nomad.pages.dev/docs/templates/',
      title: 'Drive Templates',
    });
    await _driveWriteFile(rootDrive, `/bookmarks/twitter.goto`, '', {
      href: 'https://twitter.com/',
      title: 'Twitter',
    });
    await _driveWriteFile(rootDrive, `/bookmarks/reddit.goto`, '', {
      href: 'https://reddit.com/',
      title: 'Reddit',
    });
    await _driveWriteFile(rootDrive, `/bookmarks/youtube.goto`, '', {
      href: 'https://youtube.com/',
      title: 'YouTube',
    });
    await _driveWriteFile(
      rootDrive,
      `/nomad/pins.json`,
      JSON.stringify(
        [
          'https://nomad.pages.dev/docs/templates/',
          'https://twitter.com/',
          'https://reddit.com/',
          'https://youtube.com/',
        ],
        null,
        2
      )
    );
  }

  let hostKeys = [];
  try {
    const drivesBuf = await _get(rootDrive, '/drives.json');
    if (drivesBuf) {
      drives = JSON.parse(b4a.toString(drivesBuf)).drives;
      hostKeys = hostKeys.concat(drives.filter((d) => d.type !== 'autobase').map((d) => d.key));
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) {
      logger.info('Error while reading /drives.json', { error: e.toString() });
    }
  }
  hyper.drives.ensureHosting(hostKeys);
  await migrateAddressBook();

  await spacesDb.backfillDefaultSpaceDrive(browsingProfile.url);
  spaceRootDrives[1] = rootDrive;

  // Pre-load all other spaces' root drives so hyper://private/ resolves to the
  // correct drive for each space before any restored tabs fire their first request.
  // Without this, restored tabs from space N see getSpaceRootDriveUrl(N) === null
  // and fall back to DNS (space 1's drive), silently writing files to the wrong place.
  const allSpaces = await spacesDb.list();
  await Promise.all(
    allSpaces
      .filter((s) => s.id !== 1 && s.root_drive_url)
      .map((s) =>
        getOrSetupSpaceDrive(s).catch((e) =>
          logger.warn('Pre-load space drive failed', { spaceId: s.id, error: e.toString() })
        )
      )
  );

  // Load this Device's Vault at startup so it JOINS the Vault's swarm topic. The Vault is the parent
  // that ties Spaces + Devices together, and being on its topic is what keeps multi-device features
  // live: Space Root Drive replication, Draft sync (ADR-0012), device management, and the AI Bridge
  // reaching this Device's other Devices. Without this the Vault loaded only lazily (when Settings →
  // Devices opened), so the Device sat off the topic and unreachable by its own phone until then.
  // Background + guarded: getVault() is a no-op (null) when this Device has no Vault yet.
  vault
    .getVault()
    .then((sess) => {
      if (sess) {
        logger.info('Loaded Vault at startup (joined swarm topic)');
        vault.registerOwnDevice({ platform: 'desktop' }).catch(() => {});
      }
    })
    .catch((e) => logger.warn('Vault startup load failed', { error: e.toString() }));
}

export function getDriveIdent(url) {
  const system = isRootUrl(url);
  return { system, internal: system, profile: false, feed: false };
}

export async function getDriveIdentFull(url) {
  const ident = getDriveIdent(url);
  if (ident.system) return ident;
  try {
    // getOrLoadDrive hangs for autobase keys — detect and skip them first
    const hostname = new URL(url).hostname;
    if (HYPERDRIVE_HASH_REGEX.test(hostname)) {
      if (
        getDriveConfig(hostname)?.type === 'autobase' ||
        autobases.getCollaborativeDrive(hostname)
      ) {
        // Autobase drive: getOrLoadDrive would hang, so read the manifest from the
        // already-loaded collaborative session (if present) to recognize feeds.
        try {
          const sess = autobases.getCollaborativeDrive(hostname);
          if (sess) {
            const manifest = await autobases.readJson(sess, '/index.json');
            if (manifest) {
              ident.feed = manifest.type === 'walled.garden/feed';
            }
          }
        } catch {}
        return ident;
      }
    }
    const drive = await hyper.drives.getOrLoadDrive(url);
    const buf = await drive.drive.get('/index.json');
    if (buf) {
      const manifest = JSON.parse(buf.toString());
      ident.profile = manifest.type === 'walled.garden/person';
      ident.feed = manifest.type === 'walled.garden/feed';
    }
  } catch {}
  return ident;
}

export function setPrivateAlias(url) {
  if (!url) return;
  if (!url.endsWith('/')) url += '/';
  hyper.dns.setLocal('private', url);
}

export async function getOrSetupSpaceDrive(space) {
  if (spaceRootDrives[space.id]) return spaceRootDrives[space.id];

  if (space.root_drive_url) {
    let url = space.root_drive_url;
    if (!url.endsWith('/')) url += '/';
    const drive = await _loadRootDrive(url);
    spaceRootDrives[space.id] = drive;
    return drive;
  }

  const drive = await _createRootDrive();
  logger.info('Created root drive for space', { spaceId: space.id, url: drive.url });
  await spacesDb.update(space.id, { rootDriveUrl: drive.url });
  spaceRootDrives[space.id] = drive;
  return drive;
}

// Drop a space's cached Root Drive session so the next getOrSetupSpaceDrive reloads it from the
// (possibly changed) root_drive_url. Used after the Vault migration converts a Root Drive to an
// Autobase, which gives it a new key/url.
export function resetSpaceRootDrive(spaceId) {
  delete spaceRootDrives[spaceId];
}

export function getSpaceRootDrive(spaceId) {
  return spaceRootDrives[spaceId];
}

export function getSpaceRootDriveUrl(spaceId) {
  return spaceRootDrives[spaceId]?.url || null;
}

export function registerWebContentsSpace(wcId, spaceId) {
  webContentsSpaceMap.set(wcId, spaceId);
}

export function unregisterWebContentsSpace(wcId) {
  webContentsSpaceMap.delete(wcId);
}

export function getSpaceIdForWebContents(wcId) {
  return webContentsSpaceMap.get(wcId);
}

var spaceDrivesMap = {};

export async function configDriveForSpace(url, opts = {}, spaceId = 1) {
  if (spaceId === 1) return configDrive(url, opts);
  const space = await spacesDb.get(spaceId);
  if (!space) return configDrive(url, opts);
  const spaceDrive = await getOrSetupSpaceDrive(space);
  if (!spaceDrive?.writable) {
    // Space drive is read-only — fall back to the global drives list.
    return configDrive(url, opts);
  }

  var release = await lock(`filesystem:drives:space-${spaceId}`);
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    if (!spaceDrivesMap[spaceId]) {
      try {
        const buf = await _get(spaceDrive, '/drives.json');
        spaceDrivesMap[spaceId] = buf ? JSON.parse(b4a.toString(buf)).drives || [] : [];
      } catch (e) {
        spaceDrivesMap[spaceId] = [];
      }
    }
    const spaceDrives = spaceDrivesMap[spaceId];
    if (!spaceDrives.find((d) => d.key === key)) {
      const driveCfg = { key };
      if (opts.tags) driveCfg.tags = opts.tags;
      if (opts.forkOf) driveCfg.forkOf = opts.forkOf;
      spaceDrives.push(driveCfg);
    }
    await _put(
      spaceDrive,
      '/drives.json',
      b4a.from(JSON.stringify({ drives: spaceDrives }, null, 2))
    );
  } finally {
    release();
  }
}

export function listDrives({ includeSystem } = { includeSystem: false }) {
  var d = drives.slice();
  if (includeSystem) d.unshift({ key: 'private' });
  return d;
}

export async function listDrivesForSpace(spaceId, { includeSystem } = {}) {
  if (!spaceId || spaceId === 1) return listDrives({ includeSystem });

  // null sentinel = non-writable space drive; fall back to global list without re-checking
  if (spaceDrivesMap[spaceId] === null) return listDrives({ includeSystem });

  if (!spaceDrivesMap[spaceId]) {
    const space = await spacesDb.get(spaceId);
    if (space) {
      const spaceDrive = await getOrSetupSpaceDrive(space);
      if (!spaceDrive?.writable) {
        // Non-writable space drive — can't reliably fetch /drives.json without waiting for peers.
        spaceDrivesMap[spaceId] = null; // sentinel: skip future checks
        return listDrives({ includeSystem });
      }
      try {
        const buf = await _get(spaceDrive, '/drives.json');
        spaceDrivesMap[spaceId] = buf ? JSON.parse(b4a.toString(buf)).drives || [] : [];
      } catch (e) {
        spaceDrivesMap[spaceId] = [];
      }
    } else {
      return listDrives({ includeSystem });
    }
  }

  var d = spaceDrivesMap[spaceId].slice();
  if (includeSystem) d.unshift({ key: 'private' });
  return d;
}

export async function listDriveMetas() {
  return Promise.all(drives.map((d) => archivesDb.getMeta(d.key)));
}

export function getDriveConfig(key) {
  return listDrives().find((d) => d.key === key);
}

export async function configDrive(url, { forkOf, tags } = {}) {
  var release = await lock('filesystem:drives');
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    var driveCfg = drives.find((d) => d.key === key);
    if (!driveCfg) {
      let drive = await hyper.drives.getOrLoadDrive(url);
      let indexMeta = {};
      try {
        const buf = await drive.drive.get('/index.json');
        if (buf) indexMeta = JSON.parse(b4a.toString(buf));
      } catch {}

      driveCfg = { key };
      if (tags && Array.isArray(tags) && tags.every((t) => typeof t === 'string')) {
        driveCfg.tags = tags.filter(Boolean);
      }
      if (forkOf && typeof forkOf === 'object') driveCfg.forkOf = forkOf;

      if (indexMeta.forkOf && typeof indexMeta.forkOf === 'string') {
        if (!driveCfg.forkOf) driveCfg.forkOf = { key: undefined, label: undefined };
        driveCfg.forkOf.key = await hyper.drives.fromURLToKey(indexMeta.forkOf, true);
        if (!driveCfg.forkOf.label) {
          const promptRes = await modals
            .create(BrowserWindow.getFocusedWindow().webContents, 'prompt', {
              message: 'Choose a label to save this fork under (e.g. "dev" or "bobs-changes")',
            })
            .catch((e) => false);
          if (!promptRes || !promptRes.value) return;
          driveCfg.forkOf.label = promptRes.value;
        }
        if (!drives.find((d) => d.key === driveCfg.forkOf.key)) {
          drives.push({ key: driveCfg.forkOf.key });
        }
      }

      drives.push(driveCfg);
    } else {
      if (typeof tags !== 'undefined') {
        if (tags && Array.isArray(tags) && tags.every((t) => typeof t === 'string')) {
          driveCfg.tags = tags.filter(Boolean);
        } else {
          delete driveCfg.tags;
        }
      }
      if (typeof forkOf !== 'undefined') {
        if (forkOf && typeof forkOf === 'object') driveCfg.forkOf = forkOf;
        else delete driveCfg.forkOf;
      }
    }
    await _put(rootDrive, '/drives.json', b4a.from(JSON.stringify({ drives }, null, 2)));
  } finally {
    release();
  }
}

// Register a non-Hyperdrive (e.g. autobase) URL in the drives list without loading it.
// configDrive() tries to open a Hyperdrive to read /index.json, which hangs for autobase URLs
// because the underlying core isn't a Hyperdrive.
export async function configAutobaseDrive(url, { tags } = {}) {
  var release = await lock('filesystem:drives');
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    var driveCfg = drives.find((d) => d.key === key);
    if (!driveCfg) {
      driveCfg = { key, type: 'autobase' };
      if (tags && Array.isArray(tags)) driveCfg.tags = tags.filter(Boolean);
      drives.push(driveCfg);
    } else {
      driveCfg.type = 'autobase';
      if (tags && Array.isArray(tags)) driveCfg.tags = tags.filter(Boolean);
    }
    await _put(rootDrive, '/drives.json', b4a.from(JSON.stringify({ drives }, null, 2)));
  } finally {
    release();
  }
}

export async function removeDrive(url) {
  var release = await lock('filesystem:drives');
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    const driveIndex = drives.findIndex((d) => d.key === key);
    if (driveIndex === -1) return;
    // Skip Hyperdrive-specific cleanup for autobase drives — getOrLoadDrive()
    // would try to open the autobase core as a Hyperdrive and hang.
    const driveCfg = drives[driveIndex];
    if (driveCfg.type !== 'autobase') {
      const drive = await hyper.drives.getOrLoadDrive(url);
      if (!drive.writable) {
        await hyper.daemon.configureNetwork(drive.discoveryKey, { announce: false, lookup: true });
      }
    }
    await trash.add(key);
    drives.splice(driveIndex, 1);
    await _put(rootDrive, '/drives.json', b4a.from(JSON.stringify({ drives }, null, 2)));
  } finally {
    release();
  }
}

export async function removeDriveForSpace(url, spaceId = 1) {
  if (!spaceId || spaceId === 1) return removeDrive(url);
  const space = await spacesDb.get(spaceId);
  if (!space) return removeDrive(url);
  const spaceDrive = await getOrSetupSpaceDrive(space);

  var release = await lock(`filesystem:drives:space-${spaceId}`);
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    if (!spaceDrivesMap[spaceId]) spaceDrivesMap[spaceId] = [];
    const idx = spaceDrivesMap[spaceId].findIndex((d) => d.key === key);
    if (idx === -1) return;
    spaceDrivesMap[spaceId].splice(idx, 1);
    await _put(
      spaceDrive,
      '/drives.json',
      b4a.from(JSON.stringify({ drives: spaceDrivesMap[spaceId] }, null, 2))
    );
  } finally {
    release();
  }
}

export async function getAvailableName(
  containingPath,
  basename,
  ext = undefined,
  joiningChar = '-',
  drive = rootDrive
) {
  for (let i = 1; i < 1e9; i++) {
    const name = (i === 1 ? basename : `${basename}${joiningChar}${i}`) + (ext ? `.${ext}` : '');
    const entry = await _entry(drive, joinPath(containingPath, name));
    if (!entry) return name;
  }
  throw new Error('Unable to find an available name for ' + basename);
}

export async function ensureDir(path, drive = rootDrive) {
  // In Hyperdrive v11, directories are implicit — no mkdir needed.
  // Warn only if a file already exists at this exact path (unexpected).
  try {
    const entry = await _entry(drive, path);
    if (entry) {
      logger.error('Filesystem expects a folder but an unexpected file exists.', { path });
    }
  } catch (e) {
    logger.error('Filesystem ensureDir check failed', { path, error: e.toString() });
  }
}

export async function migrateAddressBook() {
  let addressBook;
  try {
    const buf = await _get(rootDrive, '/address-book.json');
    if (!buf) return;
    addressBook = JSON.parse(b4a.toString(buf));
  } catch (e) {
    return;
  }
  // Only touch the file if it's actually the old Beaker Browser address-book format.
  // A user-created file at this path that lacks both arrays must not be deleted.
  if (!Array.isArray(addressBook.profiles) && !Array.isArray(addressBook.contacts)) return;
  addressBook.profiles = Array.isArray(addressBook.profiles) ? addressBook.profiles : [];
  addressBook.contacts = Array.isArray(addressBook.contacts) ? addressBook.contacts : [];
  const profiles = addressBook.profiles.concat(addressBook.contacts);
  for (const profile of profiles) {
    const existing = drives.find((d) => d.key === profile.key);
    if (!existing) {
      drives.push({ key: profile.key, tags: ['contact'] });
    } else {
      const tags = existing.tags || [];
      if (!tags.includes('contact')) existing.tags = tags.concat(['contact']);
    }
  }
  await _put(rootDrive, '/drives.json', b4a.from(JSON.stringify({ drives }, null, 2)));
  await _del(rootDrive, '/address-book.json');
}

// internal helpers
// =
// The root + space drives are Autobase (ADR-0010 Phase 4). These small helpers dispatch on the
// session type so the module works whether a session is an Autobase (has `.base`) or a legacy
// Hyperdrive (`.drive` is a Hyperdrive). Autobase content goes through the shared fs-core helpers
// (inline value for these small control records / JSON bodies; see autobases.js).

async function _createRootDrive() {
  return autobases.createCollaborativeDrive({});
}

async function _loadRootDrive(url) {
  const key = await hyper.drives.fromURLToKey(url, true);
  return autobases.getOrLoadCollaborativeDrive(key);
}

async function _get(sess, path) {
  if (sess && sess.base) return autobases.readContent(sess, path); // Autobase → bytes | null
  const buf = await sess.drive.get(path);
  return buf || null;
}

async function _put(sess, path, content) {
  const buf = typeof content === 'string' ? b4a.from(content) : content;
  if (sess && sess.base) return autobases.putInline(sess, path, buf); // small control record → inline
  return sess.drive.put(path, buf);
}

async function _del(sess, path) {
  if (sess && sess.base) return autobases.deletePath(sess, path);
  return sess.drive.del(path);
}

// Existence check: Autobase view is a Hyperbee (`.get` → node|null); Hyperdrive uses `.entry`.
async function _entry(sess, path) {
  if (sess && sess.base) return sess.drive.get(path);
  return sess.drive.entry(path);
}

// Write a bookmark/control file. On Autobase the bookmark href/title live in the file BODY (JSON),
// not entry metadata (which is now filesystem stat). The serve path's .goto handler reads href from
// the body; see bg/protocols/hyper.js.
async function _driveWriteFile(drive, path, content, metadata = undefined) {
  const body = metadata
    ? JSON.stringify(metadata)
    : typeof content === 'string'
      ? content
      : content;
  await _put(drive, path, body);
}
