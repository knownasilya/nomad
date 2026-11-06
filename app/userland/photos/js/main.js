// nomad://photos: the family album of a shared Space (ADR-0043). Everyone in the Space sees its
// photos; everyone who can edit adds them, here or from their phone. A photo shows who added it, and
// only they, or the Space's owner, can remove it.
//
// - Everything comes from nomad.vault (bg/web-apis/bg/photos.ts; the rules are shared/photos.mjs).
// - A photo is scaled here before it is sent: MAX_SIDE on its long side and a THUMB_SIDE
//   thumbnail, both JPEG, as the phone does, so every Device keeps the same size.
// - The tab title is `<caption or date> · Photos` while a photo is open, else "Photos".

const MAX_SIDE = 2560
const THUMB_SIDE = 480
const QUALITY = 0.85
const THUMB_QUALITY = 0.75
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const state = {
  data: null, // nomad.vault.listPhotos()
  error: '',
  open: null, // the id of the photo in the viewer
  adding: null, // { done, total } while photos are being added
  status: '',
  statusErr: false,
}
const thumbs = new Map() // id -> data URL ('' while loading, null when not here yet)
const full = new Map()

start()

async function start() {
  await load()
  try {
    const events = nomad.vault.watchAppData()
    events.addEventListener('changed', () => load())
  } catch {}
  window.addEventListener('keydown', onKey)
  const main = () => document.querySelector('main')
  window.addEventListener('dragover', (e) => {
    if (!canAdd() || !hasFiles(e)) return
    e.preventDefault()
    main()?.classList.add('dropping')
  })
  window.addEventListener('dragleave', (e) => {
    if (e.target === document.documentElement || !e.relatedTarget) main()?.classList.remove('dropping')
  })
  window.addEventListener('drop', (e) => {
    main()?.classList.remove('dropping')
    if (!canAdd() || !hasFiles(e)) return
    e.preventDefault()
    addFiles([...e.dataTransfer.files])
  })
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
const canAdd = () => !!state.data?.shared && !!state.data?.canAdd

async function load() {
  try {
    state.data = await nomad.vault.listPhotos()
    state.error = ''
  } catch (err) {
    state.error = err?.message || String(err)
  }
  if (state.open && !photos().some((p) => p.id === state.open)) state.open = null
  render()
}

const photos = () => state.data?.photos || []

function byMonth(list) {
  const groups = new Map()
  for (const p of list) {
    const d = new Date(p.takenAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!groups.has(key)) groups.set(key, { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, photos: [] })
    groups.get(key).photos.push(p)
  }
  return [...groups.values()]
}

function whenText(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function render() {
  const data = state.data || {}
  const open = state.open ? photos().find((p) => p.id === state.open) : null
  document.title = open ? `${open.caption || whenText(open.takenAt)} · Photos` : 'Photos'
  const app = document.getElementById('app')
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addFiles([...e.target.files]) })
  app.replaceChildren(
    el('header', {}, [
      el('div', { class: 'brand' }, [
        el('img', { src: 'asset:favicon:nomad://photos/', alt: '' }),
        'Photos',
        data.spaceName ? el('span', { class: 'space' }, [`· ${data.spaceName}`]) : null,
      ]),
      data.shared && photos().length ? el('span', { class: 'count' }, [`${photos().length} photo${photos().length === 1 ? '' : 's'}`]) : null,
      el('div', { class: 'spacer' }),
      state.adding
        ? el('span', { class: 'status' }, [`Adding ${state.adding.done + 1} of ${state.adding.total}…`])
        : state.status
          ? el('span', { class: `status${state.statusErr ? ' err' : ''}` }, [state.status])
          : null,
      canAdd()
        ? el('button', { class: 'btn primary', disabled: !!state.adding, onclick: () => input.click() }, [icon('plus'), 'Add photos'])
        : null,
      input,
    ]),
    el('main', {}, [renderBody()]),
    ...(open ? [renderViewer(open)] : [])
  )
  observeThumbs()
}

