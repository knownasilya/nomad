// The canonical beaker.fs API surface — the single source of truth for the method list, shared by
// BOTH runtimes (ADR-0010). Desktop imports it as the pauls-electron-rpc manifest; mobile references
// it when wiring its WebView `window.beaker.fs` shim + Bare-backend dispatcher. Pure data (no
// platform deps), so it resolves under Electron/Node, Bare, and RN/Metro alike.
//
// Value is the RPC call type: 'promise' (async → value) or 'readable' (returns an event stream).
// Keep in sync with app/bg/web-apis/bg/fs.js (impl), fg/fs.js (desktop shim), and the mobile shim
// (mobile/lib/types.ts BEAKER_SHIM + mobile/backend/backend.mjs dispatchBeaker).

/** The RPC call type for a `beaker.fs` method. @typedef {'promise' | 'readable'} RpcCallType */

/** @satisfies {Record<string, RpcCallType>} */
export default {
  getInfo: 'promise',

  // Read
  entry: 'promise',
  stat: 'promise',
  get: 'promise',
  readFile: 'promise',
  list: 'promise',
  readdir: 'promise',
  query: 'promise',
  diff: 'promise',

  // Write
  put: 'promise',
  writeFile: 'promise',
  del: 'promise',
  unlink: 'promise',
  mkdir: 'promise',
  rmdir: 'promise',
  copy: 'promise',
  rename: 'promise',
  updateMetadata: 'promise',
  deleteMetadata: 'promise',
  mount: 'promise',
  unmount: 'promise',
  symlink: 'promise',

  // Bulk filesystem import/export
  importFromFilesystem: 'promise',
  exportToFilesystem: 'promise',
  exportToDrive: 'promise',

  // Change notifications
  watch: 'readable',

  // Drive lifecycle
  createDrive: 'promise',
  createCollaborativeDrive: 'promise',
  forkDrive: 'promise',
  loadDrive: 'promise',
  configure: 'promise',
  isCollaborativeDrive: 'promise',

  // Collaborative-drive writer management
  createInvite: 'promise',
  claimInvite: 'promise',
  requestAccess: 'promise',
  listRequests: 'promise',
  watchRequests: 'readable',
  approveRequest: 'promise',
  denyRequest: 'promise',
  removeWriter: 'promise',
  listWriters: 'promise',
};
