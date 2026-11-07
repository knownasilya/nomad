// nomad://assets: the files a Space keeps (ADR-0044), which grew out of the family album (ADR-0043).
// Photos, videos, voice memos, PDFs, Markdown, code, spreadsheets' CSVs: anything up to MAX_BYTES,
// and what the user's AI saves here (its saveAsset capability). In a shared Space everyone sees them
// and everyone who can edit adds them; a file shows who added it, and only they, or the Space's
// owner, can remove it. In any other Space they are the user's own, kept in their Vault.
//
// - Everything comes from nomad.vault (bg/web-apis/bg/assets.ts; the rules are shared/assets.mjs).
// - A camera photo bigger than MAX_SIDE is scaled here before it is sent, as the phone does; any
//   other file is kept as it is. Pictures and videos get a THUMB_SIDE thumbnail.
// - Previews: pictures, video and audio play from a blob: URL of the file's bytes; a PDF renders
//   with pdf.js (js/pdf.build.js, copied in by scripts/build.js); Markdown renders with markdown-it
//   (raw HTML off); CSV is a table, JSON is pretty-printed, code and text are shown as text. An HTML
//   file is shown as its source, never run.
// - `?id=` opens one file. The tab title is `<file name> · Assets` while one is open, else "Assets".

import * as as from '../../../../shared/assets.mjs'

const MD_URL = 'nomad://app-stdlib/vendor/markdown-it.js'
const PDF_URL = '/js/pdf.build.js'
const PDF_WORKER_URL = '/js/pdf.worker.build.js'
// A picture with no thumbnail (the AI saved a GIF) shows itself in the grid up to this size.
const SMALL_PICTURE = 3 * 1024 * 1024
const CSV_ROWS = 500

const state = {
  data: null, // nomad.vault.listAssets()
  error: '',
  open: new URLSearchParams(location.search).get('id'), // the id of the file in the viewer
  filter: 'all',
  query: '',
  adding: null, // { done, total } while files are being added
  status: '',
  statusErr: false,
}
const thumbs = new Map() // id -> URL ('' while loading, null when not here yet)
const files = new Map() // id -> { url, blob } of the whole file, the newest few
const KEEP_FILES = 6

start()

