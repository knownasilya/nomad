// E-books in Assets: an EPUB or a MOBI (also PRC, AZW and AZW3 without DRM) read into one shape
// the reader (./reader.js) shows, on desktop's nomad://assets and in the phone's viewer page
// (./phone.js, bundled into mobile/lib/docViewerHtml.ts).
//
//   { format: 'epub' | 'mobi', title, author,
//     sections: [{ path, html, type }],          // one page of the book each: its markup as text
//     toc: [{ label, section, anchor, depth }],   // the book's contents, pointing into sections
//     resources: Map(path -> { data, type }),     // pictures, styles, fonts, by their path
//     cover: path | '' }                          // the cover picture's path in resources, if it has one
//
// Nothing here runs the book: the reader shows each section in a sandboxed frame with no scripts.
// The XML parser is the page's DOMParser (or one passed in, as the tests do).

import { unzipSync } from 'fflate'

export class BookError extends Error {}

export function bookFormat(bytes) {
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'epub'
  const kind = ascii(bytes, 60, 8)
  if (kind === 'BOOKMOBI' || kind === 'TEXtREAd') return 'mobi'
  return ''
}

export function openBook(bytes, opts = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const format = bookFormat(data)
  if (format === 'epub') return openEpub(data, opts)
  if (format === 'mobi') return openMobi(data)
  throw new BookError('This file isn’t an EPUB or MOBI book')
}

// Paths
// =

export function resolvePath(base, href) {
  const clean = String(href || '').split('#')[0]
  if (!clean) return base
  let path
  try {
    path = decodeURIComponent(clean)
  } catch {
    path = clean
  }
  if (path.startsWith('/')) return normalize(path.slice(1))
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
  return normalize(dir + path)
}

function normalize(path) {
  const out = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

const EXT_TYPES = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', css: 'text/css', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf',
  woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', mp4: 'video/mp4',
}
export const typeOfPath = (path) => EXT_TYPES[(/\.([a-z0-9]+)$/i.exec(path) || [])[1]?.toLowerCase()] || 'application/octet-stream'

// EPUB
// =

const textOf = (bytes) => new TextDecoder('utf-8').decode(bytes)

// Elements by local name, whatever their namespace prefix (dc:title, opf:item, …).
function byName(node, name) {
  const out = []
  const all = node.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if ((all[i].localName || all[i].nodeName.split(':').pop()) === name) out.push(all[i])
  return out
}
const childrenNamed = (node, name) => [...node.childNodes].filter((c) => c.nodeType === 1 && (c.localName || c.nodeName.split(':').pop()) === name)

function xml(text, opts) {
  const P = opts.DOMParser || globalThis.DOMParser
  return new P().parseFromString(text, 'application/xml')
}

