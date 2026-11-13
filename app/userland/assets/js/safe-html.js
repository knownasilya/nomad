// The HTML a Markdown file holds (a README's <sup>, <br>, <kbd>, <p align="center">, <details>), made
// safe to show in nomad://assets. markdown-it renders the file with its HTML; this parses the result
// in an inert document (nothing in it runs or loads there) and keeps only an allowlist: the tags
// below, a few attributes on them, and links and pictures with a safe address. Any other tag goes,
// with its text kept, and script, style and the like go with their contents. The phone draws the
// same tags as styled text (mobile/lib/markdown.ts nestHtml, htmlBlock).

const KEEP = new Set([
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'kbd', 'samp',
  'tt', 'var', 'b', 'strong', 'i', 'em', 'cite', 'dfn', 'q', 'u', 'ins', 's', 'strike', 'del', 'mark', 'small',
  'sup', 'sub', 'abbr', 'a', 'img', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'caption', 'details', 'summary', 'figure', 'figcaption', 'center', 'section', 'article', 'header',
  'footer', 'aside', 'address', 'input',
])
// Gone with everything in them.
const DROP = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'title', 'head', 'meta', 'link', 'base', 'form', 'textarea', 'select', 'button', 'video', 'audio', 'canvas', 'dialog'])
const ATTRS = {
  '*': ['title', 'align', 'dir', 'lang'],
  a: ['href', 'name', 'id'],
  img: ['src', 'alt', 'width', 'height'],
  ol: ['start', 'type', 'reversed'],
  li: ['value'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  details: ['open'],
  abbr: ['title'],
  h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
  input: ['type', 'checked', 'disabled'], // a task list's checkbox
}
const SAFE_HREF = /^(https?:|hyper:|nomad:|mailto:|#)/i
const SAFE_SRC = /^(https?:|hyper:|data:image\/(png|jpeg|gif|webp);)/i
const ALIGN = /^(left|right|center|justify)$/i

/**
 * @param {string} html  markdown-it's output, with the file's own HTML in it
 * @param {Document} [into]  the document the nodes are for
 * @returns {DocumentFragment}
 */
export function safeHtml(html, into = document) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  clean(doc.body)
  const frag = into.createDocumentFragment()
  for (const node of [...doc.body.childNodes]) frag.append(into.importNode(node, true))
  return frag
}

function clean(parent) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue // text
    if (node.nodeType !== 1) {
      node.remove() // comments and the like
      continue
    }
    const tag = node.localName
    if (DROP.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      node.remove()
      continue
    }
    clean(node)
    if (!KEEP.has(tag) || (tag === 'input' && (node.getAttribute('type') || '').toLowerCase() !== 'checkbox')) {
      node.replaceWith(...node.childNodes)
      continue
    }
    const allowed = new Set([...ATTRS['*'], ...(ATTRS[tag] || [])])
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (!allowed.has(name)) node.removeAttribute(attr.name)
      else if (name === 'href' && !SAFE_HREF.test(value)) node.removeAttribute(attr.name)
      else if (name === 'src' && !SAFE_SRC.test(value)) node.removeAttribute(attr.name)
      else if (name === 'align' && !ALIGN.test(value)) node.removeAttribute(attr.name)
      else if ((name === 'width' || name === 'height') && !/^\d{1,4}%?$/.test(value)) node.removeAttribute(attr.name)
    }
    if (tag === 'input') node.setAttribute('disabled', '')
    if (tag === 'img' && !node.hasAttribute('src')) {
      // A picture from inside the file or elsewhere it can't be read: its alt text.
      node.replaceWith(node.getAttribute('alt') || '')
      continue
    }
    if (tag === 'center') {
      const div = node.ownerDocument.createElement('div')
      div.setAttribute('align', 'center')
      div.append(...node.childNodes)
      node.replaceWith(div)
    }
  }
}
