export default {
  // status & listing
  getStatus: 'promise', // { hasVault, canJoin, thisDevice, deviceCount }
  getThisDevice: 'promise',
  listDevices: 'promise',
  listSpaces: 'promise',
  getSyncStatus: 'promise',

  // adding devices (member side)
  createInvite: 'promise', // -> { code }
  listPendingRequests: 'promise',
  watchPendingRequests: 'readable',
  approveDevice: 'promise',
  denyDevice: 'promise',

  // joining (candidate side)
  submitInvite: 'promise',

  // managing
  renameDevice: 'promise',
  removeDevice: 'promise',

  // Reader and Notes data (bg/vault-apps.ts)
  readerState: 'promise', // -> { follows, read, writable, linked } for the caller's Space
  readerFollow: 'promise',
  readerUnfollow: 'promise',
  readerSaveRead: 'promise',
  listNotes: 'promise', // -> { notes, writable, linked }
  saveNote: 'promise', // ({ id?, body, baseUpdatedAt? }) -> note (a conflict copy on a conflict)
  deleteNote: 'promise',
  renameNoteLinks: 'promise', // ({ id, from, to }) -> number of notes changed
  watchAppData: 'readable', // 'changed' when the Vault changes

  // Names (bg/hyper/names.js)
  listNames: 'promise', // -> [{ name, url, title, createdAt, updatedAt }]
  namesForUrl: 'promise', // (url) -> the names that point to that page
  setName: 'promise', // ({ name, url, title, previous? }) -> record
  removeName: 'promise',
};
