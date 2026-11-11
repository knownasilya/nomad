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
      for (const k of ['MAX_BYTES', 'MAX_SIDE', 'THUMB_SIDE', 'QUALITY', 'THUMB_QUALITY', 'MAX_THUMB_BYTES', 'MAX_CAPTION', 'MAX_NAME', 'MAX_BATCH', 'MAX_TEXT_PREVIEW', 'MAX_HTML_PREVIEW', 'HTML_PREVIEW_CSP']) {
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
        ['app.js', 'code'], ['page.html', 'html'], ['old.htm', 'html'], ['doc.xhtml', 'html'], ['style.css', 'code'], ['list.csv', 'data'], ['data.json', 'data'], ['readme.txt', 'text'],
        ['letter.docx', 'document'], ['backup.zip', 'archive'], ['thing.bin', 'other'],
        ['novel.epub', 'book'], ['novel.mobi', 'book'], ['novel.azw3', 'book'],
      ]
      for (const [file, kind] of cases) expect(m.kindOf(m.mimeOf(file), file), file).toBe(kind)
      expect(m.isTextKind('code')).toBe(true)
      expect(m.isTextKind('pdf')).toBe(false)
      expect(m.isTextKind('html')).toBe(false)
      expect(m.hasSource('html')).toBe(true)
      expect(m.hasSource('markdown')).toBe(true)
      expect(m.hasSource('code')).toBe(false)
      expect(m.kindOf('text/html', 'download')).toBe('html')
      for (const k of m.KINDS) {
        expect(m.KIND_ICONS[k], k).toBeTruthy()
        expect(m.KIND_LABELS[k], k).toBeTruthy()
      }
    })

    it('puts the preview policy first in an HTML file, after its doctype', () => {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${m.HTML_PREVIEW_CSP}">`
      expect(m.withPreviewCsp('<!DOCTYPE html>\n<html><script>x()</script>')).toBe('<!DOCTYPE html>' + meta + '\n<html><script>x()</script>')
      expect(m.withPreviewCsp('<p>hi</p>')).toBe('<!doctype html>' + meta + '<p>hi</p>')
      expect(m.HTML_PREVIEW_CSP).toContain("connect-src 'none'")
      expect(m.HTML_PREVIEW_CSP).toContain("form-action 'none'")
      expect(m.HTML_PREVIEW_CSP).not.toMatch(/https?:\/\/(?!tile\.openstreetmap\.org)/)
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
      expect(m.formatBytes(1.5 * 1073741824)).toBe('1.5 GB')
      expect(m.formatBytes(m.MAX_BYTES)).toBe('500 MB')
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

    it('cleans tags and folders the same way', () => {
      expect(m.cleanTag('  #Road   Trip ')).toBe('road trip')
      expect(m.cleanTag('a,b')).toBe('a b')
      expect(m.cleanTag('x'.repeat(100)).length).toBe(m.MAX_TAG)
      expect(m.normalizeTags('Taxes, taxes,#2026,, ')).toEqual(['taxes', '2026'])
      expect(m.normalizeTags(Array.from({ length: 30 }, (_, i) => 't' + i)).length).toBe(m.MAX_TAGS)
      expect(m.cleanFolder(' Recipes //  Desserts / ')).toBe('Recipes/Desserts')
      expect(m.cleanFolder('../a/./b\\c')).toBe('a/b/c')
      expect(m.cleanFolder('')).toBe('')
      expect(m.cleanFolder(Array.from({ length: 12 }, (_, i) => 'f' + i).join('/')).split('/').length).toBe(m.MAX_FOLDER_DEPTH)
      expect(m.cleanFolderName('a/b')).toBe('a b')
      expect(m.folderName('Recipes/Desserts')).toBe('Desserts')
      expect(m.parentFolder('Recipes/Desserts')).toBe('Recipes')
      expect(m.joinFolder('', 'Recipes')).toBe('Recipes')
      expect(m.joinFolder('Recipes', 'Pies')).toBe('Recipes/Pies')
      expect(m.inFolder('Recipes/Pies', 'Recipes')).toBe(true)
      expect(m.inFolder('Recipes2', 'Recipes')).toBe(false)
      expect(m.inFolder('anything', '')).toBe(true)
    })

    it('lists folders and tags, and filters by them', () => {
      const list = [
        { name: 'Pie.md', kind: 'markdown', mime: 'text/markdown', folder: 'Recipes/Desserts', tags: ['baking', 'family'] },
        { name: 'Soup.md', kind: 'markdown', mime: 'text/markdown', folder: 'Recipes', tags: ['family'] },
        { name: 'Beach.jpg', kind: 'image', mime: 'image/jpeg' },
      ]
      const folders = m.allFolders(list, [{ path: 'Taxes/2026' }, 'Empty'])
      expect(folders).toEqual(['Empty', 'Recipes', 'Recipes/Desserts', 'Taxes', 'Taxes/2026'])
      expect(m.childFolders(folders, '', list)).toEqual([
        { path: 'Empty', name: 'Empty', count: 0 },
        { path: 'Recipes', name: 'Recipes', count: 2 },
        { path: 'Taxes', name: 'Taxes', count: 0 },
      ])
      expect(m.childFolders(folders, 'Recipes', list)).toEqual([{ path: 'Recipes/Desserts', name: 'Desserts', count: 1 }])
      expect(m.tagCounts(list)).toEqual([{ tag: 'family', count: 2 }, { tag: 'baking', count: 1 }])
      expect(m.filterAssets(list, { folder: '' }).map((a) => a.name)).toEqual(['Beach.jpg'])
      expect(m.filterAssets(list, { folder: 'Recipes' }).map((a) => a.name)).toEqual(['Soup.md'])
      expect(m.filterAssets(list, { tag: '#Family' }).map((a) => a.name)).toEqual(['Pie.md', 'Soup.md'])
      expect(m.filterAssets(list, { query: 'desserts' }).map((a) => a.name)).toEqual(['Pie.md'])
      expect(m.filterAssets(list, { query: 'baking' }).map((a) => a.name)).toEqual(['Pie.md'])
    })
  })
}

