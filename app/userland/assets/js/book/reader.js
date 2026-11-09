// The e-book reader in Assets: a book from ./parse.js, one page of it at a time (a chapter, for
// most books) in a sandboxed frame with no scripts, with the book's contents, the previous and next
// page, and the text size. It remembers where the reader was, per book, in this browser's storage.
// Desktop's nomad://assets (main.js) and the phone's viewer page (./phone.js) both use it.
//
// The book never runs and never reaches the network: scripts, frames and forms are dropped, every
// picture, style and font it names is a blob: URL of its own bytes, and anything it names outside
// itself is removed. The frame is `sandbox="allow-same-origin"`, so this page can style it, follow
// its links and keep the place, while the book's own markup can do none of that.

import { resolvePath } from './parse.js'

const SIZES = [80, 90, 100, 110, 120, 135, 150, 170]
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

const ICONS = {
  list: '<path d="M4 6h16M4 12h16M4 18h16" />',
  prev: '<path d="M15 5l-7 7 7 7" />',
  next: '<path d="M9 5l7 7-7 7" />',
}
function icon(name) {
  if (name === 'smaller' || name === 'bigger') {
    const a = document.createElement('span')
    a.className = `book-a ${name}`
    a.setAttribute('aria-hidden', 'true')
    a.textContent = 'A'
    return a
  }
  const span = document.createElement('span')
  span.className = 'book-icon'
  span.setAttribute('aria-hidden', 'true')
  span.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return span
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v === true) node.setAttribute(k, '')
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children) if (c != null && c !== false) node.append(c)
  return node
}

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

/**
 * @param {HTMLElement} host  where the reader goes (it fills it)
 * @param {object} book  openBook()'s result
 * @param {{ key: string, theme: { scheme: 'light'|'dark', bg: string, text: string, link: string }, onLink?: (url: string) => void }} opts
 */
