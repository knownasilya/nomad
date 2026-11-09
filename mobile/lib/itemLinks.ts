// Links to the user's things in Nomad, as the AI writes them in an answer: a copy of
// shared/item-links.mjs parseItemLink for the phone's bundle (tests/unit/item-links.test.js checks
// that the two agree). The AI panel opens a Note, a Job, Reader, the calendar or Assets on its own screen, a web or
// hyper:// page in a new tab, and says where the rest are on the user's computer. A nomad:// link
// opens only as the URL built here, never as the model wrote it.

import { cleanFolder, cleanTag } from './assetRules'

export type ItemLink =
  | { kind: 'page'; url: string } // a web or hyper:// page
  | { kind: 'note' | 'job' | 'mod'; id?: string; url: string; place: string }
  | { kind: 'library' | 'ai'; view: string; url: string; place: string }
  | { kind: 'reader'; url: string; place: string }
  | { kind: 'calendar'; day?: string; url: string; place: string }
  | { kind: 'asset'; id?: string; folder?: string; tag?: string; url: string; place: string }

// Note, Job, Mod and memory ids (shared/vault-apps.mjs isNoteId, shared/jobs.mjs, shared/mods.mjs,
// shared/ai-memory.mjs): all are lowercase letters, digits and dashes.
const ID = /^[a-z0-9-]{1,40}$/

export const noteLink = (id: string) => `nomad://notes/${id}`
export const jobLink = (id: string) => `nomad://library/jobs?id=${id}`
export const modLink = (id: string) => `nomad://library/mods?id=${id}`
export const MEMORY_LINK = 'nomad://ai/memory'
export const READER_LINK = 'nomad://reader/'
export const CALENDAR_LINK = 'nomad://calendar/'
export const calendarLink = (day: string) => `${CALENDAR_LINK}?day=${day}`
const DAY = /^\d{4}-\d{2}-\d{2}$/
export const CONTACTS_LINK = 'nomad://library/contacts'
export const ASSETS_LINK = 'nomad://assets/'
export const assetLink = (id: string) => `${ASSETS_LINK}?id=${id}`
export const assetFolderLink = (path: string) => `${ASSETS_LINK}?folder=${encodeURIComponent(path)}`
export const assetTagLink = (tag: string) => `${ASSETS_LINK}?tag=${encodeURIComponent(tag)}`
// shared/assets.mjs isAssetId
const ASSET_ID = /^[ap][a-z0-9]{6,14}-[a-z0-9]{4,10}$/

// The nomad:// pages a link may open, with where they are in words (for a device that can't open them).
const AI_VIEWS: Record<string, string> = { chats: 'Chats', memory: 'Memory', skills: 'Skills', setup: 'Setup' }
const LIBRARY_VIEWS: Record<string, string> = {
  drives: 'Drives',
  bookmarks: 'Bookmarks',
  contacts: 'Contacts',
  names: 'Names',
  mods: 'Mods',
  jobs: 'Jobs',
  secrets: 'Secrets',
  sharing: 'Sharing',
}

// One query value, decoded ('' when it isn't there or doesn't decode).
function queryValue (query: string | undefined, key: string) {
  const m = new RegExp(`[?&]${key}=([^&]*)`).exec(query || '')
  if (!m) return ''
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '))
  } catch {
    return ''
  }
}

export function parseItemLink (href: string): ItemLink | null {
  const s = String(href || '').trim()
  // No URL class: the phone's copy runs where URL is only partly there.
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]*)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(s)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const host = m[2].toLowerCase()
  if (!host || host.includes('@')) return null
  if (scheme === 'http' || scheme === 'https' || scheme === 'hyper') return { kind: 'page', url: s }
  if (scheme !== 'nomad') return null
  // nomad://notes/<id>: the host names the app, the path the item.
  let seg: string[]
  try {
    seg = m[3].split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  } catch {
    return null
  }
  const idMatch = /[?&]id=([^&]*)/.exec(m[4] || '')
  const id = idMatch ? idMatch[1] : null
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

  if (host === 'notes') {
    if (!seg.length) return { kind: 'note', url: 'nomad://notes/', place: 'Notes' }
    if (seg.length === 1 && ID.test(seg[0])) return { kind: 'note', id: seg[0], url: noteLink(seg[0]), place: 'Notes' }
    return null
  }
  if (host === 'reader') {
    return seg.length ? null : { kind: 'reader', url: READER_LINK, place: 'Reader' }
  }
  if (host === 'calendar') {
    if (seg.length) return null
    const day = /[?&]day=([^&]*)/.exec(m[4] || '')?.[1]
    if (day && DAY.test(day)) return { kind: 'calendar', day, url: calendarLink(day), place: 'Calendar' }
    return { kind: 'calendar', url: CALENDAR_LINK, place: 'Calendar' }
  }
  if (host === 'assets') {
    if (seg.length) return null
    if (id && ASSET_ID.test(id)) return { kind: 'asset', id, url: assetLink(id), place: 'Assets' }
    const folder = cleanFolder(queryValue(m[4], 'folder'))
    if (folder) return { kind: 'asset', folder, url: assetFolderLink(folder), place: `Assets → ${folder.split('/').join(' → ')}` }
    const tag = cleanTag(queryValue(m[4], 'tag'))
    if (tag) return { kind: 'asset', tag, url: assetTagLink(tag), place: `Assets → #${tag}` }
    return { kind: 'asset', url: ASSETS_LINK, place: 'Assets' }
  }
  if (host === 'ai') {
    const view = seg[0] || 'chats'
    if (seg.length > 1 || !has(AI_VIEWS, view)) return null
    return { kind: 'ai', view, url: `nomad://ai/${view}`, place: `the AI page → ${AI_VIEWS[view]}` }
  }
  if (host === 'library') {
    const view = seg[0] || 'drives'
    if (seg.length > 1 || !has(LIBRARY_VIEWS, view)) return null
    const place = `My Library → ${LIBRARY_VIEWS[view]}`
    if (view === 'jobs' || view === 'mods') {
      const kind = view === 'jobs' ? 'job' : 'mod'
      if (id && ID.test(id)) return { kind, id, url: kind === 'job' ? jobLink(id) : modLink(id), place }
      return { kind, url: `nomad://library/${view}`, place }
    }
    return { kind: 'library', view, url: `nomad://library/${view}`, place }
  }
  return null
}
