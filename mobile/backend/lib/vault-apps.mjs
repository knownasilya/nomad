import b4a from 'b4a'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as apps from '../../../shared/vault-apps.mjs'
import * as names from '../../../shared/names.mjs'
import * as ot from '../../../shared/open-tabs.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { parseHyperUrl } from './hyper-url.mjs'
import { DRIVE_AUTOBASE, DRIVE_HYPERDRIVE } from '../../rpc-commands.mjs'

// The phone's Reader, Notes and Names (ADR-0017, ADR-0018). They read and write the same Vault records as desktop's
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

// Reader
// =

export async function readerState (base, space) {
  await boundedUpdate(base)
  return {
    follows: apps.followUrls(await readPrefix(base, apps.followsPrefix(space))),
    read: (await readRecord(base, apps.readPath(space)))?.read || [],
    writable: !!base.writable
  }
}

export async function follow (base, space, url) {
  const path = apps.followPath(space, url) // throws for a non-hyper address
  if (!(await readRecord(base, path))) await putRecord(base, path, apps.followRecord(url))
  return readerState(base, space)
}

export async function unfollow (base, space, url) {
  await delRecord(base, apps.followPath(space, url))
  return readerState(base, space)
}

// Merges with what other Devices marked read; see mergeReadState for what it prunes.
export async function saveRead (base, space, add = [], loaded = {}) {
  const { follows, read } = await readerState(base, space)
  const next = apps.mergeReadState(read, add, follows, loaded)
  if (next.length === read.length && next.every((u, i) => u === read[i])) return readerState(base, space)
  await putRecord(base, apps.readPath(space), { read: next })
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
  return (await readPrefix(base, apps.notesPrefix(space))).filter(apps.isNote).map(withSpace(space))
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
    const theirs = await readRecord(base, apps.notePath(id, space))
    if (theirs) return { space, prev: theirs }
  }
  return { space: null, prev: null }
}

export async function listNotes (base, space = null) {
  await boundedUpdate(base)
  return { notes: (await allNotes(base, space)).map(withPreview), space: spaceOrNull(space), writable: !!base.writable }
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
  if (write) await putRecord(base, apps.notePath(note.id, where), note)
  return withPreview(withSpace(where)(note))
}

export async function deleteNote (base, id, space = null) {
  const found = await findStored(base, id, space) // notePath validates the id
  if (found.prev) await delRecord(base, apps.notePath(id, found.space))
}

// Move a Note into the Space (`inSpace` true) or out to the user's Notes. Returns it.
export async function moveNote (base, { id, inSpace = false, space = null } = {}) {
  space = spaceOrNull(space)
  const found = await findStored(base, id, space)
  if (!found.prev) throw new Error('No note with that id')
  const to = inSpace ? space : null
  if (inSpace && !to) throw new Error('This Space isn’t ready yet')
  if (to === found.space) return withPreview(withSpace(to)(found.prev))
  await putRecord(base, apps.notePath(id, to), found.prev)
  await delRecord(base, apps.notePath(id, found.space))
  return withPreview(withSpace(to)(found.prev))
}

// A Note's title changed: point the other Notes' links at the new title. Returns how many changed.
// Covers the Notes the Space sees: the user's and the Space's.
export async function renameNoteLinks (base, { id, from, to, space = null } = {}) {
  const changes = apps.linkRenames(await allNotes(base, space), id, from, to)
  for (const { note, body } of changes) {
    await putRecord(base, apps.notePath(note.id, note.space), apps.makeNote({ id: note.id, body }, stored(note)))
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
  return (await readPrefix(base, names.namesPrefix(space))).filter(names.isNameRecord)
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
  const rec = await readRecord(base, names.namePath(name, space))
  return names.isNameRecord(rec) ? rec : null
}

export async function listNames (base, space = null) {
  await boundedUpdate(base)
  return { names: await allNames(base, space), space: spaceOrNull(space), writable: !!base.writable }
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
  await putRecord(base, names.namePath(clean, where), rec)
  if (previous && !same && (await readName(base, previous, from))) await delRecord(base, names.namePath(previous, from))
  return { ...rec, space: where }
}

export async function removeName (base, name, { inSpace = false, space = null } = {}) {
  const where = inSpace ? spaceOrNull(space) : null
  if (inSpace && !where) throw new Error('This Space isn’t ready yet')
  await delRecord(base, names.namePath(name, where))
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
