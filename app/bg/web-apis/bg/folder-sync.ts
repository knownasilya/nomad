import { dialog } from 'electron';
import { promises as nodefs } from 'fs';
import path from 'path';
import b4a from 'b4a';
import watch from 'recursive-watch';
import { Readable } from 'streamx';
import { debounce as _debounce } from '../../../lib/async';
import hyper from '../../hyper/index';
import * as autobases from '../../hyper/autobases';
import * as archivesDb from '../../dbs/archives';
import * as filesystem from '../../filesystem/index';
import * as folderSyncDb from '../../dbs/folder-sync';
import * as modals from '../../ui/subwindows/modals';
import { UserDeniedError } from 'beaker-error-constants';
import { globToRegex } from '../../../lib/strings';

const DEFAULT_IGNORED_FILES = '/index.json\n/.git\n/node_modules\n.DS_Store';

// globals
// =

var activeAutoSyncs = {}; // {[key]: {stopwatch, ignoredFiles}

// exported api
// =

export default {
  async chooseFolderDialog(url) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    var current = await folderSyncDb.get(key);
    var res = await dialog.showOpenDialog({
      title: 'Select folder to sync',
      buttonLabel: 'Select Folder',
      defaultPath: current ? current.localPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.filePaths.length !== 1) return current ? current.localPath : undefined;
    if (current) {
      await folderSyncDb.update(key, {
        localPath: res.filePaths[0],
      });
    } else {
      await folderSyncDb.insert(key, {
        localPath: res.filePaths[0],
        ignoredFiles: DEFAULT_IGNORED_FILES,
      });
    }
    await exportMissingManifest(drive, res.filePaths[0]);
    return res.filePaths[0];
  },

  async syncDialog(url) {
    var drive = await getDrive(url);
    var res;
    try {
      res = await modals.create(this.sender, 'folder-sync', { url: drive.url });
    } catch (e) {
      if (e.name !== 'Error') {
        throw e; // only rethrow if a specific error
      }
    }
    if (!res) throw new UserDeniedError();
    return res && res.contacts ? res.contacts[0] : undefined;
  },

  async get(url) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    var current = await folderSyncDb.get(key);
    if (!current) return;
    return {
      localPath: current.localPath,
      ignoredFiles: (current.ignoredFiles || '').split('\n').filter(Boolean),
      isAutoSyncing: key in activeAutoSyncs,
    };
  },

  async set(url, values) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    var current = await folderSyncDb.get(key);
    if (current) {
      await folderSyncDb.update(key, values);
    } else {
      values.ignoredFiles = values.ignoredFiles || DEFAULT_IGNORED_FILES;
      await folderSyncDb.insert(key, values);
    }
    if (values.localPath) await exportMissingManifest(drive, values.localPath);
    stopAutosync(key);
  },

  async updateIgnoredFiles(url, files) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    await folderSyncDb.update(key, {
      ignoredFiles: files.join('\n'),
    });
    if (activeAutoSyncs[key]) {
      activeAutoSyncs[key].ignoredFiles = files;
    }
  },

  async remove(url) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    await folderSyncDb.del(key);
    stopAutosync(key);
  },

  async compare(url) {
    const drive = await getDrive(url);
    const current = await folderSyncDb.get(driveKeyHex(drive));
    if (!current?.localPath) return [];
    await exportMissingManifest(drive, current.localPath);
    return _compare(drive, current.localPath, current.ignoredFiles || '');
  },

  async restoreFile(url, filepath) {
    const drive = await getDrive(url);
    const current = await folderSyncDb.get(driveKeyHex(drive));
    if (!current?.localPath) return;
    const buf = await readDriveFile(drive, filepath);
    if (!buf) return;
    const localFilePath = path.join(current.localPath, filepath);
    await nodefs.mkdir(path.dirname(localFilePath), { recursive: true });
    await nodefs.writeFile(localFilePath, buf);
  },

  sync,

  async enableAutoSync(url) {
    var drive = await getDrive(url);
    var key = driveKeyHex(drive);
    var current = await folderSyncDb.get(key);
    if (!current || !current.localPath) return;
    stopAutosync(key);
    startAutosync(key, current);
  },

  async disableAutoSync(url) {
    var drive = await getDrive(url);
    stopAutosync(driveKeyHex(drive));
  },
};

