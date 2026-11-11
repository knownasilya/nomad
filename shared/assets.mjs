// Assets (ADR-0044, which grew out of the family album, ADR-0043): any file a Space keeps, a photo,
// a video, a voice memo, a PDF, a recipe in Markdown, a CSV, and what the user's AI saves there.
// Desktop (app/bg/web-apis/bg/assets.ts) and the phone (mobile/backend/lib/assets.mjs) use these rules.
//
// Every Space has Assets. A shared Space's live in its Space Library (ADR-0029), the Autobase every
// member replicates and every editor writes: `/assets/items/<id>.json`, the file `/assets/files/<id>`
// and, for a picture or a video, a thumbnail `/assets/thumbs/<id>.jpg`. Any other Space's are the
// user's own, in the Vault under the Space's prefix (`/.vault/space-lib/<space>/assets/…`), and move
// into the Space Library when the Space is shared. Files are blobs in the adding writer's own blob
// core, so the oplog carries only pointers.
//
// A file can have tags and sit in a folder (ADR-0044 amendment): `tags` and `folder` on its record.
// A folder is a path ('Recipes/Desserts'); one that holds no files is kept by a folder record,
// `<root>folders/<folderKey(path)>.json`, so a new folder stays until it is removed.
//
// The family album's photos (`/photos/items|files|thumbs/`) are Assets now: `legacyPaths` and
// `fromPhoto` read them, and a Device that can write the Space Library moves them (same blobs, new
// paths) the first time it lists the Space's Assets.
//
// No Electron imports, and nothing touched as the module loads that Bare lacks.

import { spaceLibPrefix } from './vault-apps.mjs'
import { originsOf } from './ai-origin.mjs'

export const ASSET_TYPE = 'nomad/asset'
export const LIB_ASSETS = '/assets/'

// Where a Space's Assets are: '/assets/' in its Space Library, or the Space's prefix in the Vault.
export function vaultRoot(space) {
  return spaceLibPrefix(space) + 'assets/'
}

// A file is kept as it is, up to MAX_BYTES. A photo from a camera is scaled to MAX_SIDE first, as
// the album did, and every picture and video gets a THUMB_SIDE JPEG thumbnail where the Device can
// make one.
export const MAX_BYTES = 500 * 1024 * 1024
// What the user's AI saves (saveAsset): it fetches or writes the whole file in memory.
export const MAX_AI_BYTES = 100 * 1024 * 1024
// Big files move in pieces this size, between a page and the backend, never whole.
export const CHUNK_BYTES = 4 * 1024 * 1024
// The most nomad.vault.assetData sends as one data: URL (thumbnails, small pictures).
export const MAX_DATA_URL_BYTES = 32 * 1024 * 1024
export const MAX_SIDE = 2560
export const THUMB_SIDE = 480
export const QUALITY = 0.85
export const THUMB_QUALITY = 0.75
export const MAX_THUMB_BYTES = 400 * 1024
export const MAX_CAPTION = 500
export const MAX_NAME = 120
// One add at a time from a picker.
export const MAX_BATCH = 30
// How much of a text file a preview shows.
export const MAX_TEXT_PREVIEW = 512 * 1024

const ID_RE = /^[ap][a-z0-9]{6,14}-[a-z0-9]{4,10}$/
// New Assets start with `a`; the album's photos kept their `p` ids.
export function isAssetId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

function randomPart(n = 6) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36)
  return s
}

export function newAssetId(now = Date.now(), rand = randomPart) {
  return 'a' + Math.floor(now).toString(36) + '-' + rand(6)
}

function check(id) {
  if (!isAssetId(id)) throw new Error('Not an asset id: ' + id)
  return id
}

// The paths under one root ('/assets/' or vaultRoot(space)).
export function pathsOf(root = LIB_ASSETS) {
  return {
    root,
    items: root + 'items/',
    files: root + 'files/',
    thumbs: root + 'thumbs/',
    item: (id) => root + 'items/' + check(id) + '.json',
    file: (id) => root + 'files/' + check(id),
    thumb: (id) => root + 'thumbs/' + check(id) + '.jpg',
    folders: root + 'folders/',
    folder: (path) => root + 'folders/' + folderKey(path) + '.json',
  }
}