function openEpub(data, opts) {
  let files
  try {
    files = unzipSync(data)
  } catch {
    throw new BookError('This EPUB is damaged: it can’t be unpacked')
  }
  const names = Object.keys(files)
  if (names.includes('META-INF/encryption.xml') && /EncryptedData/.test(textOf(files['META-INF/encryption.xml'])) && /adobe|apple|kindle|fairplay|readium/i.test(textOf(files['META-INF/encryption.xml']))) {
    throw new BookError('This book is locked with DRM, so it can only be read in the app it came from')
  }
  let opfPath = ''
  if (files['META-INF/container.xml']) {
    const root = byName(xml(textOf(files['META-INF/container.xml']), opts), 'rootfile')[0]
    opfPath = root?.getAttribute('full-path') || ''
  }
  if (!files[opfPath]) opfPath = names.find((n) => /\.opf$/i.test(n)) || ''
  if (!opfPath) throw new BookError('This EPUB has no table of its pages (no .opf file)')
  const opf = xml(textOf(files[opfPath]), opts)

  const meta = (name) => (byName(opf, name)[0]?.textContent || '').replace(/\s+/g, ' ').trim()
  const manifest = new Map()
  for (const item of byName(opf, 'item')) {
    const id = item.getAttribute('id')
    const path = resolvePath(opfPath, item.getAttribute('href'))
    manifest.set(id, { path, type: item.getAttribute('media-type') || typeOfPath(path), props: item.getAttribute('properties') || '' })
  }
  const resources = new Map()
  for (const name of names) {
    if (name.endsWith('/')) continue
    const listed = [...manifest.values()].find((m) => m.path === name)
    resources.set(name, { data: files[name], type: listed?.type || typeOfPath(name) })
  }

  const spine = byName(opf, 'spine')[0]
  const sections = []
  for (const ref of spine ? childrenNamed(spine, 'itemref') : []) {
    const item = manifest.get(ref.getAttribute('idref'))
    if (!item || !files[item.path]) continue
    if (!/html|xml/.test(item.type)) continue
    sections.push({ path: item.path, type: item.type, html: textOf(files[item.path]), linear: ref.getAttribute('linear') !== 'no' })
  }
  if (!sections.length) throw new BookError('This EPUB has no pages to show')

  const where = (path, href) => {
    const target = resolvePath(path, href)
    const section = sections.findIndex((s) => s.path === target)
    const hash = String(href || '').split('#')[1]
    return section < 0 ? null : { section, anchor: hash ? decodeURIComponentSafe(hash) : '' }
  }

  // The contents: the EPUB 3 nav document, else the EPUB 2 NCX.
  let toc = []
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props))
  if (nav && files[nav.path]) toc = navToc(xml(textOf(files[nav.path]), opts), nav.path, where)
  if (!toc.length) {
    const ncxId = spine?.getAttribute('toc')
    const ncx = manifest.get(ncxId) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
    if (ncx && files[ncx.path]) toc = ncxToc(xml(textOf(files[ncx.path]), opts), ncx.path, where)
  }

  return { format: 'epub', title: meta('title'), author: meta('creator'), sections, toc, resources, cover: epubCover(opf, manifest, resources) }
}

// The cover picture: EPUB 3's `cover-image` item, else EPUB 2's <meta name="cover">, else a
// picture called "cover".
function epubCover(opf, manifest, resources) {
  const isPicture = (m) => m && /^image\//.test(m.type) && resources.has(m.path)
  const items = [...manifest.values()]
  const byProps = items.find((m) => /\bcover-image\b/.test(m.props))
  if (isPicture(byProps)) return byProps.path
  const metaId = byName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
  if (metaId && isPicture(manifest.get(metaId))) return manifest.get(metaId).path
  const named = [...manifest.entries()].find(([id, m]) => isPicture(m) && (/cover/i.test(id) || /cover/i.test(m.path.split('/').pop())))
  return named ? named[1].path : ''
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function navToc(doc, path, where) {
  const navs = byName(doc, 'nav')
  const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0]
  const ol = nav && childrenNamed(nav, 'ol')[0]
  const out = []
  const walk = (list, depth) => {
    for (const li of childrenNamed(list, 'li')) {
      const a = childrenNamed(li, 'a')[0] || childrenNamed(li, 'span')[0]
      const label = (a?.textContent || '').replace(/\s+/g, ' ').trim()
      const at = a?.getAttribute('href') ? where(path, a.getAttribute('href')) : null
      if (label && at) out.push({ label, depth, ...at })
      const sub = childrenNamed(li, 'ol')[0]
      if (sub) walk(sub, depth + 1)
    }
  }
  if (ol) walk(ol, 0)
  return out
}

function ncxToc(doc, path, where) {
  const out = []
  const walk = (node, depth) => {
    for (const point of childrenNamed(node, 'navPoint')) {
      const label = (byName(point, 'text')[0]?.textContent || '').replace(/\s+/g, ' ').trim()
      const src = childrenNamed(point, 'content')[0]?.getAttribute('src')
      const at = src ? where(path, src) : null
      if (label && at) out.push({ label, depth, ...at })
      walk(point, depth + 1)
    }
  }
  const map = byName(doc, 'navMap')[0]
  if (map) walk(map, 0)
  return out
}

// MOBI
// =
// A Palm database: record 0 has the PalmDOC and MOBI headers (and EXTH metadata), then the text in
// records of 4 KB, compressed with PalmDOC's LZ77 or with HUFF/CDIC, then the pictures. A book in
// the newer KF8 format (AZW3) keeps its text the same way; a "combination" file has the old book
// first, which is what is read here.

