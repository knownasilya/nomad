// The Calendar's rules (shared/calendar.mjs): event records, repeats, the agenda, and the iCal reader.
import { describe, it, expect } from 'vitest'
import * as cal from '../../shared/calendar.mjs'

const T0 = '2026-11-05T10:00:00.000Z'
const SPACE = 'c'.repeat(64)

describe('event records', () => {
  it('tidies an event and keeps who added it', () => {
    const e = cal.makeEvent({ id: 'e1', title: '  Bins   out ', start: '2026-11-10T18:00', by: 'Sam', repeat: { freq: 'weekly', byDay: [2, 2] } }, null, T0)
    expect(e).toMatchObject({ type: cal.EVENT_TYPE, id: 'e1', title: 'Bins out', start: '2026-11-10T18:00', allDay: false, by: 'Sam', repeat: { freq: 'weekly', interval: 1, byDay: [2] } })
    expect(cal.isEvent(e)).toBe(true)
    // An edit keeps createdAt and the first `by`.
    const edited = cal.makeEvent({ id: 'e1', title: 'Bins', start: '2026-11-10T18:30', by: 'Ilya' }, e, '2026-11-06T10:00:00.000Z')
    expect(edited.createdAt).toBe(T0)
    expect(edited.by).toBe('Sam')
    expect(edited.repeat).toBeUndefined()
  })

  it('takes a day for an all-day event, and refuses what makes no sense', () => {
    expect(cal.makeEvent({ id: 'e2', title: 'Half term', start: '2026-10-26T00:00', end: '2026-10-30', allDay: true }, null, T0)).toMatchObject({ start: '2026-10-26', end: '2026-10-30', allDay: true })
    expect(() => cal.makeEvent({ id: 'e3', title: '', start: '2026-11-10' })).toThrow()
    expect(() => cal.makeEvent({ id: 'e3', title: 'x', start: '2026-02-30', allDay: true })).toThrow()
    expect(() => cal.makeEvent({ id: 'e3', title: 'x', start: '2026-11-10T18:00', end: '2026-11-10T17:00' })).toThrow()
    expect(() => cal.makeEvent({ id: '../x', title: 'x', start: '2026-11-10' })).toThrow()
    expect(() => cal.normalizeRepeat({ freq: 'hourly' })).toThrow()
  })

  it('keeps records where Notes keep theirs', () => {
    expect(cal.calendarPrefix('events')).toBe('/.vault/calendar/events/')
    expect(cal.calendarPrefix('feeds', SPACE)).toMatch(new RegExp(`${SPACE}/calendar/feeds/$`))
    expect(cal.libraryPrefix('feedCache')).toBe('/calendar/feed-cache/')
    expect(() => cal.calendarPrefix('photos')).toThrow()
  })

  it('tidies a feed link', () => {
    expect(cal.feedUrl('webcal://school.example/cal.ics#x')).toBe('https://school.example/cal.ics')
    expect(() => cal.feedUrl('file:///etc/passwd')).toThrow()
    expect(cal.makeFeed({ id: 'f1', url: 'https://www.school.example/cal.ics' }, null, T0).name).toBe('school.example')
  })
})

