// A Space's Assets (ADR-0044): the rules in shared/assets.mjs, the phone's copy of the parts its
// screens need (mobile/lib/assetRules.ts, which runs the same cases so the two can't drift apart),
// and the AI's saveAsset arguments (app/bg/ai/save-asset.mjs).

import { describe, it, expect } from 'vitest'
import * as as from '../../shared/assets.mjs'
import * as phone from '../../mobile/lib/assetRules.ts'
import { assetRequest, nameForUrl, sizeCheck } from '../../app/bg/ai/save-asset.mjs'
import { spaceLibPrefix } from '../../shared/vault-apps.mjs'

const SPACE = 'c'.repeat(64)
const T = '2026-11-07T10:00:00.000Z'

describe('asset ids and paths', () => {
  it('makes ids that start with a, and still reads the album’s p ids', () => {
    const id = as.newAssetId(Date.UTC(2026, 10, 7), () => 'abc123')
    expect(id).toMatch(/^a[a-z0-9]+-abc123$/)
    expect(as.isAssetId(id)).toBe(true)
    expect(as.isAssetId('pmhc2k1a0-abc123')).toBe(true)
    for (const bad of ['', 'x123456-abcd', 'a12-abcd', '../a1234567-abcd', 'a1234567-abcd/..', null]) expect(as.isAssetId(bad)).toBe(false)
  })

  it('puts a shared Space’s in its Library and any other’s in the Vault', () => {
    const lib = as.pathsOf(as.LIB_ASSETS)
    expect(lib.item('a1234567-abcd')).toBe('/assets/items/a1234567-abcd.json')
    expect(lib.file('a1234567-abcd')).toBe('/assets/files/a1234567-abcd')
    expect(lib.thumb('a1234567-abcd')).toBe('/assets/thumbs/a1234567-abcd.jpg')
    expect(as.vaultRoot(SPACE)).toBe(spaceLibPrefix(SPACE) + 'assets/')
    expect(() => lib.file('../../.vault/x')).toThrow()
    expect(as.legacyPaths('pmhc2k1a0-abc123')).toEqual({
      item: '/photos/items/pmhc2k1a0-abc123.json',
      file: '/photos/files/pmhc2k1a0-abc123.jpg',
      thumb: '/photos/thumbs/pmhc2k1a0-abc123.jpg',
    })
  })
})

