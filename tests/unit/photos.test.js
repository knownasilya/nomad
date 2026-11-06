// The family album's rules (shared/photos.mjs): records, paths, sizes, order and who may remove.
import { describe, it, expect } from 'vitest'
import * as ph from '../../shared/photos.mjs'

const T0 = '2026-11-05T10:00:00.000Z'

describe('photo records', () => {
  it('keeps who added a photo and when it was taken, through a caption edit', () => {
    const id = ph.newPhotoId(Date.parse(T0))
    expect(ph.isPhotoId(id)).toBe(true)
    const p = ph.makePhoto({ id, by: 'Sam', memberId: 'm1', takenAt: '2026-10-31T16:20:00Z', width: 2560, height: 1920, bytes: 900000, caption: '  Pumpkins   ' }, null, T0)
    expect(p).toMatchObject({ type: ph.PHOTO_TYPE, id, by: 'Sam', memberId: 'm1', takenAt: '2026-10-31T16:20:00.000Z', addedAt: T0, width: 2560, caption: 'Pumpkins' })
    expect(ph.isPhoto(p)).toBe(true)
    const edited = ph.makePhoto({ id, caption: 'Halloween', by: 'Ilya', takenAt: '2020-01-01T00:00:00Z' }, p, '2026-11-06T09:00:00.000Z')
    expect(edited).toMatchObject({ by: 'Sam', takenAt: p.takenAt, addedAt: T0, caption: 'Halloween' })
    expect(ph.makePhoto({ id, caption: '' }, p).caption).toBeUndefined()
    // No time, or a bad one: the time it was added.
    expect(ph.makePhoto({ id, takenAt: 'yesterday' }, null, T0).takenAt).toBe(T0)
  })

  it('keeps its files in the Space Library, and refuses ids that aren’t', () => {
    const id = 'pmh2x0k3c-ab12cd'
    expect(ph.itemPath(id)).toBe('/photos/items/pmh2x0k3c-ab12cd.json')
    expect(ph.filePath(id)).toBe('/photos/files/pmh2x0k3c-ab12cd.jpg')
    expect(ph.thumbPath(id)).toBe('/photos/thumbs/pmh2x0k3c-ab12cd.jpg')
    expect(() => ph.filePath('../x')).toThrow()
    expect(() => ph.makePhoto({ id: 'nope' })).toThrow()
  })

  it('refuses an empty or oversized photo', () => {
    expect(ph.sizeError({ bytes: 0, thumbBytes: 10 })).toMatch(/empty/)
    expect(ph.sizeError({ bytes: ph.MAX_BYTES + 1, thumbBytes: 10 })).toMatch(/too big/)
    expect(ph.sizeError({ bytes: 10, thumbBytes: 0 })).toMatch(/thumbnail/)
    expect(ph.sizeError({ bytes: 10, thumbBytes: 10 })).toBe('')
  })

  it('reads an EXIF time', () => {
    expect(ph.exifTime('2026:11:05 14:03:22')).toBe(new Date(2026, 10, 5, 14, 3, 22).toISOString())
    expect(ph.exifTime('0000:00:00 00:00:00')).toBe(null)
    expect(ph.exifTime('')).toBe(null)
  })
})

describe('the album', () => {
  const at = (id, takenAt, memberId = 'm1') => ph.makePhoto({ id, takenAt, memberId }, null, T0)
  const list = [at('pa000001-aaaa', '2026-10-02T10:00:00Z'), at('pa000002-aaaa', '2026-11-03T10:00:00Z', 'm2'), at('pa000003-aaaa', '2026-11-01T10:00:00Z')]

  it('puts the newest first, by month', () => {
    const months = ph.byMonth(list, (iso) => iso.slice(0, 7))
    expect(months.map((m) => [m.label, m.photos.map((p) => p.id)])).toEqual([
      ['November 2026', ['pa000002-aaaa', 'pa000003-aaaa']],
      ['October 2026', ['pa000001-aaaa']],
    ])
  })

  it('lets the person who added a photo, or the owner, remove it', () => {
    const [mine, theirs] = list
    expect(ph.canDelete(mine, { memberId: 'm1', role: 'editor', writable: true })).toBe(true)
    expect(ph.canDelete(theirs, { memberId: 'm1', role: 'editor', writable: true })).toBe(false)
    expect(ph.canDelete(theirs, { memberId: 'm1', role: 'owner', writable: true })).toBe(true)
    expect(ph.canDelete(mine, { memberId: 'm1', role: 'viewer', writable: false })).toBe(false)
  })
})
