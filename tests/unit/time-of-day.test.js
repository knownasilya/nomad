// The calendar's time pickers: desktop's nomad://calendar uses
// app/userland/app-stdlib/js/time-of-day.js; the phone keeps a copy in mobile/lib/timeOfDay.ts. The
// same cases run on both, so the two can't drift apart.

import { describe, it, expect } from 'vitest'
import * as desktop from '../../app/userland/app-stdlib/js/time-of-day.js'
import * as phone from '../../mobile/lib/timeOfDay.ts'

for (const [name, m] of [['desktop', desktop], ['phone', phone]]) {
  describe(`time of day (${name})`, () => {
    it('reads what a person types', () => {
      expect(m.parseTime('9')).toBe('09:00')
      expect(m.parseTime('09:30')).toBe('09:30')
      expect(m.parseTime('930')).toBe('09:30')
      expect(m.parseTime('9.30')).toBe('09:30')
      expect(m.parseTime('1830')).toBe('18:30')
      expect(m.parseTime('18:30')).toBe('18:30')
      expect(m.parseTime('3pm')).toBe('15:00')
      expect(m.parseTime('3:30 PM')).toBe('15:30')
      expect(m.parseTime('3:30p')).toBe('15:30')
      expect(m.parseTime('12am')).toBe('00:00')
      expect(m.parseTime('12pm')).toBe('12:00')
      expect(m.parseTime('12:15 am')).toBe('00:15')
      expect(m.parseTime('noon')).toBe('12:00')
      expect(m.parseTime('midnight')).toBe('00:00')
      expect(m.parseTime(' 7 ')).toBe('07:00')
    })

    it('refuses what is not a time', () => {
      for (const bad of ['', '   ', '24', '25:00', '9:60', '13pm', '0am', 'soon', '9:3', '12345', null, undefined]) {
        expect(m.parseTime(bad)).toBe(null)
      }
    })

    it('turns minutes into times and back', () => {
      expect(m.minutesOf('00:00')).toBe(0)
      expect(m.minutesOf('18:30')).toBe(1110)
      expect(m.minutesOf('nope')).toBeNaN()
      expect(m.timeFrom(1110)).toBe('18:30')
      expect(m.timeFrom(24 * 60 + 15)).toBe('00:15')
      expect(m.timeFrom(-15)).toBe('23:45')
      expect(m.isTime('23:59')).toBe(true)
      expect(m.isTime('24:00')).toBe(false)
    })

    it('shows times on a 12-hour clock', () => {
      expect(m.formatTime('00:00')).toBe('12:00 AM')
      expect(m.formatTime('00:30')).toBe('12:30 AM')
      expect(m.formatTime('09:05')).toBe('9:05 AM')
      expect(m.formatTime('12:00')).toBe('12:00 PM')
      expect(m.formatTime('15:30')).toBe('3:30 PM')
      expect(m.formatTime('23:45')).toBe('11:45 PM')
      expect(m.formatTime('17:00', true)).toBe('5pm')
      expect(m.formatTime('17:30', true)).toBe('5:30pm')
      expect(m.formatTime('00:00', true)).toBe('12am')
      expect(m.formatTime('nope')).toBe('nope')
      // What it shows reads back as the same time.
      for (const o of m.timeOptions()) expect(m.parseTime(o.label)).toBe(o.value)
    })

    it('says how long an event is', () => {
      expect(m.durationLabel(15)).toBe('15 min')
      expect(m.durationLabel(60)).toBe('1 h')
      expect(m.durationLabel(90)).toBe('1.5 h')
      expect(m.durationLabel(105)).toBe('1 h 45 min')
      expect(m.durationLabel(-5)).toBe('')
    })

    it('lists every quarter hour of a day', () => {
      const all = m.timeOptions()
      expect(all).toHaveLength(96)
      expect(all[0]).toEqual({ value: '00:00', label: '12:00 AM' })
      expect(all[54]).toEqual({ value: '13:30', label: '1:30 PM' })
      expect(all[95].value).toBe('23:45')
      expect(m.timeOptions(30)).toHaveLength(48)
    })

    it('lists end times after the start, with how long each makes it', () => {
      const ends = m.endOptions('09:00')
      expect(ends[0]).toEqual({ value: '09:15', label: '9:15 AM (15 min)' })
      expect(ends[3]).toEqual({ value: '10:00', label: '10:00 AM (1 h)' })
      expect(ends.at(-1).value).toBe('23:45')
      // A start off the quarter hour still offers the next quarter.
      expect(m.endOptions('09:10')[0]).toEqual({ value: '09:15', label: '9:15 AM (5 min)' })
      // On a later day, or with a late start, every time.
      expect(m.endOptions('09:00', false)).toHaveLength(96)
      expect(m.endOptions('23:50')).toHaveLength(96)
    })

    it('moves the end with the start, keeping the length', () => {
      const ev = { startDay: '2026-11-07', startTime: '09:00', endDay: '2026-11-07', endTime: '10:30' }
      expect(m.shiftEnd(ev, '2026-11-07', '14:00')).toEqual({ endDay: '2026-11-07', endTime: '15:30' })
      // Past midnight: the next day.
      expect(m.shiftEnd(ev, '2026-11-07', '23:00')).toEqual({ endDay: '2026-11-08', endTime: '00:30' })
      // A new start day carries the end day along.
      expect(m.shiftEnd(ev, '2026-11-30', '09:00')).toEqual({ endDay: '2026-11-30', endTime: '10:30' })
      expect(m.shiftEnd(ev, '2026-12-31', '23:30')).toEqual({ endDay: '2027-01-01', endTime: '01:00' })
      // An event over several days stays that long.
      const long = { startDay: '2026-11-07', startTime: '20:00', endDay: '2026-11-09', endTime: '08:00' }
      expect(m.shiftEnd(long, '2026-11-10', '20:00')).toEqual({ endDay: '2026-11-12', endTime: '08:00' })
    })

    it('leaves an end it cannot read, or one before the start, alone', () => {
      const none = { startDay: '2026-11-07', startTime: '09:00', endDay: '2026-11-07', endTime: '' }
      expect(m.shiftEnd(none, '2026-11-07', '11:00')).toEqual({ endDay: '2026-11-07', endTime: '' })
      const backwards = { startDay: '2026-11-07', startTime: '09:00', endDay: '2026-11-07', endTime: '08:00' }
      expect(m.shiftEnd(backwards, '2026-11-07', '11:00')).toEqual({ endDay: '2026-11-07', endTime: '08:00' })
    })
  })
}
