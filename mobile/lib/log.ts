// Prefix every console line on the React-Native side with [nomad] so the app's logs can be filtered
// out of the device log stream (Metro, `adb logcat`, Xcode console), which is otherwise full of
// framework noise. The Bare backend installs the same prefix on its own console (see
// backend/backend.mjs) so both halves of the app share one filterable tag.
//
// The lines are also kept in memory (the last MAX_ENTRIES) for the Logs page (Settings → Logs),
// which shows them next to the backend's.
//
// Importing this module runs the patch as a side effect; import it once, as early as possible.
import { format } from '../backend/lib/log-store.mjs'

const TAG = '[nomad]'
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const
const MAX_ENTRIES = 1000

export interface LogEntry { id: number; t: number; level: string; msg: string }

declare const globalThis: { __nomadLogPatched?: boolean } & typeof global

const entries: LogEntry[] = []
let seq = 0

if (!globalThis.__nomadLogPatched) {
  globalThis.__nomadLogPatched = true
  for (const level of LEVELS) {
    const orig = console[level]
    if (typeof orig !== 'function') continue
    const bound = orig.bind(console)
    console[level] = (...args: unknown[]) => {
      bound(TAG, ...args)
      try {
        entries.push({ id: ++seq, t: Date.now(), level, msg: format(args) })
        if (entries.length > MAX_ENTRIES) entries.shift()
      } catch {}
    }
  }
}

// The app's lines with id > since, oldest first.
export function appLogsSince (since = 0): LogEntry[] {
  return entries.filter((e) => e.id > since)
}
