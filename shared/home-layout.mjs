// The home page is a document (ADR-0048). What nomad://desktop shows is an openui-lang program,
// the language the AI Sidebar draws with (app/lib/genui/library.mjs): the layout. It places the
// page's live parts (HomeGreeting, HomePins, HomeNeedsYou, HomeNotifications, HomeJobs, HomeEvents,
// HomeNotes, HomeFiles), which the page fills with the user's things, and HomeCards, the cards the
// user pinned. With no layout of their own the user gets DEFAULT_LAYOUT, the dashboard as it was
// before any of this.
//
// Two kinds of record, the user's own, per Space, in the Vault (never in a shared Space's Library:
// a home page is one person's):
//
//   /.vault/home/spaces/<space>/layout.json      { type, source, previous?, ai?, updatedAt }
//   /.vault/home/spaces/<space>/cards/<id>.json  { type, id, title, source, wide?, order, ai?,
//                                                  job?, createdAt, updatedAt }
//
// A card is a program of its own, with its own root: drawn by itself, so one that doesn't parse
// leaves the rest of the page alone, and removed by itself. The user's AI makes cards and layouts
// (app/bg/web-apis/bg/ai-vault.ts: getDashboard, pinDashboardCard, removeDashboardCard,
// setDashboard), and the user pins a drawing from an answer with the button under it. The layout
// keeps the one it replaced (`previous`), so one step back is always there.
//
// A Job can keep one card of its own (`job: { id, title, at }`), when the user gave it the `home`
// grant (shared/jobs.mjs writes): each run that calls setJobCard replaces the card's program, in
// the Job's Space, and `at` says when. The page shows which Job keeps it and when it last did, and
// removing the card takes the grant away (app/bg/web-apis/bg/vault.ts removeHomeCard).
//
// This file holds the rules; whether a program parses is checked where the parser is
// (app/bg/ai/genui-page.js programError). No I/O, no Electron, no globals the phone's Bare worklet
// lacks. Tests: tests/unit/home-layout.test.js.

import { addOrigin, originsOf } from './ai-origin.mjs'

export const HOME_SPACES_PREFIX = '/.vault/home/spaces/'
export const LAYOUT_TYPE = 'nomad/home-layout'
export const CARD_TYPE = 'nomad/home-card'

export const MAX_CARDS = 24
export const MAX_CARD_SOURCE = 20000
export const MAX_LAYOUT_SOURCE = 40000
export const MAX_TITLE = 80

// The home page's live parts, as the library names them.
export const HOME_WIDGETS = [
  'HomeGreeting',
  'HomePins',
  'HomeNeedsYou',
  'HomeNotifications',
  'HomeJobs',
  'HomeEvents',
  'HomeNotes',
  'HomeFiles',
  'HomeCards',
]

// The dashboard every Space starts with.
export const DEFAULT_LAYOUT = `root = Stack([HomeGreeting(), HomePins(), HomeNeedsYou(), board], "column", "none")
board = Columns([HomeNotifications(), HomeJobs(), HomeEvents(), HomeNotes(), HomeFiles(), HomeCards()], 3)`

const SPACE_KEY = /^[0-9a-f]{64}$/
const CARD_ID = /^[a-z0-9]{6,24}$/
const JOB_ID = /^[a-z0-9-]{6,40}$/ // shared/jobs.mjs isJobId

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}
const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))

// Paths
// =

// A page with no Space (none yet, or a window between Spaces) keeps one home of its own.
export function homePrefix(space = null) {
  if (space != null && !SPACE_KEY.test(String(space))) throw new Error('Not a Space key: ' + space)
  return `${HOME_SPACES_PREFIX}${space || 'none'}/`
}
export const layoutPath = (space = null) => homePrefix(space) + 'layout.json'
export const cardsPrefix = (space = null) => homePrefix(space) + 'cards/'

export function isCardId(id) {
  return typeof id === 'string' && CARD_ID.test(id)
}

export function cardPath(space, id) {
  if (!isCardId(id)) throw new Error('Not a card id: ' + id)
  return cardsPrefix(space) + id + '.json'
}

export function newCardId(now = Date.now(), rand = Math.random) {
  return now.toString(36).padStart(8, '0') + Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')
}

// Programs
// =

// A program as stored: no ``` fence around it, no trailing space. Throws when it is empty or too long.
export function cleanSource(source, max, what = 'The program') {
  let s = String(source ?? '').replace(/\r\n?/g, '\n').trim()
  const fenced = /^```[a-z-]*\n([\s\S]*?)\n?```$/i.exec(s)
  if (fenced) s = fenced[1].trim()
  if (!s) throw new Error(`${what} is empty. Start it with root = Stack([...])`)
  if (s.length > max) throw new Error(`${what} is ${s.length} characters; the most is ${max}`)
  return s
}

