// Live data on the home page (ADR-0048 amendment, "Live cards"). A card or a layout is an
// openui-lang program, and a program can ask for data with the language's own Query statement:
//
//   today = Query("events", {days: 1}, {items: []}, 300)
//   list = List(@Each(today.items, "e", ListItem(e.title, e.when)), "divided")
//
// The first argument names one of the SOURCES below, the second its arguments, the third what
// draws until the data comes, the fourth how often (seconds) it is read again. The page that draws
// the program (nomad://desktop, and the AI Sidebar before it is pinned) answers each Query from the
// user's own things in the page's Space, through nomad.vault.homeQuery (app/bg/web-apis/bg/
// home-live.ts). The data is never written into the program: the model writes the Query, and
// every viewer reads their own (in a shared Space, each member sees theirs). A page with no
// answerer (a saved page in Assets, the phone) draws the defaults.
//
// Every source only reads. Each result is an object with `items` (a list) and `count`, so one
// default, {items: []}, fits all of them.
//
// This file is the rules: the sources and their arguments, how often they may refresh, and the
// shape of each result, made from records the caller read. No I/O, no Electron, no globals the
// phone's Bare worklet lacks. Tests: tests/unit/home-live.test.js.

import { upcomingEvents, latestNotes, dayLabel, addDays } from './home-dashboard.mjs'
import { describeSchedule, runPreview } from './jobs.mjs'
import { jobLink } from './item-links.mjs'

export const MIN_REFRESH = 60 // seconds
export const MAX_REFRESH = 24 * 60 * 60
export const MAX_FILE_BYTES = 512 * 1024 // a drive file a card reads
export const MAX_TEXT = 20000 // characters of a file's text in a result
export const MAX_ROWS = 500 // rows of a CSV or items of a JSON list
export const MAX_RUN_TEXT = 2000 // characters of a Job run's answer

const num = (min, max, dflt) => ({ type: 'number', min, max, dflt })

// The sources a Query can name. `args` are checked by liveArgs; `refresh` is the default interval
// when the Query gives none. `doc` is what the model reads (guide:dashboard, search-execute.mjs).
export const SOURCES = {
  events: {
    args: { days: num(1, 42, 1), limit: num(1, 50, 8) },
    refresh: 300,
    doc: {
      args: 'days?: number (1 = today, 7 = this week; default 1), limit?: number (default 8)',
      about: 'The calendar from now on: events that haven\'t ended, today first.',
      returns:
        '{items: [{title, when, time, end, dayLabel, day, allDay, ongoing, location, calendar, url}], count, label}. ' +
        '`when` reads "Today, 9:30 AM–10:00 AM"; `time` "9:30 AM" or "All day"; `dayLabel` "Today", "Tomorrow", ' +
        '"Wed 12 Nov"; `label` "Today" or "Next 7 days".',
    },
  },
  jobs: {
    args: { limit: num(1, 20, 5) },
    refresh: 120,
    doc: {
      args: 'limit?: number (default 5)',
      about: 'The user\'s Jobs, the next to run first.',
      returns:
        '{items: [{id, title, when, next, running, enabled, lastStatus, lastAgo, lastSummary, url}], count, running}. ' +
        '`when` is the schedule in words; `next` "in 2 h" or ""; `lastStatus` "ok", "error", "stopped" or "".',
    },
  },
  jobRuns: {
    args: { job: { type: 'string', max: 120 }, limit: num(1, 20, 5) },
    refresh: 120,
    doc: {
      args: 'job?: string (a Job\'s id or title; all Jobs without it), limit?: number (default 5)',
      about: 'The newest runs of a Job, or of every Job: what it answered and when.',
      returns:
        '{job: {id, title, url}, items: [{job, status, ok, ago, at, summary, text, url}], count, last}. ' +
        '`last` is the newest run (the same fields) and `last.text` its whole answer up to 2,000 characters; ' +
        '`summary` its first lines; `status` "ok", "error" or "stopped".',
    },
  },
  notes: {
    args: { limit: num(1, 20, 5), topic: { type: 'string', max: 60 } },
    refresh: 300,
    doc: {
      args: 'limit?: number (default 5), topic?: string (only Notes with this topic)',
      about: 'The Notes changed last.',
      returns: '{items: [{title, snippet, ago, topics, url}], count}.',
    },
  },
  driveFile: {
    args: { url: { type: 'url', required: true } },
    refresh: 600,
    doc: {
      args: 'url: string (a hyper:// file)',
      about:
        'One file in a drive, read as JSON (.json), a table (.csv) or text (anything else). Up to 512 KB.',
      returns:
        '{name, kind, data, items, columns, text, count, url}. JSON: `data` is the value, and `items` the list it is ' +
        '(or its first list field). CSV: `items` are the rows as objects keyed by `columns`. Text: `text`, and ' +
        '`items` its non-empty lines.',
    },
  },
  driveFolder: {
    args: { url: { type: 'url', required: true }, limit: num(1, 50, 10) },
    refresh: 600,
    doc: {
      args: 'url: string (a hyper:// folder), limit?: number (default 10)',
      about: 'The files in a drive folder, the newest first.',
      returns: '{items: [{name, folder, size, ago, url}], count}.',
    },
  },
}

