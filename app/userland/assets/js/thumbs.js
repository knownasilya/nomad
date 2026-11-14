// Thumbnails for Assets made in a page (shared/assets.mjs needsThumb): a picture or a video frame
// drawn small, a PDF's first page, an e-book's cover. Desktop's nomad://assets (main.js) makes them
// when a file is added, as a tile without one comes into view, and when one is opened; the phone's
// viewer page (phone-viewer.js) makes one for a PDF or a book it opens. Each is a JPEG, at most
// SIDE on its long side, on white (a transparent PNG or a PDF page has no background of its own).

// shared/assets.mjs THUMB_SIDE and THUMB_QUALITY (the phone's viewer page doesn't bundle that
// module; tests/unit/assets.test.js checks they agree).
export const SIDE = 480
export const QUALITY = 0.75

// Something a canvas can draw (an ImageBitmap, an <img>, a <video>, a canvas), `width` x `height`,
// as a JPEG Blob.
export async function drawThumb(source, width, height, { side = SIDE, quality = QUALITY } = {}) {
  const k = Math.min(1, side / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('The thumbnail couldn’t be drawn')
  return blob
}

// A PDF's first page. `doc` is an open pdf.js document, or the file's bytes to open with `pdfjs`.
export async function pdfThumb(pdfjs, doc, opts = {}) {
  const side = opts.side || SIDE
  const opened = doc?.getPage ? doc : await pdfjs.getDocument({ data: doc, isEvalSupported: false }).promise
  try {
    const page = await opened.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: Math.min(4, side / Math.max(base.width, base.height)) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(vp.width))
    canvas.height = Math.max(1, Math.floor(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    return await drawThumb(canvas, canvas.width, canvas.height, opts)
  } finally {
    if (opened !== doc) opened.destroy?.()
  }
}

// An e-book's cover (book/parse.js `cover`), or null when it has none.
export async function bookThumb(book, opts = {}) {
  const res = book?.cover ? book.resources.get(book.cover) : null
  if (!res) return null
  const blob = new Blob([res.data], { type: res.type })
  const pic = await picture(blob, res.type)
  try {
    return await drawThumb(pic.source, pic.width, pic.height, opts)
  } finally {
    pic.close?.()
  }
}

// A picture as something a canvas can draw, turned upright: an ImageBitmap, or an <img> for SVG.
export async function picture(blob, type = blob.type) {
  if (type === 'image/svg+xml') {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { width: img.naturalWidth || SIDE, height: img.naturalHeight || SIDE, source: img }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close?.() }
}

// A Blob as base64, without the data: prefix (what nomad.vault and the phone's backend take).
export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