// The family album's paths (ADR-0043), read until a writer moves them.
export const LEGACY_ROOT = '/photos/'
export const LEGACY_ITEMS = LEGACY_ROOT + 'items/'
export function legacyPaths(id) {
  check(id)
  return { item: `${LEGACY_ROOT}items/${id}.json`, file: `${LEGACY_ROOT}files/${id}.jpg`, thumb: `${LEGACY_ROOT}thumbs/${id}.jpg` }
}

// Kinds
// =

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm',
  pdf: 'application/pdf',
  md: 'text/markdown', markdown: 'text/markdown',
  txt: 'text/plain', log: 'text/plain', text: 'text/plain',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
  xml: 'application/xml', ics: 'text/calendar', vcf: 'text/vcard', srt: 'text/plain', vtt: 'text/vtt',
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/x-typescript',
  tsx: 'text/x-typescript', jsx: 'text/javascript', py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust',
  java: 'text/x-java', kt: 'text/x-kotlin', swift: 'text/x-swift', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sh: 'text/x-shellscript',
  sql: 'application/sql', toml: 'application/toml', ini: 'text/plain',
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', rtf: 'application/rtf',
  epub: 'application/epub+zip', mobi: 'application/x-mobipocket-ebook', prc: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook', azw3: 'application/vnd.amazon.mobi8-ebook',
}

