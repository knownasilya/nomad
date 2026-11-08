// The phone's calendar: the same records as desktop's nomad://calendar (app/bg/web-apis/bg/calendar.ts),
// on the same rules (shared/calendar.mjs). An event is the user's (every Space) or one Space's; a
// shared Space's are in its Space Library, so the whole household sees and edits them.
//
// iCal feeds: the phone's UI fetches a feed's file itself (React Native's fetch, as Reader does for
// RSS) when its copy is old and this phone can write the copy, and hands the text to `feedFetched`,
// which reads it here and keeps the copy for every Device. Usually a computer has fetched it already.
// A calendar drive (walled.garden/calendar) is read here instead, over the drive manager, when the UI
// asks (`fetchDrive`): the backend reads drives itself, as Reader's hyper:// feeds do.

import * as cal from '../../../shared/calendar.mjs'
import b4a from 'b4a'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import { recordsOf } from './vault-apps.mjs'
import { memberRecords } from './space-library.mjs'
import { parseHyperUrl } from './hyper-url.mjs'
import { DRIVE_AUTOBASE, DRIVE_HYPERDRIVE } from '../../rpc-commands.mjs'

const SPACES_PREFIX = '/.vault/spaces/'
const withSpace = (space) => (rec) => ({ ...rec, space: space || null })

async function listKind (base, space, kind, test) {
  const s = await recordsOf(base, space, kind)
  return (await s.list()).filter(test).map(withSpace(space))
}

async function locate (base, kind, id, space) {
  const file = cal.recordFile(id)
  const own = await (await recordsOf(base, null, kind)).get(file)
  if (own) return { space: null, prev: own }
  if (space) {
    const theirs = await (await recordsOf(base, space, kind)).get(file)
    if (theirs) return { space, prev: theirs }
  }
  return { space: null, prev: null }
}

// This person's name in a shared Space, for "added by".
async function memberName (base, space) {
  if (!space) return ''
  const s = await recordsOf(base, space, 'events')
  if (!s.shared || !s.lib) return ''
  const mine = (await memberRecords(s.lib).catch(() => [])).find((m) => m.memberId === s.lib.memberId)
  return (mine && mine.name) || ''
}

async function canWrite (base, space, kind = 'events') {
  const s = await recordsOf(base, space, kind)
  return s.shared ? s.writable : !!base.writable
}

// { space, shared, canWriteSpace, writable, from, to, events, feeds, occurrences }, as desktop's.
// Each feed carries `due`: its copy is old and this phone can write a new one.
export async function listCalendar (base, space, { from, to } = {}) {
  const today = cal.dayOf(cal.localWallTime())
  from = cal.isDate(from) ? from : today
  to = cal.isDate(to) && to > from ? to : cal.addDays(from, 42)
  space = cal.isSpaceKey(space) ? space : null
  const events = [...(await listKind(base, null, 'events', cal.isEvent)), ...(space ? await listKind(base, space, 'events', cal.isEvent) : [])]
  const feeds = [...(await listKind(base, null, 'feeds', cal.isFeed)), ...(space ? await listKind(base, space, 'feeds', cal.isFeed) : [])]
  const withCache = []
  for (const feed of feeds) {
    const store = await recordsOf(base, feed.space, 'feedCache')
    const cache = await store.get(cal.recordFile(feed.id)).catch(() => null)
    const writable = store.shared ? store.writable : !!base.writable
    withCache.push({ feed, cache: cal.isFeedCache(cache) ? cache : null, writable })
  }
  const shared = space ? (await recordsOf(base, space, 'events')).shared : false
  return {
    space,
    shared,
    canWriteSpace: space ? await canWrite(base, space) : !!base.writable,
    writable: !!base.writable,
    from,
    to,
    events,
    feeds: withCache.map(({ feed, cache, writable }) => ({
      ...feed,
      fetchedAt: (cache && cache.fetchedAt) || null,
      error: (cache && cache.error) || '',
      count: (cache && cache.events && cache.events.length) || 0,
      due: writable && cal.feedDue(cache, Date.now(), feed)
    })),
    occurrences: cal.agenda({ events, feeds: withCache.filter((f) => f.cache) }, from, to)
  }
}

export async function saveEvent (base, space, fields = {}) {
  space = cal.isSpaceKey(space) ? space : null
  const id = fields.id ? String(fields.id) : cal.newCalendarId()
  const found = fields.id ? await locate(base, 'events', id, space) : { space: null, prev: null }
  if (fields.id && !found.prev) throw new Error('That event was deleted')
  const where = found.prev ? found.space : fields.inSpace && space && (await canWrite(base, space)) ? space : null
  if (where && !(await canWrite(base, where))) throw new Error('You can view this Space’s calendar, but not change it')
  const rec = cal.makeEvent({ ...fields, id, by: await memberName(base, where) }, found.prev)
  await (await recordsOf(base, where, 'events')).put(cal.recordFile(id), rec)
  return withSpace(where)(rec)
}