describe('repeats', () => {
  const bins = cal.makeEvent({ id: 'b', title: 'Bins', start: '2026-11-03T18:00', end: '2026-11-03T18:15', repeat: { freq: 'weekly' } }, null, T0)

  it('repeats every week at the same wall time', () => {
    const list = cal.occurrences(bins, '2026-11-01', '2026-12-01')
    expect(list.map((o) => o.start)).toEqual(['2026-11-03T18:00', '2026-11-10T18:00', '2026-11-17T18:00', '2026-11-24T18:00'])
    expect(list[0].end).toBe('2026-11-03T18:15')
    // Across the end of British Summer Time it stays at 6pm.
    expect(cal.occurrences(bins, '2027-03-22', '2027-04-06').map((o) => o.start)).toEqual(['2027-03-23T18:00', '2027-03-30T18:00'])
  })

  it('takes days of the week, intervals, an end and a count', () => {
    const swim = { ...bins, repeat: { freq: 'weekly', interval: 2, byDay: [1, 4] } }
    expect(cal.occurrences(swim, '2026-11-01', '2026-11-30').map((o) => o.start.slice(0, 10))).toEqual(['2026-11-05', '2026-11-16', '2026-11-19'])
    const until = { ...bins, repeat: { freq: 'daily', interval: 1, until: '2026-11-05' } }
    expect(cal.occurrences(until, '2026-11-01', '2026-12-01')).toHaveLength(3)
    const count = { ...bins, repeat: { freq: 'monthly', interval: 1, count: 2 } }
    expect(cal.occurrences(count, '2026-01-01', '2027-12-01').map((o) => o.start)).toEqual(['2026-11-03T18:00', '2026-12-03T18:00'])
  })

  it('skips a month with no such day, and spans days for an all-day event', () => {
    const rent = cal.makeEvent({ id: 'r', title: 'Rent', start: '2027-01-31', allDay: true, repeat: { freq: 'monthly' } }, null, T0)
    expect(cal.occurrences(rent, '2027-01-01', '2027-05-01').map((o) => o.start)).toEqual(['2027-01-31', '2027-03-31'])
    const trip = cal.makeEvent({ id: 't', title: 'Trip', start: '2026-11-08', end: '2026-11-10', allDay: true }, null, T0)
    // It shows on a day it covers even though it started before.
    expect(cal.occurrences(trip, '2026-11-10', '2026-11-11')).toHaveLength(1)
    expect(cal.occurrences(trip, '2026-11-11', '2026-11-12')).toHaveLength(0)
  })
})

describe('the agenda', () => {
  it('puts events and feed events in time order, all-day first', () => {
    const events = [
      cal.makeEvent({ id: 'b', title: 'Bins', start: '2026-11-10T18:00', by: 'Sam' }, null, T0),
      cal.makeEvent({ id: 'd', title: 'Dentist', start: '2026-11-10T09:30', location: 'High St' }, null, T0),
    ]
    const feed = cal.makeFeed({ id: 'f1', url: 'https://school.example/cal.ics', name: 'School' }, null, T0)
    const cache = cal.makeFeedCache(feed, { events: [{ uid: 'u1', title: 'Inset day', start: '2026-11-10', allDay: true }] }, null, new Date(T0))
    const list = cal.agenda({ events, feeds: [{ feed, cache }] }, '2026-11-10', '2026-11-11')
    expect(list.map((o) => o.title)).toEqual(['Inset day', 'Dentist', 'Bins'])
    expect(list[0].feed).toEqual({ id: 'f1', name: 'School', color: null, kind: 'ics', url: 'https://school.example/cal.ics' })
    expect(cal.agendaText(list)).toBe(
      ['- Tue 10 Nov, all day: Inset day (from School)', '- Tue 10 Nov, 09:30: Dentist (at High St)', '- Tue 10 Nov, 18:00: Bins (added by Sam)'].join('\n')
    )
    expect(cal.agendaText([])).toMatch(/Nothing/)
  })

  it('says how a repeat reads', () => {
    expect(cal.describeRepeat({ freq: 'weekly', interval: 1, byDay: [2] })).toBe('Every week on Tue')
    expect(cal.describeRepeat({ freq: 'monthly', interval: 2 })).toBe('Every 2 months')
  })

  it('fetches a feed again once its copy is old, and keeps the last copy on an error', () => {
    const feed = cal.makeFeed({ id: 'f1', url: 'https://school.example/cal.ics' }, null, T0)
    const ok = cal.makeFeedCache(feed, { events: [{ uid: 'u', title: 'Play', start: '2026-12-01T18:00' }, { uid: 'old', title: 'Gone', start: '2026-01-01' }] }, null, new Date(T0))
    expect(ok.events.map((e) => e.uid)).toEqual(['u'])
    expect(cal.feedDue(ok, Date.parse(T0) + 1000)).toBe(false)
    expect(cal.feedDue(ok, Date.parse(T0) + cal.FEED_TTL_MS)).toBe(true)
    const failed = cal.makeFeedCache(feed, { error: 'HTTP 500' }, ok, new Date(T0))
    expect(failed.error).toBe('HTTP 500')
    expect(failed.events).toEqual(ok.events)
  })
})