async function start() {
  await load()
  try {
    const events = nomad.vault.watchAppData()
    events.addEventListener('changed', () => load())
  } catch {}
  window.addEventListener('keydown', onKey)
  window.addEventListener('popstate', () => {
    state.open = new URLSearchParams(location.search).get('id')
    render()
  })
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
const canAdd = () => !!state.data?.canAdd
const assets = () => state.data?.assets || []
const shown = () => as.filterAssets(assets(), { filter: state.filter, query: state.query })
const maxBytes = () => state.data?.maxBytes || as.MAX_BYTES

async function load() {
  try {
    state.data = await nomad.vault.listAssets()
    state.error = ''
  } catch (err) {
    state.error = err?.message || String(err)
  }
  if (state.open && state.data && !assets().some((a) => a.id === state.open)) setOpen(null, true)
  render()
  if (state.open) loadFile(state.open)
}

function whenText(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function describe(a) {
  return [as.KIND_LABELS[a.kind] || 'File', as.formatBytes(a.bytes), a.duration ? as.formatDuration(a.duration) : '', a.width && a.height ? `${a.width} × ${a.height}` : '']
    .filter(Boolean)
    .join(' · ')
}

function setOpen(id, replace = false) {
  state.open = id
  const url = id ? `?id=${encodeURIComponent(id)}` : location.pathname
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}

// Rendering
// =

function render() {
  const data = state.data || {}
  const open = state.open ? assets().find((a) => a.id === state.open) : null
  document.title = open ? `${open.name} · Assets` : 'Assets'
  const app = document.getElementById('app')
  const focused = document.activeElement?.id
  const input = el('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => addFiles([...e.target.files]) })
  const count = assets().length
  app.replaceChildren(
    el('header', {}, [
      el('div', { class: 'brand' }, [
        el('img', { src: 'asset:favicon:nomad://assets/', alt: '' }),
        'Assets',
        data.spaceName ? el('span', { class: 'space' }, [`· ${data.spaceName}`]) : null,
      ]),
      count ? el('span', { class: 'count' }, [`${count} file${count === 1 ? '' : 's'}`]) : null,
      el('div', { class: 'spacer' }),
      state.adding
        ? el('span', { class: 'status' }, [`Adding ${state.adding.done + 1} of ${state.adding.total}…`])
        : state.status
          ? el('span', { class: `status${state.statusErr ? ' err' : ''}` }, [state.status])
          : null,
      count
        ? el('label', { class: 'search' }, [
            icon('search'),
            el('input', {
              id: 'search',
              type: 'search',
              value: state.query,
              placeholder: 'Search files',
              'aria-label': 'Search files',
              oninput: (e) => {
                state.query = e.target.value
                render()
              },
            }),
          ])
        : null,
      canAdd()
        ? el('button', { class: 'btn primary', disabled: !!state.adding, onclick: () => input.click() }, [icon('plus'), 'Add files'])
        : null,
      input,
    ]),
    count ? renderFilters() : null,
    el('main', {}, [renderBody()]),
    ...(open ? [renderViewer(open)] : [])
  )
  if (focused === 'search') {
    const s = document.getElementById('search')
    s?.focus()
    s?.setSelectionRange(s.value.length, s.value.length)
  }
  observeThumbs()
}

function renderFilters() {
  const counts = new Map(as.FILTERS.map((f) => [f.id, as.filterAssets(assets(), { filter: f.id }).length]))
  return el(
    'nav',
    { class: 'filters', 'aria-label': 'Kinds of files' },
    as.FILTERS.filter((f) => f.id === 'all' || f.id === state.filter || counts.get(f.id)).map((f) =>
      el(
        'button',
        {
          class: `chip${state.filter === f.id ? ' on' : ''}`,
          'aria-pressed': state.filter === f.id ? 'true' : 'false',
          onclick: () => {
            state.filter = f.id
            render()
          },
        },
        [f.label, el('span', { class: 'n' }, [String(counts.get(f.id))])]
      )
    )
  )
}

function renderBody() {
  const data = state.data
  if (state.error) return el('div', { class: 'notice' }, [state.error])
  if (!data) return el('div', { class: 'notice' }, ['Loading…'])
  const place = data.spaceName || 'this Space'
  if (!assets().length) {
    return el('div', { class: 'notice' }, [
      el('div', {}, [icon('folder-open')]),
      el('h2', {}, ['No files yet']),
      el('div', {}, [
        !data.canAdd
          ? `When someone in ${place} adds files, they show here.`
          : data.shared
            ? `Add photos, videos, PDFs, notes or any other file here, drop them on this page, or add them from the Nomad app on your phone. Everyone in ${place} sees them. Your AI can save things here too.`
            : `Keep photos, videos, PDFs, notes or any other file for ${place} here: add them, drop them on this page, or ask your AI to save something. They sync to your other devices.`,
      ]),
      data.canAdd ? el('button', { class: 'btn primary', onclick: () => document.querySelector('header input[type=file]')?.click() }, [icon('plus'), 'Add files']) : null,
    ])
  }
  const list = shown()
  const body = list.length
    ? as.byMonth(list).map((g) =>
        el('section', { class: 'month' }, [
          el('h2', {}, [g.label, el('span', { class: 'n' }, [String(g.assets.length)])]),
          el('div', { class: 'grid' }, g.assets.map(renderTile)),
        ])
      )
    : [el('div', { class: 'notice' }, [state.query ? `Nothing matches “${state.query}”.` : 'No files of this kind.'])]
  return el('div', {}, [
    !data.shared
      ? el('p', { class: 'hint' }, [
          icon('lock'),
          `Only you see these files, on your own devices. Share ${place} to keep them with the people in it, in `,
          el('a', { href: 'nomad://library/sharing' }, ['My Library → Sharing']),
          '.',
        ])
      : null,
    ...body,
  ])
}

const hasPicture = (a) => a.thumb || (a.kind === 'image' && a.bytes <= SMALL_PICTURE)

function renderTile(a) {
  const media = hasPicture(a)
  const label = `${a.name}, ${as.KIND_LABELS[a.kind] || 'File'}, ${whenText(a.takenAt)}${a.by ? `, added by ${a.by}` : ''}${a.source === 'ai' ? ', saved by your AI' : ''}`
  return el('button', { class: `tile${media ? ' media' : ' doc'}`, 'data-id': a.id, 'data-picture': media ? '1' : '', title: a.caption || a.name, 'aria-label': label, onclick: () => openAsset(a.id) }, [
    media && thumbs.get(a.id) ? el('img', { src: thumbs.get(a.id), alt: '' }) : null,
    !media
      ? el('div', { class: `doc-face kind-${a.kind}` }, [
          icon(as.KIND_ICONS[a.kind] || 'file'),
          el('span', { class: 'ext' }, [as.extOf(a.name).toUpperCase() || as.KIND_LABELS[a.kind]]),
        ])
      : null,
    a.kind === 'video' ? el('span', { class: 'play' }, [icon('play'), a.duration ? as.formatDuration(a.duration) : '']) : null,
    a.source === 'ai' ? el('span', { class: 'ai', title: 'Saved by your AI' }, [icon('magic')]) : null,
    !media ? el('span', { class: 'name' }, [a.name]) : null,
    a.by && media ? el('span', { class: 'by' }, [a.by]) : null,
  ])
}

// Thumbnails load as their tiles come into view.
let observer = null
function observeThumbs() {
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) loadThumb(e.target.dataset.id)
    },
    { rootMargin: '400px' }
  )
  for (const t of document.querySelectorAll('.tile[data-picture="1"]')) if (!thumbs.get(t.dataset.id)) observer.observe(t)
}

