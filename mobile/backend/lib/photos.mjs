// The phone's family album (ADR-0043): the same records and files as desktop's nomad://photos
// (app/bg/web-apis/bg/photos.ts), on the same rules (shared/photos.mjs). Photos live in a shared
// Space's Library; the files are blobs in this phone's own blob core for that Library, so the
// Library's oplog carries only pointers, and the other members fetch the bytes over the swarm.
//
// `libraryOf(space)` is backend.mjs's (lib/space-library.mjs libraryFor), `blobs` the drive
// manager's putBlobFor / readFileOf.

import b4a from 'b4a'
import * as ph from '../../../shared/photos.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { memberRecords } from './space-library.mjs'
import { decodeInlineJson, makeMetadata } from '../../../shared/fs-core.mjs'

export function createPhotos ({ libraryOf, blobs }) {
  async function open (space) {
    const lib = space ? await libraryOf(space).catch(() => null) : null
    if (lib) await boundedUpdate(lib.base, 2000)
    return lib
  }

  async function me (lib) {
    const mine = (await memberRecords(lib).catch(() => [])).find((m) => m.memberId === lib.memberId)
    return { memberId: lib.memberId || null, name: (mine && mine.name) || '' }
  }

  async function items (lib) {
    const out = []
    for await (const node of lib.base.view.createReadStream({ gte: ph.ITEMS, lt: ph.ITEMS + '\xff' })) {
      const rec = decodeInlineJson(node.value, b4a)
      if (ph.isPhoto(rec)) out.push(rec)
    }
    return ph.sortPhotos(out)
  }

  const who = (lib) => ({ memberId: lib.memberId || null, role: lib.role, writable: !!lib.base.writable })

  // { shared, canAdd, role, photos: [...record, canDelete] } for Space `space`.
  async function list (space) {
    const lib = await open(space)
    if (!lib) return { shared: false, canAdd: false, role: null, photos: [] }
    const w = who(lib)
    return { shared: true, canAdd: w.writable, role: lib.role, photos: (await items(lib)).map((p) => ({ ...p, canDelete: ph.canDelete(p, w) })) }
  }

  // A photo's file or thumbnail as base64, or null until it has replicated here.
  async function read (space, id, { thumb = false } = {}) {
    const lib = await open(space)
    if (!lib || !ph.isPhotoId(id)) return null
    const buf = await blobs.readFileOf(lib.base, thumb ? ph.thumbPath(id) : ph.filePath(id)).catch(() => null)
    return buf ? b4a.toString(buf, 'base64') : null
  }

  // Add a photo the UI scaled (base64 JPEG `photo` and `thumb`).
  async function add (space, { photo, thumb, width, height, takenAt, caption } = {}) {
    const lib = await open(space)
    if (!lib) throw new Error('Share this Space to keep a family album in it')
    if (!lib.base.writable) throw new Error('You can view this Space, but not add to it')
    const file = b4a.from(String(photo || ''), 'base64')
    const small = b4a.from(String(thumb || ''), 'base64')
    const err = ph.sizeError({ bytes: file.length, thumbBytes: small.length })
    if (err) throw new Error(err)
    const m = await me(lib)
    const id = ph.newPhotoId()
    const rec = ph.makePhoto({ id, by: m.name, memberId: m.memberId, takenAt, width, height, bytes: file.length, caption })
    const now = Date.now()
    const blobOp = async (path, buf) => ({ op: 'put', path, metadata: makeMetadata({ mtime: now, ctime: now }), blob: await blobs.putBlobFor(lib.base, buf) })
    await lib.base.append(await blobOp(ph.filePath(id), file))
    await lib.base.append(await blobOp(ph.thumbPath(id), small))
    await lib.base.append(inlineOp(ph.itemPath(id), rec))
    await lib.base.update()
    return { ...rec, canDelete: true }
  }

  async function caption (space, { id, caption } = {}) {
    const lib = await open(space)
    if (!lib || !lib.base.writable) throw new Error('You can view this Space, but not change it')
    const node = ph.isPhotoId(id) ? await lib.base.view.get(ph.itemPath(id)) : null
    const prev = node ? decodeInlineJson(node.value, b4a) : null
    if (!ph.isPhoto(prev)) throw new Error('That photo was removed')
    const rec = ph.makePhoto({ id, caption: String(caption ?? '') }, prev)
    await lib.base.append(inlineOp(ph.itemPath(id), rec))
    await lib.base.update()
    return rec
  }

  async function remove (space, id) {
    const lib = await open(space)
    if (!lib || !ph.isPhotoId(id)) return false
    const node = await lib.base.view.get(ph.itemPath(id))
    const prev = node ? decodeInlineJson(node.value, b4a) : null
    if (!ph.isPhoto(prev)) return false
    if (!ph.canDelete(prev, who(lib))) throw new Error('Only the person who added a photo, or the Space’s owner, can remove it')
    for (const p of [ph.itemPath(id), ph.filePath(id), ph.thumbPath(id)]) await lib.base.append({ op: 'del', path: p })
    await lib.base.update()
    return true
  }

  return { list, read, add, caption, remove }
}