for (const [name, m] of [['shared', as], ['phone', phone]]) {
  describe(`asset rules (${name})`, () => {
    it('has the same limits', () => {
      for (const k of ['MAX_BYTES', 'MAX_SIDE', 'THUMB_SIDE', 'QUALITY', 'THUMB_QUALITY', 'MAX_THUMB_BYTES', 'MAX_CAPTION', 'MAX_NAME', 'MAX_BATCH', 'MAX_TEXT_PREVIEW']) {
        expect(m[k], k).toBe(as[k])
      }
      expect(m.KINDS).toEqual(as.KINDS)
      expect(m.KIND_ICONS).toEqual(as.KIND_ICONS)
      expect(m.KIND_LABELS).toEqual(as.KIND_LABELS)
      expect(m.FILTERS).toEqual(as.FILTERS)
    })

    it('reads a file’s type from what it came with, else its extension', () => {
      expect(m.mimeOf('a.pdf', '')).toBe('application/pdf')
      expect(m.mimeOf('a.PDF', 'application/octet-stream')).toBe('application/pdf')
      expect(m.mimeOf('notes.md', 'text/plain')).toBe('text/markdown')
      expect(m.mimeOf('photo.heic', 'image/heic')).toBe('image/heic')
      expect(m.mimeOf('clip', 'video/mp4; codecs=avc1')).toBe('video/mp4')
      expect(m.mimeOf('weird', 'not a type')).toBe('application/octet-stream')
      expect(m.mimeOf('x.unknownext', '')).toBe('application/octet-stream')
    })

    it('sorts files into kinds', () => {
      const cases = [
        ['photo.jpg', 'image'], ['clip.mov', 'video'], ['song.mp3', 'audio'], ['form.pdf', 'pdf'], ['plan.md', 'markdown'],
        ['app.js', 'code'], ['page.html', 'code'], ['list.csv', 'data'], ['data.json', 'data'], ['readme.txt', 'text'],
        ['letter.docx', 'document'], ['backup.zip', 'archive'], ['thing.bin', 'other'],
      ]
      for (const [file, kind] of cases) expect(m.kindOf(m.mimeOf(file), file), file).toBe(kind)
      expect(m.isTextKind('code')).toBe(true)
      expect(m.isTextKind('pdf')).toBe(false)
      for (const k of m.KINDS) {
        expect(m.KIND_ICONS[k], k).toBeTruthy()
        expect(m.KIND_LABELS[k], k).toBeTruthy()
      }
    })

    it('cleans names, keeping the extension', () => {
      expect(m.cleanName('../../etc/passwd')).toBe('passwd')
      expect(m.cleanName('C:\\Users\\me\\a b.txt')).toBe('a b.txt')
      expect(m.cleanName('  two\n lines\u0000.md ')).toBe('two lines.md')
      expect(m.cleanName('')).toBe('Untitled')
      expect(m.cleanName('..')).toBe('Untitled')
      const long = m.cleanName('x'.repeat(300) + '.pdf')
      expect(long.length).toBe(as.MAX_NAME)
      expect(long.endsWith('.pdf')).toBe(true)
    })

    it('reads EXIF times as local time', () => {
      expect(m.exifTime('2026:11:05 14:03:22')).toBe(new Date(2026, 10, 5, 14, 3, 22).toISOString())
      expect(m.exifTime('0000:00:00 00:00:00')).toBeNull()
      expect(m.exifTime('')).toBeNull()
    })

    it('formats sizes and durations', () => {
      expect(m.formatBytes(512)).toBe('512 B')
      expect(m.formatBytes(2048)).toBe('2 KB')
      expect(m.formatBytes(1.5 * 1048576)).toBe('1.5 MB')
      expect(m.formatBytes(25 * 1048576)).toBe('25 MB')
      expect(m.formatDuration(65)).toBe('1:05')
      expect(m.formatDuration(3725)).toBe('1:02:05')
    })

    it('filters and searches every word, ignoring case and accents', () => {
      const list = [
        { name: 'Café menu.pdf', kind: 'pdf', mime: 'application/pdf', by: 'Sam' },
        { name: 'Beach.jpg', kind: 'image', mime: 'image/jpeg', caption: 'Summer trip' },
        { name: 'Plan.md', kind: 'markdown', mime: 'text/markdown', source: 'ai' },
        { name: 'song.mp3', kind: 'audio', mime: 'audio/mpeg' },
      ]
      expect(m.filterAssets(list, { filter: 'media' }).map((a) => a.name)).toEqual(['Beach.jpg'])
      expect(m.filterAssets(list, { filter: 'docs' }).map((a) => a.name)).toEqual(['Café menu.pdf', 'Plan.md'])
      expect(m.filterAssets(list, { query: 'MENU cafe' }).map((a) => a.name)).toEqual(['Café menu.pdf'])
      expect(m.filterAssets(list, { query: 'trip summer' }).map((a) => a.name)).toEqual(['Beach.jpg'])
      expect(m.filterAssets(list, { query: 'ai' }).map((a) => a.name)).toEqual(['Plan.md'])
      expect(m.filterAssets(list, { filter: 'audio', query: 'sam' })).toEqual([])
    })
  })
}