describe('the iCal reader', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:inset-1',
    'SUMMARY:Inset day\\, no school',
    'DTSTART;VALUE=DATE:20261113',
    'DTEND;VALUE=DATE:20261114',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:play',
    'SUMMARY:School play',
    'LOCATION:Main ',
    ' hall',
    'DTSTART:20261203T180000Z',
    'DTEND:20261203T193000Z',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:swim',
    'SUMMARY:Swimming',
    'DTSTART;TZID=Europe/London:20261102T163000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T000000Z',
    'EXDATE;TZID=Europe/London:20261105T163000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:gone',
    'SUMMARY:Cancelled',
    'STATUS:CANCELLED',
    'DTSTART:20261110T100000',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const toLocal = (d) => d.toISOString().slice(0, 16) // a Device on UTC

  it('reads events, all-day and timed, with repeats and skipped days', () => {
    const list = cal.parseIcs(ics, { toLocal })
    expect(list.map((e) => e.uid)).toEqual(['inset-1', 'play', 'swim'])
    expect(list[0]).toEqual({ uid: 'inset-1', title: 'Inset day, no school', start: '2026-11-13', allDay: true })
    expect(list[1]).toEqual({ uid: 'play', title: 'School play', start: '2026-12-03T18:00', end: '2026-12-03T19:30', allDay: false, location: 'Main hall' })
    expect(list[2].repeat).toEqual({ freq: 'weekly', interval: 1, until: '2026-12-31', byDay: [1, 4] })
    const swims = cal.occurrences(list[2], '2026-11-01', '2026-11-10').map((o) => o.start)
    expect(swims).toEqual(['2026-11-02T16:30', '2026-11-09T16:30']) // the 5th was skipped
  })

  it('shrugs at junk', () => {
    expect(cal.parseIcs('not a calendar')).toEqual([])
    expect(cal.parseIcs('BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT')).toEqual([])
  })

  it('moves a Space’s calendar into its Library when it is shared', () => {
    const e = cal.makeEvent({ id: 'e1', title: 'Bins', start: '2026-11-10' , allDay: true }, null, T0)
    const f = cal.makeFeed({ id: 'f1', url: 'https://school.example/cal.ics' }, null, T0)
    expect(cal.shareCalendarPaths({ events: [e, { bad: true }], feeds: [f] }).map((p) => p.path)).toEqual(['/calendar/events/e1.json', '/calendar/feeds/f1.json'])
  })
})

