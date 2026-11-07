// Times of day for the calendar's time pickers: the phone's copy of
// app/userland/app-stdlib/js/time-of-day.js (its bundle can't reach app/).
// tests/unit/time-of-day.test.js runs the same cases on both, so change them together.

const pad = (n: number) => String(n).padStart(2, '0')
const DAY = 24 * 60

export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

// Minutes since midnight, or NaN.
export function minutesOf (t: string): number {
  return isTime(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : NaN
}

// "HH:MM" from minutes since midnight, wrapped into one day.
export function timeFrom (min: number): string {
  const m = ((Math.round(min) % DAY) + DAY) % DAY
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// What the person typed, as "HH:MM", or null: "9" → 09:00, "930" / "9:30" / "9.30" → 09:30,
// "1830" → 18:30, "3pm" / "3:30 pm" / "3:30p" → 15:00 / 15:30, "12am" → 00:00, "noon", "midnight".
export function parseTime (text: unknown): string | null {
  const s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, ':')
  if (!s) return null
  if (s === 'noon' || s === 'midday') return '12:00'
  if (s === 'midnight') return '00:00'
  const m = /^(\d{1,2})(?::?(\d{2}))?(a|p|am|pm)?$/.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3] ? m[3][0] : ''
  if (min > 59) return null
  if (ampm) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ampm === 'p' ? 12 : 0)
  } else if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}

// "30 min", "1 h", "1.5 h", "1 h 45 min".
export function durationLabel (min: number): string {
  if (!(min >= 0)) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  if (!rest) return `${h} h`
  if (rest === 30) return `${h}.5 h`
  return `${h} h ${rest} min`
}

// The times a picker lists, every `step` minutes from midnight.
export interface TimeOption { value: string; label: string }

export function timeOptions (step = 15): TimeOption[] {
  const out: TimeOption[] = []
  for (let m = 0; m < DAY; m += step) out.push({ value: timeFrom(m), label: timeFrom(m) })
  return out
}

// The times an end-time picker lists on the start's day: every `step` minutes after the start,
// up to 23:45, each with how long the event would be ("10:30 (1.5 h)"). On a later day, every time.
export function endOptions (start: string, sameDay = true, step = 15): TimeOption[] {
  const s = minutesOf(start)
  if (!sameDay || Number.isNaN(s)) return timeOptions(step)
  const out: TimeOption[] = []
  for (let m = Math.floor(s / step) * step + step; m < DAY; m += step) {
    out.push({ value: timeFrom(m), label: `${timeFrom(m)} (${durationLabel(m - s)})` })
  }
  return out.length ? out : timeOptions(step)
}

// Days as UTC dates, so adding one never meets a clock change.
function addDays (day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function daysBetween (a: string, b: string): number {
  const ms = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))
  return Math.round((ms(b) - ms(a)) / 864e5)
}

// When the start moves, the end moves with it and the event keeps its length (as in most
// calendars). `from` is the event before the change ({ startDay, startTime, endDay, endTime });
// returns the new { endDay, endTime }. An end before the start (or none) is left as it was.
export interface EventTimes { startDay: string; startTime: string; endDay: string; endTime: string }

export function shiftEnd (from: EventTimes, startDay: string, startTime: string): { endDay: string; endTime: string } {
  const { endDay, endTime } = from
  const oldStart = minutesOf(from.startTime)
  const oldEnd = minutesOf(endTime)
  const newStart = minutesOf(startTime)
  if (!endDay || [oldStart, oldEnd, newStart].some(Number.isNaN)) return { endDay, endTime }
  const length = daysBetween(from.startDay, endDay) * DAY + oldEnd - oldStart
  if (length < 0) return { endDay, endTime }
  const end = newStart + length
  return { endDay: addDays(startDay, Math.floor(end / DAY)), endTime: timeFrom(end) }
}