describe('asset records', () => {
  it('makes a record from what was added, and an edit keeps the rest', () => {
    const rec = as.makeAsset(
      { id: 'a1234567-abcd', name: 'plan.md', mime: 'text/plain', bytes: 120, by: 'Sam', memberId: 'm1', source: 'ai', sourceUrl: 'https://example.com/plan', caption: '  For   the trip ' },
      null,
      T
    )
    expect(rec).toEqual({
      type: as.ASSET_TYPE, id: 'a1234567-abcd', name: 'plan.md', mime: 'text/markdown', kind: 'markdown', bytes: 120,
      addedAt: T, takenAt: T, by: 'Sam', memberId: 'm1', updatedAt: T, source: 'ai', sourceUrl: 'https://example.com/plan', caption: 'For the trip',
    })
    expect(as.isAsset(rec)).toBe(true)
    const later = '2026-11-08T10:00:00.000Z'
    const edited = as.makeAsset({ id: rec.id, name: 'Trip plan.md', bytes: 999, by: 'Mallory', mime: 'text/html' }, rec, later)
    expect(edited).toMatchObject({ name: 'Trip plan.md', mime: 'text/markdown', bytes: 120, by: 'Sam', addedAt: T, updatedAt: later, caption: 'For the trip' })
    expect(as.makeAsset({ id: rec.id, caption: '' }, rec, later).caption).toBeUndefined()
  })

  it('keeps only sensible extras', () => {
    const rec = as.makeAsset({ id: 'a1234567-abcd', name: 'clip.mp4', bytes: 10, width: 1920, height: 0, duration: 12.345, sourceUrl: 'javascript:alert(1)', source: 'other' }, null, T)
    expect(rec.width).toBeUndefined()
    expect(rec.duration).toBe(12.3)
    expect(rec.sourceUrl).toBeUndefined()
    expect(rec.source).toBeUndefined()
    expect(rec.kind).toBe('video')
    expect(as.makeAsset({ id: 'a1234567-abcd', name: 'x', bytes: as.MAX_BYTES * 2 }, null, T).bytes).toBe(0)
    expect(() => as.makeAsset({ id: '../x' })).toThrow()
  })

  it('refuses empty and oversized files', () => {
    expect(as.sizeError({ bytes: 0 })).toMatch(/empty/)
    expect(as.sizeError({ bytes: as.MAX_BYTES + 1 })).toMatch(/too big/)
    expect(as.sizeError({ bytes: 10, thumbBytes: as.MAX_THUMB_BYTES + 1 })).toMatch(/thumbnail/)
    expect(as.sizeError({ bytes: 10, thumbBytes: 10 })).toBe('')
  })

  it('sorts by when it was taken and groups by month', () => {
    const a = as.makeAsset({ id: 'a1111111-aaaa', name: 'a.jpg', bytes: 1, takenAt: '2026-10-01T10:00:00Z' }, null, T)
    const b = as.makeAsset({ id: 'a2222222-bbbb', name: 'b.jpg', bytes: 1, takenAt: '2026-11-02T10:00:00Z' }, null, T)
    const c = as.makeAsset({ id: 'a3333333-cccc', name: 'c.pdf', bytes: 1 }, null, T)
    expect(as.sortAssets([a, b, c]).map((x) => x.name)).toEqual(['c.pdf', 'b.jpg', 'a.jpg'])
    const groups = as.byMonth([a, b, c], (iso) => iso.slice(0, 7))
    expect(groups.map((g) => [g.label, g.assets.length])).toEqual([['November 2026', 2], ['October 2026', 1]])
  })

  it('lets the adder or the owner remove one, and anyone in their own Space', () => {
    const rec = { memberId: 'm1' }
    expect(as.canDelete(rec, { shared: true, memberId: 'm1', role: 'editor', writable: true })).toBe(true)
    expect(as.canDelete(rec, { shared: true, memberId: 'm2', role: 'editor', writable: true })).toBe(false)
    expect(as.canDelete(rec, { shared: true, memberId: 'm2', role: 'owner', writable: true })).toBe(true)
    expect(as.canDelete(rec, { shared: true, memberId: 'm1', role: 'viewer', writable: false })).toBe(false)
    expect(as.canDelete({ memberId: null }, { shared: false, writable: true })).toBe(true)
  })
})