const HTML_EXT = new Set(['html', 'htm', 'xhtml'])
const CODE_EXT = new Set(['css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'sql', 'toml', 'xml', 'yaml', 'yml', 'ini'])
const DATA_EXT = new Set(['json', 'csv', 'tsv', 'ics', 'vcf'])
const ARCHIVE_EXT = new Set(['zip', 'gz', 'tgz', 'tar', '7z', 'rar'])
const DOCUMENT_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf'])
const BOOK_EXT = new Set(['epub', 'mobi', 'prc', 'azw', 'azw3'])

export function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

const MIME_RE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,100}$/

// A file's type: the one it came with when it looks like one, else from its extension.
export function mimeOf(name, given = '') {
  const g = String(given || '').toLowerCase().split(';')[0].trim()
  const fromExt = EXT_MIME[extOf(name)]
  if (g && MIME_RE.test(g) && g !== 'application/octet-stream') {
    // A browser says text/plain for a .md, and some pickers say application/json for .geojson: the
    // extension knows better for text.
    if (fromExt && (g === 'text/plain' || g === 'text/x-markdown')) return fromExt
    return g
  }
  return fromExt || 'application/octet-stream'
}

// What a file is, for the icon, the filter and the preview: image, video, audio, pdf, book (an
// e-book: EPUB or MOBI), markdown, html (a web page, shown in a sandbox), code, data, text,
// document, archive, other.
export const KINDS = ['image', 'video', 'audio', 'pdf', 'book', 'markdown', 'html', 'code', 'data', 'text', 'document', 'archive', 'other']
export function kindOf(mime, name = '') {
  const m = String(mime || '').toLowerCase()
  const ext = extOf(name)
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (BOOK_EXT.has(ext) || m === 'application/epub+zip' || m === 'application/x-mobipocket-ebook' || m.startsWith('application/vnd.amazon.')) return 'book'
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown'
  if (HTML_EXT.has(ext) || m === 'text/html' || m === 'application/xhtml+xml') return 'html'
  if (DATA_EXT.has(ext) || m === 'application/json' || m === 'text/csv') return 'data'
  if (CODE_EXT.has(ext)) return 'code'
  if (m.startsWith('text/')) return 'text'
  if (DOCUMENT_EXT.has(ext)) return 'document'
  if (ARCHIVE_EXT.has(ext) || /zip|tar|gzip|compressed|rar/.test(m)) return 'archive'
  return 'other'
}

// Kinds whose preview is the file's text.
export function isTextKind(kind) {
  return kind === 'markdown' || kind === 'code' || kind === 'data' || kind === 'text'
}

// Kinds the viewer draws from their text and can also show as source (Preview / Source).
export function hasSource(kind) {
  return kind === 'markdown' || kind === 'html'
}

// An HTML file's preview runs in a sandbox: its own origin (none), no forms, popups or top
// navigation, and this policy, so it reaches nothing outside the file. Its scripts run, so a page
// the AI drew from components (app/lib/genui/page.mjs) works, as do its inline styles, fonts and
// pictures as data: or blob: URLs. The one host it may load from is OpenStreetMap's tiles, for a
// Map. Desktop serves it as the header of nomad://assets/html-frame (bg/protocols/nomad.js); the
// phone puts it first in the page (withPreviewCsp).
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: data:",
  "style-src 'unsafe-inline' blob: data:",
  'img-src data: blob: https://tile.openstreetmap.org',
  'font-src data: blob:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

// The most of an HTML file the preview draws (an AI page with a map is about half a megabyte).
export const MAX_HTML_PREVIEW = 16 * 1024 * 1024

// An HTML file with HTML_PREVIEW_CSP as the first thing in it, after its doctype, so the policy
// covers everything the page does. For a WebView that loads the page as a string (the phone).
export function withPreviewCsp(html) {
  const text = String(html || '')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`
  const m = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(text)
  return m ? m[0] + meta + text.slice(m[0].length) : '<!doctype html>' + meta + text
}

// A Font Awesome 5 (solid) icon for each kind, the same on desktop and the phone.
export const KIND_ICONS = {
  image: 'image',
  video: 'film',
  audio: 'music',
  pdf: 'file-pdf',
  book: 'book',
  markdown: 'file-alt',
  html: 'globe',
  code: 'file-code',
  data: 'table',
  text: 'file-alt',
  document: 'file-word',
  archive: 'file-archive',
  other: 'file',
}

export const KIND_LABELS = {
  image: 'Picture',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  book: 'Book',
  markdown: 'Markdown',
  html: 'Web page',
  code: 'Code',
  data: 'Data',
  text: 'Text',
  document: 'Document',
  archive: 'Archive',
  other: 'File',
}

// The filters above the grid: [{ id, label, kinds }]. 'all' has every kind.
export const FILTERS = [
  { id: 'all', label: 'All', kinds: KINDS },
  { id: 'media', label: 'Photos & videos', kinds: ['image', 'video'] },
  { id: 'docs', label: 'Documents', kinds: ['pdf', 'book', 'markdown', 'html', 'code', 'data', 'text', 'document'] },
  { id: 'audio', label: 'Audio', kinds: ['audio'] },
  { id: 'other', label: 'Other', kinds: ['archive', 'other'] },
]

// Records
// =

// A file name with no folders or control characters, at most MAX_NAME, keeping its extension.
export function cleanName(name, fallback = 'Untitled') {
  let s = String(name || '')
    .split(/[\\/]/)
    .pop()
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s === '.' || s === '..') s = fallback
  if (s.length > MAX_NAME) {
    const ext = extOf(s)
    s = ext ? s.slice(0, MAX_NAME - ext.length - 1).trimEnd() + '.' + ext : s.slice(0, MAX_NAME)
  }
  return s
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/
function isoOrNull(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// EXIF's DateTimeOriginal ('2026:11:05 14:03:22', no zone) as an ISO time, read as this Device's
// local time, or null.
export function exifTime(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(d.getTime()) && +m[1] > 1990 ? d.toISOString() : null
}

const posInt = (n, max = 100000) => {
  const v = Math.floor(Number(n))
  return v > 0 && v <= max ? v : 0
}

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * An Asset's record. `by` and `memberId` say who added it, `source` 'ai' that the user's AI did
 * (with the page it came from as `sourceUrl`). An edit (a name, a caption) keeps the rest.
 * `takenAt` is when a photo or video was taken, else when the file was added.
 * `tags` and `folder` are the user's to change, like the name and caption.
 * @param {{ id: string, name?: string, mime?: string, bytes?: number, width?: number, height?: number, duration?: number, takenAt?: string | null, by?: string, memberId?: string | null, caption?: string, thumb?: boolean, source?: string, sourceUrl?: string, tags?: string[] | string, folder?: string, ai?: any[] }} f
 */
export function makeAsset(f, prev = null, now = new Date().toISOString()) {
  const id = check(String(f.id || ''))
  const name = cleanName(f.name ?? prev?.name ?? '', prev?.name || 'Untitled')
  const mime = prev ? prev.mime : mimeOf(name, f.mime)
  const caption = clean(f.caption ?? prev?.caption ?? '', MAX_CAPTION)
  const tags = normalizeTags(f.tags ?? prev?.tags ?? [])
  const folder = cleanFolder(f.folder ?? prev?.folder ?? '')
  const from = prev || f
  const rec = {
    type: ASSET_TYPE,
    id,
    name,
    mime,
    kind: kindOf(mime, name),
    bytes: posInt(from.bytes, MAX_BYTES),
    addedAt: prev?.addedAt || now,
    takenAt: isoOrNull(from.takenAt) || prev?.addedAt || now,
    by: clean(from.by, 100),
    memberId: from.memberId || null,
    updatedAt: now,
  }
  const width = posInt(from.width)
  const height = posInt(from.height)
  if (width && height) Object.assign(rec, { width, height })
  const duration = Math.round(Number(from.duration) * 10) / 10
  if (duration > 0 && duration < 1e6) rec.duration = duration
  if (from.thumb) rec.thumb = true
  if (from.source === 'ai') rec.source = 'ai'
  const sourceUrl = clean(from.sourceUrl, 2000)
  if (sourceUrl && /^(https?|hyper):\/\//.test(sourceUrl)) rec.sourceUrl = sourceUrl
  if (caption) rec.caption = caption
  if (tags.length) rec.tags = tags
  if (folder) rec.folder = folder
  // The AI chats that made or changed it (shared/ai-origin.mjs, ADR-0047).
  const ai = originsOf(from)
  if (ai.length) rec.ai = ai
  return rec
}

export function isAsset(rec) {
  return !!rec && rec.type === ASSET_TYPE && isAssetId(rec.id) && typeof rec.name === 'string' && typeof rec.takenAt === 'string'
}

// An album photo's record (ADR-0043) as an Asset: a JPEG with a thumbnail.
export function fromPhoto(rec) {
  if (!rec || rec.type !== 'nomad/photo' || !isAssetId(rec.id) || typeof rec.takenAt !== 'string') return null
  const day = rec.takenAt.slice(0, 10)
  return makeAsset(
    {
      id: rec.id,
      name: `Photo ${day}.jpg`,
      mime: 'image/jpeg',
      bytes: rec.bytes,
      width: rec.width,
      height: rec.height,
      takenAt: rec.takenAt,
      by: rec.by,
      memberId: rec.memberId,
      caption: rec.caption,
      thumb: true,
    },
    null,
    rec.updatedAt || rec.addedAt
  )
}

// What a move of one album photo writes: its new record, and each file's old and new path.
export function legacyMove(rec, root = LIB_ASSETS) {
  const asset = fromPhoto(rec)
  if (!asset) return null
  const p = pathsOf(root)
  const old = legacyPaths(rec.id)
  return {
    asset: { ...asset, addedAt: rec.addedAt || asset.addedAt },
    files: [
      { from: old.file, to: p.file(rec.id) },
      { from: old.thumb, to: p.thumb(rec.id) },
    ],
    remove: [old.item],
  }
}

// The sizes of the stored files, refused before anything is written.
export function sizeError({ bytes, thumbBytes = 0 }) {
  if (!(bytes > 0)) return 'That file is empty'
  if (bytes > MAX_BYTES) return `That file is too big (${formatBytes(bytes)}, at most ${formatBytes(MAX_BYTES)})`
  if (thumbBytes > MAX_THUMB_BYTES) return 'That file’s thumbnail didn’t come out'
  return ''
}

export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  const mb = b / 1048576
  if (mb < 1000) return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`
  const gb = b / 1073741824
  return `${gb < 10 ? gb.toFixed(1).replace(/\.0$/, '') : Math.round(gb)} GB`
}

export function formatDuration(s) {
  const t = Math.round(Number(s) || 0)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Newest taken first, then newest added.
export function sortAssets(list) {
  return [...list].sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || '') || (b.addedAt || '').localeCompare(a.addedAt || ''))
}

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// The Assets a filter and a search show: every word typed, in any order, ignoring case and accents
// (Notes' and Reader's rule), in the name, caption, who added it, the kind, the tags or the folder.
// `tag` keeps those with that tag; `folder` (when given, '' for the top) those right in that folder.
export function filterAssets(list, { filter = 'all', query = '', tag = '', folder = null } = {}) {
  const kinds = new Set((FILTERS.find((f) => f.id === filter) || FILTERS[0]).kinds)
  const words = fold(query).split(/\s+/).filter(Boolean)
  const want = tag ? cleanTag(tag) : ''
  return list.filter((a) => {
    if (!kinds.has(a.kind || kindOf(a.mime, a.name))) return false
    if (want && !(a.tags || []).includes(want)) return false
    if (folder != null && (a.folder || '') !== folder) return false
    if (!words.length) return true
    const hay = fold([a.name, a.caption, a.by, KIND_LABELS[a.kind] || '', a.source === 'ai' ? 'ai' : '', ...(a.tags || []), a.folder || ''].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// By month of taking, newest first: [{ month: 'YYYY-MM', label: 'November 2026', assets }].
// `local` turns an ISO time into this Device's 'YYYY-MM' (passed in for tests).
export function byMonth(
  list,
  local = (iso) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
) {
  const groups = new Map()
  for (const a of sortAssets(list)) {
    const m = local(a.takenAt)
    if (!groups.has(m)) groups.set(m, [])
    groups.get(m).push(a)
  }
  return [...groups].map(([month, assets]) => ({ month, label: `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`, assets }))
}

// Who may remove an Asset: in a Space that isn't shared, the user (they own it all); in a shared
// one, the person who added it, or whoever manages the Space.
export function canDelete(asset, { shared = true, memberId = null, role = null, writable = false } = {}) {
  if (!writable) return false
  if (!shared || role === 'owner') return true
  return !!memberId && asset?.memberId === memberId
}

// Tags
// =

export const MAX_TAGS = 20
export const MAX_TAG = 40

// A tag as it is kept: lowercase, no '#' or commas, spaces collapsed, at most MAX_TAG. '' for none.
export function cleanTag(s) {
  return String(s || '')
    .normalize('NFC')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG)
    .trim()
}

// Tags from a list or a comma-separated string: cleaned, each once, at most MAX_TAGS.
export function normalizeTags(list) {
  const parts = Array.isArray(list) ? list : String(list || '').split(',')
  const out = []
  for (const p of parts) {
    const t = cleanTag(p)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

// Every tag the Assets use, most used first, then by name: [{ tag, count }].
export function tagCounts(list) {
  const counts = new Map()
  for (const a of list) for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// A record's tags after adding `add` and taking away `remove` (bulk edit).
export function changeTags(tags, { add = [], remove = [] } = {}) {
  const gone = new Set(normalizeTags(remove))
  return normalizeTags([...(tags || []), ...normalizeTags(add)]).filter((t) => !gone.has(t))
}

// Folders
// =

export const FOLDER_TYPE = 'nomad/asset-folder'
export const MAX_FOLDER_PART = 80
export const MAX_FOLDER_DEPTH = 8

// A folder path as it is kept: parts split on '/', each with no control characters and spaces
// collapsed, at most MAX_FOLDER_PART, no '.' or '..', at most MAX_FOLDER_DEPTH deep. '' is the top.
export function cleanFolder(path) {
  return String(path || '')
    .split(/[\\/]/)
    // oxlint-disable-next-line no-control-regex
    .map((p) => p.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_PART).trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .slice(0, MAX_FOLDER_DEPTH)
    .join('/')
}

// One folder name, for New folder and Rename: no '/'. '' when there's nothing left.
export function cleanFolderName(name) {
  return cleanFolder(String(name || '').replace(/[\\/]/g, ' '))
}

export const folderName = (path) => String(path || '').split('/').pop() || ''
export const parentFolder = (path) => String(path || '').split('/').slice(0, -1).join('/')
export const joinFolder = (parent, name) => cleanFolder(parent ? `${parent}/${name}` : name)
// `path` is `folder` or inside it.
export const inFolder = (path, folder) => !folder || path === folder || String(path || '').startsWith(folder + '/')

// The key a folder's record is kept under: two FNV-1a hashes of the path, 16 hex digits.
export function folderKey(path) {
  const s = cleanFolder(path)
  let a = 0x811c9dc5
  let b = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export function makeFolder(path, prev = null, now = new Date().toISOString()) {
  const p = cleanFolder(path)
  if (!p) throw new Error('A folder needs a name')
  return { type: FOLDER_TYPE, path: p, createdAt: prev?.createdAt || now, updatedAt: now }
}

export const isFolder = (rec) => !!rec && rec.type === FOLDER_TYPE && typeof rec.path === 'string' && !!cleanFolder(rec.path)

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

// Every folder there is: the kept ones, the ones files are in, and each of their parents, by path.
export function allFolders(list, kept = []) {
  const out = new Set()
  const addWithParents = (p) => {
    for (let f = cleanFolder(p); f; f = parentFolder(f)) out.add(f)
  }
  for (const k of kept) addWithParents(typeof k === 'string' ? k : k?.path)
  for (const a of list) if (a.folder) addWithParents(a.folder)
  return [...out].sort(byName)
}

// The folders right inside `parent` ('' for the top), by name, each with how many files are in it
// and its own folders: [{ path, name, count }].
export function childFolders(folders, parent = '', list = []) {
  const depth = parent ? parent.split('/').length + 1 : 1
  return folders
    .filter((f) => f.split('/').length === depth && inFolder(f, parent) && f !== parent)
    .map((path) => ({ path, name: folderName(path), count: list.filter((a) => a.folder && inFolder(a.folder, path)).length }))
    .sort((a, b) => byName(a.name, b.name))
}

// What moving (or renaming) folder `from` to `to` changes: each file's new folder, and the folder
// records to remove and to keep. Moving a folder into itself is refused.
export function moveFolderPlan(list, kept, from, to) {
  const src = cleanFolder(from)
  const dst = cleanFolder(to)
  if (!src) throw new Error('Pick a folder to move')
  if (!dst) throw new Error('A folder needs a name')
  if (dst !== src && inFolder(dst, src)) throw new Error('A folder can’t go inside itself')
  const swap = (p) => cleanFolder(dst + p.slice(src.length))
  const assets = list.filter((a) => a.folder && inFolder(a.folder, src)).map((a) => ({ id: a.id, folder: swap(a.folder) }))
  const paths = kept.map((k) => (typeof k === 'string' ? k : k?.path)).filter((p) => p && inFolder(p, src))
  return { assets, remove: paths, keep: [...new Set([dst, ...paths.map(swap)])] }
}

// What removing folder `path` removes: the files in it and its folders, and the folder records.
export function deleteFolderPlan(list, kept, path) {
  const p = cleanFolder(path)
  if (!p) throw new Error('Pick a folder to remove')
  return {
    assets: list.filter((a) => a.folder && inFolder(a.folder, p)).map((a) => a.id),
    remove: kept.map((k) => (typeof k === 'string' ? k : k?.path)).filter((f) => f && inFolder(f, p)),
  }
}
