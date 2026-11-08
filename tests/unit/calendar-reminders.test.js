// Calendar reminders (shared/calendar.mjs, ADR-0042 amendment): an event's `remind`, when each
// occurrence's reminder is due, and what it says.

import { describe, it, expect } from 'vitest'
import * as cal from '../../shared/calendar.mjs'

const ev = (f) => cal.makeEvent({ id: cal.newCalendarId(), ...f }, null, '2026-11-01T00:00:00.000Z')

describe('calendar reminders', () => {
  it('keeps only a reminder it offers', () => {
    expect(ev({ title: 'A', start: '2026-11-10T18:00', remind: 30 }).remind).toBe(30)
    expect(ev({ title: 'A', start: '2026-11-10T18:00', remind: '60' }).remind).toBe(60)
    expect(ev({ title: 'A', start: '2026-11-10T18:00', remind: 0 }).remind).toBe(0)
    expect(ev({ title: 'A', start: '2026-11-10T18:00', remind: 7 }).remind).toBeUndefined()
    expect(ev({ title: 'A', start: '2026-11-10T18:00', remind: null }).remind).toBeUndefined()
    expect(ev({ title: 'A', start: '2026-11-10T18:00' }).remind).toBeUndefined()
  })

  it('counts an all-day event from 9 AM on its day', () => {
    expect(cal.reminderAt({ start: '2026-11-10T18:00', allDay: false }, 30)).toBe('2026-11-10T17:30')
    expect(cal.reminderAt({ start: '2026-11-10', allDay: true }, 0)).toBe('2026-11-10T09:00')
    expect(cal.reminderAt({ start: '2026-11-10', allDay: true }, 30)).toBe('2026-11-10T09:00')
    expect(cal.reminderAt({ start: '2026-11-10', allDay: true }, 1440)).toBe('2026-11-09T09:00')
    expect(cal.reminderAt({ start: '2026-11-01T00:10', allDay: false }, 30)).toBe('2026-10-31T23:40')
    expect(cal.reminderAt({ start: '2026-11-10T18:00' }, null)).toBe(null)
  })

  it('finds each occurrence’s reminder in a window, soonest first', () => {
    const swim = ev({ title: 'Swim', start: '2026-11-10T17:00', remind: 60, repeat: { freq: 'weekly', interval: 1 }, location: 'Pool' })
    const trash = ev({ title: 'Bins out', start: '2026-11-12', allDay: true, remind: 1440 })
    const quiet = ev({ title: 'No reminder', start: '2026-11-10T08:00' })
    const got = cal.remindersBetween([swim, trash, quiet, { junk: true }], '2026-11-10T00:00', '2026-11-18T00:00')
    expect(got.map((r) => [r.title, r.at])).toEqual([
      ['Swim', '2026-11-10T16:00'],
      ['Bins out', '2026-11-11T09:00'],
      ['Swim', '2026-11-17T16:00'],
    ])
    expect(got[0].key).toBe(`${swim.id}@2026-11-10T17:00`)
    // The window is [from, to): a reminder exactly at `to` waits for the next one.
    expect(cal.remindersBetween([swim], '2026-11-10T15:00', '2026-11-10T16:00')).toEqual([])
    expect(cal.remindersBetween([swim], '2026-11-10T16:00', '2026-11-10T16:01')).toHaveLength(1)
  })

  it('finds a reminder a week ahead of its event', () => {
    const trip = ev({ title: 'Trip', start: '2026-11-20', allDay: true, remind: 10080 })
    expect(cal.remindersBetween([trip], '2026-11-13T00:00', '2026-11-14T00:00').map((r) => r.at)).toEqual(['2026-11-13T09:00'])
  })

  it('says when, on a 12-hour clock', () => {
    expect(cal.reminderText({ title: 'Swim', start: '2026-11-10T17:00', at: '2026-11-10T16:00', allDay: false, location: 'Pool' }))
      .toEqual({ title: 'Swim', body: 'Today, 5:00 PM · Pool' })
    expect(cal.reminderText({ title: 'Bins out', start: '2026-11-12', at: '2026-11-11T09:00', allDay: true }).body).toBe('Tomorrow, all day')
    expect(cal.reminderText({ title: 'Trip', start: '2026-11-20', at: '2026-11-13T09:00', allDay: true }).body).toBe('Fri 20 Nov, all day')
  })

  it('names the choices', () => {
    expect(cal.describeRemind(0)).toBe('At the start')
    expect(cal.describeRemind(15)).toBe('15 minutes before')
    expect(cal.describeRemind(120)).toBe('2 hours before')
    expect(cal.describeRemind(1440)).toBe('1 day before')
    expect(cal.describeRemind(0, true)).toBe('On the day, at 9 AM')
    expect(cal.describeRemind(2880, true)).toBe('2 days before, at 9 AM')
    expect(cal.describeRemind(null)).toBe('No reminder')
    expect(cal.remindOptions(true)).toEqual([0, 1440, 2880, 10080])
    expect(cal.addWallMs('2026-11-10T00:10', -cal.REMIND_LATE_MS)).toBe('2026-11-09T23:40')
  })
})