async function loadThumb(id) {
  if (thumbs.has(id) && thumbs.get(id) !== null) return
  const a = assets().find((x) => x.id === id)
  if (!a) return
  thumbs.set(id, '')
  const url = await nomad.vault.assetData(id, { thumb: !!a.thumb }).catch(() => null)
  thumbs.set(id, url)
  if (url) {
    const tile = document.querySelector(`.tile[data-id="${id}"]`)
    if (tile && !tile.querySelector('img')) tile.prepend(el('img', { src: url, alt: '' }))
  } else setTimeout(() => thumbs.delete(id), 5000) // not replicated yet: try again on the next render
}

// The whole file as a blob: URL, kept for the last few opened.
async function loadFile(id) {
  if (files.has(id)) return files.get(id)
  const pending = (async () => {
    const dataUrl = await nomad.vault.assetData(id).catch(() => null)
    if (!dataUrl) return null
    const blob = await (await fetch(dataUrl)).blob()
    return { blob, url: URL.createObjectURL(blob) }
  })()
  files.set(id, pending)
  const got = await pending
  if (!got) files.delete(id)
  else {
    files.set(id, got)
    while (files.size > KEEP_FILES) {
      const [oldId, old] = files.entries().next().value
      if (oldId === state.open) break
      if (old?.url) URL.revokeObjectURL(old.url)
      files.delete(oldId)
    }
  }
  if (state.open === id) render()
  return got
}

function fileOf(id) {
  const f = files.get(id)
  return f && !(f instanceof Promise) ? f : null
}

function openAsset(id) {
  setOpen(id)
  render()
  loadFile(id)
}

function close() {
  setOpen(null)
  render()
}

function step(n) {
  const list = shown()
  const i = list.findIndex((a) => a.id === state.open)
  if (i < 0 || list.length < 2) return
  const next = list[(i + n + list.length) % list.length]
  setOpen(next.id, true)
  render()
  loadFile(next.id)
}