// Whether a program places a widget (a call by that name, outside a string).
export function placesWidget(source, name) {
  const text = String(source ?? '').replace(/"(?:[^"\\]|\\.)*"/g, '""')
  return new RegExp(`\\b${name}\\s*\\(`).test(text)
}

// The widgets anywhere in a parsed program's tree (lang-core's `root`), drawn now or not: one
// inside a tab that isn't open is still placed. [{ name, limit? }], in the program's order.
export function widgetsIn(root) {
  const out = []
  const seen = new Set()
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) return v.forEach(walk)
    if (v.type === 'element' && HOME_WIDGETS.includes(v.typeName)) {
      const limit = Math.round(Number(v.props?.limit))
      out.push(limit > 0 ? { name: v.typeName, limit } : { name: v.typeName })
      return
    }
    for (const k of Object.keys(v)) walk(v[k])
  }
  walk(root)
  return out
}

// A title for a card that came without one: its first CardHeader, Header or heading text.
export function titleFromSource(source) {
  const text = String(source ?? '')
  const str = '"((?:[^"\\\\]|\\\\.)*)"'
  for (const re of [
    new RegExp(`\\b(?:CardHeader|Header)\\(\\s*${str}`),
    new RegExp(`\\bTextContent\\(\\s*${str}\\s*,\\s*"large-heavy"`),
    new RegExp(`\\b(?:Stat|EntityCard|LinkCard|EventCard|ProductCard|Feature|Empty)\\(\\s*${str}`),
  ]) {
    const m = re.exec(text)
    if (!m) continue
    let t = m[1]
    try {
      t = JSON.parse(`"${m[1]}"`)
    } catch {}
    t = clip(t, MAX_TITLE)
    if (t) return t
  }
  return ''
}

export function cardTitle(title, source) {
  return clip(title, MAX_TITLE) || titleFromSource(source) || 'Card'
}

// Cards
// =

/**
 * The card record to store. `prev` is the stored card with that id, if any: fields left out keep
 * its values, and it keeps its place and its origins.
 * @param {{ id: string, title?: string, source?: string, wide?: boolean, order?: number, job?: any }} fields
 */
export function makeCard(fields, prev = null, now = new Date().toISOString()) {
  // (`job` is set by makeJobCard, and otherwise carried over from `prev`.)
  if (!isCardId(fields?.id)) throw new Error('Not a card id: ' + fields?.id)
  const source = cleanSource(fields.source ?? prev?.source, MAX_CARD_SOURCE, 'The card')
  const createdAt = isIso(prev?.createdAt) ? prev.createdAt : now
  const order = Number.isFinite(fields.order) ? fields.order : Number.isFinite(prev?.order) ? prev.order : Date.parse(createdAt)
  const rec = {
    type: CARD_TYPE,
    id: fields.id,
    title: cardTitle(fields.title ?? prev?.title, source),
    source,
    order,
    createdAt,
    updatedAt: now,
  }
  const wide = fields.wide ?? prev?.wide
  if (wide === true) rec.wide = true
  const ai = originsOf(prev)
  if (ai.length) rec.ai = ai
  const job = cleanJobRef(fields.job ?? prev?.job)
  if (job) rec.job = job
  return rec
}

// Which Job keeps a card: { id, title, at }, or null.
export function cleanJobRef(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !JOB_ID.test(job.id)) return null
  const out = { id: job.id, title: clip(job.title, MAX_TITLE) || 'Job' }
  if (isIso(job.at)) out.at = job.at
  return out
}

// The card a Job keeps, if any.
export function jobCardOf(list, jobId) {
  return sortCards(list).find((c) => c.job?.id === jobId) || null
}

/**
 * The card a Job's run sets (setJobCard): a new one, or `prev` (jobCardOf) with its program
 * replaced. The user's own changes stay: its place, and whether it is wide (`wide` counts only on
 * a new card).
 * @param {{ id: string, title?: string }} job the Job record (shared/jobs.mjs)
 * @param {{ id?: string, title?: string, source: string, wide?: boolean }} fields
 */
export function makeJobCard(job, fields, prev = null, now = new Date().toISOString()) {
  const ref = cleanJobRef({ id: job?.id, title: job?.title, at: now })
  if (!ref) throw new Error('Not a Job')
  return makeCard(
    {
      id: prev ? prev.id : fields.id,
      title: fields.title || prev?.title || ref.title,
      source: fields.source,
      wide: prev ? undefined : fields.wide === true,
      job: ref,
    },
    prev,
    now
  )
}

export function isCard(rec) {
  return !!rec && rec.type === CARD_TYPE && isCardId(rec.id) && typeof rec.source === 'string' && !!rec.source
}

