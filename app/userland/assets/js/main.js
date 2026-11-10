// nomad://assets: the files a Space keeps (ADR-0044), which grew out of the family album (ADR-0043).
// Photos, videos, voice memos, PDFs, Markdown, code, spreadsheets' CSVs: anything up to MAX_BYTES,
// and what the user's AI saves here (its saveAsset capability). In a shared Space everyone sees them
// and everyone who can edit adds them; a file shows who added it, and only they, or the Space's
// owner, can remove it. In any other Space they are the user's own, kept in their Vault.
//
// - Everything comes from nomad.vault (bg/web-apis/bg/assets.ts; the rules are shared/assets.mjs).
// - A camera photo bigger than MAX_SIDE is scaled here before it is sent, as the phone does; any
//   other file is kept as it is. Pictures and videos get a THUMB_SIDE thumbnail.
// - Files move in pieces of CHUNK_BYTES both ways (nomad.vault.assetChunk to read; beginAssetUpload/
//   assetUploadChunk/finishAssetUpload to add), so a 500 MB movie never crosses IPC whole. The viewer
//   shows how much has arrived while a big file comes in.
// - Previews: pictures, video and audio play from a blob: URL of the file's bytes; a PDF renders
//   with pdf.js (js/pdf.build.js, copied in by scripts/build.js; pages drawn as they scroll in,
//   js/pdf-view.js); an EPUB or MOBI opens in the book reader (js/book/, shared with the phone's
//   viewer page); Markdown renders with markdown-it (raw HTML off); CSV is a table, JSON is
//   pretty-printed, code and text are shown as text. An HTML file is shown as its source, never run.
// - Folders and tags (ADR-0044 amendment): the grid shows the open folder's own folders, then its
//   files. A kind, a tag or a search looks in the folder and every folder in it. Select files (the
//   tick on a tile, or Shift-click for a run) to move, tag or remove many at once, or drag them onto
//   a folder. Copy link puts a Markdown link to a file, folder or tag on the clipboard for a Note.
// - `?id=` opens one file, `?folder=` a folder and `?tag=` a tag. The tab title is
//   `<file name> · Assets` while one is open, else `<folder> · Assets`, `#<tag> · Assets` or "Assets".

import * as as from '../../../../shared/assets.mjs'
import { assetLink, assetFolderLink, assetTagLink } from '../../../../shared/item-links.mjs'
import { showPdf } from './pdf-view.js'
import { openBook, BookError } from './book/parse.js'
import { createReader } from './book/reader.js'
import { showAiOrigins } from '../../app-stdlib/js/ai-origin.js'

const MD_URL = 'nomad://app-stdlib/vendor/markdown-it.js'
const PDF_URL = '/js/pdf.build.js'
const PDF_WORKER_URL = '/js/pdf.worker.build.js'
// A picture with no thumbnail (the AI saved a GIF) shows itself in the grid up to this size.
const SMALL_PICTURE = 3 * 1024 * 1024
const CSV_ROWS = 500

const params = () => new URLSearchParams(location.search)
const state = {
  data: null, // nomad.vault.listAssets()
  error: '',
  open: params().get('id'), // the id of the file in the viewer
  folder: as.cleanFolder(params().get('folder') || ''), // the folder shown, '' for the top
  tag: as.cleanTag(params().get('tag') || ''), // the tag shown, '' for none
  filter: 'all',
  query: '',
  selected: new Set(), // ids picked for a change to many at once
  lastPicked: null, // the id picked last, for Shift-click
  adding: null, // { done, total, sent, size } while files are being added
  status: '',
  statusErr: false,
}
// Dragging tiles onto a folder moves them.
const DRAG_TYPE = 'application/x-nomad-assets'
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
    state.open = params().get('id')
    state.folder = as.cleanFolder(params().get('folder') || '')
    state.tag = as.cleanTag(params().get('tag') || '')
    state.selected.clear()
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
const folders = () => state.data?.folders || []
// Just looking around: no kind, tag or search, so the grid is the folder's own folders and files.
const browsing = () => state.filter === 'all' && !state.query && !state.tag
// The files in the open folder and every folder in it.
const scoped = () => assets().filter((a) => as.inFolder(a.folder || '', state.folder))
const shown = () =>
  browsing() ? as.filterAssets(assets(), { folder: state.folder }) : as.filterAssets(scoped(), { filter: state.filter, query: state.query, tag: state.tag })
const maxBytes = () => state.data?.maxBytes || as.MAX_BYTES
const knownTags = () => as.tagCounts(assets()).map((t) => t.tag)

