// Which AI chat made an item (ADR-0047). When the user's AI makes or changes a Note, an Asset or a
// drive, the item keeps where that happened: the AI Sidebar chat (a session in chat-store.js), the
// AI Job, or that it was the phone's AI panel or another program on this computer (the loopback
// MCP), whose chats aren't saved anywhere. The item then shows a link back to the chat, while the
// chat is still there.
//
// An origin is { stage, chat?, job?, space?, at, made? }:
//   stage  'sidebar' | 'job' | 'phone' | 'outside' (app/bg/ai/stages.mjs)
//   chat   the sidebar session's id (chat-store.js newSessionId); for a Job, the run's chat when
//          someone watched it (job-chat.js)
//   job    the Job's id (shared/jobs.mjs)
//   space  the Space key the chat is kept in: a sidebar chat lives in hyper://private/ of the
//          window's Space, that Space's Root Drive
//   at     when, ISO time
//   made   true when this chat made the item, not only changed it
//
// Only ids go on the item, never the chat's title or words: a Note or an Asset in a shared Space is
// seen by everyone in it, and their Nomad finds no chat by that id, so they read "Made with AI".
//
// Notes and Assets keep the list on their record as `ai` (newest first, at most MAX_ORIGINS; makeNote
// and makeAsset carry it over). A drive's goes in the Vault, `/.vault/ai-made/<driveKey>.json`, since a
// drive can be public and the chat ids are the user's: it adds the paths each chat wrote.
//
// `resolveOrigins` turns a list into what the item shows, with the lookups passed in, so desktop
// (bg/web-apis/bg/ai-chats.ts) and the phone's backend (mobile/backend/backend.mjs) show the same words.
//
// No Electron imports, no globals (this runs on the phone's Bare worklet too).

export const MAX_ORIGINS = 5
export const MAX_PATHS = 20
export const AI_MADE_PREFIX = '/.vault/ai-made/'
export const AI_MADE_TYPE = 'nomad/ai-made'
const STAGES = ['sidebar', 'job', 'phone', 'outside']
const CHAT_ID = /^[a-z0-9]{1,40}$/
const JOB_ID = /^[a-z0-9-]{1,40}$/
const KEY = /^[0-9a-f]{64}$/

const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))

/**
 * An origin as stored, or null when it isn't one.
 * @param {any} o
 * @returns {null | { stage: string, chat?: string, job?: string, space?: string, at: string, made?: true }}
 */
export function cleanOrigin(o, now = new Date().toISOString()) {
  if (!o || typeof o !== 'object') return null
  if (!STAGES.includes(o.stage)) return null
  /** @type {any} */
  const out = { stage: o.stage }
  if (typeof o.chat === 'string' && CHAT_ID.test(o.chat)) out.chat = o.chat
  if (typeof o.job === 'string' && JOB_ID.test(o.job)) out.job = o.job
  if (typeof o.space === 'string' && KEY.test(o.space)) out.space = o.space
  // A sidebar origin names its chat; a Job's names its Job.
  if (out.stage === 'sidebar' && !out.chat) return null
  if (out.stage === 'job' && !out.job) return null
  out.at = isIso(o.at) ? o.at : now
  if (o.made === true) out.made = true
  return out
}

// What makes two origins the same chat: the chat, else the Job, else the stage.
export function originKey(o) {
  if (!o) return ''
  if (o.chat) return 'chat:' + o.chat
  if (o.job) return 'job:' + o.job
  return 'stage:' + o.stage
}

/**
 * The item's list after `origin` made (made: true) or changed it: newest first, one entry per chat,
 * at most MAX_ORIGINS. A chat that made the item stays marked `made` when it changes it again.
 * Returns the list it was given when nothing changes but the time, so a save can be skipped.
 */
export function addOrigin(list, origin, { made = false, now = new Date().toISOString() } = {}) {
  const prev = originsOf({ ai: list })
  const o = cleanOrigin({ ...origin, at: origin?.at || now, made: made || origin?.made === true }, now)
  if (!o) return prev
  const key = originKey(o)
  const old = prev.find((p) => originKey(p) === key)
  if (old?.made) o.made = true
  if (old && prev[0] === old && !!old.made === !!o.made && old.space === o.space && old.job === o.job) return prev
  return [o, ...prev.filter((p) => originKey(p) !== key)].slice(0, MAX_ORIGINS)
}

// The origins on a record (`ai`), cleaned. [] when there are none.
export function originsOf(rec) {
  const list = rec && Array.isArray(rec.ai) ? rec.ai : []
  const out = []
  const seen = new Set()
  for (const o of list) {
    const c = cleanOrigin(o, '')
    if (!c || !c.at) continue
    const key = originKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (out.length >= MAX_ORIGINS) break
  }
  return out
}

// Whether two lists say the same.
export function sameOrigins(a, b) {
  return JSON.stringify(originsOf({ ai: a })) === JSON.stringify(originsOf({ ai: b }))
}

// ── Drives ────────────────────────────────────────────────────────────────────────────────────────

export function aiMadePath(driveKey) {
  if (!KEY.test(String(driveKey || ''))) throw new Error('Not a drive key: ' + driveKey)
  return AI_MADE_PREFIX + driveKey + '.json'
}

