export default {
  // Drive lifecycle
  createCollaborativeDrive: 'promise',
  isCollaborativeDrive: 'promise',
  loadDrive: 'promise',
  getInfo: 'promise',
  configure: 'promise',

  // Read methods
  entry: 'promise',
  get: 'promise',
  list: 'promise',
  diff: 'promise',
  watch: 'readable',

  // Write methods
  put: 'promise',
  del: 'promise',
  mkdir: 'promise',
  rmdir: 'promise',
  copy: 'promise',
  rename: 'promise',
  updateMetadata: 'promise',
  deleteMetadata: 'promise',

  // Writer management
  createInvite: 'promise',
  claimInvite: 'promise',
  requestAccess: 'promise',
  listRequests: 'promise',
  approveRequest: 'promise',
  denyRequest: 'promise',
  removeWriter: 'promise',
  listWriters: 'promise',

  // v10 compat shims
  stat: 'promise',
  readFile: 'promise',
  writeFile: 'promise',
  unlink: 'promise',
  readdir: 'promise',
  symlink: 'promise',
  mount: 'promise',
  unmount: 'promise',
}