function onKey(e) {
  if (!state.open || ['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}

function renderViewer(a) {
  const f = fileOf(a.id)
  const many = shown().length > 1
  const editable = !!state.data?.canAdd
  return el('div', { class: `viewer kind-${a.kind}`, role: 'dialog', 'aria-label': a.name }, [
    el('div', { class: 'bar' }, [
      el('span', { class: 'kind-icon', title: as.KIND_LABELS[a.kind] }, [icon(as.KIND_ICONS[a.kind] || 'file')]),
      el('div', { class: 'titles' }, [
        editable
          ? el('input', {
              class: 'name',
              type: 'text',
              value: a.name,
              'aria-label': 'File name',
              maxlength: String(as.MAX_NAME),
              onchange: (e) => save(a, { name: e.target.value }),
              onkeydown: (e) => {
                if (e.key === 'Enter') e.target.blur()
              },
            })
          : el('div', { class: 'name' }, [a.name]),
        el('div', { class: 'meta' }, [
          [describe(a), whenText(a.takenAt), a.by ? `Added by ${a.by}` : '', a.source === 'ai' ? 'Saved by your AI' : ''].filter(Boolean).join(' · '),
        ]),
      ]),
      a.sourceUrl ? el('a', { class: 'icon-btn', href: a.sourceUrl, target: '_blank', rel: 'noopener', title: 'Open where it came from', 'aria-label': 'Open where it came from' }, [icon('external-link-alt')]) : null,
      el('a', { class: 'icon-btn', href: f?.url || '#', download: a.name, title: 'Download', 'aria-label': 'Download', 'aria-disabled': f ? 'false' : 'true' }, [icon('download')]),
      a.canDelete ? el('button', { class: 'icon-btn', title: 'Remove from Assets', 'aria-label': 'Remove from Assets', onclick: () => remove(a) }, [icon('trash')]) : null,
      el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: close }, [icon('times')]),
    ]),
    el('div', { class: 'stage' }, [
      many ? el('button', { class: 'icon-btn side', title: 'Previous file', 'aria-label': 'Previous file', onclick: () => step(-1) }, [icon('chevron-left')]) : null,
      el('div', { class: 'preview' }, [f ? renderPreview(a, f) : el('div', { class: 'loading' }, [thumbs.get(a.id) ? el('img', { src: thumbs.get(a.id), alt: '' }) : 'Loading…'])]),
      many ? el('button', { class: 'icon-btn side', title: 'Next file', 'aria-label': 'Next file', onclick: () => step(1) }, [icon('chevron-right')]) : null,
    ]),
    el('div', { class: 'caption' }, [
      editable
        ? el('input', {
            type: 'text',
            value: a.caption || '',
            placeholder: 'Add a caption',
            'aria-label': 'Caption',
            maxlength: String(as.MAX_CAPTION),
            onchange: (e) => save(a, { caption: e.target.value }),
            onkeydown: (e) => {
              if (e.key === 'Enter') e.target.blur()
            },
          })
        : a.caption
          ? el('p', {}, [a.caption])
          : null,
    ]),
  ])
}

// Previews
// =

const previewCache = new Map() // id -> the element, so a re-render keeps a playing video and a rendered PDF

function renderPreview(a, f) {
  const key = a.id + ':' + f.url
  if (previewCache.has(key)) return previewCache.get(key)
  let node
  if (a.kind === 'image') {
    node = el('img', { class: 'picture', src: f.url, alt: a.caption || a.name })
    node.addEventListener('error', () => node.replaceWith(noPreview(a, f, 'This picture can’t be shown here')))
  } else if (a.kind === 'video') {
    node = el('video', { class: 'video', src: f.url, controls: true, preload: 'metadata', playsinline: true })
    node.addEventListener('error', () => node.replaceWith(noPreview(a, f, 'This video can’t be played here')))
  } else if (a.kind === 'audio') {
    node = el('div', { class: 'card audio' }, [
      el('div', { class: 'big-icon' }, [icon('music')]),
      el('div', { class: 'card-name' }, [a.name]),
      el('audio', { src: f.url, controls: true, preload: 'metadata' }),
    ])
  } else if (a.kind === 'pdf') {
    node = el('div', { class: 'doc pdf' }, [el('div', { class: 'loading' }, ['Opening the PDF…'])])
    renderPdf(node, f.blob).catch((err) => node.replaceChildren(noPreview(a, f, `This PDF can’t be shown here (${err?.message || err})`)))
  } else if (as.isTextKind(a.kind)) {
    node = el('div', { class: `doc text kind-${a.kind}` }, [el('div', { class: 'loading' }, ['Loading…'])])
    renderText(node, a, f.blob).catch(() => node.replaceChildren(noPreview(a, f, 'This file can’t be read as text')))
  } else {
    node = noPreview(a, f, 'There’s no preview for this kind of file')
  }
  previewCache.set(key, node)
  if (previewCache.size > KEEP_FILES) previewCache.delete(previewCache.keys().next().value)
  return node
}

function noPreview(a, f, why) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'big-icon' }, [icon(as.KIND_ICONS[a.kind] || 'file')]),
    el('div', { class: 'card-name' }, [a.name]),
    el('div', { class: 'card-sub' }, [`${describe(a)}. ${why}.`]),
    el('a', { class: 'btn', href: f.url, download: a.name }, [icon('download'), 'Download']),
  ])
}