export async function deleteEvent (base, space, id) {
  const found = await locate(base, 'events', String(id || ''), cal.isSpaceKey(space) ? space : null)
  if (!found.prev) return false
  await (await recordsOf(base, found.space, 'events')).del(cal.recordFile(found.prev.id))
  return true
}

// Follow an iCal feed or a calendar drive (the user's, or the Space's when `inSpace`). The UI
// fetches an iCal feed next; a drive is read here first (it must be a calendar), and its copy kept.
export async function saveFeed (base, space, fields = {}, manager = null) {
  space = cal.isSpaceKey(space) ? space : null
  const id = fields.id ? String(fields.id) : cal.newCalendarId()
  const found = fields.id ? await locate(base, 'feeds', id, space) : { space: null, prev: null }
  const where = found.prev ? found.space : fields.inSpace && space && (await canWrite(base, space, 'feeds')) ? space : null
  if (where && !(await canWrite(base, where, 'feeds'))) throw new Error('You can view this Space’s calendar, but not change it')
  const list = await listKind(base, where, 'feeds', cal.isFeed)
  if (!found.prev && list.length >= cal.MAX_FEEDS) throw new Error(`A calendar can follow at most ${cal.MAX_FEEDS} feeds`)
  const source = cal.sourceOf(fields.url ?? (found.prev && found.prev.url))
  const same = list.find((f) => f.url === source.url && f.id !== id)
  if (same) throw new Error(`The calendar already follows ${same.name}`)
  let extra = {}
  let drive = null
  if (source.kind === 'drive') {
    if (!manager) throw new Error('Can’t read drives here')
    drive = await readCalendarDrive(manager, source.url)
    const info = cal.calendarInfo(drive.manifest)
    const prev = found.prev || {}
    extra = { name: fields.name || prev.name || info.name, color: fields.color || prev.color || info.color }
  }
  const rec = cal.makeFeed({ ...fields, ...extra, url: source.url, id, by: await memberName(base, where) }, found.prev)
  await (await recordsOf(base, where, 'feeds')).put(cal.recordFile(id), rec)
  if (drive) {
    const store = await recordsOf(base, where, 'feedCache')
    if (store.shared ? store.writable : base.writable) await store.put(cal.recordFile(id), cal.makeFeedCache(rec, { events: drive.events }))
  }
  return withSpace(where)(rec)
}

function withTimeout (p, ms, message) {
  let t
  return Promise.race([p, new Promise((resolve, reject) => { t = setTimeout(() => reject(new Error(message)), ms) })]).finally(() => clearTimeout(t))
}

// A calendar drive's manifest and events, the same reading desktop's bg does over nomad.fs. New
// drives are Autobases; an older one may be a Hyperdrive, so that is the second try.
export async function readCalendarDrive (manager, url, { timeout = 20e3 } = {}) {
  const root = cal.driveRoot(url)
  if (!root) throw new Error('That isn’t a drive’s hyper:// address')
  const { key, keyHex } = parseHyperUrl(root)
  const read = (type, path) => withTimeout(manager.bridgeRead(type, key, path), timeout, 'timeout')
  let type = DRIVE_AUTOBASE
  let text = await read(type, '/index.json').catch(() => null)
  if (text == null) {
    manager.release(DRIVE_AUTOBASE, keyHex)
    type = DRIVE_HYPERDRIVE
    text = await read(type, '/index.json').catch(() => null)
  }
  if (text == null) {
    manager.release(DRIVE_HYPERDRIVE, keyHex)
    throw new Error('Couldn’t reach that drive. Is it online?')
  }
  let manifest = null
  try { manifest = JSON.parse(text) } catch {}
  if (!cal.isCalendarManifest(manifest)) throw new Error('That drive isn’t a calendar (its index.json type isn’t walled.garden/calendar)')
  const dir = cal.calendarEventsPath(manifest)
  const keys = await withTimeout(manager.bridgeListKeys(type, key, dir), timeout, 'timeout').catch(() => [])
  const files = []
  for (const path of cal.eventFiles(keys, dir)) {
    const value = await read(type, path).catch(() => null)
    if (value != null) files.push({ path, value })
  }
  return { url: root, manifest, events: cal.driveEvents(files) }
}