async function load() {
  try {
    state.data = await nomad.vault.listAssets()
    state.error = ''
  } catch (err) {
    state.error = err?.message || String(err)
  }
  if (state.open && state.data && !assets().some((a) => a.id === state.open)) setOpen(null, true)
  for (const id of [...state.selected]) if (!assets().some((a) => a.id === id)) state.selected.delete(id)
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

function urlNow() {
  const q = new URLSearchParams()
  if (state.folder) q.set('folder', state.folder)
  if (state.tag) q.set('tag', state.tag)
  if (state.open) q.set('id', state.open)
  const s = q.toString()
  return s ? `?${s}` : location.pathname
}

function setOpen(id, replace = false) {
  state.open = id
  if (replace) history.replaceState(null, '', urlNow())
  else history.pushState(null, '', urlNow())
}

// Show a folder or a tag. Selection and the search start over.
function go({ folder = state.folder, tag = state.tag } = {}, replace = false) {
  state.folder = as.cleanFolder(folder)
  state.tag = as.cleanTag(tag)
  state.open = null
  state.query = ''
  state.selected.clear()
  if (replace) history.replaceState(null, '', urlNow())
  else history.pushState(null, '', urlNow())
  render()
}

// Rendering
// =

function render() {
  const data = state.data || {}
  const open = state.open ? assets().find((a) => a.id === state.open) : null
  document.title = open ? `${open.name} · Assets` : state.tag ? `#${state.tag} · Assets` : state.folder ? `${as.folderName(state.folder)} · Assets` : 'Assets'
  const app = document.getElementById('app')
  const focused = document.activeElement?.id
  const input = el('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => addFiles([...e.target.files]) })
  const count = assets().length
  replaceKids(
    app,
    el('header', {}, [
      el('div', { class: 'brand' }, [
        el('img', { src: 'asset:favicon:nomad://assets/', alt: '' }),
        'Assets',
        data.spaceName ? el('span', { class: 'space' }, [`· ${data.spaceName}`]) : null,
      ]),
      count ? el('span', { class: 'count' }, [`${count} file${count === 1 ? '' : 's'}`]) : null,
      el('div', { class: 'spacer' }),
      state.adding
        ? el('span', { class: 'status', id: 'adding' }, [addingText()])
        : state.status
          ? el('span', { class: `status${state.statusErr ? ' err' : ''}`, role: 'status' }, [state.status])
          : null,
      count
        ? el('label', { class: 'search' }, [
            icon('search'),
            el('input', {
              id: 'search',
              type: 'search',
              value: state.query,
              placeholder: state.folder ? `Search ${as.folderName(state.folder)}` : 'Search files',
              'aria-label': 'Search files',
              oninput: (e) => {
                state.query = e.target.value
                render()
              },
            }),
          ])
        : null,
      canAdd() ? el('button', { class: 'btn', onclick: newFolder }, [icon('folder-plus'), 'New folder']) : null,
      canAdd()
        ? el('button', { class: 'btn primary', disabled: !!state.adding, onclick: () => input.click() }, [icon('plus'), 'Add files'])
        : null,
      input,
    ]),
    count || folders().length || state.folder || state.tag ? renderWhere() : null,
    count ? renderFilters() : null,
    el('main', {}, [renderBody()]),
    state.selected.size ? renderSelection() : null,
    open ? renderViewer(open) : null
  )
  if (focused === 'search') {
    const s = document.getElementById('search')
    s?.focus()
    s?.setSelectionRange(s.value.length, s.value.length)
  } else if (focused === 'tag-add') document.getElementById('tag-add')?.focus()
  observeThumbs()
}

// Where you are: Assets › Recipes › Desserts (each a place to go, and to drop files on), or a tag,
// with what can be done to it.
function renderWhere() {
  const parts = state.folder ? state.folder.split('/') : []
  const atTop = !state.folder && !state.tag
  const crumbs = [
    atTop
      ? el('span', { class: 'crumb here', 'aria-current': 'page', ...dropOn('') }, [icon('home'), 'Assets'])
      : el('button', { class: 'crumb', onclick: () => go({ folder: '', tag: '' }), ...dropOn('') }, [icon('home'), 'Assets']),
  ]
  parts.forEach((name, i) => {
    const path = parts.slice(0, i + 1).join('/')
    crumbs.push(el('span', { class: 'sep', 'aria-hidden': 'true' }, ['›']))
    crumbs.push(
      i === parts.length - 1 && !state.tag
        ? el('span', { class: 'crumb here', 'aria-current': 'page' }, [icon('folder-open'), name])
        : el('button', { class: 'crumb', onclick: () => go({ folder: path, tag: '' }), ...dropOn(path) }, [icon('folder'), name])
    )
  })
  if (state.tag) {
    crumbs.push(el('span', { class: 'sep', 'aria-hidden': 'true' }, ['›']))
    crumbs.push(el('span', { class: 'crumb here', 'aria-current': 'page' }, [icon('tag'), state.tag]))
  }
  const edit = canAdd()
  let actions = []
  if (state.tag) {
    actions = [
      el('button', { class: 'btn small', onclick: () => copyLink(`#${state.tag}`, assetTagLink(state.tag)) }, [icon('link'), 'Copy link']),
      el('button', { class: 'btn small', onclick: () => go({ tag: '' }) }, [icon('times'), 'Clear tag']),
    ]
  } else if (state.folder) {
    actions = [
      el('button', { class: 'btn small', onclick: () => copyLink(as.folderName(state.folder), assetFolderLink(state.folder)) }, [icon('link'), 'Copy link']),
      edit ? el('button', { class: 'btn small', onclick: () => renameFolder(state.folder) }, [icon('pen'), 'Rename']) : null,
      edit ? el('button', { class: 'btn small', onclick: () => moveFolder(state.folder) }, [icon('arrow-right'), 'Move']) : null,
      edit ? el('button', { class: 'btn small danger', onclick: () => removeFolder(state.folder) }, [icon('trash'), 'Remove']) : null,
    ]
  }
  return el('nav', { class: 'where', 'aria-label': 'Folders' }, [el('div', { class: 'crumbs' }, crumbs), el('div', { class: 'spacer' }), ...actions])
}

function renderFilters() {
  const pool = scoped()
  const counts = new Map(as.FILTERS.map((f) => [f.id, as.filterAssets(pool, { filter: f.id }).length]))
  const tags = as.tagCounts(pool)
  if (state.tag && !tags.some((t) => t.tag === state.tag)) tags.unshift({ tag: state.tag, count: 0 })
  return el('div', { class: 'filters' }, [
    el(
      'nav',
      { class: 'chips', 'aria-label': 'Kinds of files' },
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
    ),
    tags.length
      ? el(
          'nav',
          { class: 'chips tags', 'aria-label': 'Tags' },
          tags.map((t) =>
            el(
              'button',
              {
                class: `chip tag${state.tag === t.tag ? ' on' : ''}`,
                'aria-pressed': state.tag === t.tag ? 'true' : 'false',
                title: state.tag === t.tag ? 'Show every file again' : `Show the files tagged ${t.tag}`,
                onclick: () => go({ tag: state.tag === t.tag ? '' : t.tag }),
              },
              [`#${t.tag}`, el('span', { class: 'n' }, [String(t.count)])]
            )
          )
        )
      : null,
  ])
}

function renderBody() {
  const data = state.data
  if (state.error) return el('div', { class: 'notice' }, [state.error])
  if (!data) return el('div', { class: 'notice' }, ['Loading…'])
  const place = data.spaceName || 'this Space'
  if (!assets().length && !folders().length) {
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
  if (state.folder && !folders().includes(state.folder)) {
    return el('div', { class: 'notice' }, [
      el('div', {}, [icon('folder')]),
      el('h2', {}, ['This folder isn’t here']),
      el('div', {}, ['Someone may have renamed, moved or removed it.']),
      el('button', { class: 'btn', onclick: () => go({ folder: '', tag: '' }) }, ['Go to all files']),
    ])
  }
  const subs = browsing() ? as.childFolders(folders(), state.folder, assets()) : []
  const list = shown()
  const body = []
  if (subs.length) {
    body.push(
      el('section', { class: 'month folders' }, [
        el('h2', {}, ['Folders', el('span', { class: 'n' }, [String(subs.length)])]),
        el('div', { class: 'grid folder-grid' }, subs.map(renderFolderTile)),
      ])
    )
  }
  if (list.length) {
    for (const g of as.byMonth(list)) {
      body.push(
        el('section', { class: 'month' }, [
          el('h2', {}, [g.label, el('span', { class: 'n' }, [String(g.assets.length)])]),
          el('div', { class: 'grid' }, g.assets.map(renderTile)),
        ])
      )
    }
  } else if (state.query) body.push(el('div', { class: 'notice' }, [`Nothing matches “${state.query}”.`]))
  else if (state.tag) body.push(el('div', { class: 'notice' }, [`No files are tagged ${state.tag}${state.folder ? ' in this folder' : ''}.`]))
  else if (!browsing()) body.push(el('div', { class: 'notice' }, ['No files of this kind.']))
  else if (!subs.length) {
    body.push(
      el('div', { class: 'notice' }, [
        el('div', {}, [icon('folder-open')]),
        el('h2', {}, ['This folder is empty']),
        el('div', {}, [data.canAdd ? 'Add files here, drop them on this page, or move files in from another folder.' : 'Nothing’s been put here yet.']),
        data.canAdd ? el('button', { class: 'btn primary', onclick: () => document.querySelector('header input[type=file]')?.click() }, [icon('plus'), 'Add files']) : null,
      ])
    )
  }
  return el('div', {}, [
    !data.shared && !state.folder && !state.tag
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

function renderFolderTile(f) {
  return el(
    'button',
    {
      class: 'folder-tile',
      title: f.path,
      'aria-label': `Folder ${f.name}, ${f.count} file${f.count === 1 ? '' : 's'}`,
      onclick: () => go({ folder: f.path, tag: '' }),
      ...dropOn(f.path),
    },
    [icon('folder'), el('span', { class: 'name' }, [f.name]), el('span', { class: 'n' }, [f.count ? `${f.count} file${f.count === 1 ? '' : 's'}` : 'Empty'])]
  )
}

function renderTile(a) {
  const media = hasPicture(a)
  const picked = state.selected.has(a.id)
  const label = `${a.name}, ${as.KIND_LABELS[a.kind] || 'File'}, ${whenText(a.takenAt)}${a.by ? `, added by ${a.by}` : ''}${a.source === 'ai' ? ', saved by your AI' : ''}${a.folder && !browsing() ? `, in ${a.folder}` : ''}`
  const tile = el(
    'button',
    {
      class: `tile${media ? ' media' : ' doc'}`,
      'data-id': a.id,
      'data-picture': media ? '1' : '',
      title: [a.caption || a.name, a.folder && !browsing() ? `In ${a.folder}` : '', (a.tags || []).map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n'),
      'aria-label': label,
      draggable: canAdd() ? 'true' : null,
      onclick: (e) => {
        if (e.shiftKey || state.selected.size) return pick(a.id, e.shiftKey)
        openAsset(a.id)
      },
      ondragstart: (e) => {
        const ids = state.selected.has(a.id) ? [...state.selected] : [a.id]
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'move'
      },
    },
    [
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
    ]
  )
  return el('div', { class: `cell${picked ? ' picked' : ''}${state.selected.size ? ' picking' : ''}` }, [
    tile,
    el(
      'button',
      {
        class: 'pick',
        'aria-pressed': picked ? 'true' : 'false',
        'aria-label': `${picked ? 'Unselect' : 'Select'} ${a.name}`,
        title: picked ? 'Unselect' : 'Select',
        onclick: (e) => pick(a.id, e.shiftKey),
      },
      [icon('check')]
    ),
  ])
}

// Drag files onto a folder (a tile or a crumb) to move them there.
function dropOn(path) {
  if (!canAdd()) return {}
  const over = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE)
  return {
    ondragover: (e) => {
      if (!over(e)) return
      e.preventDefault()
      e.currentTarget.classList.add('drop')
    },
    ondragleave: (e) => e.currentTarget.classList.remove('drop'),
    ondrop: (e) => {
      if (!over(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.remove('drop')
      let ids = []
      try {
        ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE))
      } catch {}
      if (Array.isArray(ids) && ids.length) moveTo(ids, path)
    },
  }
}

// Select or unselect a file; Shift picks every file between it and the one picked last.
function pick(id, range = false) {
  const list = shown()
  if (range && state.lastPicked && state.lastPicked !== id) {
    const a = list.findIndex((x) => x.id === state.lastPicked)
    const b = list.findIndex((x) => x.id === id)
    if (a >= 0 && b >= 0) {
      for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selected.add(x.id)
      state.lastPicked = id
      render()
      return
    }
  }
  if (state.selected.has(id)) state.selected.delete(id)
  else state.selected.add(id)
  state.lastPicked = id
  render()
}

// The bar at the bottom while files are selected.
function renderSelection() {
  const ids = [...state.selected]
  const picked = assets().filter((a) => state.selected.has(a.id))
  const removable = picked.filter((a) => a.canDelete).length
  const all = shown()
  return el('div', { class: 'selection', role: 'toolbar', 'aria-label': 'Selected files' }, [
    el('button', { class: 'icon-btn', title: 'Clear selection', 'aria-label': 'Clear selection', onclick: clearSelection }, [icon('times')]),
    el('span', { class: 'n' }, [`${ids.length} selected`]),
    all.some((a) => !state.selected.has(a.id))
      ? el('button', { class: 'btn small', onclick: () => (all.forEach((a) => state.selected.add(a.id)), render()) }, ['Select all'])
      : null,
    el('div', { class: 'spacer' }),
    canAdd() ? el('button', { class: 'btn small', onclick: () => moveAssets(ids) }, [icon('arrow-right'), 'Move to…']) : null,
    canAdd() ? el('button', { class: 'btn small', onclick: () => tagAssets(ids) }, [icon('tag'), 'Tags…']) : null,
    removable ? el('button', { class: 'btn small danger', onclick: () => removeAssets(picked) }, [icon('trash'), 'Remove']) : null,
  ])
}

function clearSelection() {
  state.selected.clear()
  state.lastPicked = null
  render()
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

// The whole file as a blob: URL, kept for the last few opened. It comes in CHUNK_BYTES pieces (a
// movie is far too big for one message), folded into the Blob as it goes so Chromium can keep the
// bytes on disk, and the viewer shows how far along it is.
const progress = new Map() // id -> { got, size } while a file is coming in
async function loadFile(id) {
  if (files.has(id)) return files.get(id)
  const pending = (async () => {
    const a = assets().find((x) => x.id === id)
    let blob = new Blob([])
    let parts = []
    let partBytes = 0
    let got = 0
    let size = Infinity
    while (got < size) {
      const piece = await nomad.vault.assetChunk(id, { start: got }).catch(() => null)
      if (!piece) return null
      size = piece.size
      const n = piece.data?.byteLength || 0
      if (!n && got < size) return null
      parts.push(piece.data)
      partBytes += n
      got += n
      if (partBytes >= 64 * 1024 * 1024) {
        blob = new Blob([blob, ...parts])
        parts = []
        partBytes = 0
      }
      progress.set(id, { got, size })
      showProgress(id)
    }
    blob = new Blob([blob, ...parts], { type: a?.mime || '' })
    return { blob, url: URL.createObjectURL(blob) }
  })()
  files.set(id, pending)
  const got = await pending.finally(() => progress.delete(id))
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

// "12 MB of 840 MB" under the viewer's spinner, updated in place (a render per piece would restart
// the whole page).
function showProgress(id) {
  const p = progress.get(id)
  const node = document.querySelector(`.viewer .loading[data-id="${id}"]`)
  if (!node || !p) return
  let bar = node.querySelector('.progress')
  if (!bar) {
    bar = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Loading the file', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [el('div', { class: 'fill' }), el('div', { class: 'what' })])
    node.append(bar)
  }
  const pct = p.size ? Math.round((p.got / p.size) * 100) : 0
  bar.setAttribute('aria-valuenow', String(pct))
  bar.querySelector('.fill').style.width = `${pct}%`
  bar.querySelector('.what').textContent = `${as.formatBytes(p.got)} of ${as.formatBytes(p.size)}`
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
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return
  if (!state.open) {
    if (e.key === 'Escape' && state.selected.size) clearSelection()
    return
  }
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
          [describe(a), whenText(a.takenAt), a.by ? `Added by ${a.by}` : '', a.source === 'ai' ? 'Saved by your AI' : '', a.folder ? `In ${a.folder.split('/').join(' › ')}` : ''].filter(Boolean).join(' · '),
        ]),
      ]),
      el('button', { class: 'icon-btn', title: 'Copy link for a note', 'aria-label': 'Copy link for a note', onclick: () => copyLink(a.name, assetLink(a.id)) }, [icon('link')]),
      editable ? el('button', { class: 'icon-btn', title: 'Move to a folder', 'aria-label': 'Move to a folder', onclick: () => moveAssets([a.id]) }, [icon('folder')]) : null,
      a.sourceUrl ? el('a', { class: 'icon-btn', href: a.sourceUrl, target: '_blank', rel: 'noopener', title: 'Open where it came from', 'aria-label': 'Open where it came from' }, [icon('external-link-alt')]) : null,
      el('a', { class: 'icon-btn', href: f?.url || '#', download: a.name, title: 'Download', 'aria-label': 'Download', 'aria-disabled': f ? 'false' : 'true' }, [icon('download')]),
      a.canDelete ? el('button', { class: 'icon-btn', title: 'Remove from Assets', 'aria-label': 'Remove from Assets', onclick: () => remove(a) }, [icon('trash')]) : null,
      el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: close }, [icon('times')]),
    ]),
    el('div', { class: 'stage' }, [
      many ? el('button', { class: 'icon-btn side', title: 'Previous file', 'aria-label': 'Previous file', onclick: () => step(-1) }, [icon('chevron-left')]) : null,
      el('div', { class: 'preview' }, [f ? renderPreview(a, f) : renderLoading(a)]),
      many ? el('button', { class: 'icon-btn side', title: 'Next file', 'aria-label': 'Next file', onclick: () => step(1) }, [icon('chevron-right')]) : null,
    ]),
    el('div', { class: 'caption' }, [
      renderTags(a, editable),
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
      renderOrigins(a),
    ]),
  ])
}

