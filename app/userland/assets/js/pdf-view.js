// A PDF in Assets: its pages drawn with pdf.js as they scroll into view, each the width of the
// view (at most `maxWidth`). Desktop's nomad://assets (main.js, pdf.js copied in by
// scripts/build.js) and the phone's viewer page (./book/phone.js) both use it; each passes its own
// pdf.js.

function el(tag, attrs = {}) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k === 'class' ? 'class' : k, v)
  return node
}

export async function showPdf(node, data, pdfjs, { root = node.closest('.preview') || null, maxWidth = 900 } = {}) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = el('div', { class: 'pages' })
  const meta = el('div', { class: 'pdf-meta' })
  meta.textContent = `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`
  node.replaceChildren(meta, pages)
  // Each page draws as it scrolls into view.
  const io = new IntersectionObserver(
    async (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.done) continue
        e.target.dataset.done = '1'
        io.unobserve(e.target)
        const page = await doc.getPage(+e.target.dataset.n)
        const width = Math.min(maxWidth, pages.clientWidth || 800)
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
        const canvas = el('canvas', { width: String(Math.floor(vp.width)), height: String(Math.floor(vp.height)), 'aria-label': `Page ${e.target.dataset.n}` })
        canvas.style.width = `${Math.floor(base.width * scale)}px`
        e.target.replaceChildren(canvas)
        await page.render({ canvas, viewport: vp }).promise
      }
    },
    { root, rootMargin: '600px' }
  )
  // Every page holds the first page's shape until it draws.
  const first = (await doc.getPage(1)).getViewport({ scale: 1 })
  const ratio = first.height / first.width
  for (let n = 1; n <= doc.numPages; n++) {
    const holder = el('div', { class: 'page', 'data-n': String(n) })
    holder.style.aspectRatio = String(1 / ratio)
    pages.append(holder)
    io.observe(holder)
  }
  return doc
}