export const SOURCE_NAMES = Object.keys(SOURCES)

export function isSource(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, name)
}

// A hyper:// address, tidied, or null.
export function hyperUrl(input) {
  const s = String(input ?? '').trim()
  if (!/^hyper:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(s) || s.length > 1000) return null
  return s.includes('/', 'hyper://'.length) ? s : s + '/'
}

/**
 * A Query's arguments, checked: unknown names are dropped, numbers rounded and kept in range,
 * missing ones get their default. Throws, in words the model can act on, for an unknown source or
 * a missing or wrong required argument.
 */
export function liveArgs(source, args) {
  if (!isSource(source)) {
    throw new Error(`There is no live source "${String(source).slice(0, 40)}". The sources are ${SOURCE_NAMES.join(', ')}`)
  }
  const given = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const out = {}
  for (const [name, spec] of Object.entries(SOURCES[source].args)) {
    const v = given[name]
    if (spec.type === 'number') {
      const n = Math.round(Number(v))
      out[name] = Number.isFinite(n) && v !== null && v !== '' ? Math.min(spec.max, Math.max(spec.min, n)) : spec.dflt
    } else if (spec.type === 'string') {
      const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, spec.max) : ''
      if (s) out[name] = s
    } else if (spec.type === 'url') {
      const u = hyperUrl(v)
      if (!u) {
        if (spec.required) throw new Error(`Query("${source}") needs \`${name}\`: a hyper:// address`)
        continue
      }
      out[name] = u
    }
  }
  return out
}

// How often a Query reads again, in seconds: its own interval kept between MIN_REFRESH and
// MAX_REFRESH, or the source's default.
export function refreshSeconds(source, seconds) {
  const n = Math.round(Number(seconds))
  if (!Number.isFinite(n) || n <= 0 || seconds === null) return isSource(source) ? SOURCES[source].refresh : 0
  return Math.min(MAX_REFRESH, Math.max(MIN_REFRESH, n))
}

// The sources whose data comes from the Vault and Jobs: read again when the page hears they
// changed. A drive is read again only on its interval or by hand.
export const VAULT_SOURCES = ['events', 'jobs', 'jobRuns', 'notes']

// Words
// =

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

// "3:30 PM" from 'HH:MM' (the calendar shows a 12-hour clock).
export function time12(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ''))
  if (!m) return ''
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// "just now", "5 min ago", "2 h ago", "3 days ago", or the date. `at` is an ISO time.
export function agoText(at, now = Date.now()) {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  // Floored, as the home page's own parts count (desktop/js/lib/when.js).
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(t).toISOString().slice(0, 10)
}

// "in 5 min", "in 2 h", "in 3 days", or '' for a time past.
export function untilText(at, now = Date.now()) {
  const t = Date.parse(at)
  if (!Number.isFinite(t) || t < now) return ''
  const s = Math.round((t - now) / 1000)
  if (s < 60) return 'in under a minute'
  if (s < 3600) return `in ${Math.round(s / 60)} min`
  if (s < 86400) return `in ${Math.round(s / 3600)} h`
  const d = Math.round(s / 86400)
  return `in ${d} day${d === 1 ? '' : 's'}`
}

