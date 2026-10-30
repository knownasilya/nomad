// Back goes where you came from. The phone keeps two stacks, and both follow the same rule.
//
// Screens (My Library, Settings, Logs, …) open on top of each other: opening Logs from Settings
// leaves Settings under it, so back from Logs lands in Settings, not in the browser.
//
// A tab's history is one list of pages. A link followed inside a page's WebView adds its own entry,
// the same as a typed address, so back from a typed address lands on the page you left, not on the
// page the WebView first loaded. Entries one WebView reached by following links share a `session`;
// stepping between two of them asks that WebView to go back or forward (its page state and scroll
// survive), and any other step loads the entry fresh. A page opened from a screen remembers the
// screens (`returnTo`), so back from it opens them again: My Library → a bookmark → back is My
// Library.

import type { DriveType } from './hyperUrl'

// One entry in a tab's back/forward history.
export type NavEntry<S = unknown> =
  | { kind: 'home'; session?: number; returnTo?: S[] }
  | { kind: 'web'; url: string; session?: number; returnTo?: S[] }
  | { kind: 'hyper'; url: string; driveType: DriveType; ns?: string; detect?: boolean; session?: number; returnTo?: S[] }

export interface TabHistory<S = unknown> {
  stack: NavEntry<S>[]
  sp: number // the entry on screen
  session: number // the WebView session on screen, set each time the app loads an entry
  settled: boolean // the entry the app loaded has finished its first load
  pendingStep: boolean // the WebView was asked to go back or forward and hasn't landed yet
}

// --- screens -------------------------------------------------------------

// Open a screen on top. A screen that is already open comes back to the top by closing the ones
// above it (it takes the new params), so a screen is never in the stack twice.
export function pushScreen<S extends { name: string }> (stack: S[], screen: S): S[] {
  const i = stack.findIndex((s) => s.name === screen.name)
  if (i === -1) return [...stack, screen]
  return [...stack.slice(0, i), screen]
}

// Close a screen and every screen above it. Closing one that isn't open changes nothing.
export function closeScreen<S extends { name: string }> (stack: S[], name: string): S[] {
  const i = stack.findIndex((s) => s.name === name)
  return i === -1 ? stack : stack.slice(0, i)
}

// --- a tab's history -----------------------------------------------------

// Two addresses for the same page: ignore a trailing slash after the host and an empty fragment.
export function sameUrl (a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#$/, '').replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)\/?(?=[?#]|$)/i, '$1/')
  return norm(a) === norm(b)
}

// The app loads `entry` into the tab: pushed as a new entry, or (sp given) stepped to. The entry
// starts a new WebView session.
export function loadEntry<S> (h: TabHistory<S>, entry: NavEntry<S>, push: boolean, session: number, sp?: number): TabHistory<S> {
  if (push) {
    const stack = [...h.stack.slice(0, h.sp + 1), { ...entry, session }]
    return { stack, sp: stack.length - 1, session, settled: false, pendingStep: false }
  }
  const at = sp ?? h.sp
  const stack = h.stack.map((e, i) => (i === at ? { ...e, session } : e))
  return { stack, sp: at, session, settled: false, pendingStep: false }
}

// What the WebView says about its own history as it lands.
export interface WebHistory { canGoBack: boolean; canGoForward: boolean }

// The tab's WebView finished loading `url`. Returns the new history, or null when nothing changes.
// - after a back/forward the WebView was asked for: that entry now holds where it landed
// - the same page again (a reload, a title change): nothing
// - the WebView went back or forward by itself (the page called history.back(), an iOS swipe) to
//   the entry next to this one: the tab moves there
// - the first load of an entry the app loaded: a redirect, so the entry takes the final address
// - anything else is a link followed in the page, which gets its own entry
export function pageLoaded<S> (h: TabHistory<S>, url: string, web?: WebHistory): TabHistory<S> | null {
  const cur = h.stack[h.sp]
  if (!cur || cur.kind === 'home') return null
  const own = (e: NavEntry<S> | undefined) => !!e && e.kind !== 'home' && e.session === h.session && sameUrl(e.url, url)
  const replace = (): TabHistory<S> => ({
    ...h,
    stack: h.stack.map((e, i) => (i === h.sp ? { ...cur, url } : e)),
    settled: true,
    pendingStep: false
  })
  if (h.pendingStep) return replace()
  if (sameUrl(cur.url, url)) return h.settled ? null : { ...h, settled: true }
  if (h.settled && cur.session === h.session) {
    if (web?.canGoForward && own(h.stack[h.sp - 1])) return { ...h, sp: h.sp - 1 }
    if (web?.canGoBack && own(h.stack[h.sp + 1])) return { ...h, sp: h.sp + 1 }
  }
  if (!h.settled) return replace()
  const next: NavEntry<S> = cur.kind === 'hyper'
    ? { kind: 'hyper', url, driveType: cur.driveType, ns: cur.ns, detect: false, session: h.session }
    : { kind: 'web', url, session: h.session }
  const stack = [...h.stack.slice(0, h.sp + 1), next]
  return { ...h, stack, sp: stack.length - 1, settled: true }
}

export type StepPlan<S> =
  | { type: 'none' }
  // Ask the WebView on screen to go back or forward; the tab moves to `sp` once it lands.
  | { type: 'native'; sp: number; returnTo?: S[] }
  // Load the entry at `sp` fresh.
  | { type: 'load'; sp: number; returnTo?: S[] }

// Where back (delta -1) or forward (+1) goes. `webCan` is whether the WebView on screen can go that
// way itself. Back from an entry opened from a screen also reopens that screen (`returnTo`).
export function planStep<S> (h: TabHistory<S>, delta: -1 | 1, webCan: boolean): StepPlan<S> {
  const to = h.sp + delta
  const cur = h.stack[h.sp]
  const target = h.stack[to]
  if (!cur || !target) return { type: 'none' }
  const returnTo = delta < 0 && cur.returnTo?.length ? cur.returnTo : undefined
  const sameSession = webCan && cur.session != null && cur.session === h.session && target.session === h.session
  return { type: sameSession ? 'native' : 'load', sp: to, ...(returnTo ? { returnTo } : {}) }
}
