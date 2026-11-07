import { dialog } from 'electron';
import { promises as nodefs } from 'fs';
import { join as joinPath2, basename as pathBasename } from 'path';
import * as modals from '../../ui/subwindows/modals';
import * as prompts from '../../ui/subwindows/prompts';
import * as drives from '../../hyper/drives';
import {
  getDriveConfig,
  configDrive,
  listDrives as fsListDrives,
  removeDrive,
} from '../../filesystem/index';
import { lookupDrive } from './hyperdrive';
import { isHyperUrl, parseDriveUrl, normalizeOrigin } from '../../../lib/urls';
import { joinPath } from '../../../lib/strings';
import * as permissions from '../../ui/permissions';
import assert from 'assert';
import { UserDeniedError, ArchiveNotWritableError } from 'beaker-error-constants';
import { pick } from '../../../lib/async';
import * as wcTrust from '../../wc-trust';
import * as filesystem from '../../filesystem/index';
import * as capabilities from '../../hyper/capabilities';
import { scopeFor, capUrlFor } from '../../hyper/capability-rules.mjs';
import fsAPI from './fs';

// typedefs
// =

/**
 * @typedef {Object} NomadShellPublicAPIDriveRecord
 * @prop {string} url
 * @prop {string} title
 * @prop {string} description
 */

// exported api
// =

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function drivePropertiesDialog(url) {
  assert(url && typeof url === 'string', '`url` must be a string');
  var info = await drives.getDriveInfo(url);
  var cfg = getDriveConfig(info.key);
  await modals.create(this.sender, 'drive-properties', {
    url: info.url,
    writable: info.writable,
    thumbPath: info.manifest?.thumb || null,
    props: Object.assign(pick(info, ['title', 'description']), {
      tags: cfg.tags || [],
    }),
  });
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.buttonLabel]
 * @param {string} [opts.drive]
 * @param {string} [opts.defaultPath]
 * @param {string[]} [opts.select]
 * @param {Object} [opts.filters]
 * @param {string[]} [opts.filters.extensions]
 * @param {boolean} [opts.filters.writable]
 * @param {boolean} [opts.filters.networked]
 * @param {boolean} [opts.allowMultiple]
 * @param {boolean} [opts.disallowCreate]
 * @param {boolean} [opts.capability] - give capability URLs for what the user picks, not the drives'
 *   own URLs: read-only, only the picked items, and they can come from the private drive. A web page
 *   always gets them; only a trusted nomad:// page gets the drives' own URLs, unless it passes this.
 * @returns {Promise<string[]>}
 */
export async function selectFileDialog(opts: any = {}) {
  // validate
  assert(opts && typeof opts === 'object', 'Must pass an options object');
  assert(!opts.title || typeof opts.title === 'string', '.title must be a string');
  assert(
    !opts.buttonLabel || typeof opts.buttonLabel === 'string',
    '.buttonLabel must be a string'
  );
  assert(!opts.drive || typeof opts.drive === 'string', '.drive must be a string');
  assert(
    !opts.defaultPath || typeof opts.defaultPath === 'string',
    '.defaultPath must be a string'
  );
  assert(!opts.select || isStrArray(opts.select), '.select must be an array of strings');
  if (opts.filters) {
    assert(typeof opts.filters === 'object', '.filters must be an object');
    assert(
      !opts.filters.extensions || isStrArray(opts.filters.extensions),
      '.filters.extensions must be an array of strings'
    );
    assert(
      !opts.filters.writable || typeof opts.filters.writable === 'boolean',
      '.filters.writable must be a boolean'
    );
    assert(
      !opts.filters.networked || typeof opts.filters.networked === 'boolean',
      '.filters.networked must be a boolean'
    );
  }
  assert(
    !opts.allowMultiple || typeof opts.allowMultiple === 'boolean',
    '.filters.allowMultiple must be a boolean'
  );
  assert(
    !opts.disallowCreate || typeof opts.disallowCreate === 'boolean',
    '.filters.disallowCreate must be a boolean'
  );
  assert(!opts.capability || typeof opts.capability === 'boolean', '.capability must be a boolean');
  // A web page never learns which drive a picked file lives in: it always gets capabilities.
  if (!wcTrust.isWcTrusted(this.sender)) opts.capability = true;

  // initiate the modal
  var res;
  try {
    while (true) {
      res = await modals.create(this.sender, 'select-file', opts);
      if (res && res.gotoCreateDrive) {
        res = await modals.create(this.sender, 'create-drive').catch((e) => undefined);
        if (res && res.gotoSync) {
          await modals.create(this.sender, 'folder-sync', {
            url: res.url,
            closeAfterSync: true,
          });
        }
        if (res) opts.drive = res.url;
      } else {
        break;
      }
    }
  } catch (e) {
    if (e.name !== 'Error') {
      throw e; // only rethrow if a specific error
    }
  }
  if (!res) throw new UserDeniedError();
  if (opts.capability) return Promise.all(res.map((sel) => pickedCapability(this.sender, sel)));
  return res;
}

