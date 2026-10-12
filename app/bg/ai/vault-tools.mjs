// The AI's Notes and Reader capabilities (search-execute.mjs CAPABILITIES, gate `personal`): the
// pure parts, finding and shaping what the model gets. bg/web-apis/bg/ai-vault.ts does the Vault and
// Drive reads and writes, after the user's permission.
//
// Only a personal turn (the user's own AI: the AI Sidebar, the phone's AI panel, the loopback MCP)
// sees these, and each asks its own permission: reading and writing Notes, and reading and changing
// Reader, are four grants (ADR-0019).
//
// No Electron imports.

import { noteTitle, noteSnippet, sortNotes, makeResolver, findLinks, driveRoot } from '../../../shared/vault-apps.mjs'

// Capability -> the permission it asks for.
export const VAULT_TOOL_PERMS = {
  listNotes: 'notesRead',
  readNote: 'notesRead',
  writeNote: 'notesWrite',
  listReaderPosts: 'readerRead',
  readReaderPost: 'readerRead',
  followFeed: 'readerWrite',
  unfollowFeed: 'readerWrite',
  markPostsRead: 'readerWrite',
}

export const VAULT_PERMS = ['notesRead', 'notesWrite', 'readerRead', 'readerWrite']

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
// A post or note the model reads in full is cut here, so one long page can't fill its context.
export const MAX_TEXT = 20000

export function clampLimit(limit) {
  const n = Math.floor(Number(limit))
  return n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT
}

// `text`, cut to `max` characters with a note saying so.
export function clip(text, max = MAX_TEXT) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + `\n\n[Cut at ${max} of ${s.length} characters.]` : s
}

// True when every word of `query` is in one of `fields` (any case). An empty query matches.
function matches(query, fields) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fields.map((f) => String(f || '').toLowerCase()).join('\n')
  return words.every((w) => text.includes(w))
}

// A permission function that asks once per turn for the Vault permissions: the first answer, allow
// or deny, holds for the rest of the turn. A Bridge turn relays every ask to the phone, which keeps
// no grant, and a denied ask isn't stored anywhere, so without this a turn could ask again and again.
// Any other permission (modifyDrive) goes straight through. The answer is per site too: a grant is
// for a site (ADR-0019 §4), and the user's own AI can move to another tab in a turn (ADR-0021).
export function askOncePerTurn(permit) {
  const answers = new Map()
  return (permission, sender, ...rest) => {
    if (!VAULT_PERMS.includes(permission)) return permit(permission, sender, ...rest)
    const key = `${permission} ${siteOf(sender)}`
    if (!answers.has(key)) answers.set(key, Promise.resolve(permit(permission, sender, ...rest)))
    return answers.get(key)
  }
}

function siteOf(sender) {
  try {
    const url = new URL(sender.getURL())
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

// Notes
// =

// The Notes that match, newest first, as list rows.
/**
 * @param {any[]} notes
 * @param {{ query?: string, limit?: number }} [opts]
 */
export function findNotes(notes, { query, limit } = {}) {
  return sortNotes(notes)
    .filter((n) => matches(query, [n.body]))
    .slice(0, clampLimit(limit))
    .map((n) => ({ id: n.id, title: noteTitle(n.body), snippet: noteSnippet(n.body), updatedAt: n.updatedAt }))
}

// The Note with this id, else the newest one with this title (any case), else null.
/**
 * @param {any[]} notes
 * @param {{ id?: string, title?: string }} [opts]
 */
export function findNote(notes, { id, title } = {}) {
  if (id) return notes.find((n) => n.id === id) || null
  if (title) {
    const n = makeResolver(notes)(title)
    return n && noteTitle(n.body).toLowerCase() === String(title).trim().toLowerCase() ? n : null
  }
  return null
}

// A whole Note for the model, with the titles it links to.
export function noteForModel(note) {
  return {
    id: note.id,
    title: noteTitle(note.body),
    body: clip(note.body),
    links: [...new Set(findLinks(note.body).map((l) => l.target))],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...(note.conflictOf ? { conflictOf: note.conflictOf } : {}),
  }
}

// Reader
// =

function ensureDir(p) {
  if (!p.startsWith('/')) p = '/' + p
  if (!p.endsWith('/')) p = p + '/'
  return p
}

// One Feed and its posts, read the way nomad://reader does (app/userland/reader/js/main.js loadFeed):
// the Feed's /index.json names itemsPath, and each post is <itemsPath><slug>/post.json. `readText(path)`
// and `listKeys(dir)` (every path under dir) read the Feed's Drive.
export async function loadFeedPosts(url, { readText, listKeys }) {
  const root = driveRoot(url)
  if (!root) throw new Error('Not a hyper:// address')
  const feed = JSON.parse(await readText('/index.json'))
  const title = feed.title || root
  const itemsPath = ensureDir(feed.itemsPath || '/posts/')
  const posts = []
  for (const k of await listKeys(itemsPath)) {
    if (!k.endsWith('/post.json')) continue
    try {
      const meta = JSON.parse(await readText(k))
      if (meta.draft) continue
      const slug = k.slice(itemsPath.length).replace(/\/post\.json$/, '')
      posts.push({
        title: meta.title || slug,
        summary: meta.summary || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        createdAt: meta.createdAt || '',
        url: root + itemsPath.slice(1) + slug + '/',
        feedUrl: root,
        feedTitle: title,
      })
    } catch {}
  }
  return { url: root, title, posts }
}

// The posts that match across loaded feeds, newest first, each with `read`.
/**
 * @param {any[]} feeds
 * @param {string[]} read
 * @param {{ query?: string, feed?: string, unread?: boolean, limit?: number }} [opts]
 */
export function findPosts(feeds, read, { query, feed, unread, limit } = {}) {
  const readSet = new Set(read || [])
  const only = feed ? driveRoot(feed) : null
  return feeds
    .flatMap((f) => f.posts || [])
    .filter((p) => !only || p.feedUrl === only)
    .map((p) => ({ ...p, read: readSet.has(p.url) }))
    .filter((p) => !unread || !p.read)
    .filter((p) => matches(query, [p.title, p.summary, p.tags.join(' '), p.feedTitle]))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, clampLimit(limit))
}

// The files a post's text may be in, in the order to try: post.* now, index.* in older posts.
export const POST_BODY_FILES = ['post.md', 'post.html', 'post.txt', 'index.md', 'index.html', 'index.txt']

// A post URL split into its Feed root and its folder path ('/posts/2026-01-01-x/'), or null.
export function splitPostUrl(url) {
  const root = driveRoot(url)
  if (!root) return null
  const path = '/' + String(url).trim().slice(root.length).replace(/[?#].*$/, '')
  const dir = path.replace(/\/(post|index)\.(json|md|html|txt)$/, '/').replace(/\/?$/, '/')
  return dir === '/' ? null : { root, dir }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// Readable text from a post's HTML: no scripts or styles, a line break per block, entities decoded.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|pre|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
