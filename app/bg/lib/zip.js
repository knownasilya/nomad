import yazl from 'yazl';

/**
 * @param {Object} drive - Hyperdrive v11 session
 * @param {string} [dirpath = '/']
 * @returns {import('stream').Readable}
 */
export const toZipStream = function (drive, dirpath = '/') {
  var zipfile = new yazl.ZipFile();

  ;(async () => {
    for await (const entry of drive.drive.list(dirpath, { recursive: true })) {
      const relPath = entry.key.slice(dirpath.endsWith('/') ? dirpath.length : dirpath.length + 1);
      const buf = await drive.drive.get(entry.key);
      if (buf) zipfile.addBuffer(buf, relPath);
    }
    zipfile.end();
  })().catch((e) => {
    console.error('Error while producing zip stream', e);
    zipfile.outputStream.emit('error', e);
  });

  return zipfile.outputStream;
};