// The AI chat that saved the file, while it is still there (ADR-0047).
function renderOrigins(a) {
  if (!Array.isArray(a.ai) || !a.ai.length) return null
  const slot = el('div', { class: 'ai-origin-slot' })
  showAiOrigins(slot, a.ai, { onError: (e) => say(e?.message || String(e), true) })
  return slot
}

// The file's tags in the viewer: each goes to its tag; × takes it off; the box adds one.
function renderTags(a, editable) {
  const tags = a.tags || []
  if (!tags.length && !editable) return null
  const listId = 'known-tags'
  return el('div', { class: 'tags-row' }, [
    ...tags.map((t) =>
      el('span', { class: 'tag-chip' }, [
        el('button', { class: 'tag-go', title: `Show the files tagged ${t}`, onclick: () => go({ folder: '', tag: t }) }, [`#${t}`]),
        editable
          ? el('button', { class: 'tag-x', title: `Remove the tag ${t}`, 'aria-label': `Remove the tag ${t}`, onclick: () => save(a, { tags: tags.filter((x) => x !== t) }) }, [icon('times')])
          : null,
      ])
    ),
    editable
      ? el('input', {
          id: 'tag-add',
          class: 'tag-add',
          type: 'text',
          placeholder: tags.length ? 'Add a tag' : 'Add tags',
          'aria-label': 'Add a tag',
          list: listId,
          maxlength: String(as.MAX_TAG * 4),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              const add = as.normalizeTags(e.target.value)
              if (add.length) save(a, { tags: [...tags, ...add] })
              e.target.value = ''
            }
          },
          onchange: (e) => {
            const add = as.normalizeTags(e.target.value)
            if (add.length) save(a, { tags: [...tags, ...add] })
          },
        })
      : null,
    editable ? el('datalist', { id: listId }, knownTags().filter((t) => !tags.includes(t)).map((t) => el('option', { value: t }))) : null,
  ])
}