// The user picked `sel` ({ path, origin: the drive's URL, url }) in a capability picker. Make (or
// reuse) a capability for that one file or folder, owned by the page that asked, and hand back its
// URL in the drive's place. `hyper://private/` is the asking tab's own Space.
async function pickedCapability(sender, sel) {
  const origin = normalizeOrigin(sender.getURL());
  let driveUrl = sel.origin;
  if (parseDriveUrl(driveUrl).hostname === 'private') {
    const spaceId = filesystem.getSpaceIdForWebContents(sender.id);
    driveUrl = (spaceId && filesystem.getSpaceRootDriveUrl(spaceId)) || driveUrl;
  }
  const key = await drives.fromURLToKey(driveUrl, true);
  if (!/^[0-9a-f]{64}$/i.test(String(key || ''))) throw new Error('Could not find that drive');

  // Read as the browser (no page sender): the user is choosing, so the private drive is open here.
  const ctx = {};
  const itemUrl = `hyper://${key}${sel.path === '/' ? '/' : sel.path}`;
  const st: any = await fsAPI.stat.call(ctx, itemUrl).catch(() => null);
  const isFolder =
    sel.path === '/' ||
    (!!st &&
      (typeof st.isDirectory === 'function'
        ? st.isDirectory()
        : (st.mode & 0o170000) === 0o040000));
  const scope = scopeFor(sel.path, isFolder);
  if (!scope) throw new Error('Cannot share that path');
  // As with the private-drive guard, the whole private drive is never handed to a page.
  if (scope === '/' && filesystem.isRootUrl(`hyper://${key}/`)) {
    throw new Error('Pick a file or folder inside your private drive, not the whole drive');
  }
  const info: any = await fsAPI.getInfo.call(ctx, `hyper://${key}/`).catch(() => null);
  const name = scope === '/' ? '' : scope.replace(/\/$/, '').split('/').pop();

  const cap = await capabilities.createPickedCap(
    origin,
    { key, path: scope },
    { title: name || info?.title || '', driveTitle: info?.title || '' }
  );
  return {
    path: sel.path,
    origin: capUrlFor(cap.token, '/'),
    url: capUrlFor(cap.token, scope),
  };
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.buttonLabel]
 * @param {string} [opts.drive]
 * @param {string} [opts.defaultPath]
 * @param {string} [opts.defaultFilename]
 * @param {string} [opts.extension]
 * @param {Object} [opts.filters]
 * @param {string[]} [opts.filters.extensions]
 * @param {boolean} [opts.filters.networked]
 * @returns {Promise<string[]>}
 */
