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

// The UI gets each Note with its list title and preview, so the phone uses the same definition as
// desktop (shared/vault-apps.mjs) without its React Native bundle reaching outside mobile/.
function withPreview (note) {
  return { ...note, title: apps.noteTitle(note.body), snippet: apps.noteSnippet(note.body) }
}

async function allNotes (base) {
  return apps.sortNotes((await readPrefix(base, apps.NOTES_PREFIX)).filter(apps.isNote))
}

export async function listNotes (base) {
  await boundedUpdate(base)
  return { notes: (await allNotes(base)).map(withPreview), writable: !!base.writable }
}

// Create (no id) or update a Note, and return the stored Note. `baseUpdatedAt` is the updatedAt of
// the version the editor started from: if another Device saved the Note since, this edit is kept as
// a conflict copy (a new Note with conflictOf), which is returned instead (shared planNoteSave).
export async function saveNote (base, { id, body, baseUpdatedAt } = {}) {
  const prev = id ? await readRecord(base, apps.notePath(id)) : null
  const { note, write } = apps.planNoteSave({ id, body, baseUpdatedAt }, prev)
  if (write) await putRecord(base, apps.notePath(note.id), note)
  return withPreview(note)
}

export async function deleteNote (base, id) {
  await delRecord(base, apps.notePath(id))
}

// A Note's title changed: point the other Notes' links at the new title. Returns how many changed.
export async function renameNoteLinks (base, { id, from, to } = {}) {
  const changes = apps.linkRenames(await allNotes(base), id, from, to)
  for (const { note, body } of changes) {
    await putRecord(base, apps.notePath(note.id), apps.makeNote({ id: note.id, body }, note))
  }
  return changes.length
}

// Names (ADR-0018)
// =
//
// The user's short names for drives and URLs, the same /.vault/names/ records desktop's
// app/bg/hyper/names.js keeps (rules in shared/names.mjs). The phone resolves hyper://<name>/ where
// the user navigates (the address bar and links in a page), never for a page's own reads, as on
// desktop. These read the view as it is, without waiting on an update, so a navigation never stalls.

async function allNames (base) {
  return (await readPrefix(base, names.NAMES_PREFIX)).filter(names.isNameRecord).sort((a, b) => a.name.localeCompare(b.name))
}

async function readName (base, name) {
  if (names.nameError(name)) return null
  const rec = await readRecord(base, names.namePath(name))
  return names.isNameRecord(rec) ? rec : null
}

export async function listNames (base) {
  await boundedUpdate(base)
  return { names: await allNames(base), writable: !!base.writable }
}

// Where the address bar entry `input` goes, or null when it isn't a name. "blog", "hyper://blog/"
// and "hyper://blog/posts/" all count, as typing a name and pressing Enter does on desktop.
export async function resolveName (base, input) {
  const s = String(input || '').trim()
  const url = /^[a-z0-9-]+\/?$/i.test(s) ? `hyper://${s.replace(/\/$/, '')}/` : s
  const m = /^hyper:\/\/([a-z0-9-]+)(?:[/?#]|$)/i.exec(url)
  if (!m) return null
  const rec = await readName(base, m[1].toLowerCase())
  return rec ? names.resolveNamedUrl(url, () => rec) : null
}

// The page at `url`: `approved` is the user's own name for it, the one the address bar shows (a name
// the AI gave doesn't count until the user keeps it); `named` are the names that point to it, AI's
// included, for the name sheet; `suggested` is a name to offer for a page titled `title`.
export async function namesForUrl (base, url, title = '') {
  const all = await allNames(base)
  const target = names.nameTarget(url)
  return {
    approved: names.approvedNameFor(url, all),
    named: all.filter((r) => r.url === target || r.url === url),
    suggested: names.suggestName(title),
    writable: !!base.writable
  }
}

// The names that match what's typed in the address bar, best first.
export async function matchNames (base, query, limit = 5) {
  return names.matchNames(query, await allNames(base), limit)
}

// Give the page at `url` the name `name`, as desktop's site-info panel does: the name is tidied,
// a drive page names its folder, and `previous` is the name being changed. A name saved here is the
// user's, so it drops the AI's `auto` mark. Refuses a name that already points somewhere else.
export async function setName (base, { name, url, title, previous } = {}) {
  const clean = names.normalizeName(name)
  const err = names.nameError(clean)
  if (err) throw new Error(err)
  const target = names.nameTarget(url)
  const existing = await readName(base, clean)
  if (existing && existing.url !== target && previous !== clean) {
    throw new Error(`“${clean}” already names ${existing.title || existing.url}`)
  }
  const rec = names.makeNameRecord({ name: clean, url: target, title }, existing)
  await putRecord(base, names.namePath(clean), rec)
  if (previous && previous !== clean && (await readName(base, previous))) await delRecord(base, names.namePath(previous))
  return rec
}

export async function removeName (base, name) {
  await delRecord(base, names.namePath(name))
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
