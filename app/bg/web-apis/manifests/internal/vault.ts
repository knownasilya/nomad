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

  // Always-on Peers (ADR-0038): a Peer pairs like a Device but never writes
  listPeers: 'promise', // -> [{ key, name, kind, hold, online, status, summary, spaces: [{ rootDriveKey, name, kept }] }]
  setPeerSpace: 'promise', // (peerKey, rootDriveKey, on)
  renamePeer: 'promise', // (peerKey, name)
  removePeer: 'promise', // (peerKey)

  // Editing a Drive another of the user's Devices can write (bg/hyper/drive-writers.js)
  driveEditStatus: 'promise', // (url) -> { writable, canAsk, legacy, linked, request: { pending, granted } | null }
  requestDriveEdit: 'promise', // (url, { note? }) -> the same, after asking the user's other Devices (and a shared Space's members)

  // Shared Spaces (bg/hyper/space-library.js, ADR-0029), for the caller's Space
  getSpaceShare: 'promise', // -> { spaceId, name, personal, shared, preview?, role, memberId, members, joins, requests, writable }
  shareSpace: 'promise', // ({ name }) -> share info
  setUpHome: 'promise', // ({ name?, ownName? }) -> { spaceId, name }: a new shared Space with a Groceries list and House info
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
  readerState: 'promise', // -> { follows, read, webRead, articles, postTopics, ai, writable, linked } for the caller's Space
  readerFollow: 'promise',
  readerUnfollow: 'promise',
  readerSaveRead: 'promise',
  // Saved articles (bg/reader-articles.ts, ADR-0033): any web page, with topics the AI picks
  readerSaveArticle: 'promise', // (url, { read? }) -> { article, state }
  readerUpdateArticle: 'promise', // (id, { topics?, read? }) -> state
  readerDeleteArticle: 'promise', // (id) -> state
  readerSuggestTopics: 'promise', // (ids?) -> state; asks the AI now (untagged ones when no ids)
  readerArticle: 'promise', // (id) -> { article, text } for the reading view
  readerRefetchArticle: 'promise', // (id) -> { article, text }, after loading the page again
  readerAddLink: 'promise', // (url) -> { followed?, article?, feeds?, state }: follows a feed, saves a page
  readerWebFeed: 'promise', // (url, { fresh? }) -> { url, title, siteUrl, posts } for a followed RSS/Atom feed
  readerTagPosts: 'promise', // (posts, urls?) -> state; the AI sorts recent feed posts into topics
  readerSetPostTopics: 'promise', // (url, topics) -> state
  listNotes: 'promise', // -> { notes, space, spaceName, writable, linked, ai }; each note has `space` (key or null)
  saveNote: 'promise', // ({ id?, body, baseUpdatedAt?, inSpace? }) -> note (a conflict copy on a conflict)
  moveNote: 'promise', // ({ id, inSpace }) -> note, moved into the caller's Space or out to every Space
  deleteNote: 'promise',
  renameNoteLinks: 'promise', // ({ id, from, to }) -> number of notes changed
  setNoteTopics: 'promise', // ({ id, topics }) -> note, its topics set by hand (ADR-0035)
  setNoteTick: 'promise', // ({ id, text, checked }) -> note, who ticked an item noted in a shared Space
  // The Calendar (bg/web-apis/bg/calendar.ts, shared/calendar.mjs), for the caller's Space
  listCalendar: 'promise', // ({ from?, to? }) -> { space, spaceName, shared, canWriteSpace, events, feeds, occurrences }
  saveCalendarEvent: 'promise', // ({ id?, title, start, end?, allDay?, location?, notes?, repeat?, inSpace? }) -> event
  deleteCalendarEvent: 'promise', // (id) -> boolean
  saveCalendarFeed: 'promise', // ({ id?, url, name?, color?, inSpace? }) -> feed, fetched once. url: an iCal link or a calendar drive's hyper:// address
  deleteCalendarFeed: 'promise', // (id) -> boolean
  refreshCalendarFeeds: 'promise', // ({ force? }) -> listCalendar(), after fetching the feeds that are due
  listCalendarDrives: 'promise', // () -> [{ url, name, color }]: calendar drives in the caller's Space not followed yet
  // The family album (bg/web-apis/bg/photos.ts, shared/photos.mjs), for the caller's shared Space
  listPhotos: 'promise', // () -> { space, spaceName, shared, canAdd, role, photos }
  photoData: 'promise', // (id, { thumb? }) -> data:image/jpeg URL, or null until it replicates
  addPhoto: 'promise', // ({ photo, thumb (base64 JPEG), width, height, takenAt?, caption? }) -> photo
  setPhotoCaption: 'promise', // ({ id, caption }) -> photo
  deletePhoto: 'promise', // (id) -> boolean
  suggestNoteTopics: 'promise', // (ids?) -> how many notes the AI will sort into topics
  watchAppData: 'readable', // 'changed' when the Vault changes
  openLiveNote: 'readable', // (id, conn) -> 'message' { data } (y-protocols, base64), 'status', 'failed' (ADR-0041)
  liveNoteSend: 'promise', // (id, conn, data) -> whether the session took it

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

  // AI memory (bg/ai/memory.js, ADR-0032): nomad://ai/memory
  listMemories: 'promise', // ({ query? }) -> { memories: [{ id, text, by, createdAt, updatedAt }], enabled, max }
  saveMemory: 'promise', // ({ id?, text }) -> record; a user's edit, so `by` is 'user'
  deleteMemory: 'promise', // (id)
  clearMemories: 'promise', // () -> how many were deleted

  // AI skills (bg/ai/skills.js, ADR-0034): nomad://ai/skills
  listSkills: 'promise', // ({ query? }) -> { skills: [{ id, name, description, instructions, enabled, createdAt, updatedAt }], max, limits }
  saveSkill: 'promise', // ({ id?, name?, description?, instructions?, enabled? }) -> record
  deleteSkill: 'promise', // (id)
  parseSkillMd: 'promise', // (text) -> { name, description, instructions }
  exportSkill: 'promise', // (id) -> SKILL.md text

  // AI Jobs (bg/ai/jobs.js, ADR-0030)
  listJobs: 'promise', // -> { jobs: [{ ...job, lastRun, nextRunAt, running, here, deviceName }] }
  listJobRuns: 'promise', // (id) -> runs, newest first, with deviceName and took
  clearJobRuns: 'promise', // (id) -> how many runs were deleted, on every Device
  saveJob: 'promise', // ({ id?, title?, prompt?, source?, writes?, schedule?, notify?, enabled?, runHere? }) -> record
  previewSchedule: 'promise', // (schedule) -> { schedule, when, next: [ISO, …] }: checked, with its next times
  checkJobSource: 'promise', // (id) -> { url, live, module, prompt, title, hash }: the source's drive now
  deleteJob: 'promise',
  runJob: 'promise', // (id, { watch? }) runs it now, on this Device; watch: in a tab the user watches (Run with me)
  viewJob: 'promise', // (id, { chat? }) opens a running Job's chat in the AI Sidebar and shows its page; after, a run's chat
  watchJobs: 'readable', // 'changed' when a Job or a run changes, or a run starts

  // Open tabs on the user's other Devices (bg/ui/open-tabs.js)
  listDeviceTabs: 'promise', // -> { devices: [{ deviceKey, name, platform, connected, updatedAt, spaces }], linked, sharing, currentSpace }
};
