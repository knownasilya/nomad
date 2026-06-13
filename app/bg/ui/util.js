import { promises as nodefs } from 'fs';
import { join as joinPath } from 'path';
import * as modals from './subwindows/modals';
import * as shellWebAPI from '../web-apis/bg/shell';
import drivesWebAPI from '../web-apis/bg/drives';
import hyper from '../hyper/index';
import * as filesystem from '../filesystem/index';
import { UserDeniedError } from 'beaker-error-constants';

export async function runSelectFileDialog(win, opts = {}) {
  var res;
  try {
    res = await modals.create(win.webContents, 'select-file', opts);
  } catch (e) {
    if (e.name !== 'Error') throw e;
  }
  if (!res) throw new UserDeniedError();
  return res;
}

export async function runNewDriveFlow(win) {
  let res;
  try {
    res = await modals.create(win.webContents, 'create-drive', {});
    if (res && res.gotoSync) {
      await modals.create(win.webContents, 'folder-sync', { url: res.url, closeAfterSync: true });
    }
  } catch (e) {
    if (e.name !== 'Error') throw e;
  }
  if (!res || !res.url) throw new UserDeniedError();
  return res.url;
}

export async function runNewDriveFromFolderFlow(folderPath) {
  let newDrive;
  try {
    const meta = { title: folderPath.split('/').pop() };
    newDrive = await hyper.drives.createNewDrive(meta);
    await filesystem.configDrive(newDrive.url);
  } catch (e) {
    console.log(e);
    throw e;
  }
  await _importFsFolder(newDrive.drive, folderPath, '/');
  return newDrive.url;
}

export async function runForkFlow(win, url, { detached } = { detached: false }) {
  var res;
  try {
    let forks = await drivesWebAPI.getForks(url);
    res = await modals.create(win.webContents, 'fork-drive', { url, forks, detached });
  } catch (e) {
    if (e.name !== 'Error') throw e;
  }
  if (!res || !res.url) throw new UserDeniedError();
  return res.url;
}

export async function runDrivePropertiesFlow(win, key) {
  await shellWebAPI.drivePropertiesDialog.call({ sender: win }, key);
}

export async function exportDriveToFilesystem(sourceUrl, targetPath) {
  const drive = await hyper.drives.getOrLoadDrive(sourceUrl);
  return _exportToFs(drive.drive, '/', targetPath, { overwriteExisting: true });
}

export async function importFilesystemToDrive(srcPath, targetUrl, { preserveFolder } = { preserveFolder: false }) {
  const targetUrlp = new URL(targetUrl);
  const drive = await hyper.drives.getOrLoadDrive(targetUrlp.hostname);
  return _importFsFolder(drive.drive, srcPath, targetUrlp.pathname || '/', { inplace: !preserveFolder });
}

// internal helpers
// =

async function _importFsFolder(drive, srcPath, dstPath, { ignore = [], inplace = true } = {}) {
  const ignoreSet = new Set(ignore);
  const entries = await nodefs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreSet.has(entry.name)) continue;
    const fullSrc = joinPath(srcPath, entry.name);
    const fullDst = (dstPath.endsWith('/') ? dstPath : dstPath + '/') + entry.name;
    if (entry.isDirectory()) {
      await _importFsFolder(drive, fullSrc, fullDst, { ignore, inplace });
    } else if (entry.isFile()) {
      const buf = await nodefs.readFile(fullSrc);
      await drive.put(fullDst, buf);
    }
  }
}

async function _exportToFs(drive, srcFolder, dstPath, { overwriteExisting = true } = {}) {
  await nodefs.mkdir(dstPath, { recursive: true });
  for await (const entry of drive.list(srcFolder, { recursive: true })) {
    const relPath = entry.key.slice(srcFolder.length).replace(/^\//, '');
    const dstFile = joinPath(dstPath, relPath);
    if (!overwriteExisting) {
      try { await nodefs.access(dstFile); continue; } catch {}
    }
    const buf = await drive.get(entry.key);
    if (buf) {
      await nodefs.mkdir(joinPath(dstFile, '..'), { recursive: true });
      await nodefs.writeFile(dstFile, buf);
    }
  }
}