export function createReader(host, book, opts) {
  const urls = new Map() // resource path -> blob: URL
  const pages = new Map() // section index -> blob: URL of its page
  const placeKey = `nomad-book:${opts.key}`
  let size = SIZES.includes(readStore('nomad-book-size')) ? readStore('nomad-book-size') : 100
  let current = -1
  let saveTimer = null
  const n = book.sections.length

  const labelOf = (i) => {
    const entry = book.toc.find((t) => t.section === i && !t.anchor) || book.toc.find((t) => t.section === i)
    return entry ? entry.label : n > 1 ? `Part ${i + 1}` : ''
  }

  const frame = el('iframe', { class: 'book-page', sandbox: 'allow-same-origin', title: book.title || 'Book' })
  const where = el('div', { class: 'book-where' })
  const tocList = el('div', { class: 'book-toc', hidden: true, role: 'menu', 'aria-label': 'Contents' })
  const btn = (name, label, onclick, extra = {}) => el('button', { type: 'button', class: 'book-btn', title: label, 'aria-label': label, onclick, ...extra }, [icon(name)])
  const tocBtn = book.toc.length > 1 ? btn('list', 'Contents', () => toggleToc(), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }) : null
  const prevBtn = n > 1 ? btn('prev', 'Previous chapter', () => show(current - 1)) : null
  const nextBtn = n > 1 ? btn('next', 'Next chapter', () => show(current + 1)) : null
  const bar = el('div', { class: 'book-bar' }, [
    tocBtn,
    el('div', { class: 'book-titles' }, [el('div', { class: 'book-title' }, [book.title || 'Untitled book']), where]),
    btn('smaller', 'Smaller text', () => resize(-1)),
    btn('bigger', 'Bigger text', () => resize(1)),
    prevBtn,
    nextBtn,
  ])
  const root = el('div', { class: `book-reader ${opts.theme.scheme}` }, [bar, el('div', { class: 'book-body' }, [frame, tocList])])
  root.style.setProperty('--book-bg', opts.theme.bg)
  root.style.setProperty('--book-text', opts.theme.text)
  root.style.setProperty('--book-link', opts.theme.link)
  host.replaceChildren(root)

  for (const t of book.toc) {
    tocList.append(
      el('button', { type: 'button', role: 'menuitem', class: 'book-toc-item', style: `padding-left: ${14 + t.depth * 16}px`, onclick: () => (toggleToc(false), show(t.section, { anchor: t.anchor })) }, [t.label])
    )
  }

  function toggleToc(open = tocList.hidden) {
    tocList.hidden = !open
    tocBtn?.setAttribute('aria-expanded', String(open))
    if (open) tocList.querySelector('.book-toc-item.on')?.scrollIntoView({ block: 'center' })
  }

  // A resource as a blob: URL, made once.
  function urlOf(path) {
    if (urls.has(path)) return urls.get(path)
    const res = book.resources.get(path)
    if (!res) return ''
    // A style sheet comes in with its own references made blob: URLs too.
    const blob = res.type === 'text/css' ? new Blob([css(new TextDecoder().decode(res.data), path)], { type: 'text/css' }) : new Blob([res.data], { type: res.type })
    const url = URL.createObjectURL(blob)
    urls.set(path, url)
    return url
  }

  function css(text, base, depth = 0) {
    return text
      .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi, (all, q, href) => {
        if (EXTERNAL.test(href) || depth > 3) return ''
        const path = resolvePath(base, href)
        const res = book.resources.get(path)
        return res ? css(new TextDecoder().decode(res.data), path, depth + 1) : ''
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, q, href) => {
        if (href.startsWith('data:')) return all
        if (EXTERNAL.test(href)) return 'url("")'
        return `url("${urlOf(resolvePath(base, href))}")`
      })
  }

  function pageOf(i) {
    if (pages.has(i)) return pages.get(i)
    const s = book.sections[i]
    const xml = /xml/.test(s.type)
    let doc = new DOMParser().parseFromString(s.html, xml ? 'application/xhtml+xml' : 'text/html')
    let asXml = xml
    if (xml && doc.getElementsByTagName('parsererror').length) {
      doc = new DOMParser().parseFromString(s.html, 'text/html')
      asXml = false
    }
    for (const bad of [...doc.querySelectorAll('script, iframe, frame, frameset, object, embed, base, meta[http-equiv], form, noscript')]) bad.remove()
    for (const node of doc.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on') || name === 'srcset' || name === 'formaction' || name === 'ping') node.removeAttribute(attr.name)
      }
      if (node.hasAttribute('style')) node.setAttribute('style', css(node.getAttribute('style'), s.path))
      const tag = node.localName
      if (tag === 'link') {
        const rel = (node.getAttribute('rel') || '').toLowerCase()
        const href = node.getAttribute('href') || ''
        if (rel.includes('stylesheet') && !EXTERNAL.test(href)) {
          const path = resolvePath(s.path, href)
          const res = book.resources.get(path)
          const style = doc.createElementNS(node.namespaceURI || 'http://www.w3.org/1999/xhtml', 'style')
          style.textContent = res ? css(new TextDecoder().decode(res.data), path) : ''
          node.replaceWith(style)
        } else node.remove()
        continue
      }
      if (tag === 'style') {
        node.textContent = css(node.textContent, s.path)
        continue
      }
      if (tag === 'a') continue // links are followed by the click handler, below
      for (const name of ['src', 'href', 'xlink:href', 'poster', 'data']) {
        if (!node.hasAttribute(name)) continue
        const v = node.getAttribute(name)
        if (v.startsWith('data:image/')) continue
        if (EXTERNAL.test(v) || !v) node.removeAttribute(name)
        else node.setAttribute(name, urlOf(resolvePath(s.path, v)) || '')
      }
    }
    const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement.insertBefore(doc.createElementNS(doc.documentElement.namespaceURI, 'head'), doc.documentElement.firstChild)
    const style = doc.createElementNS(doc.documentElement.namespaceURI || 'http://www.w3.org/1999/xhtml', 'style')
    style.textContent = readerCss(opts.theme)
    head.append(style)
    const text = asXml ? new XMLSerializer().serializeToString(doc) : '<!doctype html>' + doc.documentElement.outerHTML
    const url = URL.createObjectURL(new Blob([text], { type: asXml ? 'application/xhtml+xml' : 'text/html' }))
    pages.set(i, url)
    return url
  }

  function frameDoc() {
    try {
      return frame.contentDocument
    } catch {
      return null
    }
  }

  function applySize() {
    const doc = frameDoc()
    if (!doc?.documentElement) return
    let s = doc.getElementById('nomad-book-size')
    if (!s) {
      s = doc.createElementNS(doc.documentElement.namespaceURI || 'http://www.w3.org/1999/xhtml', 'style')
      s.setAttribute('id', 'nomad-book-size')
      ;(doc.head || doc.documentElement).append(s)
    }
    s.textContent = `html { font-size: ${size}% !important; }`
  }

  function resize(step) {
    const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + step))
    const keep = fraction()
    size = SIZES[i]
    writeStore('nomad-book-size', size)
    applySize()
    scrollTo(keep)
  }

  function scroller() {
    const doc = frameDoc()
    return doc?.scrollingElement || doc?.documentElement
  }
  function fraction() {
    const s = scroller()
    if (!s) return 0
    const max = s.scrollHeight - s.clientHeight
    return max > 0 ? s.scrollTop / max : 0
  }
  function scrollTo(f) {
    const s = scroller()
    if (s) s.scrollTop = f * Math.max(0, s.scrollHeight - s.clientHeight)
  }

  function save() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => writeStore(placeKey, { section: current, fraction: Math.round(fraction() * 10000) / 10000 }), 250)
  }

  function show(i, { anchor = '', at = 0 } = {}) {
    if (i < 0 || i >= n) return
    current = i
    where.textContent = [labelOf(i), n > 1 ? `${i + 1} of ${n}` : ''].filter(Boolean).join(' · ')
    if (prevBtn) prevBtn.disabled = i === 0
    if (nextBtn) nextBtn.disabled = i === n - 1
    for (const [k, item] of [...tocList.children].entries()) item.classList.toggle('on', book.toc[k]?.section === i)
    frame.onload = () => {
      const doc = frameDoc()
      if (!doc) return
      applySize()
      doc.addEventListener('click', onClick)
      doc.addEventListener('scroll', save, { passive: true })
      // Pictures change the height; the place is set once they're in.
      const go = () => {
        const target = anchor ? doc.getElementById(anchor) || doc.getElementsByName(anchor)[0] : null
        if (target) target.scrollIntoView()
        else scrollTo(at)
      }
      go()
      doc.defaultView?.addEventListener('load', go, { once: true })
      save()
    }
    frame.src = pageOf(i)
  }

  function onClick(e) {
    const a = e.target?.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (href.startsWith('#')) return // within the page
    e.preventDefault()
    if (EXTERNAL.test(href)) {
      if (/^https?:/i.test(href)) opts.onLink?.(href)
      return
    }
    const path = resolvePath(book.sections[current].path, href)
    const i = book.sections.findIndex((s) => s.path === path)
    if (i >= 0) show(i, { anchor: decodeURIComponent(href.split('#')[1] || '') })
  }

  const place = readStore(placeKey)
  if (place && place.section >= 0 && place.section < n) show(place.section, { at: place.fraction || 0 })
  else show(0)

  return {
    destroy() {
      clearTimeout(saveTimer)
      for (const url of [...urls.values(), ...pages.values()]) URL.revokeObjectURL(url)
      urls.clear()
      pages.clear()
    },
  }
}

function readerCss({ scheme, bg, text, link }) {
  const dark = scheme === 'dark'
  return `
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
html { background: ${bg} !important; }
body { box-sizing: border-box; max-width: 44em; margin: 0 auto !important; padding: 28px 24px 96px !important; color: ${text}; background: transparent !important;
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif; line-height: 1.6; overflow-wrap: break-word; -webkit-text-size-adjust: 100%; }
img, svg, video { max-width: 100% !important; height: auto !important; }
a { color: ${link}; }
${dark ? `body * { color: inherit !important; background-color: transparent !important; border-color: rgba(255,255,255,0.2) !important; } a, a * { color: ${link} !important; }` : ''}
`
}