export function sizeText(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Results
// =

/**
 * The calendar from `now` (a wall time 'YYYY-MM-DDTHH:MM') through the end of day `days`.
 * `occurrences` are shared/calendar.mjs agenda() rows from today to at least that day.
 */
export function eventsResult(occurrences, now, { days = 1, limit = 8 } = {}) {
  const today = String(now || '').slice(0, 10)
  const last = addDays(today, Math.max(1, days) - 1)
  const items = upcomingEvents(occurrences, now, { max: 1000 })
    .filter((e) => e.day <= last)
    .slice(0, limit)
    .map((e) => {
      const start = e.allDay ? '' : time12(e.start.slice(11, 16))
      const end = !e.allDay && e.end && e.end.slice(0, 10) === e.day ? time12(e.end.slice(11, 16)) : ''
      const label = e.dayLabel || dayLabel(e.day, today)
      return {
        title: e.title,
        when: e.allDay ? `${label}, all day` : `${label}, ${start}${end ? '–' + end : ''}`,
        time: e.allDay ? 'All day' : start,
        end,
        dayLabel: label,
        day: e.day,
        allDay: e.allDay,
        ongoing: e.ongoing,
        location: e.location,
        calendar: e.feed,
        url: e.url,
      }
    })
  return { items, count: items.length, label: days <= 1 ? 'Today' : `Next ${days} days` }
}

const runStatus = (r) => (r.status === 'error' ? 'error' : r.stopped ? 'stopped' : 'ok')

/** `jobs` are bg/ai/jobs.js list() rows (shared/jobs.mjs jobsWithRuns, plus `running`). */
export function jobsResult(jobs, { limit = 5 } = {}, now = Date.now()) {
  const list = (jobs || []).filter((j) => j && typeof j.id === 'string')
  const at = (j) => (j.running || j.queued ? '' : j.enabled && j.nextRunAt ? j.nextRunAt : '~')
  const items = list
    .slice()
    .sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : String(a.title).localeCompare(String(b.title))))
    .slice(0, limit)
    .map((j) => ({
      id: j.id,
      title: clip(j.title, 80) || 'Job',
      when: describeSchedule(j.schedule) || 'By hand',
      next: j.enabled && j.nextRunAt ? untilText(j.nextRunAt, now) : '',
      running: !!(j.running || j.queued),
      enabled: !!j.enabled,
      lastStatus: j.lastRun ? runStatus(j.lastRun) : '',
      lastAgo: j.lastRun ? agoText(j.lastRun.finishedAt || j.lastRun.startedAt, now) : '',
      lastSummary: j.lastRun ? runPreview(j.lastRun, 200) : '',
      url: jobLink(j.id),
    }))
  return { items, count: items.length, running: list.filter((j) => j.running || j.queued).length }
}

// The Job a Query names: by id, or by title (any case).
export function findJob(jobs, job) {
  if (!job) return null
  const want = String(job).trim().toLowerCase()
  return (jobs || []).find((j) => j?.id === job) || (jobs || []).find((j) => String(j?.title || '').trim().toLowerCase() === want) || null
}

const EMPTY_RUN = { job: '', status: '', ok: false, ago: '', at: '', summary: '', text: '', url: '' }

/**
 * `jobs` as for jobsResult; `runs` every Job's runs (bg/ai/jobs.js allRuns()).
 * @param {any[]} jobs @param {any[]} runs @param {{ job?: string, limit?: number }} [opts] @param {number} [now]
 */
export function jobRunsResult(jobs, runs, { job, limit = 5 } = {}, now = Date.now()) {
  const named = job ? findJob(jobs, job) : null
  const titles = new Map((jobs || []).map((j) => [j.id, j.title]))
  const items = (runs || [])
    .filter((r) => r && typeof r.jobId === 'string' && (!job || r.jobId === named?.id))
    .sort((a, b) => (String(a.finishedAt || a.startedAt) < String(b.finishedAt || b.startedAt) ? 1 : -1))
    .slice(0, limit)
    .map((r) => {
      const status = runStatus(r)
      const at = r.finishedAt || r.startedAt || ''
      return {
        job: clip(titles.get(r.jobId) || r.title, 80) || 'Job',
        status,
        ok: status === 'ok',
        ago: agoText(at, now),
        at,
        summary: runPreview(r, 200),
        text: status === 'error' ? clip(r.error || 'The Job didn’t finish', MAX_RUN_TEXT) : String(r.output || r.summary || '').trim().slice(0, MAX_RUN_TEXT),
        url: jobLink(r.jobId),
      }
    })
  return {
    job: named ? { id: named.id, title: clip(named.title, 80), url: jobLink(named.id) } : { id: '', title: job ? '' : 'All Jobs', url: '' },
    items,
    count: items.length,
    last: items[0] || EMPTY_RUN,
  }
}

/**
 * `notes` are Note records (vault-apps listNotes, shared/vault-apps.mjs).
 * @param {any[]} notes @param {{ limit?: number, topic?: string }} [opts] @param {number} [now]
 */
export function notesResult(notes, { limit = 5, topic } = {}, now = Date.now()) {
  const want = topic ? String(topic).trim().toLowerCase() : ''
  const list = want ? (notes || []).filter((n) => (n?.topics || []).some((t) => String(t).toLowerCase() === want)) : notes
  const topicsOf = new Map((notes || []).map((n) => [n?.id, Array.isArray(n?.topics) ? n.topics.slice(0, 8) : []]))
  const items = latestNotes(list, { max: limit }).map((n) => ({
    title: clip(n.title, 120) || 'Untitled',
    snippet: n.snippet,
    ago: agoText(n.updatedAt, now),
    updatedAt: n.updatedAt,
    topics: topicsOf.get(n.id) || [],
    url: n.url,
  }))
  return { items, count: items.length }
}

