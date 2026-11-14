// The phone's Assets (ADR-0044): the same records and files as desktop's nomad://assets
// (app/bg/web-apis/bg/assets.ts), on the same rules (shared/assets.mjs). A shared Space's are in its
// Space Library; any other Space's are the user's own, in the Vault. Files are blobs in this phone's
// own blob core for that Autobase, so the oplog carries only pointers, and the user's other Devices
// (and a shared Space's members) fetch the bytes over the swarm.
//
// The family album's photos (ADR-0043) are Assets: the first list on a Device that can write the
// Space Library moves them (same blobs, new paths), and until then they are read where they are.
//
// `libraryOf(space)` is backend.mjs's (lib/space-library.mjs libraryFor), `vaultOf()` the Vault's
// Autobase, `blobs` the drive manager's putBlobFor / putBlobFromFor / readFileOf / fileSizeOf.
//
// A file moves between the app and here as a file on disk, never as one big message: the app
// hands `add` the path of the file it picked (or the photo it scaled), and `readTo` writes an
// Asset's file into the app's cache, a piece at a time. Paths must be in the app's own folders
// (`roots`: its documents and cache), and `fs` is bare-fs (node:fs in the tests).

import b4a from 'b4a'
import * as as from '../../../shared/assets.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { memberRecords } from './space-library.mjs'
import { decodeInlineJson, makeMetadata } from '../../../shared/fs-core.mjs'