function renderBody() {
  const data = state.data
  if (state.error) return el('div', { class: 'notice' }, [state.error])
  if (!data) return el('div', { class: 'notice' }, ['Loading…'])
  if (!data.shared) {
    return el('div', { class: 'notice' }, [
      el('div', {}, [icon('images')]),
      el('h2', {}, ['An album for the people you live with']),
      el('div', {}, [
        'Photos here are shared with everyone in a shared Space, and they add theirs from their phones. Share this Space, or set up a home, in My Library → Sharing.',
      ]),
      el('a', { class: 'btn', href: 'nomad://library/sharing' }, ['Open Sharing']),
    ])
  }
  if (!photos().length) {
    return el('div', { class: 'notice' }, [
      el('div', {}, [icon('images')]),
      el('h2', {}, ['No photos yet']),
      el('div', {}, [
        data.canAdd
          ? `Add photos here, drop them on this page, or add them from the Nomad app on your phone. Everyone in ${data.spaceName || 'this Space'} sees them.`
          : `When someone in ${data.spaceName || 'this Space'} adds photos, they show here.`,
      ]),
    ])
  }
  return el(
    'div',
    {},
    byMonth(photos()).map((g) =>
      el('section', { class: 'month' }, [
        el('h2', {}, [g.label, el('span', { class: 'n' }, [String(g.photos.length)])]),
        el(
          'div',
          { class: 'grid' },
          g.photos.map((p) =>
            el('button', { class: 'tile', 'data-id': p.id, title: p.caption || whenText(p.takenAt), 'aria-label': `${p.caption || 'Photo'}, ${whenText(p.takenAt)}${p.by ? `, added by ${p.by}` : ''}`, onclick: () => openPhoto(p.id) }, [
              thumbs.get(p.id) ? el('img', { src: thumbs.get(p.id), alt: '' }) : null,
              p.by ? el('span', { class: 'by' }, [p.by]) : null,
            ])
          )
        ),
      ])
    )
  )
}

// Thumbnails load as their tiles come into view.
let observer = null
function observeThumbs() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) loadThumb(e.target.dataset.id)
  }, { rootMargin: '400px' })
  for (const t of document.querySelectorAll('.tile')) if (!thumbs.get(t.dataset.id)) observer.observe(t)
}

async function loadThumb(id) {
  if (thumbs.has(id) && thumbs.get(id) !== null) return
  thumbs.set(id, '')
  const url = await nomad.vault.photoData(id, { thumb: true }).catch(() => null)
  thumbs.set(id, url)
  if (url) {
    const tile = document.querySelector(`.tile[data-id="${id}"]`)
    if (tile && !tile.querySelector('img')) tile.prepend(el('img', { src: url, alt: '' }))
  } else setTimeout(() => thumbs.delete(id), 5000) // not replicated yet: try again on the next render
}

function openPhoto(id) {
  state.open = id
  render()
  if (!full.get(id)) {
    nomad.vault.photoData(id).then((url) => {
      if (url) full.set(id, url)
      if (state.open === id) render()
    }).catch(() => {})
  }
}

function step(n) {
  const list = photos()
  const i = list.findIndex((p) => p.id === state.open)
  if (i < 0) return
  const next = list[(i + n + list.length) % list.length]
  if (next) openPhoto(next.id)
}

function onKey(e) {
  if (!state.open || e.target?.tagName === 'INPUT') return
  if (e.key === 'Escape') { state.open = null; render() }
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}

function renderViewer(p) {
  const src = full.get(p.id) || thumbs.get(p.id)
  const many = photos().length > 1
  return el('div', { class: 'viewer', role: 'dialog', 'aria-label': p.caption || 'Photo' }, [
    el('div', { class: 'bar' }, [
      el('div', { class: 'meta' }, [[whenText(p.takenAt), p.by ? `Added by ${p.by}` : ''].filter(Boolean).join(' · ')]),
      el('a', { class: 'icon-btn', href: full.get(p.id) || '#', download: `${p.id}.jpg`, title: 'Download', 'aria-label': 'Download' }, [icon('download')]),
      p.canDelete ? el('button', { class: 'icon-btn', title: 'Remove from the album', 'aria-label': 'Remove from the album', onclick: () => remove(p) }, [icon('trash')]) : null,
      el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => { state.open = null; render() } }, [icon('times')]),
    ]),
    el('div', { class: 'stage' }, [
      many ? el('button', { class: 'icon-btn', title: 'Previous photo', 'aria-label': 'Previous photo', onclick: () => step(-1) }, [icon('chevron-left')]) : null,
      src ? el('img', { src, alt: p.caption || '' }) : el('div', { class: 'loading' }, ['Loading…']),
      many ? el('button', { class: 'icon-btn', title: 'Next photo', 'aria-label': 'Next photo', onclick: () => step(1) }, [icon('chevron-right')]) : null,
    ]),
    el('div', { class: 'caption' }, [
      state.data?.canAdd
        ? el('input', {
            type: 'text',
            value: p.caption || '',
            placeholder: 'Add a caption',
            'aria-label': 'Caption',
            maxlength: '500',
            onchange: (e) => saveCaption(p, e.target.value),
            onkeydown: (e) => { if (e.key === 'Enter') e.target.blur() },
          })
        : p.caption ? el('p', {}, [p.caption]) : null,
    ]),
  ])
}