function ascii(bytes, start, n) {
  let s = ''
  for (let i = start; i < start + n && i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

export function openMobi(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(76)
  const offsets = []
  for (let i = 0; i < count; i++) offsets.push(view.getUint32(78 + i * 8))
  const record = (i) => (i >= 0 && i < count ? data.subarray(offsets[i], i + 1 < count ? offsets[i + 1] : data.length) : null)
  const r0 = record(0)
  if (!r0 || r0.length < 16) throw new BookError('This MOBI book is damaged')
  const h = new DataView(r0.buffer, r0.byteOffset, r0.byteLength)
  const compression = h.getUint16(0)
  const textRecords = h.getUint16(8)
  if (h.getUint16(12) !== 0) throw new BookError('This book is locked with DRM, so it can only be read in the app it came from')

  let encoding = 'windows-1252'
  let firstImage = -1
  let extraFlags = 0
  let huffOffset = 0
  let huffCount = 0
  let title = ''
  let author = ''
  let version = 0
  let coverAt = -1
  const isMobi = ascii(r0, 16, 4) === "MOBI"
  if (isMobi) {
    const len = h.getUint32(20)
    version = h.getUint32(36)
    if (h.getUint32(28) === 65001) encoding = 'utf-8'
    firstImage = h.getUint32(108)
    huffOffset = h.getUint32(112)
    huffCount = h.getUint32(116)
    if (len >= 0xe4 && r0.length >= 16 + 0xe4) extraFlags = h.getUint16(16 + 0xe2)
    const nameAt = h.getUint32(84)
    const nameLen = h.getUint32(88)
    if (nameAt && nameAt + nameLen <= r0.length) title = new TextDecoder(encoding).decode(r0.subarray(nameAt, nameAt + nameLen))
    if (h.getUint32(128) & 0x40) {
      const exth = readExth(r0, 16 + len, encoding)
      author = exth.get(100) || ''
      title = exth.get(503) || title
      if (exth.has(201)) coverAt = exth.get(201)
    }
  } else {
    title = ascii(data, 0, 32).replace(/\0.*$/, '')
  }

  let decompress
  if (compression === 1) decompress = (b) => b
  else if (compression === 2) decompress = palmDoc
  else if (compression === 17480) decompress = huffCdic(record(huffOffset), Array.from({ length: Math.max(0, huffCount - 1) }, (_, i) => record(huffOffset + 1 + i)))
  else throw new BookError('This MOBI book uses a kind of compression Nomad can’t read')

  const parts = []
  let total = 0
  for (let i = 1; i <= textRecords; i++) {
    const raw = record(i)
    if (!raw) break
    const text = decompress(raw.subarray(0, raw.length - trailingSize(raw, extraFlags)))
    parts.push(text)
    total += text.length
  }
  const text = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    text.set(p, at)
    at += p.length
  }

  // Pictures: the records from firstImage, until one isn't a picture.
  const resources = new Map()
  const images = []
  if (firstImage > 0 && firstImage < count) {
    for (let i = firstImage; i < count; i++) {
      const rec = record(i)
      const type = imageType(rec)
      if (!type) {
        // FLIS, FCIS, SRCS and friends end the pictures; a stray record in between is skipped.
        if (/^(FLIS|FCIS|SRCS|EOF|BOUN|FDST|DATP|RESC|CRES|CMET|PAGE|kind|AUDI|VIDE)/.test(ascii(rec || [], 0, 4))) {
          if (ascii(rec || [], 0, 4) === 'RESC' || ascii(rec || [], 0, 4) === 'CRES') {
            images.push(null)
            continue
          }
          break
        }
        images.push(null)
        continue
      }
      const path = `images/${String(images.length + 1).padStart(5, '0')}.${type.split('/')[1].replace('jpeg', 'jpg')}`
      resources.set(path, { data: rec, type })
      images.push(path)
    }
  }

  const html = version >= 8 ? kf8Html(text, encoding, images) : mobi7Html(text, encoding, images)
  // The cover is the picture EXTH 201 points at, counted from the first picture.
  const cover = (coverAt >= 0 && images[coverAt]) || ''
  return { format: 'mobi', title, author, sections: [{ path: 'book.html', type: 'text/html', html, linear: true }], toc: [], resources, cover }
}

function readExth(r0, at, encoding) {
  const out = new Map()
  if (ascii(r0, at, 4) !== 'EXTH') return out
  const v = new DataView(r0.buffer, r0.byteOffset, r0.byteLength)
  const n = v.getUint32(at + 8)
  let p = at + 12
  for (let i = 0; i < n && p + 8 <= r0.length; i++) {
    const type = v.getUint32(p)
    const len = v.getUint32(p + 4)
    if (len < 8 || p + len > r0.length) break
    if (!out.has(type) && (type === 100 || type === 503)) out.set(type, new TextDecoder(encoding).decode(r0.subarray(p + 8, p + len)).trim())
    // 201: the cover, as a picture's number counted from the first picture.
    if (!out.has(type) && type === 201 && len >= 12) out.set(type, v.getUint32(p + 8))
    p += len
  }
  return out
}

// The bytes a text record ends with that aren't text (MOBI's "extra data flags").
export function trailingSize(data, flags) {
  let num = 0
  const size = data.length
  for (let f = flags >> 1; f; f >>= 1) {
    if (f & 1) {
      let bitpos = 0
      let result = 0
      let p = size - num
      for (;;) {
        const v = data[p - 1]
        result |= (v & 0x7f) << bitpos
        bitpos += 7
        p--
        if (v & 0x80 || bitpos >= 28 || p === 0) break
      }
      num += result
    }
  }
  if (flags & 1) num += (data[size - num - 1] & 3) + 1
  return Math.min(num, size)
}

// PalmDOC's LZ77.
export function palmDoc(input) {
  const out = new Uint8Array(input.length * 8)
  let o = 0
  for (let i = 0; i < input.length; ) {
    const c = input[i++]
    if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < input.length; k++) out[o++] = input[i++]
    } else if (c < 0x80) {
      out[o++] = c
    } else if (c >= 0xc0) {
      out[o++] = 0x20
      out[o++] = c ^ 0x80
    } else {
      if (i >= input.length) break
      const m = (c << 8) | input[i++]
      const dist = (m >> 3) & 0x7ff
      const len = (m & 7) + 3
      if (dist > o || !dist) continue
      for (let k = 0; k < len; k++, o++) out[o] = out[o - dist]
    }
  }
  return out.subarray(0, o)
}