export function createAssets ({ libraryOf, vaultOf = () => null, blobs, fs = null, roots = [], streams = null }) {
  // A file: URI or path the app gave, as a path in one of its own folders.
  function localPath (uri) {
    let p = String(uri || '')
    if (p.startsWith('file://')) p = p.slice(7)
    try { p = decodeURIComponent(p) } catch {}
    const inside = roots.some((r) => {
      const root = r.replace(/^file:\/\//, '').replace(/\/+$/, '')
      return root && p.startsWith(root + '/')
    })
    if (!fs || !p.startsWith('/') || p.split('/').includes('..') || !inside) throw new Error('That file isn’t in Nomad’s own folders')
    return p
  }

  // { base, root, shared, writable, role, memberId } for Space `space`, or null with no Vault.
  async function placeOf (space) {
    const lib = space ? await libraryOf(space).catch(() => null) : null
    if (lib) {
      await boundedUpdate(lib.base, 2000)
      return { base: lib.base, root: as.LIB_ASSETS, shared: true, writable: !!lib.base.writable, role: lib.role || null, memberId: lib.memberId || null, lib }
    }
    const base = vaultOf()
    if (!base || !space) return null
    // Catch up on what the user's other Devices added, as Notes and desktop's placeFor do. Without
    // it the list and the file reads see the view as it was, and miss a computer's new files.
    await boundedUpdate(base)
    return { base, root: as.vaultRoot(space), shared: false, writable: !!base.writable, role: null, memberId: null }
  }

  async function me (place) {
    if (!place.shared) return { memberId: null, name: '' }
    const mine = (await memberRecords(place.lib).catch(() => [])).find((m) => m.memberId === place.memberId)
    return { memberId: place.memberId, name: (mine && mine.name) || '' }
  }

  async function readPrefix (base, prefix) {
    const out = []
    for await (const node of base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
      const rec = decodeInlineJson(node.value, b4a)
      if (rec) out.push(rec)
    }
    return out
  }

  async function moveAlbum (place) {
    if (!place.shared || !place.writable) return 0
    let moved = 0
    for (const rec of await readPrefix(place.base, as.LEGACY_ITEMS)) {
      const plan = as.legacyMove(rec, place.root)
      if (!plan) continue
      for (const f of plan.files) {
        const node = await place.base.view.get(f.from)
        if (node && node.value) await place.base.append({ op: 'put', path: f.to, metadata: node.value.metadata, blob: node.value.blob || null, value: node.value.value || null })
      }
      await place.base.append(inlineOp(as.pathsOf(place.root).item(rec.id), plan.asset))
      for (const f of plan.files) await place.base.append({ op: 'del', path: f.from })
      for (const p of plan.remove) await place.base.append({ op: 'del', path: p })
      moved++
    }
    if (moved) await place.base.update()
    return moved
  }

  async function items (place) {
    await moveAlbum(place).catch((err) => console.log('[assets] moving the album', err && err.message))
    const out = new Map()
    if (place.shared) {
      for (const rec of await readPrefix(place.base, as.LEGACY_ITEMS)) {
        const a = as.fromPhoto(rec)
        if (a) out.set(a.id, a)
      }
    }
    for (const rec of await readPrefix(place.base, as.pathsOf(place.root).items)) if (as.isAsset(rec)) out.set(rec.id, rec)
    return as.sortAssets([...out.values()])
  }

  const who = (place) => ({ shared: place.shared, memberId: place.memberId, role: place.role, writable: place.writable })

  // The folder records (shared/assets.mjs makeFolder): folders kept while nothing is in them.
  async function keptFolders (place) {
    return (await readPrefix(place.base, as.pathsOf(place.root).folders)).filter(as.isFolder)
  }

  // { shared, canAdd, role, maxBytes, assets: [...record, canDelete], folders: [path] } for Space `space`.
  async function list (space) {
    const place = await placeOf(space)
    if (!place) return { shared: false, canAdd: false, role: null, maxBytes: as.MAX_BYTES, assets: [], folders: [] }
    const w = who(place)
    // The kind as the rules read it now (an EPUB added before books were a kind is a book).
    const all = await items(place)
    return {
      shared: place.shared,
      canAdd: place.writable,
      role: place.role,
      maxBytes: as.MAX_BYTES,
      assets: all.map((a) => ({ ...a, kind: as.kindOf(a.mime, a.name), canDelete: as.canDelete(a, w) })),
      folders: as.allFolders(all, await keptFolders(place))
    }
  }

  // Where an Asset's file (or thumbnail) is: its path, or an album photo's not moved yet.
  async function fileOf (place, id, thumb) {
    const p = as.pathsOf(place.root)
    const at = thumb ? p.thumb(id) : p.file(id)
    if ((await blobs.fileSizeOf(place.base, at)) >= 0 || !place.shared) return at
    const old = as.legacyPaths(id)
    return thumb ? old.thumb : old.file
  }

  // A thumbnail (or a small file) as base64, or null until it has replicated here. A whole file goes
  // to the app's cache with readTo.
  async function read (space, id, { thumb = false } = {}) {
    const place = await placeOf(space)
    if (!place || !as.isAssetId(id)) return null
    const at = await fileOf(place, id, thumb)
    if (!thumb && (await blobs.fileSizeOf(place.base, at)) > as.MAX_DATA_URL_BYTES) throw new Error('That file is too big to read at once')
    const buf = await blobs.readFileOf(place.base, at).catch(() => null)
    return buf ? b4a.toString(buf, 'base64') : null
  }

  // Write an Asset's file to `to` (a file: URI in the app's cache), CHUNK_BYTES at a time, through
  // `to`.part so a half-written file is never taken for the whole one. A big file, or one still
  // coming from another Device, takes longer than one call may wait, so the copy goes on by itself:
  // each call waits up to `wait` ms for it and says how far it got, and a call for the same `to`
  // joins the copy already going. -> { size, written, done }, or null until it has replicated here.
  const copies = new Map() // `to` path -> { size, written, done, missing, error, promise }
  async function readTo (space, id, { to, thumb = false, wait = Infinity } = {}) {
    const out = localPath(to)
    let job = copies.get(out)
    if (job && (job.error || job.missing)) {
      copies.delete(out)
      if (job.missing) return null
      throw job.error
    }
    if (!job) {
      const place = await placeOf(space)
      if (!place || !as.isAssetId(id)) return null
      const at = await fileOf(place, id, thumb)
      const size = await blobs.fileSizeOf(place.base, at)
      if (size < 0) return null
      const have = await fs.promises.stat(out).catch(() => null)
      if (have && have.size === size) return { size, written: size, done: true }
      job = copies.get(out) // another call may have started it meanwhile
      if (!job) {
        job = { size, written: 0, done: false, missing: false, error: null }
        job.promise = copyOut(place, at, out, job).then(
          (ok) => { if (ok) { job.done = true; copies.delete(out) } else job.missing = true },
          (err) => { job.error = err }
        )
        copies.set(out, job)
      }
    }
    let timer = null
    await Promise.race([job.promise, wait === Infinity ? new Promise(() => {}) : new Promise((resolve) => { timer = setTimeout(resolve, wait) })])
      .finally(() => clearTimeout(timer))
    if (job.done) return { size: job.size, written: job.size, done: true }
    if (job.missing || job.error) {
      copies.delete(out)
      if (job.missing) return null
      throw job.error
    }
    return { size: job.size, written: job.written, done: false }
  }

  // -> true once `out` holds the whole file, false when a piece of it isn't here.
  async function copyOut (place, at, out, job) {
    await fs.promises.mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true })
    const part = out + '.part'
    const fh = await fs.promises.open(part, 'w')
    let ok = false
    try {
      for (let start = 0; start < job.size; start += as.CHUNK_BYTES) {
        const buf = await blobs.readFileOf(place.base, at, { start, length: Math.min(as.CHUNK_BYTES, job.size - start) })
        if (!buf) return false
        await fh.write(buf, 0, buf.length, start)
        job.written = start + buf.length
      }
      ok = true
    } finally {
      await fh.close().catch(() => {})
      if (!ok) await fs.promises.unlink(part).catch(() => {})
    }
    await fs.promises.rename(part, out)
    return true
  }

  // A video or recording to play while it arrives (./asset-stream.mjs): a loopback URL that serves
  // the file with Range requests, read from the blob store a piece at a time (pieces still on
  // another Device come when asked for). -> { url, token, size, mime }, or null until it has
  // replicated here. The app gives the token back with `endStream` when its viewer closes.
  async function stream (space, id) {
    if (!streams) throw new Error('Streaming isn’t available here')
    const place = await placeOf(space)
    if (!place || !as.isAssetId(id)) return null
    const at = await fileOf(place, id, false)
    const size = await blobs.fileSizeOf(place.base, at)
    if (size < 0) return null
    const rec = await recordAt(place, as.pathsOf(place.root).item(id)).catch(() => null)
    const mime = (rec && typeof rec.mime === 'string' && /^(video|audio)\//.test(rec.mime)) ? rec.mime : 'application/octet-stream'
    const { url, token } = await streams.add({ size, mime, read: (start, length) => blobs.readFileOf(place.base, at, { start, length }) })
    return { url, token, size, mime }
  }

  function endStream (token) {
    streams?.end(String(token || ''))
  }

  // Add a file the app picked: `path` (a file: URI in its own folders) or, for a small one, base64
  // `data`; a scaled camera photo; a `thumb`, base64 JPEG, for a picture or a video.
  async function add (space, f = {}) {
    const place = await placeOf(space)
    if (!place) throw new Error('Link this phone to your computer to keep files')
    if (!place.writable) throw new Error(place.shared ? 'You can view this Space, but not add to it' : 'This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
    const from = f.path ? localPath(f.path) : null
    const file = from ? null : b4a.from(String(f.data || ''), 'base64')
    const bytes = from ? (await fs.promises.stat(from)).size : file.length
    const small = f.thumb ? b4a.from(String(f.thumb), 'base64') : null
    const err = as.sizeError({ bytes, thumbBytes: small ? small.length : 0 })
    if (err) throw new Error(err)
    const m = await me(place)
    const id = as.newAssetId()
    const p = as.pathsOf(place.root)
    const rec = as.makeAsset({ id, name: f.name, mime: f.mime, bytes, width: f.width, height: f.height, duration: f.duration, takenAt: f.takenAt, by: m.name, memberId: m.memberId, caption: f.caption, thumb: !!(small && small.length), tags: f.tags, folder: f.folder })
    const now = Date.now()
    const metadata = makeMetadata({ mtime: now, ctime: now })
    const blob = from ? await blobs.putBlobFromFor(place.base, fs.createReadStream(from)) : await blobs.putBlobFor(place.base, file)
    await place.base.append({ op: 'put', path: p.file(id), metadata, blob })
    if (small && small.length) await place.base.append({ op: 'put', path: p.thumb(id), metadata, blob: await blobs.putBlobFor(place.base, small) })
    await place.base.append(inlineOp(p.item(id), rec))
    await place.base.update()
    return { ...rec, canDelete: true }
  }

  async function writable (space) {
    const place = await placeOf(space)
    if (!place || !place.writable) throw new Error('You can view this Space, but not change it')
    return place
  }

  async function recordAt (place, path) {
    const node = await place.base.view.get(path)
    return node ? decodeInlineJson(node.value, b4a) : null
  }

  // The fields of a change the user may make: a name, a caption, tags, a folder.
  const editOf = ({ name, caption, tags, folder }) => ({
    ...(name !== undefined ? { name } : {}),
    ...(caption !== undefined ? { caption } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(folder !== undefined ? { folder } : {})
  })

  // A new name, caption, tags or folder.
  async function update (space, change = {}) {
    const place = await writable(space)
    const { id } = change
    const path = as.isAssetId(id) ? as.pathsOf(place.root).item(id) : null
    const prev = path ? await recordAt(place, path) : null
    if (!as.isAsset(prev)) throw new Error('That file was removed')
    const rec = as.makeAsset({ id, ...editOf(change) }, prev)
    await place.base.append(inlineOp(path, rec))
    await place.base.update()
    return rec
  }

  // Many at once (select, then Move or Tag): `folder` moves them, `addTags`/`removeTags` change their tags.
  async function updateMany (space, { ids = [], folder, addTags = [], removeTags = [] } = {}) {
    const place = await writable(space)
    const p = as.pathsOf(place.root)
    let changed = 0
    for (const id of (Array.isArray(ids) ? ids : []).filter(as.isAssetId)) {
      const prev = await recordAt(place, p.item(id))
      if (!as.isAsset(prev)) continue
      const tags = as.changeTags(prev.tags, { add: addTags, remove: removeTags })
      await place.base.append(inlineOp(p.item(id), as.makeAsset({ id, tags, ...(folder !== undefined ? { folder } : {}) }, prev)))
      changed++
    }
    if (changed) await place.base.update()
    return { changed }
  }

  // A thumbnail made after the file was added (shared/assets.mjs needsThumb): the app makes it from
  // the file when it is opened. Anyone who can write the Space may add one where there is none; one
  // that is there is never replaced. -> the record, or null when it had one already.
  async function setThumb (space, id, thumb) {
    const place = await writable(space)
    const small = b4a.from(String(thumb || ''), 'base64')
    if (!small.length) throw new Error('That thumbnail is empty')
    const err = as.sizeError({ bytes: 1, thumbBytes: small.length })
    if (err) throw new Error(err)
    const p = as.pathsOf(place.root)
    const prev = as.isAssetId(id) ? await recordAt(place, p.item(id)) : null
    if (!as.isAsset(prev)) throw new Error('That file was removed')
    if (!as.needsThumb(prev)) return null
    const now = Date.now()
    await place.base.append({ op: 'put', path: p.thumb(id), metadata: makeMetadata({ mtime: now, ctime: now }), blob: await blobs.putBlobFor(place.base, small) })
    const rec = as.withThumb(prev)
    await place.base.append(inlineOp(p.item(id), rec))
    await place.base.update()
    return rec
  }

  async function removeFrom (place, id) {
    const p = as.pathsOf(place.root)
    const prev = await recordAt(place, p.item(id))
    if (!as.isAsset(prev)) return 'gone'
    if (!as.canDelete(prev, who(place))) return 'refused'
    for (const path of [p.item(id), p.file(id), p.thumb(id)]) await place.base.append({ op: 'del', path })
    return 'removed'
  }

  async function remove (space, id) {
    const place = await placeOf(space)
    if (!place || !as.isAssetId(id)) return false
    const res = await removeFrom(place, id)
    if (res === 'refused') throw new Error('Only the person who added a file, or the Space’s owner, can remove it')
    if (res === 'removed') await place.base.update()
    return res === 'removed'
  }

  // Many at once. Files someone else added in a shared Space stay (`refused`).
  async function removeMany (space, ids = []) {
    const place = await placeOf(space)
    let removed = 0
    let refused = 0
    if (!place) return { removed, refused }
    for (const id of (Array.isArray(ids) ? ids : []).filter(as.isAssetId)) {
      const res = await removeFrom(place, id)
      if (res === 'removed') removed++
      else if (res === 'refused') refused++
    }
    if (removed) await place.base.update()
    return { removed, refused }
  }

  // Folders: a new one is kept by its record until it is removed.
  async function addFolder (space, path) {
    const place = await writable(space)
    const rec = as.makeFolder(path)
    await place.base.append(inlineOp(as.pathsOf(place.root).folder(rec.path), rec))
    await place.base.update()
    return rec.path
  }

  // Rename or move folder `from` to `to` (a whole path), with everything in it.
  async function moveFolder (space, { from, to } = {}) {
    const place = await writable(space)
    const p = as.pathsOf(place.root)
    const all = await items(place)
    const own = await readPrefix(place.base, p.items)
    const plan = as.moveFolderPlan(all, await keptFolders(place), from, to)
    for (const { id, folder } of plan.assets) {
      const prev = own.find((a) => a.id === id)
      if (as.isAsset(prev)) await place.base.append(inlineOp(p.item(id), as.makeAsset({ id, folder }, prev)))
    }
    for (const path of plan.remove) await place.base.append({ op: 'del', path: p.folder(path) })
    for (const path of plan.keep) await place.base.append(inlineOp(p.folder(path), as.makeFolder(path)))
    await place.base.update()
    return { path: as.cleanFolder(to), moved: plan.assets.length }
  }

  // Remove folder `path` and everything in it. Refused, with nothing removed, when it holds a file
  // this user can't remove (someone else's, in a shared Space).
  async function removeFolder (space, path) {
    const place = await writable(space)
    const p = as.pathsOf(place.root)
    const all = await items(place)
    const plan = as.deleteFolderPlan(all, await keptFolders(place), path)
    const w = who(place)
    const theirs = plan.assets.filter((id) => !as.canDelete(all.find((a) => a.id === id), w)).length
    if (theirs) throw new Error(`This folder has ${theirs} file${theirs === 1 ? '' : 's'} someone else added. Only they, or the Space’s owner, can remove ${theirs === 1 ? 'it' : 'them'}.`)
    for (const id of plan.assets) for (const f of [p.item(id), p.file(id), p.thumb(id)]) await place.base.append({ op: 'del', path: f })
    for (const f of plan.remove) await place.base.append({ op: 'del', path: p.folder(f) })
    await place.base.update()
    return { removed: plan.assets.length }
  }

  return { list, read, readTo, stream, endStream, add, setThumb, update, updateMany, remove, removeMany, addFolder, moveFolder, removeFolder }
}
