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

  // Editing a Drive another of the user's Devices can write (bg/hyper/drive-writers.js)
  driveEditStatus: 'promise', // (url) -> { writable, canAsk, legacy, linked, request: { pending, granted } | null }
  requestDriveEdit: 'promise', // (url) -> the same, after asking the user's other Devices

  // Reader and Notes data (bg/vault-apps.ts)
  readerState: 'promise', // -> { follows, read, writable, linked } for the caller's Space
  readerFollow: 'promise',
  readerUnfollow: 'promise',
  readerSaveRead: 'promise',
  listNotes: 'promise', // -> { notes, space, spaceName, writable, linked }; each note has `space` (key or null)
  saveNote: 'promise', // ({ id?, body, baseUpdatedAt?, inSpace? }) -> note (a conflict copy on a conflict)
  moveNote: 'promise', // ({ id, inSpace }) -> note, moved into the caller's Space or out to every Space
  deleteNote: 'promise',
  renameNoteLinks: 'promise', // ({ id, from, to }) -> number of notes changed
  watchAppData: 'readable', // 'changed' when the Vault changes

  // Names (bg/hyper/names.js)
  listNames: 'promise', // -> [{ name, url, title, space, hidden?, createdAt, updatedAt }]
  getNamesSpace: 'promise', // -> { space, spaceName } of the caller
  namesForUrl: 'promise', // (url) -> the names that point to that page
  setName: 'promise', // ({ name, url, title, inSpace?, previous?, previousInSpace? }) -> record
  removeName: 'promise', // (name, { inSpace? })

  // Mods (bg/ui/mods.js, ADR-0023)
  listMods: 'promise', // -> { mods, presets: [{ id, label, description }] }
  saveMod: 'promise', // ({ id?, name?, site?, enabled?, presets?, hide?, css?, js? }) -> record
  deleteMod: 'promise',

  // Open tabs on the user's other Devices (bg/ui/open-tabs.js)
  listDeviceTabs: 'promise', // -> { devices: [{ deviceKey, name, platform, connected, updatedAt, spaces }], linked, sharing, currentSpace }
};
