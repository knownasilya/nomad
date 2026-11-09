// E-books in Assets (app/userland/assets/js/book/parse.js): EPUB and MOBI read into the reader's shape.
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { openBook, bookFormat, palmDoc, trailingSize, resolvePath, huffCdic, BookError } from '../../app/userland/assets/js/book/parse.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function epub ({ nav = true, encryption = null } = {}) {
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Walk</dc:title><dc:creator>Ann Author</dc:creator></metadata>
  <manifest>
    ${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/two%20b.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="img" href="images/map.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml">One</a><ol><li><a href="text/one.xhtml#part">Part</a></li></ol></li><li><a href="text/two%20b.xhtml">Two</a></li></ol></nav></body></html>'),
    'OEBPS/toc.ncx': strToU8('<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="a"><navLabel><text>First</text></navLabel><content src="text/one.xhtml"/><navPoint id="b"><navLabel><text>Inner</text></navLabel><content src="text/two%20b.xhtml#x"/></navPoint></navPoint></navMap></ncx>'),
    'OEBPS/text/one.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../style.css"/></head><body><h1>One</h1><img src="../images/map.png"/><p id="part">Part</p></body></html>'),
    'OEBPS/text/two b.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Two</h1></body></html>'),
    'OEBPS/style.css': strToU8('h1 { color: red }'),
    'OEBPS/images/map.png': PNG,
  }
  if (encryption) files['META-INF/encryption.xml'] = strToU8(encryption)
  return zipSync(files)
}

// A Palm database with one text record (PalmDOC, literals only), a picture, and the end records.
function mobi ({ text, title = 'Short Book', author = 'Bo Writer', drm = false, compression = 2, extraFlags = 0, trailing = [] }) {
  const enc = new TextEncoder()
  const body = enc.encode(text)
  // Every byte as a literal: 0x09-0x7f stand for themselves, anything else goes behind a 0x01 escape.
  const packed = []
  for (const b of body) {
    if (compression === 1 || (b >= 0x09 && b <= 0x7f) || b === 0) packed.push(b)
    else packed.push(1, b)
  }
  const textRec = new Uint8Array([...packed, ...trailing])
  const exth = []
  const put = (type, s) => {
    const v = enc.encode(s)
    exth.push(...u32(type), ...u32(v.length + 8), ...v)
  }
  put(100, author)
  put(503, title)
  const exthRec = [...enc.encode('EXTH'), ...u32(12 + exth.length), ...u32(2), ...exth]
  const mobiLen = 0xe8
  const r0 = new Uint8Array(16 + mobiLen + exthRec.length + 64)
  const v = new DataView(r0.buffer)
  v.setUint16(0, compression)
  v.setUint32(4, body.length)
  v.setUint16(8, 1)
  v.setUint16(10, 4096)
  v.setUint16(12, drm ? 2 : 0)
  r0.set(enc.encode('MOBI'), 16)
  v.setUint32(20, mobiLen)
  v.setUint32(24, 2)
  v.setUint32(28, 65001)
  v.setUint32(36, 6)
  v.setUint32(84, 0)
  v.setUint32(88, 0)
  v.setUint32(108, 2) // first picture
  v.setUint32(128, 0x40) // EXTH follows
  v.setUint16(16 + 0xe2, extraFlags)
  r0.set(exthRec, 16 + mobiLen)
  const records = [r0, textRec, PNG, enc.encode('FLIS\0\0\0\0'), enc.encode('FCIS\0\0\0\0')]
  const head = 78 + records.length * 8 + 2
  const total = head + records.reduce((n, r) => n + r.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  out.set(enc.encode('short_book'), 0)
  out.set(enc.encode('BOOKMOBI'), 60)
  dv.setUint16(76, records.length)
  let at = head
  records.forEach((r, i) => {
    dv.setUint32(78 + i * 8, at)
    out.set(r, at)
    at += r.length
  })
  return out
}
function u32 (n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] }