// Read the calendar drive feed `id` follows and keep its events (or the error) for every Device.
export async function fetchDrive (base, manager, space, { id } = {}) {
  const found = await locate(base, 'feeds', String(id || ''), cal.isSpaceKey(space) ? space : null)
  if (!found.prev || !cal.isDriveFeed(found.prev)) return null
  const store = await recordsOf(base, found.space, 'feedCache')
  if (store.shared ? !store.writable : !base.writable) return null
  const prev = await store.get(cal.recordFile(found.prev.id)).catch(() => null)
  let rec
  try {
    const { events } = await readCalendarDrive(manager, found.prev.url)
    rec = cal.makeFeedCache(found.prev, { events }, prev)
  } catch (err) {
    rec = cal.makeFeedCache(found.prev, { error: String((err && err.message) || err) }, cal.isFeedCache(prev) ? prev : null)
  }
  await store.put(cal.recordFile(found.prev.id), rec)
  return { fetchedAt: rec.fetchedAt, error: rec.error || '', count: rec.events.length }
}

// Which of `urls` (the Space's drives) are calendar drives the calendar doesn't follow yet:
// [{ url, name, color }]. Each is given a few seconds; one that isn't online is left out.
export async function calendarDrives (base, manager, space, urls = []) {
  space = cal.isSpaceKey(space) ? space : null
  const followed = new Set([...(await listKind(base, null, 'feeds', cal.isFeed)), ...(space ? await listKind(base, space, 'feeds', cal.isFeed) : [])].map((f) => f.url))
  const roots = [...new Set((Array.isArray(urls) ? urls : []).map(cal.driveRoot).filter(Boolean))].filter((u) => !followed.has(u)).slice(0, 100)
  const out = await Promise.all(roots.map(async (url) => {
    try {
      const { key } = parseHyperUrl(url)
      const text = await withTimeout(manager.bridgeRead(DRIVE_AUTOBASE, key, '/index.json'), 3e3, 'timeout')
      const manifest = JSON.parse(text)
      if (!cal.isCalendarManifest(manifest)) return null
      return { url, ...cal.calendarInfo(manifest) }
    } catch {
      return null
    }
  }))
  return out.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
}

export async function deleteFeed (base, space, id) {
  const found = await locate(base, 'feeds', String(id || ''), cal.isSpaceKey(space) ? space : null)
  if (!found.prev) return false
  await (await recordsOf(base, found.space, 'feeds')).del(cal.recordFile(found.prev.id))
  await (await recordsOf(base, found.space, 'feedCache')).del(cal.recordFile(found.prev.id)).catch(() => {})
  return true
}

// The UI fetched feed `id`: keep its events (from `text`) or the error, beside the last good copy.
export async function feedFetched (base, space, { id, text, error } = {}) {
  const found = await locate(base, 'feeds', String(id || ''), cal.isSpaceKey(space) ? space : null)
  if (!found.prev) return null
  const store = await recordsOf(base, found.space, 'feedCache')
  if (store.shared ? !store.writable : !base.writable) return null
  const prev = await store.get(cal.recordFile(found.prev.id)).catch(() => null)
  let parsed = null
  if (!error) {
    const s = String(text || '')
    if (!/BEGIN:VCALENDAR/i.test(s.slice(0, 5000))) error = 'That link isn’t an iCal calendar'
    else parsed = cal.parseIcs(s)
  }
  const rec = parsed
    ? cal.makeFeedCache(found.prev, { events: parsed }, prev)
    : cal.makeFeedCache(found.prev, { error: String(error) }, cal.isFeedCache(prev) ? prev : null)
  await store.put(cal.recordFile(found.prev.id), rec)
  return { fetchedAt: rec.fetchedAt, error: rec.error || '', count: rec.events.length }
}

// Reminders due from `from` to `to` (wall times) across the user's own events and every Space in
// the Vault (shared/calendar.mjs remindersBetween), for the phone to schedule ahead
// (lib/useCalendarReminders.ts). Each carries its Space's name.
export async function reminders (base, { from, to } = {}) {
  const now = cal.localWallTime()
  from = cal.isDateTime(from) ? from : now
  to = cal.isDateTime(to) && to > from ? to : cal.addDays(cal.dayOf(from), 7) + from.slice(10)
  const spaces = []
  for await (const node of base.view.createReadStream({ gte: SPACES_PREFIX, lt: SPACES_PREFIX + '\xff' })) {
    const s = decodeInlineJson(node.value, b4a)
    if (s && cal.isSpaceKey(s.rootDriveKey) && !s.movedTo && !s.deleted && !s.removed) spaces.push(s)
  }
  const events = await listKind(base, null, 'events', cal.isEvent).catch(() => [])
  for (const s of spaces) events.push(...(await listKind(base, s.rootDriveKey, 'events', cal.isEvent).catch(() => [])))
  const names = new Map(spaces.map((s) => [s.rootDriveKey, s.name || '']))
  return cal.remindersBetween(events, from, to).map((r) => ({ ...r, spaceName: r.space ? names.get(r.space) || '' : '', ...cal.reminderText(r) }))
}