describe('tags and folders on records', () => {
  const rec = as.makeAsset({ id: 'a1234567-abcd', name: 'pie.md', bytes: 3, tags: 'Baking, #family', folder: ' Recipes / Desserts ' }, null, T)

  it('keeps them through an edit, and drops them when cleared', () => {
    expect(rec).toMatchObject({ tags: ['baking', 'family'], folder: 'Recipes/Desserts' })
    const renamed = as.makeAsset({ id: rec.id, name: 'Pie.md' }, rec, T)
    expect(renamed).toMatchObject({ tags: ['baking', 'family'], folder: 'Recipes/Desserts' })
    const cleared = as.makeAsset({ id: rec.id, tags: [], folder: '' }, rec, T)
    expect(cleared.tags).toBeUndefined()
    expect(cleared.folder).toBeUndefined()
  })

  it('adds and takes away tags in bulk', () => {
    expect(as.changeTags(['a', 'b'], { add: ['C', 'a'], remove: ['b'] })).toEqual(['a', 'c'])
    expect(as.changeTags(undefined, { add: 'x, y' })).toEqual(['x', 'y'])
  })

  it('keeps a folder record under a key of its path', () => {
    expect(as.folderKey('Recipes/Desserts')).toMatch(/^[0-9a-f]{16}$/)
    expect(as.folderKey(' Recipes / Desserts')).toBe(as.folderKey('Recipes/Desserts'))
    expect(as.folderKey('Recipes')).not.toBe(as.folderKey('Recipes/Desserts'))
    expect(as.pathsOf().folder('Recipes')).toBe('/assets/folders/' + as.folderKey('Recipes') + '.json')
    const f = as.makeFolder(' Taxes/2026 ', null, T)
    expect(f).toEqual({ type: as.FOLDER_TYPE, path: 'Taxes/2026', createdAt: T, updatedAt: T })
    expect(as.isFolder(f)).toBe(true)
    expect(() => as.makeFolder(' / ')).toThrow()
  })

  it('plans moving and renaming a folder with what is in it', () => {
    const list = [
      { id: 'a1111111-aaaa', folder: 'Recipes' },
      { id: 'a2222222-bbbb', folder: 'Recipes/Desserts' },
      { id: 'a3333333-cccc', folder: 'Recipes2' },
      { id: 'a4444444-dddd' },
    ]
    const kept = [{ path: 'Recipes/Desserts' }, { path: 'Recipes/Empty' }, { path: 'Other' }]
    const plan = as.moveFolderPlan(list, kept, 'Recipes', 'Food/Recipes')
    expect(plan.assets).toEqual([
      { id: 'a1111111-aaaa', folder: 'Food/Recipes' },
      { id: 'a2222222-bbbb', folder: 'Food/Recipes/Desserts' },
    ])
    expect(plan.remove).toEqual(['Recipes/Desserts', 'Recipes/Empty'])
    expect(plan.keep).toEqual(['Food/Recipes', 'Food/Recipes/Desserts', 'Food/Recipes/Empty'])
    expect(() => as.moveFolderPlan(list, kept, 'Recipes', 'Recipes/Inside')).toThrow(/itself/)
    expect(() => as.moveFolderPlan(list, kept, 'Recipes', '')).toThrow()
    expect(as.deleteFolderPlan(list, kept, 'Recipes')).toEqual({ assets: ['a1111111-aaaa', 'a2222222-bbbb'], remove: ['Recipes/Desserts', 'Recipes/Empty'] })
  })
})

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

  it('takes an openui-lang program as a page, always an .html file', () => {
    expect(assetRequest({ openui: 'root = Stack([])', title: 'Trip plan' })).toMatchObject({ from: 'openui', name: 'Trip plan.html', mime: 'text/html', title: 'Trip plan', source: 'root = Stack([])' })
    expect(assetRequest({ openui: 'x', name: 'visits.md', title: 'Visits' })).toMatchObject({ name: 'visits.html', title: 'Visits' })
    expect(assetRequest({ openui: 'x', name: 'report.htm' })).toMatchObject({ name: 'report.htm', title: 'report' })
    expect(() => assetRequest({ openui: 'x' })).toThrow(/name|title/)
    expect(() => assetRequest({ openui: 'x', text: 'y', name: 'a.html' })).toThrow(/exactly one/)
    expect(() => assetRequest({ openui: 'x'.repeat(300 * 1024), name: 'a.html' })).toThrow(/too long/)
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
    expect(() => sizeCheck(as.MAX_AI_BYTES + 1)).toThrow(/too big/)
  })

  it('names a fetched file from the URL and its type', () => {
    expect(nameForUrl('https://example.com/files/Report%202026.pdf', 'application/pdf')).toBe('Report 2026.pdf')
    expect(nameForUrl('https://example.com/image', 'image/png; charset=binary')).toBe('image.png')
    expect(nameForUrl('https://example.com/', 'text/html')).toBe('example.com.html')
    expect(nameForUrl('https://example.com/a', 'image/jpeg', 'Sunset')).toBe('Sunset.jpg')
    expect(nameForUrl('not a url')).toBe('Download')
  })
})