export async function saveFileDialog(opts: any = {}) {
  // validate
  assert(opts && typeof opts === 'object', 'Must pass an options object');
  assert(!opts.title || typeof opts.title === 'string', '.title must be a string');
  assert(
    !opts.buttonLabel || typeof opts.buttonLabel === 'string',
    '.buttonLabel must be a string'
  );
  assert(!opts.drive || typeof opts.drive === 'string', '.drive must be a string');
  assert(
    !opts.defaultPath || typeof opts.defaultPath === 'string',
    '.defaultPath must be a string'
  );
  assert(
    !opts.defaultFilename || typeof opts.defaultFilename === 'string',
    '.defaultFilename must be a string'
  );
  if (opts.filters) {
    assert(typeof opts.filters === 'object', '.filters must be an object');
    assert(
      !opts.filters.extensions || isStrArray(opts.filters.extensions),
      '.filters.extensions must be an array of strings'
    );
    assert(
      !opts.filters.networked || typeof opts.filters.networked === 'boolean',
      '.filters.networked must be a boolean'
    );
  }

  // initiate the modal
  opts.saveMode = true;
  var res;
  try {
    while (true) {
      res = await modals.create(this.sender, 'select-file', opts);
      if (res && res.gotoCreateDrive) {
        res = await modals.create(this.sender, 'create-drive').catch((e) => undefined);
        if (res && res.gotoSync) {
          await modals.create(this.sender, 'folder-sync', {
            url: res.url,
            closeAfterSync: true,
          });
        }
        if (res) opts.drive = res.url;
      } else {
        break;
      }
    }
  } catch (e) {
    if (e.name !== 'Error') {
      throw e; // only rethrow if a specific error
    }
  }
  if (!res) throw new UserDeniedError();
  return res;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.buttonLabel]
 * @param {boolean} [opts.writable]
 * @param {string} [opts.tag]
 * @param {boolean} [opts.allowMultiple]
 * @param {string} [opts.template]
 * @returns {Promise<string|string[]>}
 */
export async function selectDriveDialog(opts: any = {}) {
  // validate
  assert(opts && typeof opts === 'object', 'Must pass an options object');
  assert(!opts.title || typeof opts.title === 'string', '.title must be a string');
  assert(
    !opts.buttonLabel || typeof opts.buttonLabel === 'string',
    '.buttonLabel must be a string'
  );
  assert(!opts.tag || typeof opts.tag === 'string', '.tag must be a string');
  assert(!opts.writable || typeof opts.writable === 'boolean', '.writable must be a boolean');
  assert(
    !opts.allowMultiple || typeof opts.allowMultiple === 'boolean',
    '.allowMultiple must be a boolean'
  );
  assert(!opts.template || typeof opts.template === 'string', '.template must be a string');
  if (opts.template && !isHyperUrl(opts.template)) {
    throw new Error('.template must be a hyper:// URL');
  }

  // A web page that gets a drive's own URL keeps it for good, so the dialog says so. When the page
  // doesn't need to write, the user can share it read-only instead: a capability for the whole
  // drive, which they can take back in site-info.
  const trusted = wcTrust.isWcTrusted(this.sender);
  const modalOpts = {
    ...opts,
    warnShare: !trusted,
    offerReadOnly: !trusted && opts.writable !== true,
  };

  // initiate the modal
  var res;
  try {
    res = await modals.create(this.sender, 'select-drive', modalOpts);
    if (res && res.gotoCreate) {
      if (opts.template) {
        res = await modals.create(this.sender, 'fork-drive', {
          url: opts.template,
          forks: [{ url: opts.template }],
          detached: true,
          isTemplate: true,
          title: '',
          description: '',
          tags: [opts.tag],
        });
      } else {
        res = await modals.create(this.sender, 'create-drive', {
          tags: [opts.tag],
        });
        if (res && res.gotoSync) {
          await modals.create(this.sender, 'folder-sync', {
            url: res.url,
            closeAfterSync: true,
          });
        }
      }
    }
  } catch (e) {
    if (e.name !== 'Error') {
      throw e; // only rethrow if a specific error
    }
  }
  if (!res) throw new UserDeniedError();
  if (res.readOnly && modalOpts.offerReadOnly) {
    if (res.urls) return Promise.all(res.urls.map((u) => readOnlyDrive(this.sender, u)));
    return readOnlyDrive(this.sender, res.url);
  }
  return res.urls || res.url;
}

