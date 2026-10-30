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
  requestDriveEdit: 'promise', // (url, { note? }) -> the same, after asking the user's other Devices (and a shared Space's members)

  // Shared Spaces (bg/hyper/space-library.js, ADR-0029), for the caller's Space
  getSpaceShare: 'promise', // -> { spaceId, name, personal, shared, preview?, role, memberId, members, joins, requests, writable }
  shareSpace: 'promise', // ({ name }) -> share info
  createSpaceInvite: 'promise', // (role: 'editor' | 'viewer') -> { code, role }
  approveSpaceJoin: 'promise', // (memberId)
  denySpaceJoin: 'promise', // (memberId)
  setSpaceRole: 'promise', // (memberId, role)
  removeSpaceMember: 'promise', // (memberId)
  answerSpaceRequest: 'promise', // ({ drive, writerKey, approve })
  leaveSpace: 'promise',
  joinSpace: 'promise', // (code, { name }) -> { spaceId, name }, once an owner approves
  watchSpaceShare: 'readable', // 'changed'

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

  // AI Jobs (bg/ai/jobs.js, ADR-0030)
  listJobs: 'promise', // -> { jobs: [{ ...job, lastRun, nextRunAt, running, here, deviceName }] }
  listJobRuns: 'promise', // (id) -> runs, newest first
  saveJob: 'promise', // ({ id?, title?, prompt?, source?, schedule?, notify?, enabled?, runHere? }) -> record
  previewSchedule: 'promise', // (schedule) -> { schedule, when, next: [ISO, …] }: checked, with its next times
  checkJobSource: 'promise', // (id) -> { url, live, module, prompt, title, hash }: the source's drive now
  deleteJob: 'promise',
  runJob: 'promise', // (id) runs it now, on this Device
  watchJobs: 'readable', // 'changed' when a Job or a run changes, or a run starts

  // Open tabs on the user's other Devices (bg/ui/open-tabs.js)
  listDeviceTabs: 'promise', // -> { devices: [{ deviceKey, name, platform, connected, updatedAt, spaces }], linked, sharing, currentSpace }
};