const cleanPath = (p) => {
  const s = String(p || '').trim()
  if (!s || s.length > 500 || !s.startsWith('/')) return ''
  return s.replace(/\/+$/, '') || ''
}

/**
 * A drive's record after `origin` made it (made: true) or wrote `path` in it. Each origin keeps the
 * paths it wrote, newest first, at most MAX_PATHS.
 * @returns {{ type: string, drive: string, ai: any[] }}
 */
export function addDriveOrigin(rec, driveKey, origin, { made = false, path = '', now = new Date().toISOString() } = {}) {
  aiMadePath(driveKey) // checks the key
  /** @type {any[]} */
  const prev = driveOriginsOf(rec)
  const list = addOrigin(prev, origin, { made, now })
  const o = list[0]
  if (!o || originKey(o) !== originKey(cleanOrigin({ ...origin, at: now }, now))) {
    return { type: AI_MADE_TYPE, drive: driveKey, ai: prev }
  }
  const old = prev.find((p) => originKey(p) === originKey(o))
  const p = cleanPath(path)
  const paths = [...(p ? [p] : []), ...((old && old.paths) || []).filter((x) => x !== p)].slice(0, MAX_PATHS)
  const merged = list.map((x) => {
    if (originKey(x) === originKey(o)) return paths.length ? { ...x, paths } : x
    const was = prev.find((q) => originKey(q) === originKey(x))
    return was && was.paths ? { ...x, paths: was.paths } : x
  })
  return { type: AI_MADE_TYPE, drive: driveKey, ai: merged }
}

// The origins in a drive's record, each with its `paths`.
export function driveOriginsOf(rec) {
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.ai)) return []
  const byKey = new Map(rec.ai.map((o) => [originKey(cleanOrigin(o, '')), o]))
  return originsOf(rec).map((o) => {
    const paths = byKey.get(originKey(o))?.paths
    const clean = Array.isArray(paths) ? paths.map(cleanPath).filter(Boolean).slice(0, MAX_PATHS) : []
    return clean.length ? { ...o, paths: clean } : o
  })
}

// The origins that wrote `path` (or made the drive), else every one: what a page of the drive shows.
export function originsForPath(list, path) {
  const p = cleanPath(path) || '/'
  const hits = list.filter((o) => (o.paths || []).some((x) => x === p || (p.endsWith('/') ? x === p + 'index.html' : x === p + '/index.html' || x === p + '.html')))
  return hits.length ? hits : list
}

// ── What an item shows ─────────────────────────────────────────────────────────────────────────────

/**
 * What an item shows for each origin, newest first:
 *   { kind: 'chat', id, space, here, title, made, at, text, tip }   a chat that is still there
 *   { kind: 'job', id, title, made, at, text, tip }                 an AI Job that is still there
 *   { kind: 'none', made, at, text, tip }                           its chat is gone, or never kept
 * `here` says the chat is in the Space the viewer is in; opening one in another Space switches to it.
 * lookups: chat(id, space) -> { title } | null, job(id) -> { title } | null, currentSpace (key),
 * spaceName(key) -> string.
 */
/**
 * @param {any[]} list
 * @param {{ chat?: (id: string, space: string | null) => Promise<{ title?: string } | null>, job?: (id: string) => Promise<{ title?: string } | null>, currentSpace?: string | null, spaceName?: (key: string) => string }} [lookups]
 */
export async function resolveOrigins(list, { chat = async () => null, job = async () => null, currentSpace = null, spaceName = () => '' } = {}) {
  const out = []
  for (const o of originsOf({ ai: list })) {
    const verb = o.made ? 'Made' : 'Changed'
    const base = { made: !!o.made, at: o.at }
    const found = o.chat ? await chat(o.chat, o.space || currentSpace).catch(() => null) : null
    if (found) {
      const here = !o.space || !currentSpace || o.space === currentSpace
      const title = String(found.title || '').trim() || 'Untitled chat'
      const where = here ? '' : spaceName(o.space)
      out.push({
        ...base,
        kind: 'chat',
        id: o.chat,
        space: o.space || null,
        here,
        title,
        text: `${verb} in the AI chat “${title}”`,
        tip: here ? 'Open this chat in the AI sidebar' : `Open this chat in the AI sidebar. It is in ${where ? `the Space “${where}”` : 'another Space'}, so the window switches to it`,
      })
      continue
    }
    const j = o.job ? await job(o.job).catch(() => null) : null
    if (j) {
      const title = String(j.title || '').trim() || 'Untitled Job'
      out.push({ ...base, kind: 'job', id: o.job, title, text: `${verb} by the AI Job “${title}”`, tip: 'Open this Job in My Library' })
      continue
    }
    const by = o.made ? 'Made with AI' : 'Changed with AI'
    let tip
    if (o.stage === 'sidebar') tip = 'The AI chat it came from was deleted, or isn’t one of yours'
    else if (o.stage === 'job') tip = 'The AI Job it came from was deleted, or isn’t one of yours'
    else if (o.stage === 'phone') tip = 'In the AI panel on a phone. Its chats aren’t saved'
    else tip = 'By another program on a computer, through Nomad’s AI tools. Its chats aren’t saved here'
    out.push({ ...base, kind: 'none', text: by, tip })
  }
  return out
}
