// Prefix every console line on the React-Native side with [nomad] so the app's logs can be filtered
// out of the device log stream (Metro, `adb logcat`, Xcode console), which is otherwise full of
// framework noise. The Bare backend installs the same prefix on its own console (see
// backend/backend.mjs) so both halves of the app share one filterable tag.
//
// Importing this module runs the patch as a side effect; import it once, as early as possible.
const TAG = '[nomad]'
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const

declare const globalThis: { __nomadLogPatched?: boolean } & typeof global

if (!globalThis.__nomadLogPatched) {
  globalThis.__nomadLogPatched = true
  for (const level of LEVELS) {
    const orig = console[level]
    if (typeof orig !== 'function') continue
    const bound = orig.bind(console)
    console[level] = (...args: unknown[]) => bound(TAG, ...args)
  }
}

export {}