// While the file comes in: its thumbnail, or a spinner, and how far along it is.
function renderLoading(a) {
  const node = el('div', { class: 'loading', 'data-id': a.id }, [thumbs.get(a.id) ? el('img', { src: thumbs.get(a.id), alt: '' }) : el('div', {}, ['Loading…'])])
  queueMicrotask(() => showProgress(a.id))
  return node
}

// Previews
// =

const previewCache = new Map() // id -> the element, so a re-render keeps a playing video and a rendered PDF

function renderPreview(a, f) {
  const key = a.id + ':' + f.url
  if (previewCache.has(key)) {
    const kept = previewCache.get(key)
    // A drawn PDF moves into this render's new scroll box: its pages watch that one now.
    queueMicrotask(() => pdfWatch.get(kept)?.())
    return kept
  }
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
  } else if (a.kind === 'book') {
    node = el('div', { class: 'doc book' }, [el('div', { class: 'loading' }, ['Opening the book…'])])
    renderBook(node, a, f.blob).catch((err) => node.replaceChildren(noPreview(a, f, err instanceof BookError ? err.message : `This book can’t be shown here (${err?.message || err})`)))
  } else if (as.isTextKind(a.kind)) {
    node = el('div', { class: `doc text kind-${a.kind}` }, [el('div', { class: 'loading' }, ['Loading…'])])
    renderText(node, a, f.blob).catch(() => node.replaceChildren(noPreview(a, f, 'This file can’t be read as text')))
  } else {
    node = noPreview(a, f, 'There’s no preview for this kind of file')
  }
  previewCache.set(key, node)
  if (previewCache.size > KEEP_FILES) {
    const oldKey = previewCache.keys().next().value
    const oldNode = previewCache.get(oldKey)
    readers.get(oldNode)?.destroy()
    readers.delete(oldNode)
    previewCache.delete(oldKey)
  }
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

