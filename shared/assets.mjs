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
// The family album's photos (`/photos/items|files|thumbs/`) are Assets now: `legacyPaths` and
// `fromPhoto` read them, and a Device that can write the Space Library moves them (same blobs, new
// paths) the first time it lists the Space's Assets.
//
// No Electron imports, and nothing touched as the module loads that Bare lacks.

import { spaceLibPrefix } from './vault-apps.mjs'

export const ASSET_TYPE = 'nomad/asset'
export const LIB_ASSETS = '/assets/'

// Where a Space's Assets are: '/assets/' in its Space Library, or the Space's prefix in the Vault.
export function vaultRoot(space) {
  return spaceLibPrefix(space) + 'assets/'
}

// A file is kept as it is, up to MAX_BYTES. A photo from a camera is scaled to MAX_SIDE first, as
// the album did, and every picture and video gets a THUMB_SIDE JPEG thumbnail where the Device can
// make one.
export const MAX_BYTES = 25 * 1024 * 1024
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
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/x-typescript',
  tsx: 'text/x-typescript', jsx: 'text/javascript', py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust',
  java: 'text/x-java', kt: 'text/x-kotlin', swift: 'text/x-swift', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sh: 'text/x-shellscript',
  sql: 'application/sql', toml: 'application/toml', ini: 'text/plain',
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', rtf: 'application/rtf',
  epub: 'application/epub+zip',
}

const CODE_EXT = new Set(['html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'sql', 'toml', 'xml', 'yaml', 'yml', 'ini'])
const DATA_EXT = new Set(['json', 'csv', 'tsv', 'ics', 'vcf'])
const ARCHIVE_EXT = new Set(['zip', 'gz', 'tgz', 'tar', '7z', 'rar'])
const DOCUMENT_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'epub'])

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

// What a file is, for the icon, the filter and the preview: image, video, audio, pdf, markdown,
// code, data, text, document, archive, other.
export const KINDS = ['image', 'video', 'audio', 'pdf', 'markdown', 'code', 'data', 'text', 'document', 'archive', 'other']
export function kindOf(mime, name = '') {
  const m = String(mime || '').toLowerCase()
  const ext = extOf(name)
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown'
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

// A Font Awesome 5 (solid) icon for each kind, the same on desktop and the phone.
export const KIND_ICONS = {
  image: 'image',
  video: 'film',
  audio: 'music',
  pdf: 'file-pdf',
  markdown: 'file-alt',
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
  markdown: 'Markdown',
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
  { id: 'docs', label: 'Documents', kinds: ['pdf', 'markdown', 'code', 'data', 'text', 'document'] },
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
 * @param {{ id: string, name?: string, mime?: string, bytes?: number, width?: number, height?: number, duration?: number, takenAt?: string | null, by?: string, memberId?: string | null, caption?: string, thumb?: boolean, source?: string, sourceUrl?: string }} f
 */
export function makeAsset(f, prev = null, now = new Date().toISOString()) {
  const id = check(String(f.id || ''))
  const name = cleanName(f.name ?? prev?.name ?? '', prev?.name || 'Untitled')
  const mime = prev ? prev.mime : mimeOf(name, f.mime)
  const caption = clean(f.caption ?? prev?.caption ?? '', MAX_CAPTION)
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
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`
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
// (Notes' and Reader's rule), in the name, caption, who added it, or the kind.
export function filterAssets(list, { filter = 'all', query = '' } = {}) {
  const kinds = new Set((FILTERS.find((f) => f.id === filter) || FILTERS[0]).kinds)
  const words = fold(query).split(/\s+/).filter(Boolean)
  return list.filter((a) => {
    if (!kinds.has(a.kind || kindOf(a.mime, a.name))) return false
    if (!words.length) return true
    const hay = fold([a.name, a.caption, a.by, KIND_LABELS[a.kind] || '', a.source === 'ai' ? 'ai' : ''].join(' '))
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