// HUFF/CDIC: a Huffman code over a dictionary of phrases, each of which may be compressed itself.
export function huffCdic(huff, cdics) {
  if (!huff || ascii(huff, 0, 4) !== 'HUFF') throw new BookError('This MOBI book is damaged')
  const hv = new DataView(huff.buffer, huff.byteOffset, huff.byteLength)
  const off1 = hv.getUint32(8)
  const off2 = hv.getUint32(12)
  const dict1 = []
  for (let i = 0; i < 256; i++) {
    const v = hv.getUint32(off1 + i * 4)
    const codelen = v & 0x1f
    const term = v & 0x80
    const maxcode = (Math.floor(v / 256) + 1) * 2 ** (32 - codelen) - 1
    dict1.push([codelen, term, maxcode])
  }
  const mincode = [0]
  const maxcode = [0]
  for (let len = 1; len <= 32; len++) {
    mincode.push(hv.getUint32(off2 + (len - 1) * 8) * 2 ** (32 - len))
    maxcode.push((hv.getUint32(off2 + (len - 1) * 8 + 4) + 1) * 2 ** (32 - len) - 1)
  }
  const dictionary = []
  for (const cdic of cdics) {
    if (!cdic || ascii(cdic, 0, 4) !== 'CDIC') continue
    const cv = new DataView(cdic.buffer, cdic.byteOffset, cdic.byteLength)
    const phrases = cv.getUint32(8)
    const bits = cv.getUint32(12)
    const n = Math.min(2 ** bits, phrases - dictionary.length)
    for (let i = 0; i < n; i++) {
      const off = cv.getUint16(16 + i * 2)
      const blen = cv.getUint16(16 + off)
      dictionary.push([cdic.subarray(18 + off, 18 + off + (blen & 0x7fff)), blen & 0x8000])
    }
  }

  function unpack(data, depth = 0) {
    if (depth > 32) throw new BookError('This MOBI book is damaged')
    const padded = new Uint8Array(data.length + 8)
    padded.set(data)
    const dv = new DataView(padded.buffer)
    let bitsleft = data.length * 8
    let pos = 0
    const out = []
    let size = 0
    for (;;) {
      const i = pos >> 3
      const sh = pos & 7
      const code = sh ? ((dv.getUint32(i) << sh) | (padded[i + 4] >>> (8 - sh))) >>> 0 : dv.getUint32(i)
      let [codelen, term, max] = dict1[code >>> 24]
      if (!term) {
        while (codelen < 32 && code < mincode[codelen]) codelen++
        max = maxcode[codelen]
      }
      pos += codelen
      bitsleft -= codelen
      if (bitsleft < 0 || !codelen) break
      const r = Math.floor((max - code) / 2 ** (32 - codelen))
      const entry = dictionary[r]
      if (!entry) break
      let [slice, done] = entry
      if (!done) {
        dictionary[r] = [new Uint8Array(0), 1]
        slice = unpack(slice, depth + 1)
        dictionary[r] = [slice, 1]
      }
      out.push(slice)
      size += slice.length
    }
    const res = new Uint8Array(size)
    let o = 0
    for (const s of out) {
      res.set(s, o)
      o += s.length
    }
    return res
  }
  return unpack
}