async function saveCaption(p, caption) {
  try {
    await nomad.vault.setPhotoCaption({ id: p.id, caption })
    await load()
  } catch (err) {
    say(err?.message || String(err), true)
  }
}

async function remove(p) {
  if (!confirm(`Remove this photo from ${state.data?.spaceName || 'the album'}? It goes for everyone in the Space.`)) return
  try {
    await nomad.vault.deletePhoto(p.id)
    state.open = null
    await load()
  } catch (err) {
    say(err?.message || String(err), true)
  }
}

function say(text, err = false) {
  state.status = text
  state.statusErr = err
  render()
  setTimeout(() => { if (state.status === text) { state.status = ''; render() } }, 6000)
}

// Adding
// =

async function addFiles(files) {
  files = files.filter((f) => /^image\//.test(f.type))
  if (!files.length || state.adding) return
  let failed = 0
  let lastError = ''
  state.adding = { done: 0, total: files.length }
  render()
  for (const file of files) {
    try {
      const [scaled, thumb, takenAt] = await Promise.all([scale(file, MAX_SIDE, QUALITY), scale(file, THUMB_SIDE, THUMB_QUALITY), exifTime(file)])
      await nomad.vault.addPhoto({
        photo: scaled.base64,
        thumb: thumb.base64,
        width: scaled.width,
        height: scaled.height,
        takenAt: takenAt || new Date(file.lastModified || Date.now()).toISOString(),
      })
    } catch (err) {
      failed++
      lastError = err?.message || String(err)
    }
    state.adding.done++
    render()
  }
  state.adding = null
  await load()
  if (failed) say(failed === files.length ? lastError : `${failed} of ${files.length} photos couldn’t be added: ${lastError}`, true)
  else say(`Added ${files.length} photo${files.length === 1 ? '' : 's'}`)
}

// The image, turned upright and scaled to `side` on its long edge, as base64 JPEG.
async function scale(file, side, quality) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * k))
  const height = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('That image couldn’t be read')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return { base64: btoa(bin), width, height }
}

// When a JPEG was taken, from its EXIF DateTimeOriginal (or DateTime), as an ISO time, or null.
async function exifTime(file) {
  if (file.type !== 'image/jpeg') return null
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    if (view.getUint16(0) !== 0xffd8) return null
    let off = 2
    while (off + 4 < view.byteLength) {
      const marker = view.getUint16(off)
      const len = view.getUint16(off + 2)
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) return readTiff(view, off + 10)
      if ((marker & 0xff00) !== 0xff00) return null
      off += 2 + len
    }
  } catch {}
  return null
}

function readTiff(view, start) {
  const little = view.getUint16(start) === 0x4949
  const u16 = (o) => view.getUint16(start + o, little)
  const u32 = (o) => view.getUint32(start + o, little)
  const ascii = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(view.getUint8(start + o + i)); return s }
  const tags = (ifd) => {
    const out = {}
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) }
    }
    return out
  }
  const ifd0 = tags(u32(4))
  let when = ifd0[0x0132]
  if (ifd0[0x8769]) {
    const exif = tags(ifd0[0x8769].value)
    when = exif[0x9003] || exif[0x9004] || when
  }
  if (!when || when.type !== 2) return null
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(when.value, when.count))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(d.getTime()) && +m[1] > 1990 ? d.toISOString() : null
}

// DOM
// =

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  for (const k in attrs || {}) {
    const v = attrs[k]
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) {
      if (v) node.addEventListener(k.slice(2), v)
    } else if (k === 'value') node.value = v
    else if (k === 'disabled') node.disabled = !!v
    else if (k === 'hidden') node.hidden = !!v
    else if (v === true) node.setAttribute(k, '')
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c)
  return node
}

function icon(name) {
  return el('span', { class: `fas fa-fw fa-${name}`, 'aria-hidden': 'true' })
}