describe('calendar drives (walled.garden/calendar)', () => {
  const KEY = 'a'.repeat(52)
  const manifest = { type: cal.CALENDAR_TYPE, title: 'Swim club', color: '#3366CC' }

  it('follows a hyper:// drive as a source, beside iCal links', () => {
    expect(cal.driveRoot(`hyper://${KEY.toUpperCase()}/events/x.json`)).toBe(`hyper://${KEY}/`)
    expect(cal.driveRoot('hyper://family/')).toBe(null)
    expect(cal.sourceOf(`hyper://${KEY}`)).toEqual({ kind: 'drive', url: `hyper://${KEY}/` })
    expect(cal.sourceOf('webcal://school.example/cal.ics')).toEqual({ kind: 'ics', url: 'https://school.example/cal.ics' })
    expect(() => cal.sourceOf('hyper://not-a-key/')).toThrow(/drive/)
    const f = cal.makeFeed({ id: 'f2', url: `hyper://${KEY}/`, name: 'Swim club', color: '#3366cc' }, null, T0)
    expect(f).toMatchObject({ type: cal.FEED_TYPE, kind: 'drive', url: `hyper://${KEY}/`, name: 'Swim club', color: '#3366cc' })
    expect(cal.isFeed(f) && cal.isDriveFeed(f)).toBe(true)
    expect(cal.makeFeed({ id: 'f3', url: `hyper://${KEY}/` }, null, T0).name).toBe('Calendar drive')
    expect(cal.makeFeed({ id: 'f1', url: 'https://school.example/cal.ics' }, null, T0).kind).toBeUndefined()
  })

  it('reads the manifest: the kind, where the events are, the name and color', () => {
    expect(cal.isCalendarManifest(manifest)).toBe(true)
    expect(cal.isCalendarManifest({ type: 'walled.garden/feed' })).toBe(false)
    expect(cal.calendarEventsPath(manifest)).toBe('/events/')
    expect(cal.calendarEventsPath({ eventsPath: 'club/dates' })).toBe('/club/dates/')
    expect(cal.calendarEventsPath({ eventsPath: '/../secret/' })).toBe('/events/')
    expect(cal.calendarInfo(manifest)).toEqual({ name: 'Swim club', color: '#3366cc' })
    expect(cal.calendarInfo({})).toEqual({ name: 'Calendar drive', color: null })
  })

  it('takes the event files right in the events folder', () => {
    const keys = ['/events/b.json', { key: '/events/a.json' }, 'events/c.json', '/events/sub/d.json', '/events/notes.txt', '/events/.hidden.json', '/posts/x.json']
    expect(cal.eventFiles(keys, '/events/')).toEqual(['/events/a.json', '/events/b.json', '/events/c.json'])
  })

  it('reads its events in the calendar’s own format, and leaves out what isn’t one', () => {
    const files = [
      { path: '/events/gala.json', value: JSON.stringify({ type: cal.CALENDAR_EVENT_TYPE, title: 'Gala', start: '2026-11-21T10:00', end: '2026-11-21T13:00', location: 'Leisure centre', notes: 'Bring a towel' }) },
      { path: '/events/training.json', value: { type: cal.CALENDAR_EVENT_TYPE, title: 'Training', start: '2026-11-03T17:00', repeat: { freq: 'weekly', byDay: [2, 4] }, exclude: ['2026-11-05'] } },
      { path: '/events/break.json', value: { type: cal.CALENDAR_EVENT_TYPE, title: 'Winter break', start: '2026-12-20', end: '2026-12-31' } },
      { path: '/events/off.json', value: { type: cal.CALENDAR_EVENT_TYPE, title: 'Off', start: '2026-11-10', status: 'cancelled' } },
      { path: '/events/bad.json', value: { type: cal.CALENDAR_EVENT_TYPE, title: 'Bad', start: 'tomorrow' } },
      { path: '/events/rule.json', value: { type: cal.CALENDAR_EVENT_TYPE, title: 'Rule', start: '2026-11-10', repeat: { freq: 'hourly' } } },
      { path: '/events/other.json', value: { type: 'walled.garden/post', title: 'Hi', start: '2026-11-10' } },
      { path: '/events/junk.json', value: '{nope' },
    ]
    const events = cal.driveEvents(files)
    expect(events.map((e) => e.uid)).toEqual(['training', 'gala', 'break'])
    expect(events[1]).toEqual({ uid: 'gala', title: 'Gala', start: '2026-11-21T10:00', end: '2026-11-21T13:00', allDay: false, location: 'Leisure centre', notes: 'Bring a towel' })
    expect(events[2]).toMatchObject({ allDay: true, start: '2026-12-20', end: '2026-12-31' })
    expect(events[0].exclude).toEqual(['2026-11-05T17:00'])

    // On the calendar like a feed's: read-only, with the drive named, notes kept.
    const feed = cal.makeFeed({ id: 'f2', url: `hyper://${KEY}/`, name: 'Swim club' }, null, T0)
    const cache = cal.makeFeedCache(feed, { events }, null, new Date(T0))
    const list = cal.agenda({ feeds: [{ feed, cache }] }, '2026-11-02', '2026-11-09')
    expect(list.map((o) => o.start)).toEqual(['2026-11-03T17:00']) // the 5th is skipped
    expect(list[0]).toMatchObject({ id: 'f2:training', feed: { id: 'f2', name: 'Swim club', kind: 'drive', url: `hyper://${KEY}/` } })
    const gala = cal.agenda({ feeds: [{ feed, cache }] }, '2026-11-21', '2026-11-22')
    expect(gala[0].notes).toBe('Bring a towel')
  })

  it('reads a drive again sooner than an iCal link', () => {
    const feed = cal.makeFeed({ id: 'f2', url: `hyper://${KEY}/` }, null, T0)
    const cache = cal.makeFeedCache(feed, { events: [] }, null, new Date(T0))
    expect(cal.feedDue(cache, Date.parse(T0) + 60e3, feed)).toBe(false)
    expect(cal.feedDue(cache, Date.parse(T0) + cal.DRIVE_TTL_MS, feed)).toBe(true)
    expect(cal.feedDue(cache, Date.parse(T0) + cal.DRIVE_TTL_MS)).toBe(false) // an iCal link's wait
  })
})
