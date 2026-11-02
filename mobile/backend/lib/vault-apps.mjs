import b4a from 'b4a'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as apps from '../../../shared/vault-apps.mjs'
import * as ra from '../../../shared/reader-articles.mjs'
import * as nt from '../../../shared/note-topics.mjs'
import { parseWebFeed, isFeedXml, findFeedLinks } from '../../../shared/web-feeds.mjs'
import * as names from '../../../shared/names.mjs'
import * as ot from '../../../shared/open-tabs.mjs'
import * as jl from '../../../shared/jobs.mjs'
import * as sl from '../../../shared/space-library.mjs'
import * as du from '../../../shared/device-updates.mjs'
import * as pe from '../../../shared/personas.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { parseHyperUrl } from './hyper-url.mjs'
import { DRIVE_AUTOBASE, DRIVE_HYPERDRIVE } from '../../rpc-commands.mjs'

// The phone's Reader, Notes, Names (ADR-0017, ADR-0018) and AI Jobs (ADR-0030). They read and write the same Vault records as desktop's
// nomad://reader and nomad://notes (shared/vault-apps.mjs), so a subscription or a note made on one
// Device shows on the others. The phone only has this data once it is linked: with no Vault there is
// nothing here, and the UI points the user to Devices.
//
// `base` is the opened Vault Autobase (backend.mjs `vault`). `space` is the Root Drive key of the
// Space the Reader shows: each Space has its own subscriptions.

async function readRecord (base, path) {
  const node = await base.view.get(path)
  return node ? decodeInlineJson(node.value, b4a) : null
}

async function readPrefix (base, prefix) {
  const out = []
  for await (const node of base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    if (rec) out.push(rec)
  }
  return out
}