describe('e-books', () => {
  it('tells an EPUB from a MOBI from anything else', () => {
    expect(bookFormat(epub())).toBe('epub')
    expect(bookFormat(mobi({ text: 'hi' }))).toBe('mobi')
    expect(bookFormat(new TextEncoder().encode('%PDF-1.7 and so on, long enough to look at byte sixty and beyond it'))).toBe('')
    expect(() => openBook(new Uint8Array(100))).toThrow(BookError)
  })

  it('resolves paths inside a book', () => {
    expect(resolvePath('OEBPS/text/one.xhtml', '../images/a%20b.png#x')).toBe('OEBPS/images/a b.png')
    expect(resolvePath('OEBPS/content.opf', 'text/one.xhtml')).toBe('OEBPS/text/one.xhtml')
    expect(resolvePath('a.html', '/root.css')).toBe('root.css')
    expect(resolvePath('a/b.html', '#top')).toBe('a/b.html')
  })

  it('reads an EPUB: its title, pages in order, contents and pictures', () => {
    const book = openBook(epub(), { DOMParser })
    expect(book).toMatchObject({ format: 'epub', title: 'The Walk', author: 'Ann Author' })
    expect(book.sections.map((s) => s.path)).toEqual(['OEBPS/text/one.xhtml', 'OEBPS/text/two b.xhtml'])
    expect(book.sections[0].html).toContain('<h1>One</h1>')
    expect(book.toc).toEqual([
      { label: 'One', depth: 0, section: 0, anchor: '' },
      { label: 'Part', depth: 1, section: 0, anchor: 'part' },
      { label: 'Two', depth: 0, section: 1, anchor: '' },
    ])
    expect(book.resources.get('OEBPS/images/map.png')).toMatchObject({ type: 'image/png' })
    expect(book.resources.get('OEBPS/style.css').type).toBe('text/css')
  })

  it('falls back to the EPUB 2 contents (NCX)', () => {
    const book = openBook(epub({ nav: false }), { DOMParser })
    expect(book.toc).toEqual([
      { label: 'First', depth: 0, section: 0, anchor: '' },
      { label: 'Inner', depth: 1, section: 1, anchor: 'x' },
    ])
  })

  it('says so when an EPUB has DRM', () => {
    const locked = epub({ encryption: '<encryption><EncryptedData><EncryptionMethod Algorithm="http://ns.adobe.com/adept"/></EncryptedData></encryption>' })
    expect(() => openBook(locked, { DOMParser })).toThrow(/DRM/)
  })

  it('reads a MOBI: text, title, author, pictures and links to positions', () => {
    const text = '<html><body><p>Contents: <a filepos=0000000060>Chapter 1</a></p><mbp:pagebreak/><h2>Chapter 1</h2><p>Café</p><img recindex="00001"></body></html>'
    const book = openBook(mobi({ text }))
    expect(book).toMatchObject({ format: 'mobi', title: 'Short Book', author: 'Bo Writer' })
    const html = book.sections[0].html
    expect(html).toContain('Café')
    expect(html).toContain('<img src="images/00001.png">')
    expect(html).toContain('href="#filepos60"')
    expect(html).toContain('<a id="filepos60"></a>')
    expect(html).not.toContain('mbp:pagebreak')
    expect(book.resources.get('images/00001.png').type).toBe('image/png')
  })

  it('strips trailing entries from MOBI text records', () => {
    // flags 0b11: the last entry is 3 bytes (its size a backward varint, 0x83), and before it the
    // multibyte byte (0: just itself).
    const data = new Uint8Array([65, 66, 67, 0, 9, 9, 0x83])
    expect(trailingSize(data, 0b11)).toBe(4)
    const book = openBook(mobi({ text: '<p>Hello</p>', extraFlags: 0b11, trailing: [0, 9, 9, 0x83] }))
    expect(book.sections[0].html).toContain('<p>Hello</p></body>')
  })

  it('refuses a MOBI with DRM, and reads one with no compression', () => {
    expect(() => openBook(mobi({ text: '<p>x</p>', drm: true }))).toThrow(/DRM/)
    expect(openBook(mobi({ text: '<p>plain</p>', compression: 1 })).sections[0].html).toContain('<p>plain</p>')
  })

  it('decompresses PalmDOC back-references and space pairs', () => {
    // "abcabc" as "abc" + a copy of 3 bytes from 3 back, then " x" as 0xc0 ^ 'x'.
    const m = (3 << 3) | 0
    const out = palmDoc(new Uint8Array([0x61, 0x62, 0x63, 0x80 | (m >> 8), m & 255, 0x78 ^ 0x80]))
    expect(new TextDecoder().decode(out)).toBe('abcabc x')
  })

  it('decompresses HUFF/CDIC: each 8-bit code a phrase, phrases compressed in turn', () => {
    // Every code is 8 bits and terminal, so byte i reads as phrase 255 - i.
    const huff = new Uint8Array(24 + 256 * 4 + 64 * 4)
    const hv = new DataView(huff.buffer)
    huff.set(new TextEncoder().encode('HUFF'), 0)
    hv.setUint32(4, 24)
    hv.setUint32(8, 24)
    hv.setUint32(12, 24 + 1024)
    for (let i = 0; i < 256; i++) hv.setUint32(24 + i * 4, 8 | 0x80 | (255 << 8))
    // Phrase 255 - i is the byte i, except phrase 255 - 0x41 ('A'), which is itself compressed:
    // the bytes 'h' 'i' run through the same code.
    const phrases = []
    for (let i = 0; i < 256; i++) phrases[255 - i] = { bytes: [i], done: true }
    phrases[255 - 0x41] = { bytes: [0x68, 0x69], done: false }
    const offsets = []
    const body = []
    for (const ph of phrases) {
      offsets.push(256 * 2 + body.length)
      const blen = ph.bytes.length | (ph.done ? 0x8000 : 0)
      body.push(blen >> 8, blen & 255, ...ph.bytes)
    }
    const cdic = new Uint8Array(16 + 256 * 2 + body.length)
    const cv = new DataView(cdic.buffer)
    cdic.set(new TextEncoder().encode('CDIC'), 0)
    cv.setUint32(4, 16)
    cv.setUint32(8, 256)
    cv.setUint32(12, 8)
    offsets.forEach((o, i) => cv.setUint16(16 + i * 2, o))
    cdic.set(body, 16 + 256 * 2)
    const unpack = huffCdic(huff, [cdic])
    expect(new TextDecoder().decode(unpack(new TextEncoder().encode('Say A!')))).toBe('Say hi!')
  })
})