describe('the family album as Assets (ADR-0043)', () => {
  const photo = {
    type: 'nomad/photo', id: 'pmhc2k1a0-abc123', addedAt: '2026-10-31T17:00:00.000Z', takenAt: '2026-10-31T16:20:00.000Z',
    width: 2560, height: 1920, bytes: 5000, by: 'Ilya', memberId: 'm1', updatedAt: '2026-11-01T09:00:00.000Z', caption: 'Costumes',
  }

  it('reads an album photo as a JPEG Asset with a thumbnail', () => {
    const a = as.fromPhoto(photo)
    expect(a).toMatchObject({ id: photo.id, name: 'Photo 2026-10-31.jpg', mime: 'image/jpeg', kind: 'image', thumb: true, width: 2560, height: 1920, bytes: 5000, by: 'Ilya', memberId: 'm1', caption: 'Costumes', takenAt: photo.takenAt })
    expect(as.fromPhoto({ ...photo, type: 'nomad/asset' })).toBeNull()
    expect(as.fromPhoto({ ...photo, id: '../x' })).toBeNull()
  })

  it('plans a move to the new paths that keeps when it was added', () => {
    const plan = as.legacyMove(photo)
    expect(plan.asset).toMatchObject({ id: photo.id, addedAt: photo.addedAt })
    expect(plan.files).toEqual([
      { from: '/photos/files/pmhc2k1a0-abc123.jpg', to: '/assets/files/pmhc2k1a0-abc123' },
      { from: '/photos/thumbs/pmhc2k1a0-abc123.jpg', to: '/assets/thumbs/pmhc2k1a0-abc123.jpg' },
    ])
    expect(plan.remove).toEqual(['/photos/items/pmhc2k1a0-abc123.json'])
    expect(as.legacyMove({})).toBeNull()
  })
})

describe('the AI’s saveAsset', () => {
  it('takes exactly one of text, base64 or url', () => {
    expect(() => assetRequest({})).toThrow(/exactly one/)
    expect(() => assetRequest({ text: 'a', url: 'https://x.test/' })).toThrow(/exactly one/)
    expect(() => assetRequest({ text: 'hi' })).toThrow(/name/)
    expect(() => assetRequest({ url: 'file:///etc/passwd' })).toThrow(/http/)
    expect(() => assetRequest({ base64: 'not base64!', name: 'a.bin' })).toThrow(/base64/)
  })

  it('reads text and base64 into bytes with a type', () => {
    const t = assetRequest({ text: '# Plan', name: '../plan.md', caption: 'Trip' })
    expect(t).toMatchObject({ from: 'text', name: 'plan.md', mime: 'text/markdown', caption: 'Trip' })
    expect(Buffer.from(t.bytes).toString()).toBe('# Plan')
    expect(assetRequest({ text: 'a,b', name: 'list' }).mime).toBe('text/plain')
    const b = assetRequest({ base64: 'data:image/png;base64,' + Buffer.from('PNG').toString('base64'), name: 'chart.png' })
    expect(b).toMatchObject({ from: 'base64', mime: 'image/png' })
    expect(Buffer.from(b.bytes).toString()).toBe('PNG')
    expect(assetRequest({ url: ' https://example.com/a.pdf ' })).toMatchObject({ from: 'url', url: 'https://example.com/a.pdf', name: '' })
  })

  it('refuses empty and oversized files', () => {
    expect(() => assetRequest({ text: '', name: 'a.txt' })).toThrow(/exactly one/)
    expect(() => sizeCheck(0)).toThrow(/empty/)
    expect(() => sizeCheck(as.MAX_BYTES + 1)).toThrow(/too big/)
  })

  it('names a fetched file from the URL and its type', () => {
    expect(nameForUrl('https://example.com/files/Report%202026.pdf', 'application/pdf')).toBe('Report 2026.pdf')
    expect(nameForUrl('https://example.com/image', 'image/png; charset=binary')).toBe('image.png')
    expect(nameForUrl('https://example.com/', 'text/html')).toBe('example.com.html')
    expect(nameForUrl('https://example.com/a', 'image/jpeg', 'Sunset')).toBe('Sunset.jpg')
    expect(nameForUrl('not a url')).toBe('Download')
  })
})
