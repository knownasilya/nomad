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
// Autobase, `blobs` the drive manager's putBlobFor / readFileOf.

import b4a from 'b4a'
import * as as from '../../../shared/assets.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { memberRecords } from './space-library.mjs'
import { decodeInlineJson, makeMetadata } from '../../../shared/fs-core.mjs'

export function createAssets ({ libraryOf, vaultOf = () => null, blobs }) {
  // { base, root, shared, writable, role, memberId } for Space `space`, or null with no Vault.
  async function placeOf (space) {
    const lib = space ? await libraryOf(space).catch(() => null) : null
    if (lib) {
      await boundedUpdate(lib.base, 2000)
      return { base: lib.base, root: as.LIB_ASSETS, shared: true, writable: !!lib.base.writable, role: lib.role || null, memberId: lib.memberId || null, lib }
    }
    const base = vaultOf()
    if (!base || !space) return null
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

  // { shared, canAdd, role, maxBytes, assets: [...record, canDelete] } for Space `space`.
  async function list (space) {
    const place = await placeOf(space)
    if (!place) return { shared: false, canAdd: false, role: null, maxBytes: as.MAX_BYTES, assets: [] }
    const w = who(place)
    return { shared: place.shared, canAdd: place.writable, role: place.role, maxBytes: as.MAX_BYTES, assets: (await items(place)).map((a) => ({ ...a, canDelete: as.canDelete(a, w) })) }
  }

  // A file or its thumbnail as base64, or null until it has replicated here.
  async function read (space, id, { thumb = false } = {}) {
    const place = await placeOf(space)
    if (!place || !as.isAssetId(id)) return null
    const p = as.pathsOf(place.root)
    const buf = await blobs.readFileOf(place.base, thumb ? p.thumb(id) : p.file(id)).catch(() => null)
    if (buf) return b4a.toString(buf, 'base64')
    if (!place.shared) return null
    const old = as.legacyPaths(id)
    const legacy = await blobs.readFileOf(place.base, thumb ? old.thumb : old.file).catch(() => null)
    return legacy ? b4a.toString(legacy, 'base64') : null
  }

  // Add a file the UI read (base64 `data`; a scaled camera photo; a `thumb`, base64 JPEG, for a picture).
  async function add (space, f = {}) {
    const place = await placeOf(space)
    if (!place) throw new Error('Link this phone to your computer to keep files')
    if (!place.writable) throw new Error(place.shared ? 'You can view this Space, but not add to it' : 'This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
    const file = b4a.from(String(f.data || ''), 'base64')
    const small = f.thumb ? b4a.from(String(f.thumb), 'base64') : null
    const err = as.sizeError({ bytes: file.length, thumbBytes: small ? small.length : 0 })
    if (err) throw new Error(err)
    const m = await me(place)
    const id = as.newAssetId()
    const p = as.pathsOf(place.root)
    const rec = as.makeAsset({ id, name: f.name, mime: f.mime, bytes: file.length, width: f.width, height: f.height, duration: f.duration, takenAt: f.takenAt, by: m.name, memberId: m.memberId, caption: f.caption, thumb: !!(small && small.length) })
    const now = Date.now()
    const blobOp = async (path, buf) => ({ op: 'put', path, metadata: makeMetadata({ mtime: now, ctime: now }), blob: await blobs.putBlobFor(place.base, buf) })
    await place.base.append(await blobOp(p.file(id), file))
    if (small && small.length) await place.base.append(await blobOp(p.thumb(id), small))
    await place.base.append(inlineOp(p.item(id), rec))
    await place.base.update()
    return { ...rec, canDelete: true }
  }

  // A new name or caption.
  async function update (space, { id, name, caption } = {}) {
    const place = await placeOf(space)
    if (!place || !place.writable) throw new Error('You can view this Space, but not change it')
    const path = as.isAssetId(id) ? as.pathsOf(place.root).item(id) : null
    const node = path ? await place.base.view.get(path) : null
    const prev = node ? decodeInlineJson(node.value, b4a) : null
    if (!as.isAsset(prev)) throw new Error('That file was removed')
    const rec = as.makeAsset({ id, ...(name !== undefined ? { name } : {}), ...(caption !== undefined ? { caption } : {}) }, prev)
    await place.base.append(inlineOp(path, rec))
    await place.base.update()
    return rec
  }

  async function remove (space, id) {
    const place = await placeOf(space)
    if (!place || !as.isAssetId(id)) return false
    const p = as.pathsOf(place.root)
    const node = await place.base.view.get(p.item(id))
    const prev = node ? decodeInlineJson(node.value, b4a) : null
    if (!as.isAsset(prev)) return false
    if (!as.canDelete(prev, who(place))) throw new Error('Only the person who added a file, or the Space’s owner, can remove it')
    for (const path of [p.item(id), p.file(id), p.thumb(id)]) await place.base.append({ op: 'del', path })
    await place.base.update()
    return true
  }

  return { list, read, add, update, remove }
}