async function renderText(node, a, blob) {
  const text = await blob.slice(0, as.MAX_TEXT_PREVIEW).text()
  const cut = blob.size > as.MAX_TEXT_PREVIEW
  const ext = as.extOf(a.name)
  let body
  if (a.kind === 'markdown') {
    const markdownit = (await import(/* @vite-ignore */ MD_URL)).default
    const md = markdownit({ html: false, linkify: true, breaks: false })
    body = el('article', { class: 'markdown' })
    body.innerHTML = md.render(text) // html: false, so the file's own HTML stays text
    for (const link of body.querySelectorAll('a')) {
      link.target = '_blank'
      link.rel = 'noopener'
    }
  } else if (ext === 'csv' || ext === 'tsv' || a.mime === 'text/csv') {
    body = csvTable(text, ext === 'tsv' ? '\t' : ',')
  } else {
    let shownText = text
    if (ext === 'json' || a.mime === 'application/json') {
      try {
        shownText = JSON.stringify(JSON.parse(text), null, 2)
      } catch {}
    }
    const lines = shownText.split('\n')
    body = el('pre', { class: 'code' }, [el('code', {}, lines.map((l) => el('span', { class: 'line' }, [l + '\n'])))])
  }
  node.replaceChildren(body, cut ? el('p', { class: 'cut' }, [`Showing the first ${as.formatBytes(as.MAX_TEXT_PREVIEW)}. Download the file for all of it.`]) : '')
}

function csvTable(text, sep) {
  const rows = parseCsv(text, sep).slice(0, CSV_ROWS + 1)
  const [head, ...rest] = rows
  return el('div', { class: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, (head || []).map((c) => el('th', {}, [c])))]),
      el('tbody', {}, rest.map((r) => el('tr', {}, r.map((c) => el('td', {}, [c]))))),
    ]),
  ])
}

// RFC 4180-ish: quoted cells, doubled quotes, newlines inside quotes.
function parseCsv(text, sep) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && !cell) quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length > CSV_ROWS) return rows
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

let pdfjs = null
async function renderPdf(node, blob) {
  if (!pdfjs) {
    pdfjs = await import(/* @vite-ignore */ PDF_URL)
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise
  const pages = el('div', { class: 'pages' })
  node.replaceChildren(el('div', { class: 'pdf-meta' }, [`${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`]), pages)
  // Each page draws as it scrolls into view.
  const io = new IntersectionObserver(
    async (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.done) continue
        e.target.dataset.done = '1'
        io.unobserve(e.target)
        const page = await doc.getPage(+e.target.dataset.n)
        const width = Math.min(900, pages.clientWidth || 800)
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
        const canvas = el('canvas', { width: String(Math.floor(vp.width)), height: String(Math.floor(vp.height)), 'aria-label': `Page ${e.target.dataset.n}` })
        canvas.style.width = `${Math.floor(base.width * scale)}px`
        e.target.replaceChildren(canvas)
        await page.render({ canvas, viewport: vp }).promise
      }
    },
    { root: node.closest('.preview') || null, rootMargin: '600px' }
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
}

// Changes
// =

async function save(a, change) {
  try {
    await nomad.vault.updateAsset({ id: a.id, ...change })
    await load()
  } catch (err) {
    say(err?.message || String(err), true)
  }
}

async function remove(a) {
  const where = state.data?.shared ? ` It goes for everyone in ${state.data?.spaceName || 'the Space'}.` : ''
  if (!confirm(`Remove “${a.name}” from Assets?${where}`)) return
  try {
    await nomad.vault.deleteAsset(a.id)
    setOpen(null, true)
    await load()
  } catch (err) {
    say(err?.message || String(err), true)
  }
}

function say(text, err = false) {
  state.status = text
  state.statusErr = err
  render()
  setTimeout(() => {
    if (state.status === text) {
      state.status = ''
      render()
    }
  }, 6000)
}

// Adding
// =