// internal methods
// =

async function getDrive(url) {
  const key = await hyper.drives.fromURLToKey(url, true);
  const keyStr = typeof key === 'string' ? key : b4a.toString(key, 'hex');
  // Opening an Autobase core as a Hyperdrive hangs. Every new drive is an Autobase,
  // including ones created with the collaborative toggle off.
  let drive;
  if (await isAutobaseKey(keyStr)) {
    drive = await autobases.getOrLoadCollaborativeDrive(keyStr);
  } else {
    drive = await hyper.drives.getOrLoadDrive(keyStr);
  }
  if (!drive) throw new Error('Unable to load drive');
  if (!drive.writable) throw new Error('Must be a writable drive');
  return drive;
}

async function isAutobaseKey(key) {
  if (autobases.getCollaborativeDrive(key)) return true;
  const cfg = filesystem.getDriveConfig(key);
  if (cfg && cfg.type === 'autobase') return true;
  try {
    const meta = await archivesDb.getMeta(key);
    if (meta && meta.type === 'autobase') return true;
  } catch {}
  return false;
}

function isAutobaseSession(drive) {
  return !!(drive && drive.base);
}

// Writer records are apply-authored control data, not files the user synced in.
function isSystemPath(filepath) {
  return typeof filepath === 'string' && filepath.startsWith('/.data/walled.garden/writers/');
}

function driveKeyHex(drive) {
  if (typeof drive.keyStr === 'string') return drive.keyStr;
  if (typeof drive.key === 'string') return drive.key;
  return b4a.toString(drive.key, 'hex');
}

async function listDriveFiles(drive) {
  const driveFiles = new Map();
  if (isAutobaseSession(drive)) {
    for (const { path: drivePath, record } of await autobases.listRecords(drive, '/')) {
      if (isSystemPath(drivePath)) continue;
      driveFiles.set(drivePath, {
        key: drivePath,
        value: { blob: { byteLength: autobases.recordByteLength(record) } },
      });
    }
    return driveFiles;
  }
  for await (const entry of drive.drive.list('/', { recursive: true })) {
    driveFiles.set(entry.key, entry);
  }
  return driveFiles;
}

async function readDriveFile(drive, filepath) {
  if (isAutobaseSession(drive)) return autobases.readContent(drive, filepath);
  const buf = await drive.drive.get(filepath);
  return buf || null;
}

async function writeDriveFile(drive, filepath, buf) {
  if (isSystemPath(filepath)) return;
  if (isAutobaseSession(drive)) return autobases.writeFile(drive, filepath, buf);
  return drive.drive.put(filepath, buf);
}

async function deleteDriveFile(drive, filepath) {
  if (isSystemPath(filepath)) return;
  if (isAutobaseSession(drive)) return autobases.deletePath(drive, filepath);
  return drive.drive.del(filepath);
}

// index.json is on the default ignore list so a folder that lacks it is not treated as
// "delete the manifest." That also means sync never writes the manifest into the folder.
// Seed it once when a folder is first attached, and leave an existing file alone.
async function exportMissingManifest(drive, localPath) {
  const dest = path.join(localPath, 'index.json');
  try {
    await nodefs.access(dest);
    return;
  } catch {}
  const buf = await readDriveFile(drive, '/index.json');
  if (!buf) return;
  await nodefs.writeFile(dest, buf);
}