// The user chose "Share read-only" in the drive dialog: a capability for the whole drive, owned by
// the page that asked, kept like a picked file. Never for a private drive.
async function readOnlyDrive(sender, url) {
  const key = await drives.fromURLToKey(url, true);
  if (!/^[0-9a-f]{64}$/i.test(String(key || ''))) throw new Error('Could not find that drive');
  if (filesystem.isRootUrl(`hyper://${key}/`)) {
    throw new Error('Your private drive cannot be shared with a site');
  }
  const info: any = await fsAPI.getInfo.call({}, `hyper://${key}/`).catch(() => null);
  const cap = await capabilities.createPickedCap(
    normalizeOrigin(sender.getURL()),
    { key, path: '/' },
    { title: info?.title || '', driveTitle: info?.title || '' }
  );
  return capUrlFor(cap.token, '/');
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.tags]
 * @returns {Promise<void>}
 */
export async function saveDriveDialog(url, { tags } = { tags: '' }) {
  if (Array.isArray(tags)) {
    tags = tags.filter((t) => typeof t === 'string').join(' ');
  } else if (typeof tags !== 'string') {
    tags = '';
  }

  var res;
  try {
    res = await modals.create(this.sender, 'add-drive', { url, tags });
  } catch (e) {
    if (e.name !== 'Error') {
      throw e; // only rethrow if a specific error
    }
  }
  if (!res) throw new UserDeniedError();
  await configDrive(res.key, { tags: res.tags });
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.writable]
 * @param {string} [opts.tag]
 * @returns {Promise<NomadShellPublicAPIDriveRecord[]>}
 */
export async function listDrives(opts: any = {}) {
  // validate
  assert(opts && typeof opts === 'object', 'Must pass an options object');
  assert(!opts.tag || typeof opts.tag === 'string', '.tag must be a string');
  assert(!opts.writable || typeof opts.writable === 'boolean', '.writable must be a boolean');

  let perm = opts.tag ? `listDrives:${opts.tag || ''}` : 'listDrives';
  if (!(await permissions.requestPermission(perm, this.sender))) {
    throw new UserDeniedError();
  }

  let drivesList = fsListDrives();
  let records = [];
  for (let drive of drivesList) {
    let url = `hyper://${drive.key}/`;
    let info = await drives.getDriveInfo(drive.key, { onlyCache: true });
    if (typeof opts.writable === 'boolean' && info.writable !== opts.writable) {
      continue;
    }
    if (typeof opts.tag === 'string' && !drive.tags?.includes?.(opts.tag)) {
      continue;
    }
    records.push({ url, title: info.title, description: info.description });
  }
  return records;
}

export async function unsaveDrive(url) {
  // validate
  assert(url && typeof url === 'string', 'Must provide a URL string');

  var key = await drives.fromURLToKey(url, true);
  var cfg = getDriveConfig(key);
  if (cfg) {
    var info = await drives.getDriveInfo(key, { onlyCache: true });
    if (
      !(await permissions.requestPermission(`deleteDrive:${key}`, this.sender, {
        title: info.title,
      }))
    ) {
      throw new UserDeniedError();
    }
    await removeDrive(key);
  }
}

export async function tagDrive(url, tags) {
  // validate
  assert(url && typeof url === 'string', 'Must provide a URL string');
  if (!tags) throw new Error('Tags must be a string or array of strings');
  if (Array.isArray(tags)) {
    tags = tags.filter((v) => typeof v === 'string');
    if (tags.length === 0) throw new Error('Tags must be a string or array of strings');
  } else if (typeof tags !== 'string') {
    throw new Error('Tags must be a string or array of strings');
  } else {
    tags = tags.split(' ');
  }

  var key = await drives.fromURLToKey(url, true);
  var cfg = getDriveConfig(key);
  if (!cfg) {
    return saveDriveDialog.call(this, url, { tags });
  }

  if (cfg.tags) {
    // remove any tags already present
    tags = tags.filter((tag) => !cfg.tags.includes(tag));
    if (tags.length === 0) {
      return; // already tagged with all requested tags
    }
  }

  var info = await drives.getDriveInfo(key, { onlyCache: true });
  if (
    !(await permissions.requestPermission(`tagDrive:${key}`, this.sender, {
      title: info.title,
      tags,
    }))
  ) {
    throw new UserDeniedError();
  }

  if (cfg.tags) tags = tags.concat(cfg.tags);
  await configDrive(key, { tags });
}