async function addFiles(list) {
  if (!list.length || state.adding) return
  list = list.slice(0, as.MAX_BATCH)
  let failed = 0
  let lastError = ''
  state.adding = { done: 0, total: list.length }
  render()
  for (const file of list) {
    try {
      await nomad.vault.addAsset(await prepare(file))
    } catch (err) {
      failed++
      lastError = err?.message || String(err)
    }
    state.adding.done++
    render()
  }
  state.adding = null
  await load()
  if (failed) say(failed === list.length ? lastError : `${failed} of ${list.length} files couldn’t be added: ${lastError}`, true)
  else say(`Added ${list.length} file${list.length === 1 ? '' : 's'}`)
}

// What addAsset takes for one dropped or picked file.
async function prepare(file) {
  const mime = as.mimeOf(file.name, file.type)
  const kind = as.kindOf(mime, file.name)
  const out = { name: file.name, mime, takenAt: new Date(file.lastModified || Date.now()).toISOString() }
  let blob = file
  if (kind === 'image') {
    const taken = await exifTime(file)
    if (taken) out.takenAt = taken
    const bitmap = await picture(file).catch(() => null)
    if (bitmap) {
      out.width = bitmap.width
      out.height = bitmap.height
      // A camera photo bigger than the album's size is scaled, as the phone does.
      if (mime === 'image/jpeg' && Math.max(bitmap.width, bitmap.height) > as.MAX_SIDE) {
        const scaled = await draw(bitmap, as.MAX_SIDE, as.QUALITY)
        blob = scaled.blob
        Object.assign(out, { width: scaled.width, height: scaled.height })
      }
      out.thumb = await base64((await draw(bitmap, as.THUMB_SIDE, as.THUMB_QUALITY)).blob)
      bitmap.close?.()
    }
  } else if (kind === 'video') {
    const v = await videoFrame(file).catch(() => null)
    if (v) Object.assign(out, { width: v.width, height: v.height, duration: v.duration, thumb: v.thumb })
  } else if (kind === 'audio') {
    const d = await mediaDuration(file).catch(() => 0)
    if (d) out.duration = d
    out.takenAt = undefined
  } else {
    out.takenAt = undefined // a document goes by when it was added
  }
  if (blob.size > maxBytes()) throw new Error(`${file.name} is too big (${as.formatBytes(blob.size)}, at most ${as.formatBytes(maxBytes())})`)
  if (!blob.size) throw new Error(`${file.name} is empty`)
  out.data = await base64(blob)
  return out
}

// A picture, turned upright, as something a canvas can draw: an ImageBitmap, or an <img> for SVG.
async function picture(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { width: img.naturalWidth || 480, height: img.naturalHeight || 480, source: img }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close?.() }
}

async function draw(pic, side, quality) {
  const k = Math.min(1, side / Math.max(pic.width, pic.height))
  const width = Math.max(1, Math.round(pic.width * k))
  const height = Math.max(1, Math.round(pic.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // a transparent PNG's thumbnail, as JPEG
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(pic.source, 0, 0, width, height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('That picture couldn’t be read')
  return { blob, width, height }
}

// A video's size, length, and a thumbnail from a moment in.
async function videoFrame(file) {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = url
    await once(v, 'loadeddata')
    v.currentTime = Math.min(1, (v.duration || 0) / 3)
    await once(v, 'seeked')
    const thumb = await base64((await draw({ width: v.videoWidth, height: v.videoHeight, source: v }, as.THUMB_SIDE, as.THUMB_QUALITY)).blob)
    return { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0, thumb }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function mediaDuration(file) {
  const url = URL.createObjectURL(file)
  try {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.src = url
    await once(a, 'loadedmetadata')
    return Number.isFinite(a.duration) ? a.duration : 0
  } finally {
    URL.revokeObjectURL(url)
  }
}

function once(node, event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms)
    node.addEventListener(event, () => (clearTimeout(t), resolve()), { once: true })
    node.addEventListener('error', () => (clearTimeout(t), reject(new Error('can’t read it'))), { once: true })
  })
}

async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
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
  const ascii = (o, n) => {
    let s = ''
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(view.getUint8(start + o + i))
    return s
  }
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
  return as.exifTime(ascii(when.value, when.count))
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
  for (const c of children || []) if (c != null && c !== false && c !== '') node.append(c)
  return node
}

function icon(name) {
  return el('span', { class: `fas fa-fw fa-${name}`, 'aria-hidden': 'true' })
}