// Files
// =

const nameOf = (url) => {
  const path = String(url || '').replace(/[?#].*$/, '')
  const parts = path.split('/').filter(Boolean)
  let name = parts.length > 2 ? parts[parts.length - 1] : ''
  try {
    name = decodeURIComponent(name)
  } catch {}
  return name
}

// One CSV line's fields (RFC 4180 quotes), and the rows of a whole text.
export function parseCsv(text, maxRows = MAX_ROWS) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      if (rows.length > maxRows) break
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (rows.length <= maxRows && (row.length > 1 || row[0] !== '')) rows.push(row)
  }
  return rows
}

// A CSV cell as a value: a number when it is one, else its text.
const cell = (v) => {
  const t = String(v ?? '').trim()
  return /^-?\d+(\.\d+)?$/.test(t) && t.length < 16 ? Number(t) : t
}

/** A drive file's result. `text` is its content; `url` its address; `updated` its mtime (ISO). */
export function fileResult(url, text, { updated = null } = {}, now = Date.now()) {
  const name = nameOf(url)
  const body = String(text ?? '')
  const base = { name, url, updated: updated || '', ago: updated ? agoText(updated, now) : '' }
  if (/\.json$/i.test(name)) {
    let data
    try {
      data = JSON.parse(body)
    } catch {
      throw new Error(`${name} isn’t valid JSON`)
    }
    const list = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? Object.values(data).find(Array.isArray) || []
        : []
    const items = list.slice(0, MAX_ROWS)
    return { ...base, kind: 'json', data, items, columns: [], text: '', count: items.length }
  }
  if (/\.csv$/i.test(name)) {
    const [head = [], ...rows] = parseCsv(body)
    const columns = head.map((h, i) => String(h).trim() || `column${i + 1}`)
    const items = rows.slice(0, MAX_ROWS).map((r) => Object.fromEntries(columns.map((c, i) => [c, cell(r[i])])))
    return { ...base, kind: 'csv', data: null, items, columns, text: '', count: items.length }
  }
  const t = body.slice(0, MAX_TEXT)
  const items = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_ROWS)
  return { ...base, kind: 'text', data: null, items, columns: [], text: t, count: items.length }
}

// A stat from either drive backend: an fs.Stats-like object, or the plain one bg sends (`mode`).
export function isFolderStat(stat) {
  if (!stat) return false
  if (typeof stat.isDirectory === 'function') return !!stat.isDirectory()
  return (Number(stat.mode) & 0o170000) === 0o040000
}

/** A folder's result. `entries` are nomad.fs readdir({ includeStats }) rows: { name, stat }. */
export function folderResult(url, entries, { limit = 10 } = {}, now = Date.now()) {
  const dir = url.endsWith('/') ? url : url + '/'
  const mtime = (e) => {
    const t = e?.stat?.mtime
    const ms = typeof t === 'number' ? t : Date.parse(t)
    return Number.isFinite(ms) ? ms : 0
  }
  const items = (entries || [])
    .filter((e) => e && typeof e.name === 'string' && e.name && !e.name.startsWith('.'))
    .sort((a, b) => mtime(b) - mtime(a) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((e) => {
      const folder = isFolderStat(e.stat)
      const ms = mtime(e)
      return {
        name: e.name,
        folder,
        size: folder ? '' : sizeText(e.stat?.size),
        ago: ms ? agoText(new Date(ms).toISOString(), now) : '',
        url: dir + encodeURIComponent(e.name) + (folder ? '/' : ''),
      }
    })
  return { name: nameOf(dir), items, count: items.length, url: dir }
}

// Links in a live program
// =

// Every `url` in a result, at any depth: the links the data itself carries. A drawing may open
// one of these, or a link written in the program; never one built from data (ADR-0048 amendment).
export function urlsIn(value, out = new Set(), depth = 0) {
  if (depth > 6 || value == null) return out
  if (Array.isArray(value)) {
    for (const v of value.slice(0, MAX_ROWS)) urlsIn(v, out, depth + 1)
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'url' && typeof v === 'string') out.add(v)
      else if (v && typeof v === 'object') urlsIn(v, out, depth + 1)
    }
  }
  return out
}

// What the model reads about the sources (guide:dashboard).
export function sourcesGuide() {
  return SOURCE_NAMES.map((name) => {
    const d = SOURCES[name].doc
    return `- \`${name}\` — ${d.about} Arguments: {${d.args}}. Reads again every ${SOURCES[name].refresh / 60} min unless the Query says.\n  Returns ${d.returns}`
  }).join('\n')
}