function imageType(rec) {
  if (!rec || rec.length < 4) return ''
  if (rec[0] === 0xff && rec[1] === 0xd8) return 'image/jpeg'
  if (rec[0] === 0x89 && ascii(rec, 1, 3) === 'PNG') return 'image/png'
  if (ascii(rec, 0, 4) === 'GIF8') return 'image/gif'
  if (rec[0] === 0x42 && rec[1] === 0x4d && rec.length > 26) return 'image/bmp'
  return ''
}

// The old MOBI markup: HTML with <mbp:pagebreak/>, pictures by `recindex`, and links to byte
// positions (`filepos`). Each linked position gets an anchor, then the text is decoded.
function mobi7Html(text, encoding, images) {
  const latin = ascii(text, 0, text.length)
  const targets = new Set()
  for (const m of latin.matchAll(/filepos=['"]?0*(\d+)/gi)) targets.add(+m[1])
  const sorted = [...targets].filter((n) => n <= text.length).sort((a, b) => a - b)
  const pieces = []
  let last = 0
  for (const pos of sorted) {
    // Not inside a tag: move back before its '<'.
    let p = pos
    const lt = latin.lastIndexOf('<', p - 1)
    const gt = latin.lastIndexOf('>', p - 1)
    if (lt > gt) p = lt
    if (p < last) p = last
    pieces.push(text.subarray(last, p), new TextEncoder().encode(`<a id="filepos${pos}"></a>`))
    last = p
  }
  pieces.push(text.subarray(last))
  const decoder = new TextDecoder(encoding)
  let html = pieces.map((p) => (p instanceof Uint8Array && p.buffer === text.buffer ? decoder.decode(p) : new TextDecoder().decode(p))).join('')
  html = html
    .replace(/<mbp:pagebreak\s*\/?>/gi, '<div class="mbp-pagebreak"></div>')
    .replace(/<\/?mbp:[^>]*>/gi, '')
    .replace(/<(a\b[^>]*?)\bfilepos=['"]?0*(\d+)['"]?/gi, '<$1href="#filepos$2"')
    .replace(/<img\b([^>]*?)\brecindex=['"]?0*(\d+)['"]?([^>]*)>/gi, (all, a, n, b) => {
      const path = images[+n - 1]
      return path ? `<img${a}src="${path}"${b}>` : ''
    })
  return `<!doctype html><html><head><meta charset="utf-8"><style>.mbp-pagebreak{break-after:page;height:2em}</style></head><body>${html.replace(/<\/?(html|head|body)\b[^>]*>/gi, '')}</body></html>`
}

// KF8 (AZW3) text: each part of the book is a skeleton page with its fragments after it. Shown in
// order, the browser's HTML parser puts the fragments in the page, which reads well enough;
// pictures are `kindle:embed:XXXX` (base 32).
function kf8Html(text, encoding, images) {
  const html = new TextDecoder(encoding).decode(text)
  const body = html
    .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, '')
    .replace(/<link\b[^>]*kindle:flow[^>]*>/gi, '')
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, '')
    .replace(/kindle:embed:([0-9A-V]{4})(\?[^"')\s]*)?/gi, (all, n) => images[parseInt(n, 32) - 1] || '')
    .replace(/kindle:pos:fid:[0-9A-V]{4}:off:[0-9A-V]{10}/gi, '#')
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`
}