function sync(url) {
  const stream = new Readable();
  stream.objectMode = true;

  (async () => {
    let drive, current;
    try {
      drive = await getDrive(url);
      current = await folderSyncDb.get(driveKeyHex(drive));
    } catch (e) {
      stream.destroy(e);
      return;
    }

    if (!current?.localPath) {
      stream.push(null);
      return;
    }

    try {
      await exportMissingManifest(drive, current.localPath);
    } catch {
      // a missing manifest should not abort the rest of the sync
    }

    const ignoreFilter = createIgnoreFilter(current.ignoredFiles || '');

    let changes;
    try {
      changes = await _compare(drive, current.localPath, current.ignoredFiles || '');
    } catch (e) {
      stream.destroy(e);
      return;
    }

    for (const change of changes) {
      if (stream.destroyed) return;
      if (ignoreFilter && ignoreFilter(change.path)) continue;
      try {
        if (change.change === 'add' || change.change === 'mod') {
          const localFile = path.join(current.localPath, change.path);
          const buf = await nodefs.readFile(localFile);
          await writeDriveFile(drive, change.path, buf);
          stream.push({ op: 'writeFile', path: change.path });
        } else if (change.change === 'del') {
          await deleteDriveFile(drive, change.path);
          stream.push({ op: 'unlink', path: change.path });
        }
      } catch {
        // skip failed files and continue
      }
    }

    stream.push(null);
  })();

  return stream;
}

async function _compare(drive, localPath, ignoredFilesStr) {
  const ignoreFilter = createIgnoreFilter(ignoredFilesStr);
  const localFiles = await _listLocalFiles(localPath, ignoreFilter);

  const driveFiles = await listDriveFiles(drive);

  const changes = [];

  for (const [drivePath, localStat] of localFiles) {
    if (driveFiles.has(drivePath)) {
      const entry = driveFiles.get(drivePath);
      const driveSize = entry.value?.blob?.byteLength || 0;
      if (localStat.size !== driveSize) {
        changes.push({ change: 'mod', type: 'file', path: drivePath });
      }
    } else {
      changes.push({ change: 'add', type: 'file', path: drivePath });
    }
  }

  for (const [drivePath] of driveFiles) {
    if (!localFiles.has(drivePath)) {
      changes.push({ change: 'del', type: 'file', path: drivePath });
    }
  }

  return changes;
}

async function _listLocalFiles(basePath, ignoreFilter) {
  const files = new Map(); // drivePath (/foo/bar.js) -> fs.Stats

  async function walk(absDir) {
    let entries;
    try {
      entries = await nodefs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const drivePath = '/' + path.relative(basePath, absPath).replace(/\\/g, '/');
      if (ignoreFilter && ignoreFilter(drivePath)) continue;
      if (entry.isDirectory()) {
        await walk(absPath);
      } else if (entry.isFile()) {
        files.set(drivePath, await nodefs.stat(absPath));
      }
    }
  }

  await walk(basePath).catch(() => {});
  return files;
}

function startAutosync(key, current) {
  var syncDebounced = _debounce(sync, 500);
  var ctx = {
    ignoredFiles: (current.ignoredFiles || '').split('\n'),
    stopwatch: watch(current.localPath, (filename) => {
      filename = filename.slice(current.localPath.length).replace(/\\/g, '/');
      if (!filename.startsWith('/')) filename = '/' + filename;
      if (ctx.ignoredFiles.some((p) => filename.endsWith(p.replace(/^\//, '')))) return;
      syncDebounced(key);
    }),
  };
  activeAutoSyncs[key] = ctx;
}

function stopAutosync(key) {
  if (activeAutoSyncs[key]) {
    activeAutoSyncs[key].stopwatch();
    delete activeAutoSyncs[key];
  }
}

function createIgnoreFilter(ignoredFiles) {
  var ignoreRegexes = (ignoredFiles || '').split('\n').filter(Boolean).map(globToRegex);
  if (ignoreRegexes.length === 0) return;
  return (filepath) => {
    for (let re of ignoreRegexes) {
      if (re.test(filepath)) return true;
    }
    return false;
  };
}