// In the order the page shows them: by `order`, then the oldest first.
export function sortCards(list) {
  const at = (c) => (Number.isFinite(c.order) ? c.order : Date.parse(c.createdAt) || 0)
  return (list || []).filter(isCard).sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Moving a card one place earlier (-1) or later (1): the two records that change, with their
// `order`s swapped, or [] when it is at the end already.
export function moveCard(list, id, dir, now = new Date().toISOString()) {
  const cards = sortCards(list)
  const i = cards.findIndex((c) => c.id === id)
  const j = i + (dir < 0 ? -1 : 1)
  if (i < 0 || j < 0 || j >= cards.length) return []
  const a = cards[i]
  const b = cards[j]
  // Two cards made in the same millisecond would swap to no effect.
  const [oa, ob] = a.order === b.order ? [a.order + (dir < 0 ? -1 : 1), a.order] : [b.order, a.order]
  return [
    { ...a, order: oa, updatedAt: now },
    { ...b, order: ob, updatedAt: now },
  ]
}

// The record with the chat that made (or changed) it added (shared/ai-origin.mjs).
export function withOrigin(rec, origin, { made = false, now = new Date().toISOString() } = {}) {
  if (!origin) return rec
  const ai = addOrigin(originsOf(rec), origin, { made, now })
  return ai.length ? { ...rec, ai } : rec
}

// The layout
// =

/**
 * The layout record after it is set to `source`, or back to the default (`source` null). It keeps
 * the layout it replaces as `previous`, one step back.
 */
export function makeLayout(source, prev = null, now = new Date().toISOString()) {
  const next = source == null ? null : cleanSource(source, MAX_LAYOUT_SOURCE, 'The layout')
  const rec = { type: LAYOUT_TYPE, source: next, updatedAt: now }
  const was = isLayout(prev) ? prev.source : null
  if (was !== next) rec.previous = { source: was, updatedAt: isIso(prev?.updatedAt) ? prev.updatedAt : now }
  else if (prev?.previous) rec.previous = prev.previous
  return rec
}

// The layout before the last change, put back; the one it replaces becomes `previous`, so doing
// it twice returns to where the user was. Null when there is nothing to go back to.
export function restoreLayout(prev, now = new Date().toISOString()) {
  if (!isLayout(prev) || !prev.previous) return null
  const back = typeof prev.previous.source === 'string' && prev.previous.source ? prev.previous.source : null
  return { type: LAYOUT_TYPE, source: back, previous: { source: prev.source, updatedAt: prev.updatedAt }, updatedAt: now }
}

export function isLayout(rec) {
  return !!rec && rec.type === LAYOUT_TYPE && (rec.source === null || (typeof rec.source === 'string' && !!rec.source))
}

// The program the page draws.
export function layoutSource(rec) {
  return isLayout(rec) && rec.source ? rec.source : DEFAULT_LAYOUT
}

// What the page gets: the program, whether it is the user's own, and whether there is a step back.
export function layoutView(rec) {
  const custom = isLayout(rec) && !!rec.source
  return { source: layoutSource(rec), custom, canRestore: isLayout(rec) && !!rec.previous }
}

// The page's view of each Job's card: `job` with the Job as it is now (its title, whether it is
// running or waiting to, whether its newest run failed, and `gone` once the Job is no more).
// `jobs` are rows of shared/jobs.mjs jobsWithRuns, with `running` and `queued` (bg/ai/jobs.js list).
export function withJobState(cards, jobs = []) {
  const byId = new Map((jobs || []).filter((j) => j && typeof j.id === 'string').map((j) => [j.id, j]))
  return (cards || []).map((c) => {
    const ref = cleanJobRef(c?.job)
    if (!ref) return c
    const j = byId.get(ref.id)
    if (!j) return { ...c, job: { ...ref, gone: true } }
    /** @type {any} */
    const state = { ...ref, title: clip(j.title, MAX_TITLE) || ref.title }
    if (j.running || j.queued) state.running = true
    if (j.lastRun?.status === 'error') state.failed = true
    return { ...c, job: state }
  })
}

// What the AI reads (getDashboard): the layout's program, the cards with theirs, and what it needs
// to know to change them.
export function homeForModel(layoutRec, cards) {
  const view = layoutView(layoutRec)
  const list = sortCards(cards)
  return {
    layout: view.custom ? 'custom' : 'default',
    openui: view.source,
    cards: list.map((c) => ({
      id: c.id,
      title: c.title,
      ...(c.wide ? { wide: true } : {}),
      // A Job's card: its next run replaces the program (saveJob changes what the Job puts there).
      ...(c.job ? { job: { id: c.job.id, title: c.job.title } } : {}),
      openui: c.source,
    })),
    cardsShown: placesWidget(view.source, 'HomeCards') ? 'where the layout places HomeCards()' : 'after the layout, which has no HomeCards()',
    maxCards: MAX_CARDS,
  }
}