// An EPUB or MOBI in the reader (js/book/), in the page's colors. It stays open (previewCache) while
// the viewer re-renders, and the book's blob: URLs go when the viewer moves on.
const readers = new Map() // node -> reader
async function renderBook(node, a, blob) {
  const book = openBook(new Uint8Array(await blob.arrayBuffer()))
  const style = getComputedStyle(document.body)
  const scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const theme = { scheme, bg: style.getPropertyValue('--as-paper').trim(), text: style.getPropertyValue('--as-paper-text').trim(), link: style.getPropertyValue('--as-accent').trim() }
  readers.set(node, createReader(node, book, { key: a.id, theme, onLink: (url) => window.open(url, '_blank', 'noopener') }))
}

let pdfjs = null
const pdfWatch = new WeakMap() // a PDF's node -> rewatch(), for when a render moves it
async function renderPdf(node, blob) {
  if (!pdfjs) {
    pdfjs = await import(/* @vite-ignore */ PDF_URL)
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
  }
  const { rewatch } = await showPdf(node, new Uint8Array(await blob.arrayBuffer()), pdfjs)
  pdfWatch.set(node, rewatch)
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

// A Markdown link, ready to paste in a Note: `[name](nomad://assets/?…)`.
async function copyLink(name, url) {
  const text = `[${String(name).replace(/[[\]]/g, '')}](${url})`
  try {
    await navigator.clipboard.writeText(text)
    say('Link copied. Paste it in a note.')
  } catch {
    say('Couldn’t copy the link', true)
  }
}

// Run a change, reload, and say how it went.
async function act(fn, done) {
  try {
    const res = await fn()
    await load()
    if (done) say(typeof done === 'function' ? done(res) : done)
    return res
  } catch (err) {
    say(err?.message || String(err), true)
    return undefined
  }
}

async function newFolder() {
  const name = await askText({ title: 'New folder', label: state.folder ? `In ${state.folder.split('/').join(' › ')}` : 'In Assets', ok: 'Create' })
  const clean = as.cleanFolderName(name)
  if (!clean) return
  const path = as.joinFolder(state.folder, clean)
  if (await act(() => nomad.vault.addAssetFolder(path), `Made the folder ${clean}`)) render()
}

// Where the open folder is after `from` moved to `to`.
const movedFolder = (path, from, to) => (as.inFolder(path, from) ? as.cleanFolder(to + path.slice(from.length)) : path)

async function renameFolder(path) {
  const name = await askText({ title: 'Rename folder', label: 'Name', value: as.folderName(path), ok: 'Rename' })
  const clean = as.cleanFolderName(name)
  if (!clean || clean === as.folderName(path)) return
  const to = as.joinFolder(as.parentFolder(path), clean)
  if (folders().includes(to)) return say(`There’s already a folder called ${clean} here`, true)
  if (await act(() => nomad.vault.moveAssetFolder({ from: path, to }), `Renamed it ${clean}`)) go({ folder: movedFolder(state.folder, path, to) }, true)
}

async function moveFolder(path) {
  const dest = await pickFolder({ title: `Move “${as.folderName(path)}” to…`, not: path })
  if (dest == null) return
  const to = as.joinFolder(dest, as.folderName(path))
  if (to === path) return
  if (folders().includes(to)) return say(`There’s already a folder called ${as.folderName(path)} there`, true)
  if (await act(() => nomad.vault.moveAssetFolder({ from: path, to }), `Moved it to ${dest || 'Assets'}`)) go({ folder: movedFolder(state.folder, path, to) }, true)
}

async function removeFolder(path) {
  const n = assets().filter((a) => a.folder && as.inFolder(a.folder, path)).length
  const where = state.data?.shared && n ? ` They go for everyone in ${state.data?.spaceName || 'the Space'}.` : ''
  if (!confirm(`Remove the folder “${as.folderName(path)}”${n ? ` and the ${n} file${n === 1 ? '' : 's'} in it` : ''}?${where}`)) return
  if (await act(() => nomad.vault.deleteAssetFolder(path), 'Removed the folder')) go({ folder: as.parentFolder(path) }, true)
}

async function moveAssets(ids) {
  const here = ids.length === 1 ? assets().find((a) => a.id === ids[0])?.folder || '' : null
  const dest = await pickFolder({ title: ids.length === 1 ? 'Move to…' : `Move ${ids.length} files to…`, current: here })
  if (dest == null) return
  moveTo(ids, dest)
}

async function moveTo(ids, folder) {
  const res = await act(() => nomad.vault.updateAssets({ ids, folder }), (r) => `Moved ${r.changed} file${r.changed === 1 ? '' : 's'} to ${folder ? as.folderName(folder) : 'Assets'}`)
  if (res) {
    state.selected.clear()
    render()
  }
}

async function tagAssets(ids) {
  const picked = assets().filter((a) => ids.includes(a.id))
  const change = await editTags(picked)
  if (!change) return
  const res = await act(() => nomad.vault.updateAssets({ ids, addTags: change.add, removeTags: change.remove }), (r) => `Changed the tags on ${r.changed} file${r.changed === 1 ? '' : 's'}`)
  if (res) {
    state.selected.clear()
    render()
  }
}

async function removeAssets(picked) {
  const mine = picked.filter((a) => a.canDelete)
  const theirs = picked.length - mine.length
  const where = state.data?.shared ? ` They go for everyone in ${state.data?.spaceName || 'the Space'}.` : ''
  const skip = theirs ? ` ${theirs} added by someone else will stay.` : ''
  if (!confirm(`Remove ${mine.length} file${mine.length === 1 ? '' : 's'} from Assets?${where}${skip}`)) return
  const res = await act(() => nomad.vault.deleteAssets(mine.map((a) => a.id)), (r) => `Removed ${r.removed} file${r.removed === 1 ? '' : 's'}`)
  if (res) {
    state.selected.clear()
    render()
  }
}

// Dialogs
// =

// A <dialog> outside #app, so a render doesn't wipe what's typed in it. Resolves with what `body`
// gives `done`, or null when it's closed.
function dialog(title, build) {
  return new Promise((resolve) => {
    let result = null
    const d = el('dialog', { class: 'dlg', 'aria-label': title })
    const done = (value) => {
      result = value
      d.close()
    }
    const { body, ok, onOk } = build(done)
    d.append(
      el('form', { method: 'dialog', onsubmit: (e) => (e.preventDefault(), onOk()) }, [
        el('h2', {}, [title]),
        body,
        el('div', { class: 'dlg-actions' }, [
          el('button', { type: 'button', class: 'btn', onclick: () => done(null) }, ['Cancel']),
          el('button', { type: 'submit', class: 'btn primary' }, [ok]),
        ]),
      ])
    )
    d.addEventListener('close', () => {
      d.remove()
      resolve(result)
    })
    document.body.append(d)
    d.showModal()
    d.querySelector('input:not([type=hidden])')?.focus()
  })
}

function askText({ title, label, value = '', ok = 'OK' }) {
  return dialog(title, (done) => {
    const input = el('input', { type: 'text', class: 'text', value, 'aria-label': label, maxlength: String(as.MAX_FOLDER_PART) })
    setTimeout(() => input.select(), 0)
    return { body: el('label', { class: 'field' }, [el('span', {}, [label]), input]), ok, onOk: () => done(input.value) }
  })
}

// Pick a folder: '' is the top. `not` leaves a folder (and what's in it) out, for moving it.
function pickFolder({ title, current = null, not = null }) {
  return dialog(title, (done) => {
    let chosen = current ?? state.folder
    const extra = [] // folders made here, kept until the move writes them
    const list = el('div', { class: 'folder-list', role: 'listbox', 'aria-label': 'Folders' })
    const draw = () => {
      const all = [...new Set([...folders(), ...extra])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      const rows = ['', ...all.filter((f) => !not || !as.inFolder(f, not))]
      list.replaceChildren(
        ...rows.map((f) =>
          el(
            'button',
            {
              type: 'button',
              class: `folder-row${f === chosen ? ' on' : ''}`,
              role: 'option',
              'aria-selected': f === chosen ? 'true' : 'false',
              style: `padding-left: ${12 + (f ? f.split('/').length : 0) * 18}px`,
              onclick: () => {
                chosen = f
                draw()
              },
              ondblclick: () => done(f),
            },
            [icon(f ? 'folder' : 'home'), f ? as.folderName(f) : 'Assets', f === current ? el('span', { class: 'here' }, ['now']) : null]
          )
        )
      )
    }
    draw()
    const name = el('input', { type: 'text', class: 'text', placeholder: 'New folder', 'aria-label': 'New folder name', maxlength: String(as.MAX_FOLDER_PART) })
    const make = () => {
      const clean = as.cleanFolderName(name.value)
      if (!clean) return
      const path = as.joinFolder(chosen, clean)
      extra.push(path)
      chosen = path
      name.value = ''
      draw()
    }
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        make()
      }
    })
    return {
      body: el('div', {}, [
        list,
        el('div', { class: 'new-folder' }, [
          name,
          el('button', { type: 'button', class: 'btn', onclick: make }, [icon('folder-plus'), 'Make']),
        ]),
      ]),
      ok: 'Move here',
      onOk: () => done(chosen),
    }
  })
}

