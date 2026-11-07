// The Assets rules the phone's screens need (ADR-0044): a copy of the parts of shared/assets.mjs
// that the Metro bundle can't reach (it doesn't see the repo's shared/). tests/unit/asset-rules.test.js
// checks that the two agree. Change both together.

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


const EXT_MIME: Record<string, string> = {
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

export function extOf (name: string) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

const MIME_RE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,100}$/

// A file's type: the one it came with when it looks like one, else from its extension.
export function mimeOf (name: string, given = '') {
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
export function kindOf (mime: string, name = '') {
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
export function isTextKind (kind: string) {
  return kind === 'markdown' || kind === 'code' || kind === 'data' || kind === 'text'
}

// A Font Awesome 5 (solid) icon for each kind, the same on desktop and the phone.
export const KIND_ICONS: Record<string, string> = {
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

export const KIND_LABELS: Record<string, string> = {
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

// A file name with no folders or control characters, at most MAX_NAME, keeping its extension.
export function cleanName (name: string, fallback = 'Untitled') {
  let s = String(name || '')
    .split(/[\\/]/)
    .pop()!
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


// EXIF's DateTimeOriginal ('2026:11:05 14:03:22', no zone) as an ISO time, read as this Device's
// local time, or null.
export function exifTime (s: string) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(d.getTime()) && +m[1] > 1990 ? d.toISOString() : null
}


export function formatBytes (n: number) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  const mb = b / 1048576
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`
}

export function formatDuration (s: number) {
  const t = Math.round(Number(s) || 0)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}


const fold = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// The Assets a filter and a search show: every word typed, in any order, ignoring case and accents
// (Notes' and Reader's rule), in the name, caption, who added it, or the kind.
export function filterAssets<T extends AssetLike> (list: T[], { filter = 'all', query = '' }: { filter?: string; query?: string } = {}): T[] {
  const kinds = new Set((FILTERS.find((f) => f.id === filter) || FILTERS[0]).kinds)
  const words = fold(query).split(/\s+/).filter(Boolean)
  return list.filter((a) => {
    if (!kinds.has(a.kind || kindOf(a.mime, a.name))) return false
    if (!words.length) return true
    const hay = fold([a.name, a.caption, a.by, KIND_LABELS[a.kind] || '', a.source === 'ai' ? 'ai' : ''].join(' '))
    return words.every((w) => hay.includes(w))
  })
}


export interface AssetLike { name: string; kind: string; mime: string; caption?: string; by?: string; source?: string }
