import { BrowserWindow } from 'electron';
import { join as joinPath } from 'path';
import * as logLib from '../logger';
import hyper from '../hyper/index';
import * as db from '../dbs/profile-data-db';
import * as archivesDb from '../dbs/archives';
import * as spacesDb from '../dbs/spaces';
import * as trash from './trash';
import * as modals from '../ui/subwindows/modals';
import lock from '../../lib/lock';
import { isSameOrigin } from '../../lib/urls';

const logger = logLib
  .get()
  .child({ category: 'hyper', subcategory: 'filesystem' });

// typedefs
// =

/**
 * @typedef {import('../hyper/daemon').DaemonHyperdrive} DaemonHyperdrive
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
// =

var browsingProfile;
var rootDrive;
var drives = [];
// per-space root drives: map of {[spaceId]: DaemonHyperdrive}
var spaceRootDrives = {};

// exported api
// =

/**
 * @returns {DaemonHyperdrive}
 */
export function get() {
  return rootDrive;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isRootUrl(url) {
  return (
    isSameOrigin(url, browsingProfile.url) ||
    isSameOrigin(url, 'hyper://private/')
  );
}

/**
 * @returns {Promise<void>}
 */
export async function setup() {
  trash.setup();

  // create the root drive as needed
  var isInitialCreation = false;
  browsingProfile = await db.get(`SELECT * FROM profiles WHERE id = 0`);
  if (
    !browsingProfile.url ||
    (typeof browsingProfile.url === 'string' &&
      browsingProfile.url.startsWith('dat:'))
  ) {
    let drive = await hyper.drives.createNewRootDrive();
    logger.info('Root drive created', { url: drive.url });
    await db.run(`UPDATE profiles SET url = ? WHERE id = 0`, [drive.url]);
    browsingProfile.url = drive.url;
    isInitialCreation = true;
  }
  if (!browsingProfile.url.endsWith('/')) browsingProfile.url += '/';

  // load root drive
  logger.info('Loading root drive', { url: browsingProfile.url });
  hyper.dns.setLocal('private', browsingProfile.url);
  rootDrive = await hyper.drives.getOrLoadDrive(browsingProfile.url, {
    persistSession: true,
  });

  // default pinned bookmarks
  if (isInitialCreation) {
    await rootDrive.pda.mkdir('/bookmarks');
    await rootDrive.pda.writeFile(
      `/bookmarks/beaker-dev-docs-templates.goto`,
      '',
      {
        metadata: {
          href: 'https://nomad.pages.dev/docs/templates/',
          title: 'Hyperdrive Templates',
        },
      }
    );
    await rootDrive.pda.writeFile(`/bookmarks/twitter.goto`, '', {
      metadata: { href: 'https://twitter.com/', title: 'Twitter' },
    });
    await rootDrive.pda.writeFile(`/bookmarks/reddit.goto`, '', {
      metadata: { href: 'https://reddit.com/', title: 'Reddit' },
    });
    await rootDrive.pda.writeFile(`/bookmarks/youtube.goto`, '', {
      metadata: { href: 'https://youtube.com/', title: 'YouTube' },
    });
    await rootDrive.pda.mkdir('/beaker');
    await rootDrive.pda.writeFile(
      `/beaker/pins.json`,
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

  // load drive config
  let hostKeys = [];
  try {
    drives = JSON.parse(await rootDrive.pda.readFile('/drives.json')).drives;
    hostKeys = hostKeys.concat(drives.map((drive) => drive.key));
  } catch (e) {
    if (e.name !== 'NotFoundError') {
      logger.info(
        'Error while reading the drive configuration at /drives.json',
        { error: e.toString() }
      );
    }
  }
  hyper.drives.ensureHosting(hostKeys);
  await migrateAddressBook();

  // backfill space 1's root_drive_url from the existing browsing profile
  await spacesDb.backfillDefaultSpaceDrive(browsingProfile.url);
  spaceRootDrives[1] = rootDrive;
}

/**
 * @param {string} url
 * @returns {DriveIdent | Promise<DriveIdent>}
 */
export function getDriveIdent(url) {
  var system = isRootUrl(url);
  return { system, internal: system };
}

/**
 * Update the hyper://private/ DNS alias to point to a different root drive.
 * Called on startup and on every space switch.
 * @param {string} url
 */
export function setPrivateAlias(url) {
  if (!url) return;
  if (!url.endsWith('/')) url += '/';
  hyper.dns.setLocal('private', url);
}

/**
 * Get or create the root drive for a space, caching it in memory.
 * @param {{ id: number, root_drive_url: string|null }} space
 * @returns {Promise<DaemonHyperdrive>}
 */
export async function getOrSetupSpaceDrive(space) {
  if (spaceRootDrives[space.id]) return spaceRootDrives[space.id];

  if (space.root_drive_url) {
    let url = space.root_drive_url;
    if (!url.endsWith('/')) url += '/';
    const drive = await hyper.drives.getOrLoadDrive(url, { persistSession: true });
    spaceRootDrives[space.id] = drive;
    return drive;
  }

  // No drive yet — create one
  const drive = await hyper.drives.createNewRootDrive();
  logger.info('Created root drive for space', { spaceId: space.id, url: drive.url });
  await spacesDb.update(space.id, { rootDriveUrl: drive.url });
  spaceRootDrives[space.id] = drive;
  return drive;
}

/**
 * @param {number} spaceId
 * @returns {DaemonHyperdrive|undefined}
 */
export function getSpaceRootDrive(spaceId) {
  return spaceRootDrives[spaceId];
}

// per-space drives lists (spaceId 1 uses the module-level `drives`)
var spaceDrivesMap = {}; // {[spaceId]: DriveConfig[]}

/**
 * Register a drive in the given space's root drive /drives.json.
 * Falls back to the default configDrive for space 1.
 * @param {string} url
 * @param {Object} [opts]
 * @param {number} [spaceId]
 */
export async function configDriveForSpace(url, opts = {}, spaceId = 1) {
  if (spaceId === 1) {
    return configDrive(url, opts);
  }
  const space = await spacesDb.get(spaceId);
  if (!space) return configDrive(url, opts);
  const spaceDrive = await getOrSetupSpaceDrive(space);

  var release = await lock(`filesystem:drives:space-${spaceId}`);
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    if (!spaceDrivesMap[spaceId]) {
      try {
        spaceDrivesMap[spaceId] = JSON.parse(
          await spaceDrive.pda.readFile('/drives.json')
        ).drives || [];
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
    await spaceDrive.pda.writeFile(
      '/drives.json',
      JSON.stringify({ drives: spaceDrives }, null, 2)
    );
  } finally {
    release();
  }
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.includeSystem]
 * @returns {Array<DriveConfig>}
 */
export function listDrives({ includeSystem } = { includeSystem: false }) {
  var d = drives.slice();
  if (includeSystem) {
    d.unshift({ key: 'private' });
  }
  return d;
}

/**
 * List drives for a specific space, loading their /drives.json if needed.
 * @param {number} spaceId
 * @param {Object} [opts]
 * @param {boolean} [opts.includeSystem]
 * @returns {Promise<Array<DriveConfig>>}
 */
export async function listDrivesForSpace(spaceId, { includeSystem } = {}) {
  if (!spaceId || spaceId === 1) return listDrives({ includeSystem });

  // Ensure drives are loaded for this space
  if (!spaceDrivesMap[spaceId]) {
    const space = await spacesDb.get(spaceId);
    if (space) {
      const spaceDrive = await getOrSetupSpaceDrive(space);
      try {
        spaceDrivesMap[spaceId] = JSON.parse(
          await spaceDrive.pda.readFile('/drives.json')
        ).drives || [];
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

/**
 * @returns {Promise<Array<LibraryArchiveMeta>>}
 */
export async function listDriveMetas() {
  return Promise.all(drives.map((d) => archivesDb.getMeta(d.key)));
}

/**
 * @param {string} key
 * @returns {DriveConfig}
 */
export function getDriveConfig(key) {
  return listDrives().find((d) => d.key === key);
}

/**
 * @param {string} url
 * @param {Object} [opts]
 * @param {Object} [opts.forkOf]
 * @param {string[]} [opts.tags]
 * @returns {Promise<void>}
 */
export async function configDrive(
  url,
  { forkOf, tags } = { forkOf: undefined, tags: undefined }
) {
  var release = await lock('filesystem:drives');
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    var driveCfg = drives.find((d) => d.key === key);
    if (!driveCfg) {
      let drive = await hyper.drives.getOrLoadDrive(url);
      let manifest = await drive.pda.readManifest().catch((_) => ({}));

      driveCfg = /** @type DriveConfig */ ({ key });
      if (
        tags &&
        Array.isArray(tags) &&
        tags.every((t) => typeof t === 'string')
      ) {
        driveCfg.tags = tags.filter(Boolean);
      }
      if (forkOf && typeof forkOf === 'object') {
        driveCfg.forkOf = forkOf;
      }

      if (!drive.writable) {
        // announce the drive
        drive.session.drive.configureNetwork({
          announce: true,
          lookup: true,
        });
      }

      // for forks, we need to ensure:
      // 1. the drives.json forkOf.key is the same as index.json forkOf value
      // 2. there's a local forkOf.label
      // 3. the parent is saved
      if (manifest.forkOf && typeof manifest.forkOf === 'string') {
        if (!driveCfg.forkOf)
          driveCfg.forkOf = { key: undefined, label: undefined };
        driveCfg.forkOf.key = await hyper.drives.fromURLToKey(
          manifest.forkOf,
          true
        );
        if (!driveCfg.forkOf.label) {
          let message =
            'Choose a label to save this fork under (e.g. "dev" or "bobs-changes")';
          let promptRes = await modals
            .create(BrowserWindow.getFocusedWindow().webContents, 'prompt', {
              message,
            })
            .catch((e) => false);
          if (!promptRes || !promptRes.value) return;
          driveCfg.forkOf.label = promptRes.value;
        }

        let parentDriveCfg = drives.find((d) => d.key === driveCfg.forkOf.key);
        if (!parentDriveCfg) {
          drives.push({ key: driveCfg.forkOf.key });
        }
      }

      drives.push(driveCfg);
    } else {
      if (typeof tags !== 'undefined') {
        if (
          tags &&
          Array.isArray(tags) &&
          tags.every((t) => typeof t === 'string')
        ) {
          driveCfg.tags = tags.filter(Boolean);
        } else {
          delete driveCfg.tags;
        }
      }
      if (typeof forkOf !== 'undefined') {
        if (forkOf && typeof forkOf === 'object') {
          driveCfg.forkOf = forkOf;
        } else {
          delete driveCfg.forkOf;
        }
      }
    }
    await rootDrive.pda.writeFile(
      '/drives.json',
      JSON.stringify({ drives }, null, 2)
    );
  } finally {
    release();
  }
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function removeDrive(url) {
  var release = await lock('filesystem:drives');
  try {
    var key = await hyper.drives.fromURLToKey(url, true);
    var driveIndex = drives.findIndex((drive) => drive.key === key);
    if (driveIndex === -1) return;
    let drive = await hyper.drives.getOrLoadDrive(url);
    if (!drive.writable) {
      drive.session.drive.configureNetwork({ announce: false, lookup: true });
    }
    drives.splice(driveIndex, 1);
    await rootDrive.pda.writeFile(
      '/drives.json',
      JSON.stringify({ drives }, null, 2)
    );
  } finally {
    release();
  }
}

/**
 * Remove a drive from a specific space's /drives.json.
 * Falls back to removeDrive for space 1.
 * @param {string} url
 * @param {number} [spaceId]
 */
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
    await spaceDrive.pda.writeFile(
      '/drives.json',
      JSON.stringify({ drives: spaceDrivesMap[spaceId] }, null, 2)
    );
  } finally {
    release();
  }
}

/**
 * @param {string} containingPath
 * @param {string} basename
 * @param {string} [ext]
 * @param {string} [joiningChar]
 * @param {DaemonHyperdrive} [drive]
 * @returns {Promise<string>}
 */
export async function getAvailableName(
  containingPath,
  basename,
  ext = undefined,
  joiningChar = '-',
  drive = rootDrive
) {
  for (let i = 1; i < 1e9; i++) {
    let name =
      (i === 1 ? basename : `${basename}${joiningChar}${i}`) +
      (ext ? `.${ext}` : '');
    let st = await stat(joinPath(containingPath, name), drive);
    if (!st) return name;
  }
  // yikes if this happens
  throw new Error('Unable to find an available name for ' + basename);
}

export async function ensureDir(path, drive = rootDrive) {
  try {
    let st = await stat(path, drive);
    if (!st) {
      logger.info(`Creating directory ${path}`);
      await drive.pda.mkdir(path);
    } else if (!st.isDirectory()) {
      logger.error(
        'Warning! Filesystem expects a folder but an unexpected file exists at this location.',
        { path }
      );
    }
  } catch (e) {
    logger.error('Filesystem failed to make directory', {
      path: '' + path,
      error: e.toString(),
    });
  }
}

export async function migrateAddressBook() {
  var addressBook;
  try {
    addressBook = await rootDrive.pda
      .readFile('/address-book.json')
      .then(JSON.parse);
  } catch (e) {
    return;
  }
  addressBook.profiles =
    addressBook.profiles && Array.isArray(addressBook.profiles)
      ? addressBook.profiles
      : [];
  addressBook.contacts =
    addressBook.contacts && Array.isArray(addressBook.contacts)
      ? addressBook.contacts
      : [];
  var profiles = addressBook.profiles.concat(addressBook.contacts);
  for (let profile of profiles) {
    let existing = drives.find((d) => d.key === profile.key);
    if (!existing) {
      drives.push({ key: profile.key, tags: ['contact'] });
    } else {
      existing.tags = (existing.tags || []).concat(['contact']);
    }
  }
  await rootDrive.pda.writeFile(
    '/drives.json',
    JSON.stringify({ drives }, null, 2)
  );
  await rootDrive.pda.unlink('/address-book.json');
}

// internal methods
// =

async function stat(path, drive = rootDrive) {
  try {
    return await drive.pda.stat(path);
  } catch (e) {
    return null;
  }
}