// Add tags to some files, or take tags off them: { add, remove }.
function editTags(picked) {
  return dialog(picked.length === 1 ? 'Tags' : `Tags for ${picked.length} files`, (done) => {
    const counts = as.tagCounts(picked)
    const remove = new Set()
    const chips = el('div', { class: 'tags-row' })
    const draw = () =>
      chips.replaceChildren(
        ...(counts.length
          ? counts.map(({ tag, count }) =>
              el(
                'button',
                {
                  type: 'button',
                  class: `tag-chip toggle${remove.has(tag) ? ' off' : ''}`,
                  'aria-pressed': remove.has(tag) ? 'false' : 'true',
                  title: remove.has(tag) ? `Keep ${tag}` : `Take ${tag} off`,
                  onclick: () => {
                    if (remove.has(tag)) remove.delete(tag)
                    else remove.add(tag)
                    draw()
                  },
                },
                [`#${tag}`, picked.length > 1 ? el('span', { class: 'n' }, [`${count}`]) : null, icon(remove.has(tag) ? 'undo' : 'times')]
              )
            )
          : [el('span', { class: 'muted' }, ['No tags yet.'])])
      )
    draw()
    const input = el('input', { type: 'text', class: 'text', placeholder: 'family, recipes, taxes 2026', 'aria-label': 'Tags to add', list: 'dlg-known-tags' })
    return {
      body: el('div', {}, [
        chips,
        el('label', { class: 'field' }, [el('span', {}, ['Add tags, with commas between them']), input]),
        el('datalist', { id: 'dlg-known-tags' }, knownTags().map((t) => el('option', { value: t }))),
      ]),
      ok: 'Save',
      onOk: () => done({ add: as.normalizeTags(input.value), remove: [...remove] }),
    }
  })
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
  state.adding = { done: 0, total: list.length, sent: 0, size: 0 }
  render()
  // A file added in a folder goes in it, and one added while a tag is shown gets the tag.
  const where = { folder: state.folder || undefined, tags: state.tag ? [state.tag] : undefined }
  for (const file of list) {
    try {
      const { blob, fields } = await prepare(file)
      await upload(blob, { ...fields, ...where })
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

function addingText() {
  const { done, total, sent, size } = state.adding
  const of = total > 1 ? ` ${done + 1} of ${total}` : ''
  return size > as.CHUNK_BYTES ? `Adding${of}… ${Math.round((sent / size) * 100)}%` : `Adding${of}…`
}

// One file, in CHUNK_BYTES pieces (beginAssetUpload, assetUploadChunk, finishAssetUpload).
async function upload(blob, fields) {
  const id = await nomad.vault.beginAssetUpload({ size: blob.size })
  try {
    state.adding.size = blob.size
    for (let start = 0; start < blob.size; start += as.CHUNK_BYTES) {
      const data = new Uint8Array(await blob.slice(start, start + as.CHUNK_BYTES).arrayBuffer())
      state.adding.sent = await nomad.vault.assetUploadChunk(id, { start, data })
      const status = document.getElementById('adding')
      if (status) status.textContent = addingText()
    }
    return await nomad.vault.finishAssetUpload(id, fields)
  } catch (err) {
    nomad.vault.abortAssetUpload(id).catch(() => {})
    throw err
  } finally {
    state.adding.sent = state.adding.size = 0
  }
}

// What finishAssetUpload takes for one dropped or picked file, and the file itself (a camera
// photo scaled).
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
  return { blob, fields: out }
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

// replaceChildren, leaving out the parts that aren't there.
function replaceKids(node, ...kids) {
  node.replaceChildren(...kids.filter((k) => k != null && k !== false))
}

function icon(name) {
  return el('span', { class: `fas fa-fw fa-${name}`, 'aria-hidden': 'true' })
}