export async function importFilesAndFolders(url, filePaths) {
  if (!wcTrust.isWcTrusted(this.sender)) return;
  return doImport(this.sender, url, filePaths);
}

export async function importFilesDialog(url) {
  if (!wcTrust.isWcTrusted(this.sender)) return;

  var res = await dialog.showOpenDialog({
    title: 'Import files',
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections', 'createDirectory'],
  });
  if (res.filePaths.length) {
    return doImport(this.sender, url, res.filePaths);
  }
  return { numImported: 0 };
}

export async function importFoldersDialog(url) {
  if (!wcTrust.isWcTrusted(this.sender)) return;

  var res = await dialog.showOpenDialog({
    title: 'Import folders',
    buttonLabel: 'Import',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });
  if (res.filePaths.length) {
    return doImport(this.sender, url, res.filePaths);
  }
  return { numImported: 0 };
}

export async function exportFilesDialog(urls) {
  if (!wcTrust.isWcTrusted(this.sender)) return;

  var res = await dialog.showOpenDialog({
    title: 'Export files',
    buttonLabel: 'Export',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.filePaths.length) {
    var baseDstPath = res.filePaths[0];
    urls = Array.isArray(urls) ? urls : [urls];
    for (let srcUrl of urls) {
      var urlp = parseDriveUrl(srcUrl);
      let { checkoutFS } = await lookupDrive(this.sender, urlp.hostname, urlp.version);
      let dstPath = joinPath(baseDstPath, urlp.pathname.split('/').pop());
      await _exportToFs(checkoutFS.drive, urlp.pathname, dstPath, { overwriteExisting: false });
    }
    return { numExported: res.filePaths.length };
  }
  return { numExported: 0 };
}

// internal methods
// =

function isStrArray(v) {
  return Array.isArray(v) && v.every((el) => typeof el === 'string');
}

async function doImport(wc, url, filePaths) {
  var urlp = parseDriveUrl(url);
  var { checkoutFS, isHistoric } = await lookupDrive(wc, urlp.hostname, urlp.version);
  if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');

  var numImported = 0;
  var prompt = await prompts.create(wc, 'progress', { label: 'Importing files...' });
  try {
    for (let srcPath of filePaths) {
      numImported += await _importFsItem(checkoutFS.drive, srcPath, urlp.pathname || '/', {
        ignore: ['index.json'],
      });
    }
  } finally {
    prompts.close((prompt as any).tab);
  }

  return { numImported };
}

// filesystem helpers (replaces pauls-dat-api2 export functions)
// =

async function _importFsItem(drive, srcPath, dstPath, { ignore = [] }: any = {}) {
  const ignoreSet = new Set(ignore);
  const srcStat = await nodefs.stat(srcPath);
  const name = pathBasename(srcPath);
  if (ignoreSet.has(name)) return 0;

  if (srcStat.isFile()) {
    const fullDst = (dstPath.endsWith('/') ? dstPath : dstPath + '/') + name;
    const buf = await nodefs.readFile(srcPath);
    await drive.put(fullDst, buf);
    return 1;
  }

  if (srcStat.isDirectory()) {
    let count = 0;
    const entries = await nodefs.readdir(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreSet.has(entry.name)) continue;
      const fullSrc = joinPath2(srcPath, entry.name);
      const fullDst = (dstPath.endsWith('/') ? dstPath : dstPath + '/') + name;
      count += await _importFsItem(drive, fullSrc, fullDst, { ignore });
    }
    return count;
  }

  return 0;
}

async function _exportToFs(drive, srcFolder, dstPath, { overwriteExisting = true }: any = {}) {
  await nodefs.mkdir(dstPath, { recursive: true });
  for await (const entry of drive.list(srcFolder, { recursive: true })) {
    const relPath = entry.key.slice(srcFolder.length).replace(/^\//, '');
    const dstFile = joinPath2(dstPath, relPath);
    if (!overwriteExisting) {
      try {
        await nodefs.access(dstFile);
        continue;
      } catch {}
    }
    const buf = await drive.get(entry.key);
    if (buf) {
      await nodefs.mkdir(joinPath2(dstFile, '..'), { recursive: true });
      await nodefs.writeFile(dstFile, buf);
    }
  }
}