function assertWritable (base) {
  if (!base.writable) {
    throw new Error('This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
  }
}

async function putRecord (base, path, obj) {
  assertWritable(base)
  await base.append(inlineOp(path, obj))
  await base.update()
}

async function delRecord (base, path) {
  assertWritable(base)
  await base.append({ op: 'del', path })
  await base.update()
}

// Shared Spaces (ADR-0029)
// =
//
// A shared Space's feeds, Notes and Names are in its Space Library, not the Vault. backend.mjs
// hands in `libraryOf(space)` (lib/space-library.mjs libraryFor), which gives the open Library of a
// shared Space, or null. With none set, everything is in the Vault.

let libraryOf = async () => null
export function useSpaceLibraries (fn) {
  libraryOf = fn || (async () => null)
}

const KINDS = {
  notes: { vault: apps.notesPrefix, lib: sl.LIB_NOTES },
  names: { vault: names.namesPrefix, lib: sl.LIB_NAMES },
  follows: { vault: apps.followsPrefix, lib: sl.LIB_FOLLOWS }
}

// Where a Space's own records of `kind` are: its Space Library once shared, else the Vault. `at`
// turns the record's Vault path into its path there. The user's own (`space` null) are in the Vault.
async function placeOf (base, space, kind) {
  const vaultPrefix = KINDS[kind].vault(space)
  const lib = space ? await libraryOf(space).catch(() => null) : null
  if (!lib) return { base, prefix: vaultPrefix, at: (p) => p, shared: false, writable: !!base.writable }
  return {
    base: lib.base,
    prefix: KINDS[kind].lib,
    at: (p) => KINDS[kind].lib + p.slice(vaultPrefix.length),
    shared: true,
    writable: !!lib.base.writable
  }
}

const readAt = (place, path) => readRecord(place.base, place.at(path))

async function putAt (place, path, obj) {
  if (place.shared && !place.writable) throw new Error('You can view this Space, but not change it')
  await putRecord(place.base, place.at(path), obj)
}

async function delAt (place, path) {
  if (place.shared && !place.writable) throw new Error('You can view this Space, but not change it')
  await delRecord(place.base, place.at(path))
}

// Reader
// =

// `canFollow` is false in a shared Space this person can only view. Read marks are always theirs.
export async function readerState (base, space) {
  await boundedUpdate(base)
  const place = await placeOf(base, space, 'follows')
  if (place.shared) await boundedUpdate(place.base, 2000)
  return {
    follows: apps.followUrls(await readPrefix(place.base, place.prefix)),
    read: (await readRecord(base, apps.readPath(space)))?.read || [],
    // RSS and Atom items read, per feed.
    webRead: (await readRecord(base, apps.webReadPath(space)))?.read || {},
    // Topics the computer's AI (or the user) gave feed posts.
    postTopics: (await readPrefix(base, ra.postTopicsPrefix(space))).filter(ra.isPostTopics),
    // Pages saved to Reader on a computer (ADR-0033): the user's own, always in the Vault.
    articles: ra.sortArticles(await readPrefix(base, ra.articlesPrefix(space))),
    writable: !!base.writable,
    shared: place.shared,
    canFollow: place.writable
  }
}

export async function follow (base, space, url) {
  const path = apps.followPath(space, url) // throws for a non-hyper address
  const place = await placeOf(base, space, 'follows')
  if (!(await readAt(place, path))) await putAt(place, path, apps.followRecord(url))
  return readerState(base, space)
}

export async function unfollow (base, space, url) {
  const place = await placeOf(base, space, 'follows')
  const prefix = apps.followsPrefix(space)
  for (const file of apps.unfollowFiles(await readPrefix(place.base, place.prefix), url)) await delAt(place, prefix + file)
  return readerState(base, space)
}

// Merges with what other Devices marked read; see mergeReadState for what it prunes.
// RSS and Atom items go to web-read.json, under the loaded feed that lists them.
export async function saveRead (base, space, add = [], loaded = {}) {
  const { follows, read, webRead } = await readerState(base, space)
  const next = apps.mergeReadState(read, add, follows, loaded)
  if (!(next.length === read.length && next.every((u, i) => u === read[i]))) await putRecord(base, apps.readPath(space), { read: next })
  if (follows.some(apps.isWebFeed)) {
    const web = apps.mergeWebRead(webRead, add, follows, loaded)
    if (JSON.stringify(web) !== JSON.stringify(webRead)) await putRecord(base, apps.webReadPath(space), { read: web })
  }
  return readerState(base, space)
}

// An RSS or Atom feed's text, fetched by the app (the backend has no web fetch): the feed and its
// posts. For a web page, the feeds it links to instead: { feeds: [{ url, title }] }.
export function parseFeed (url, text) {
  const key = apps.webFeedUrl(url)
  if (!key) throw new Error('Not an RSS or Atom feed’s address')
  if (isFeedXml(text)) return parseWebFeed(text, key)
  const feeds = findFeedLinks(text, key)
  if (!feeds.length) throw new Error('No RSS or Atom feed at that address')
  return { feeds }
}

// Mark a saved article read or unread.
export async function markArticle (base, space, id, read = true) {
  const path = ra.articlePath(space, id)
  const rec = await readRecord(base, path)
  if (!ra.isArticle(rec)) throw new Error('That article isn’t in Reader any more')
  const next = ra.withRead(rec, read)
  if (next !== rec) await putRecord(base, path, next)
  return readerState(base, space)
}

// One Feed and its posts, newest first — the same reading desktop's Reader does over nomad.fs. New
// Drives are Autobases; an older Feed may be a Hyperdrive, so that is the second try.
export async function loadFeed (manager, url) {
  const root = apps.driveRoot(url)
  if (!root) throw new Error('Not a hyper:// address')
  const { key, keyHex } = parseHyperUrl(root)

  let type = DRIVE_AUTOBASE
  let manifest = await manager.bridgeRead(type, key, '/index.json').catch(() => null)
  if (manifest == null) {
    manager.release(DRIVE_AUTOBASE, keyHex)
    type = DRIVE_HYPERDRIVE
    manifest = await manager.bridgeRead(type, key, '/index.json').catch(() => null)
  }
  if (manifest == null) {
    manager.release(DRIVE_HYPERDRIVE, keyHex)
    throw new Error('Can’t reach this feed')
  }

  const feed = JSON.parse(manifest)
  const itemsPath = ensureDir(feed.itemsPath || '/posts/')
  const title = feed.title || root
  const posts = []
  for (const k of await manager.bridgeListKeys(type, key, itemsPath)) {
    if (!k.endsWith('/post.json')) continue
    try {
      const meta = JSON.parse(await manager.bridgeRead(type, key, k))
      if (meta.draft) continue
      const slug = k.slice(itemsPath.length).replace(/\/post\.json$/, '')
      posts.push({
        title: meta.title || slug,
        summary: meta.summary || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        createdAt: meta.createdAt || '',
        url: root + itemsPath.slice(1) + slug + '/',
        feedUrl: root,
        feedTitle: title
      })
    } catch {}
  }
  posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return { url: root, title, posts }
}

function ensureDir (p) {
  if (!p.startsWith('/')) p = '/' + p
  if (!p.endsWith('/')) p = p + '/'
  return p
}

// Notes
// =
//
// A Note is the user's (every Space) or one Space's (ADR-0029), as on desktop
// (app/bg/web-apis/bg/vault-apps.ts). Each Note handed to the UI carries `space`: the Space's key,
// or null for the user's. It isn't stored: the path says where it is. `space` below is the active
// Space's Root Drive key.

// The UI gets each Note with its list title and preview, so the phone uses the same definition as
// desktop (shared/vault-apps.mjs) without its React Native bundle reaching outside mobile/.
function withPreview (note) {
  return { ...note, title: apps.noteTitle(note.body), snippet: apps.noteSnippet(note.body) }
}

const spaceOrNull = (space) => (apps.isSpaceKey(space) ? space : null)
const withSpace = (space) => (note) => ({ ...note, space: space || null })
const stored = ({ space, title, snippet, ...note }) => note

async function notesIn (base, space = null) {
  const place = await placeOf(base, space, 'notes')
  return (await readPrefix(place.base, place.prefix)).filter(apps.isNote).map(withSpace(space))
}

// A Note's record, wherever its Space keeps it (`space` null: the user's own).
async function getNote (base, id, space) {
  return readAt(await placeOf(base, space, 'notes'), apps.notePath(id, space))
}

async function putNote (base, id, space, note) {
  await putAt(await placeOf(base, space, 'notes'), apps.notePath(id, space), note)
}

async function delNote (base, id, space) {
  await delAt(await placeOf(base, space, 'notes'), apps.notePath(id, space))
}

// The Notes a Space sees, newest first: the user's, and the Space's own.
async function allNotes (base, space = null) {
  space = spaceOrNull(space)
  return apps.sortNotes([...(await notesIn(base, null)), ...(space ? await notesIn(base, space) : [])])
}

// Where the Note `id` is stored: { space, prev }, looking in the user's Notes, then the Space's.
async function findStored (base, id, space) {
  const own = await readRecord(base, apps.notePath(id))
  if (own) return { space: null, prev: own }
  space = spaceOrNull(space)
  if (space) {
    const theirs = await getNote(base, id, space)
    if (theirs) return { space, prev: theirs }
  }
  return { space: null, prev: null }
}

// In a shared Space, `shared` is true and `canWriteSpace` says whether this person can write its Notes.
export async function listNotes (base, space = null) {
  await boundedUpdate(base)
  space = spaceOrNull(space)
  const place = space ? await placeOf(base, space, 'notes') : null
  if (place?.shared) await boundedUpdate(place.base, 2000)
  return {
    notes: (await allNotes(base, space)).map(withPreview),
    space,
    writable: !!base.writable,
    shared: !!place?.shared,
    canWriteSpace: place ? place.writable : !!base.writable
  }
}

// Create (no id) or update a Note, and return the stored Note. `baseUpdatedAt` is the updatedAt of
// the version the editor started from: if another Device saved the Note since, this edit is kept as
// a conflict copy (a new Note with conflictOf), which is returned instead (shared planNoteSave). A
// new Note is the Space's when `inSpace` is true, else the user's; an existing one stays where it is.
export async function saveNote (base, { id, body, baseUpdatedAt, inSpace = false, space = null } = {}) {
  space = spaceOrNull(space)
  const found = id ? await findStored(base, id, space) : { space: null, prev: null }
  const where = found.prev ? found.space : inSpace && space ? space : null
  const { note, write } = apps.planNoteSave({ id, body, baseUpdatedAt }, found.prev)
  if (write) await putNote(base, note.id, where, note)
  return withPreview(withSpace(where)(note))
}

export async function deleteNote (base, id, space = null) {
  const found = await findStored(base, id, space) // notePath validates the id
  if (found.prev) await delNote(base, id, found.space)
}

// Move a Note into the Space (`inSpace` true) or out to the user's Notes. Returns it.
export async function moveNote (base, { id, inSpace = false, space = null } = {}) {
  space = spaceOrNull(space)
  const found = await findStored(base, id, space)
  if (!found.prev) throw new Error('No note with that id')
  const to = inSpace ? space : null
  if (inSpace && !to) throw new Error('This Space isn’t ready yet')
  if (to === found.space) return withPreview(withSpace(to)(found.prev))
  await putNote(base, id, to, found.prev)
  await delNote(base, id, found.space)
  return withPreview(withSpace(to)(found.prev))
}

// Set a Note's topics by hand (ADR-0035, shared/note-topics.mjs): the AI on a computer leaves them
// alone after this. Its updatedAt stays, so it isn't taken for an edit. Returns the Note.
export async function setNoteTopics (base, { id, topics, space = null } = {}) {
  space = spaceOrNull(space)
  const found = await findStored(base, id, space) // notePath validates the id
  if (!found.prev) throw new Error('No note with that id')
  const note = nt.withNoteTopics(found.prev, topics, 'user', nt.knownNoteTopics(await allNotes(base, space)))
  await putNote(base, id, found.space, note)
  return withPreview(withSpace(found.space)(note))
}

// A Note's title changed: point the other Notes' links at the new title. Returns how many changed.
// Covers the Notes the Space sees: the user's and the Space's.
export async function renameNoteLinks (base, { id, from, to, space = null } = {}) {
  const changes = apps.linkRenames(await allNotes(base, space), id, from, to)
  for (const { note, body } of changes) {
    await putNote(base, note.id, note.space, apps.makeNote({ id: note.id, body }, stored(note)))
  }
  return changes.length
}

// Names (ADR-0018)
// =
//
// The user's short names for drives and URLs, the same records desktop's app/bg/hyper/names.js
// keeps (rules in shared/names.mjs): the user's own in /.vault/names/, and a Space's own in its
// Space Library records (ADR-0029). In a Space the user's own name wins over the Space's with the
// same word, which is then `hidden`. The phone resolves hyper://<name>/ where the user navigates
// (the address bar and links in a page), never for a page's own reads, as on desktop. These read
// the view as it is, without waiting on an update, so a navigation never stalls.

async function namesIn (base, space = null) {
  const place = await placeOf(base, space, 'names')
  return (await readPrefix(place.base, place.prefix)).filter(names.isNameRecord)
}

// Every name the Space sees, with `space` on each, and `hidden` on a Space name the user's own hides.
async function allNames (base, space = null) {
  space = spaceOrNull(space)
  return names.namesInSpace(await namesIn(base, null), space ? await namesIn(base, space) : [], space)
}

async function visibleNames (base, space) {
  return (await allNames(base, space)).filter((r) => !r.hidden)
}

async function readName (base, name, space = null) {
  if (names.nameError(name)) return null
  const rec = await readAt(await placeOf(base, space, 'names'), names.namePath(name, space))
  return names.isNameRecord(rec) ? rec : null
}

export async function listNames (base, space = null) {
  await boundedUpdate(base)
  space = spaceOrNull(space)
  const place = space ? await placeOf(base, space, 'names') : null
  return {
    names: await allNames(base, space),
    space,
    writable: !!base.writable,
    shared: !!place?.shared,
    canWriteSpace: place ? place.writable : !!base.writable
  }
}

// Where the address bar entry `input` goes, or null when it isn't a name. "blog", "hyper://blog/"
// and "hyper://blog/posts/" all count, as typing a name and pressing Enter does on desktop.
export async function resolveName (base, input, space = null) {
  const s = String(input || '').trim()
  const url = /^[a-z0-9-]+\/?$/i.test(s) ? `hyper://${s.replace(/\/$/, '')}/` : s
  const m = /^hyper:\/\/([a-z0-9-]+)(?:[/?#]|$)/i.exec(url)
  if (!m) return null
  const word = m[1].toLowerCase()
  space = spaceOrNull(space)
  const rec = (await readName(base, word)) || (space ? await readName(base, word, space) : null)
  return rec ? names.resolveNamedUrl(url, () => rec) : null
}

// The page at `url`: `approved` is the user's own name for it, the one the address bar shows (a name
// the AI gave doesn't count until the user keeps it); `named` are the names that point to it, AI's
// included, for the name sheet; `suggested` is a name to offer for a page titled `title`.
export async function namesForUrl (base, url, title = '', space = null) {
  const all = await visibleNames(base, space)
  const target = names.nameTarget(url)
  return {
    approved: names.approvedNameFor(url, all),
    named: all.filter((r) => r.url === target || r.url === url),
    suggested: names.suggestName(title),
    space: spaceOrNull(space),
    writable: !!base.writable
  }
}

// The names that match what's typed in the address bar, best first.
export async function matchNames (base, query, limit = 5, space = null) {
  return names.matchNames(query, await visibleNames(base, space), limit)
}

// Give the page at `url` the name `name`, as desktop's site-info panel does: the name is tidied,
// a drive page names its folder, and `previous` is the name being changed. `inSpace` keeps it only
// in the Space, and `previousInSpace` says where `previous` is. A name saved here is the user's, so
// it drops the AI's `auto` mark. Refuses a name that already points somewhere else in that place.
export async function setName (base, { name, url, title, previous, inSpace = false, previousInSpace = false, space = null } = {}) {
  const clean = names.normalizeName(name)
  const err = names.nameError(clean)
  if (err) throw new Error(err)
  space = spaceOrNull(space)
  const where = inSpace ? space : null
  if (inSpace && !where) throw new Error('This Space isn’t ready yet')
  const from = previousInSpace ? space : null
  const target = names.nameTarget(url)
  const existing = await readName(base, clean, where)
  const same = previous === clean && from === where
  if (existing && existing.url !== target && !same) {
    throw new Error(`“${clean}” already names ${existing.title || existing.url}`)
  }
  const rec = names.makeNameRecord({ name: clean, url: target, title }, existing)
  await putAt(await placeOf(base, where, 'names'), names.namePath(clean, where), rec)
  if (previous && !same && (await readName(base, previous, from))) {
    await delAt(await placeOf(base, from, 'names'), names.namePath(previous, from))
  }
  return { ...rec, space: where }
}

export async function removeName (base, name, { inSpace = false, space = null } = {}) {
  const where = inSpace ? spaceOrNull(space) : null
  if (inSpace && !where) throw new Error('This Space isn’t ready yet')
  await delAt(await placeOf(base, where, 'names'), names.namePath(name, where))
}

// Open tabs (shared/open-tabs.mjs)
// =

function ownKey (base) {
  return base.local?.key ? b4a.toString(base.local.key, 'hex') : null
}

// Write this phone's open tabs ([{ rootDriveKey, name, tabs }]) to its own record, or delete the
// record when `off`. Like desktop's bg/ui/open-tabs.js: only with a writable Vault, only once another
// Device is in it, and never a write that changes nothing. Returns true when it wrote.
export async function publishTabs (base, spaces, off = false) {
  const key = ownKey(base)
  if (!key || !base.writable) return false
  await boundedUpdate(base)
  const path = ot.recordPath(key)
  const existing = await readRecord(base, path)
  if (off) {
    if (!existing) return false
    await delRecord(base, path)
    return true
  }
  if (!existing) {
    const others = (await readPrefix(base, '/.vault/devices/')).filter((d) => d.key && d.key !== key)
    if (!others.length) return false
  }
  if (ot.sameTabs(existing, spaces)) return false
  await putRecord(base, path, ot.buildRecord(key, spaces))
  return true
}

// The other Devices' open tabs, `space` (a Root Drive key) first. `connected` is a Set of keys.
export async function listDeviceTabs (base, space, connected) {
  await boundedUpdate(base)
  const devices = await readPrefix(base, '/.vault/devices/')
  return {
    devices: ot.otherDevicesTabs(await readPrefix(base, ot.OPEN_TABS_PREFIX), {
      ownKey: ownKey(base),
      devices,
      connected,
      currentSpace: space || null
    }),
    linked: devices.length > 1,
    currentSpace: space || null
  }
}

// AI Jobs (shared/jobs.mjs, ADR-0030)
// =
// A desktop runs them; the phone lists them and their runs, pauses, deletes and asks for a run, and
// shows a notification for each new run that has one (lib/useJobNotifications.ts).

async function deviceNames (base) {
  const own = ownKey(base)
  const devices = await readPrefix(base, '/.vault/devices/')
  const names = new Map(devices.filter((d) => d && d.key).map((d) => [d.key, d.name || 'Device']))
  return (key) => (key && key === own ? 'This phone' : names.get(key) || 'A removed device')
}

// The user's own name for a drive (hyper://<key>/), from their Names, or null.
async function driveNamer (base) {
  const recs = await namesIn(base, null).catch(() => [])
  const byDrive = new Map()
  for (const r of recs) {
    const m = /^hyper:\/\/([0-9a-z]{52,64})\/?$/i.exec(String(r.url || ''))
    if (m && !byDrive.has(m[1].toLowerCase())) byDrive.set(m[1].toLowerCase(), r.title || r.name)
  }
  return (url) => byDrive.get((/^hyper:\/\/([^/]+)/i.exec(url) || [])[1]?.toLowerCase()) || null
}

// Every Job with its newest run, when it next runs, its schedule in words, and its Device's name.
export async function listJobs (base) {
  await boundedUpdate(base)
  const [jobs, runs, nameOf] = await Promise.all([
    readPrefix(base, jl.JOBS_PREFIX),
    readPrefix(base, jl.RUNS_PREFIX),
    deviceNames(base)
  ])
  const requested = new Set((await readPrefix(base, jl.REQUESTS_PREFIX)).filter(jl.isRequest).map((r) => r.jobId))
  const driveName = await driveNamer(base)
  return {
    jobs: jl.jobsWithRuns(jobs, runs).map((j) => ({
      ...j,
      // What the Job may change, in words, with the user's name for each drive when they have one.
      canChange: jl.describeWrites(j.writes, driveName),
      // Where a drive Job comes from, without its copied files: the phone shows only that.
      source: j.source
        ? { url: j.source.url, live: !!j.source.live, copiedAt: j.source.copiedAt || null, newer: !!j.source.changed }
        : null,
      when: jl.describeSchedule(j.schedule),
      deviceName: nameOf(j.device),
      requested: requested.has(j.id)
    })),
    writable: !!base.writable
  }
}

// A Job's runs, newest first.
export async function jobRuns (base, jobId) {
  await boundedUpdate(base)
  return jl.sortRuns(await readPrefix(base, jl.runsPrefix(jobId)))
}

async function readJob (base, id) {
  const job = await readRecord(base, jl.jobPath(id))
  if (!jl.isJob(job)) throw new Error('That Job is gone')
  return job
}

// Pause or resume a Job, for every Device.
export async function setJobEnabled (base, id, enabled) {
  const job = await readJob(base, id)
  const rec = jl.makeJob({ enabled: !!enabled }, job)
  await putRecord(base, jl.jobPath(id), rec)
  return rec
}

// Ask the Job's Device to run it now. It runs when that Device sees the request, which may be later
// if it is asleep; the run then notifies as usual.
export async function requestJobRun (base, id) {
  await readJob(base, id)
  await putRecord(base, jl.requestPath(id), jl.makeRequest(id, ownKey(base)))
  return true
}

export async function deleteJob (base, id) {
  for (const r of await readPrefix(base, jl.runsPrefix(id))) {
    if (jl.isRun(r)) await delRecord(base, jl.runPath(id, r.id))
  }
  if (await readRecord(base, jl.requestPath(id))) await delRecord(base, jl.requestPath(id))
  await delRecord(base, jl.jobPath(id))
  return true
}

// Runs that finished after `since` with a notification, and the mark to keep (pendingNotifications).
export async function jobNotifications (base, since) {
  await boundedUpdate(base)
  const { notify, since: next } = jl.pendingNotifications(await readPrefix(base, jl.RUNS_PREFIX), since ?? null)
  // Whether any Job wants to notify, so the phone asks for the notification permission only then.
  const wants = (await readPrefix(base, jl.JOBS_PREFIX)).some((j) => jl.isJob(j) && j.notify !== 'never')
  return {
    notify: notify.map((r) => ({ id: r.id, jobId: r.jobId, title: r.notification.title, body: r.notification.body })),
    since: next,
    wants
  }
}

// Updating a computer from the phone (shared/device-updates.mjs)
// =
// The phone asks one of the user's computers to install the newest release and restart; the
// computer (desktop bg/remote-update.js) writes how it goes, and the phone shows that.

// The user's computers, each with its version, whether it runs an older one than `version` (this
// phone's), whether a request is waiting for it, and its update status in words.
export async function deviceUpdates (base, version) {
  await boundedUpdate(base)
  const own = ownKey(base)
  const [devices, requests, statuses] = await Promise.all([
    readPrefix(base, '/.vault/devices/'),
    readPrefix(base, du.REQUESTS_PREFIX),
    readPrefix(base, du.STATUS_PREFIX)
  ])
  const behind = new Set(du.behindDesktops(devices, { ownKey: own, version }).map((d) => d.key))
  const pendingOf = new Map(requests.filter(du.isRequest).map((r) => [r.device, r]))
  const statusOf = new Map(statuses.filter(du.isStatus).map((st) => [st.device, st]))
  const now = Date.now()
  return {
    desktops: devices
      .filter((d) => d && du.isDeviceKey(d.key) && d.key !== own && d.platform === 'desktop')
      .map((d) => {
        const pending = pendingOf.get(d.key) || null
        const status = statusOf.get(d.key) || null
        return {
          key: d.key,
          name: d.name || 'Computer',
          version: d.version || null,
          behind: behind.has(d.key),
          busy: !!pending || du.isBusy(status, now),
          state: status?.state || null,
          message: du.describeUpdate({ status, pending, deviceVersion: d.version || null }, now)
        }
      }),
    writable: !!base.writable
  }
}

// Ask a computer to update to at least `version` and restart. Replaces any request still waiting.
export async function requestDeviceUpdate (base, { device, version, prerelease = false }) {
  const devices = await readPrefix(base, '/.vault/devices/')
  if (!devices.some((d) => d && d.key === device)) throw new Error('That device isn’t linked anymore')
  const req = du.makeRequest({ device, version, prerelease, by: ownKey(base) })
  await putRecord(base, du.requestPath(device), req)
  return req
}

// Personas and Sessions (ADR-0031)
// =
// The phone makes, edits and deletes Personas like a computer does, picks the default and the Space's
// own, and lists and ends the Sessions sites hold. Every Device writes every Profile Drive (writer
// asks below). Logging in from the phone's WebView (nomad.session) comes later.

async function readPrefixEntries (base, prefix) {
  const out = []
  for await (const node of base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    const path = typeof node.key === 'string' ? node.key : b4a.toString(node.key)
    if (rec) out.push({ path, rec })
  }
  return out
}

// Everything the Personas screen shows, for the Space `space` (its Root Drive key).
export async function listPersonas (base, space) {
  await boundedUpdate(base)
  const [recs, def, spaces, sessions] = await Promise.all([
    readPrefix(base, pe.PERSONAS_PREFIX),
    readRecord(base, pe.DEFAULT_PATH),
    readPrefix(base, pe.SPACES_PREFIX),
    readPrefixEntries(base, pe.SESSIONS_PREFIX)
  ])
  const personas = pe.sortPersonas(recs.filter(pe.isPersona))
  const defaultId = def?.personaId && personas.some((p) => p.id === def.personaId) ? def.personaId : null
  const spaceRec = spaces.find((x) => x && x.rootDriveKey === space && !x.movedTo) || null
  const override = spaceRec?.persona && personas.some((p) => p.id === spaceRec.persona) ? spaceRec.persona : null
  const resolved = pe.resolvePersona({ spaceOverride: override, defaultId, personas })
  const spaceName = (key) => spaces.find((x) => x && x.rootDriveKey === key)?.name || (key === space ? 'this space' : 'another space')
  const live = sessions.filter(({ rec }) => pe.isSession(rec))
  return {
    personas: personas.map((p) => ({
      id: p.id,
      label: p.label,
      email: p.email || '',
      profileUrl: p.profileUrl,
      isDefault: p.id === defaultId,
      sessions: live.filter(({ rec }) => rec.personaId === p.id).length
    })),
    defaultId,
    spacePersonaId: override,
    resolvedId: resolved?.id || null,
    spaceKnown: !!spaceRec,
    sessions: pe.sortSessions(live.map(({ rec, path }) => ({ ...rec, path }))).map((s) => ({
      path: s.path,
      origin: s.origin,
      site: pe.shortOrigin(s.origin),
      personaLabel: personas.find((p) => p.id === s.personaId)?.label || 'A deleted Persona',
      spaceName: spaceName(s.space),
      thisSpace: s.space === space,
      perms: s.perms,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt || null,
      expired: pe.isExpired(s)
    })),
    writable: !!base.writable
  }
}

// Is the Vault writable from this phone? Checked before a Persona's profile drive is made, so a
// phone that can't save the record doesn't leave an orphan drive.
export function vaultWritable (base) {
  return !!base?.writable
}

// Save a new Persona made on this phone (its profile drive is already made and written; `creator`
// is that drive's key, so profileState knows one of the user's own devices made it). The first
// Persona becomes the default, like on desktop.
export async function savePersona (base, { id, label, profileUrl, email }) {
  const key = pe.driveKeyOf(profileUrl)
  const rec = pe.makePersona({ id, label, profileUrl, creator: key, email })
  const existing = (await readPrefix(base, pe.PERSONAS_PREFIX)).filter(pe.isPersona)
  await putRecord(base, pe.personaPath(rec.id), rec)
  const def = await readRecord(base, pe.DEFAULT_PATH)
  if (!existing.length && !def?.personaId) await putRecord(base, pe.DEFAULT_PATH, pe.makeDefault(rec.id))
  return { id: rec.id, label: rec.label, profileUrl: rec.profileUrl }
}

// Change a Persona's label or email (its Vault record). The profile's name and picture are in its
// Profile Drive (backend.mjs updatePersona).
export async function updatePersona (base, id, { label, email } = {}) {
  const prev = await readRecord(base, pe.personaPath(id))
  if (!pe.isPersona(prev)) throw new Error('That Persona is gone')
  const relabel = label !== undefined && pe.normalizeLabel(label) !== prev.label
  const remail = email !== undefined && pe.normalizeEmail(email) !== (prev.email || null)
  if (!relabel && !remail) return prev
  const rec = pe.makePersona({ ...(relabel ? { label } : {}), ...(remail ? { email } : {}) }, prev)
  await putRecord(base, pe.personaPath(id), rec)
  return rec
}

// Delete a Persona and its Sessions, like desktop's personas.remove. Spaces that named it fall back
// to the default; if it was the default there is none until the user picks one. Its Profile Drive
// stays, and its writer asks go unless another Persona uses the same Drive.
export async function removePersona (base, id) {
  const gone = await readRecord(base, pe.personaPath(id))
  for (const { path } of await readPrefixEntries(base, pe.SESSIONS_PREFIX)) {
    if (pe.parseSessionPath(path)?.personaId === id) await delRecord(base, path)
  }
  for (const s of await readPrefix(base, pe.SPACES_PREFIX)) {
    if (s?.persona === id && s.rootDriveKey && !s.movedTo) {
      const next = { ...s }
      delete next.persona
      await putRecord(base, pe.spacePath(s.rootDriveKey), next)
    }
  }
  const def = await readRecord(base, pe.DEFAULT_PATH)
  if (def?.personaId === id) await putRecord(base, pe.DEFAULT_PATH, pe.makeDefault(null))
  if (gone) await delRecord(base, pe.personaPath(id))
  const driveKey = pe.driveKeyOf(gone?.profileUrl)
  const others = (await readPrefix(base, pe.PERSONAS_PREFIX)).filter((p) => pe.isPersona(p) && p.id !== id)
  if (driveKey && !others.some((p) => pe.driveKeyOf(p.profileUrl) === driveKey)) {
    for (const { path } of await readPrefixEntries(base, pe.writersPrefix(driveKey))) await delRecord(base, path)
  }
  return true
}

// Writer asks for Profile Drives (shared/personas.mjs): what backend.mjs syncPersonaWriters reads.
export async function personaWriterState (base) {
  const [recs, asks, devices] = await Promise.all([
    readPrefix(base, pe.PERSONAS_PREFIX),
    readPrefix(base, pe.WRITERS_PREFIX),
    readPrefix(base, '/.vault/devices/')
  ])
  return {
    personas: recs.filter(pe.isPersona),
    asks: asks.filter(pe.isWriterAsk),
    deviceKeys: devices.map((d) => d && d.key).filter(Boolean),
    device: ownKey(base)
  }
}

export async function askToWritePersona (base, { drive, writerKey }) {
  const ask = pe.makeWriterAsk({ drive, writerKey, device: ownKey(base) })
  await putRecord(base, pe.writerAskPath(drive, writerKey), ask)
  return ask
}

export async function markPersonaWriterGranted (base, ask) {
  await putRecord(base, pe.writerAskPath(ask.drive, ask.writerKey), pe.markWriterAskGranted(ask, ownKey(base)))
}

export async function dropPersonaWriterAsk (base, ask) {
  await delRecord(base, pe.writerAskPath(ask.drive, ask.writerKey))
}

// Log a site out, on every device.
export async function endPersonaSession (base, path) {
  if (!pe.parseSessionPath(path)) throw new Error('That isn’t a site login')
  if (await readRecord(base, path)) await delRecord(base, path)
  return true
}

export async function setDefaultPersona (base, id) {
  if (id && !pe.isPersona(await readRecord(base, pe.personaPath(id)))) throw new Error('That Persona is gone')
  await putRecord(base, pe.DEFAULT_PATH, pe.makeDefault(id || null))
  return true
}

// The Space's own Persona, or null to use the default. It is on the user's own record of the Space.
export async function setSpacePersona (base, space, id) {
  if (id && !pe.isPersona(await readRecord(base, pe.personaPath(id)))) throw new Error('That Persona is gone')
  const rec = await readRecord(base, pe.spacePath(space))
  if (!rec || rec.movedTo) throw new Error('This space isn’t in your Vault yet. Open it on your computer first.')
  const next = { ...rec }
  if (id) next.persona = id
  else delete next.persona
  await putRecord(base, pe.spacePath(space), next)
  return true
}
