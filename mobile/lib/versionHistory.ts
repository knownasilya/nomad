// How the phone's Version history screen (components/VersionHistory.tsx) words a drive's changes:
// rows grouped by day, times on a 12-hour clock, and what a whole-drive restore would do. The same
// words as desktop's nomad://versions (app/userland/versions/js/main.js). Tests:
// tests/unit/mobile-version-history.test.js.

import { formatTime } from './timeOfDay'

export interface Change { kind: 'added' | 'changed' | 'deleted'; at: number | null; approx?: boolean }

export const KIND_LABEL: Record<Change['kind'], string> = { added: 'Added', changed: 'Changed', deleted: 'Deleted' }

const pad = (n: number) => String(n).padStart(2, '0')
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "Today", "Yesterday", "Thursday, November 12", or with the year when it isn't this one.
export function dayLabel (ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const n = new Date(now)
  const diff = Math.round((startOfDay(n) - startOfDay(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const base = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === n.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

// "3:41 PM"
export function clockOf (ms: number): string {
  const d = new Date(ms)
  return formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
}

// "today at 3:41 PM", "Thursday, November 12 at about 9:05 AM"
export function whenOf (ms: number, approx = false, now = Date.now()): string {
  const day = dayLabel(ms, now).replace(/^Today$/, 'today').replace(/^Yesterday$/, 'yesterday')
  return `${day} at ${approx ? 'about ' : ''}${clockOf(ms)}`
}

// The rows by day, newest first. A row with no time (a delete with nothing near it) joins the day
// above it, or "Earlier" at the top.
export function groupByDay<R extends Change> (rows: R[], now = Date.now()): { day: string; rows: R[] }[] {
  const out: { day: string; rows: R[] }[] = []
  let last = 'Earlier'
  for (const row of rows) {
    const day = row.at ? dayLabel(row.at, now) : last
    last = day
    const group = out[out.length - 1]
    if (group && group.day === day) group.rows.push(row)
    else out.push({ day, rows: [row] })
  }
  return out
}

// "Changed · 3:41 PM · 2 KB"
export function rowMeta (row: Change & { size: number }, formatBytes: (n: number) => string): string {
  return [
    KIND_LABEL[row.kind] || 'Changed',
    row.at ? `${row.approx ? 'about ' : ''}${clockOf(row.at)}` : 'time unknown',
    row.kind !== 'deleted' ? formatBytes(row.size) : ''
  ].filter(Boolean).join(' · ')
}

// What a whole-drive restore does, in a sentence per kind of change.
export function restoreCounts (sum: { changed: number; back: number; removed: number }): string[] {
  return [
    sum.changed ? (sum.changed === 1 ? '1 file goes back to an older version' : `${sum.changed} files go back to an older version`) : '',
    sum.back ? (sum.back === 1 ? '1 deleted file comes back' : `${sum.back} deleted files come back`) : '',
    sum.removed ? (sum.removed === 1 ? '1 newer file is removed' : `${sum.removed} newer files are removed`) : ''
  ].filter(Boolean)
}
