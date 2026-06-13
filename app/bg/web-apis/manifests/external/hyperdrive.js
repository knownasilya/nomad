export default {
  loadDrive: 'promise',
  createDrive: 'promise',
  forkDrive: 'promise',

  getInfo: 'promise',
  configure: 'promise',
  diff: 'promise',

  // v11 API
  entry: 'promise',
  get: 'promise',
  put: 'promise',
  del: 'promise',
  list: 'promise',

  mkdir: 'promise',
  rmdir: 'promise',
  copy: 'promise',
  rename: 'promise',
  updateMetadata: 'promise',
  deleteMetadata: 'promise',

  query: 'promise',
  watch: 'readable',

  beakerDiff: 'promise',
  beakerMerge: 'promise',
  importFromFilesystem: 'promise',
  exportToFilesystem: 'promise',
  exportToDrive: 'promise',

  // v10 compat shims
  stat: 'promise',
  readFile: 'promise',
  writeFile: 'promise',
  unlink: 'promise',
  readdir: 'promise',
  symlink: 'promise',
  mount: 'promise',
  unmount: 'promise',
  createNetworkActivityStream: 'readable',
};
