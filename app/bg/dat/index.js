import { app } from 'electron';
import * as childProcess from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import pda from 'pauls-dat-api2';
import hyper from '../hyper/index';
import * as filesystem from '../filesystem/index';
import * as prompts from '../ui/subwindows/prompts';

const tmpdirs = new Map();
export function getStoragePathFor(key) {
  if (tmpdirs.has(key)) return tmpdirs.get(key);
  tmpdirs.set(key, join(tmpdir(), 'dat', key));
  return tmpdirs.get(key);
}

const downloadPromises = new Map();
export async function downloadDat(key) {
  if (downloadPromises.has(key)) {
    return downloadPromises.get(key);
  }

  const storagePath = getStoragePathFor(key);
  rimraf.sync(storagePath);
  mkdirp.sync(storagePath);

  downloadPromises.set(
    key,
    runConvertProcess(app.getPath('userData'), key, storagePath)
  );

  return downloadPromises.get(key);
}

export async function convertDatArchive(win, key) {
  await downloadDat(key);

  const storagePath = getStoragePathFor(key);
  const drive = await hyper.drives.createNewDrive();

  // calculate size of import for progress
  let numFilesToImport = 0;
  let stats = await pda.exportFilesystemToArchive({
    srcPath: storagePath,
    dstArchive: drive.session.drive,
    dstPath: '/',
    inplaceImport: true,
    dryRun: true,
  });
  numFilesToImport += stats.fileCount;

  const prompt = await prompts.create(win.webContents, 'progress', {
    label: 'Converting dat...',
  });
  try {
    await pda.exportFilesystemToArchive({
      srcPath: storagePath,
      dstArchive: drive.session.drive,
      dstPath: '/',
      inplaceImport: true,
      progress(stats) {
        prompt.webContents.executeJavaScript(
          `updateProgress(${stats.fileCount / numFilesToImport}); undefined`
        );
      },
    });
  } finally {
    prompts.close(prompt.tab);
  }

  await drive.pda
    .rename('/dat.json', drive.session.drive, '/index.json')
    .catch((e) => undefined);
  await filesystem.configDrive(drive.url);

  return drive.url;
}

async function runConvertProcess(...args) {
  var fullModulePath = join(__dirname, 'bg', 'dat', 'converter', 'index.js');
  const opts = {
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: 1,
      ELECTRON_NO_ASAR: 1,
    }),
  };
  var proc = childProcess.fork(fullModulePath, args, opts);

  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', resolve);
  });
}
