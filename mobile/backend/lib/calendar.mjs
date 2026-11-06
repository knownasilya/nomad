// The phone's calendar: the same records as desktop's nomad://calendar (app/bg/web-apis/bg/calendar.ts),
// on the same rules (shared/calendar.mjs). An event is the user's (every Space) or one Space's; a
// shared Space's are in its Space Library, so the whole household sees and edits them.
//
// iCal feeds: the phone's UI fetches a feed's file itself (React Native's fetch, as Reader does for
// RSS) when its copy is old and this phone can write the copy, and hands the text to `feedFetched`,
// which reads it here and keeps the copy for every Device. Usually a computer has fetched it already.

import * as cal from '../../../shared/calendar.mjs'
import { recordsOf } from './vault-apps.mjs'
import { memberRecords } from './space-library.mjs'

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
      due: writable && cal.feedDue(cache)
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

// Follow an iCal feed (the user's, or the Space's when `inSpace`). The UI fetches it next.
export async function saveFeed (base, space, fields = {}) {
  space = cal.isSpaceKey(space) ? space : null
  const id = fields.id ? String(fields.id) : cal.newCalendarId()
  const found = fields.id ? await locate(base, 'feeds', id, space) : { space: null, prev: null }
  const where = found.prev ? found.space : fields.inSpace && space && (await canWrite(base, space, 'feeds')) ? space : null
  if (where && !(await canWrite(base, where, 'feeds'))) throw new Error('You can view this Space’s calendar, but not change it')
  const count = (await listKind(base, where, 'feeds', cal.isFeed)).length
  if (!found.prev && count >= cal.MAX_FEEDS) throw new Error(`A calendar can follow at most ${cal.MAX_FEEDS} feeds`)
  const rec = cal.makeFeed({ ...fields, id, by: await memberName(base, where) }, found.prev)
  await (await recordsOf(base, where, 'feeds')).put(cal.recordFile(id), rec)
  return withSpace(where)(rec)
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
