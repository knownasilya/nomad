// The phone's stacked navigation (mobile/lib/navStack.ts): screens open on top of each other, and a
// tab's history holds every page you were on, so back always returns to where you came from.

import { describe, it, expect } from 'vitest'
import { pushScreen, closeScreen, sameUrl, loadEntry, pageLoaded, planStep } from '../../mobile/lib/navStack.ts'

const blank = () => ({ stack: [{ kind: 'home', session: 0 }], sp: 0, session: 0, settled: true, pendingStep: false })
const web = (url, extra = {}) => ({ kind: 'web', url, ...extra })
const urls = (h) => h.stack.map((e) => e.url || 'home')

describe('screens', () => {
  it('opens a screen over the ones already open', () => {
    expect(pushScreen([{ name: 'settings' }], { name: 'logs' })).toEqual([{ name: 'settings' }, { name: 'logs' }])
  })

  it('brings an open screen back to the top with its new params', () => {
    const stack = [{ name: 'library' }, { name: 'notes' }, { name: 'devices' }]
    expect(pushScreen(stack, { name: 'notes', noteId: 'n1' })).toEqual([{ name: 'library' }, { name: 'notes', noteId: 'n1' }])
  })

  it('closes a screen and the ones above it, and nothing else', () => {
    const stack = [{ name: 'settings' }, { name: 'hosting' }]
    expect(closeScreen(stack, 'hosting')).toEqual([{ name: 'settings' }])
    expect(closeScreen(stack, 'settings')).toEqual([])
    expect(closeScreen(stack, 'library')).toBe(stack)
  })
})

describe('sameUrl', () => {
  it('ignores a trailing slash after the host and an empty fragment', () => {
    expect(sameUrl('https://a.com', 'https://a.com/')).toBe(true)
    expect(sameUrl('https://a.com/x#', 'https://a.com/x')).toBe(true)
    expect(sameUrl('hyper://abc/', 'hyper://abc')).toBe(true)
    expect(sameUrl('https://a.com/x', 'https://a.com/x/')).toBe(false)
    expect(sameUrl('https://a.com/x', 'https://a.com/y')).toBe(false)
  })
})

describe('a tab history', () => {
  it('gives a link followed in the page its own entry', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    expect(urls(h)).toEqual(['home', 'https://a.com/', 'https://a.com/b'])
    expect(h.sp).toBe(2)
    expect(h.stack[2].session).toBe(1)
  })

  it('back from a typed address lands on the page you left, not the one the WebView first loaded', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    h = loadEntry(h, web('https://c.com/'), true, 2)
    const plan = planStep(h, -1, false)
    expect(plan).toEqual({ type: 'load', sp: 2 })
    expect(h.stack[plan.sp].url).toBe('https://a.com/b')
  })

  it('steps inside the WebView between its own pages', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    expect(planStep(h, -1, true)).toEqual({ type: 'native', sp: 1 })
    // The WebView can't go back (it was recreated): load the entry instead.
    expect(planStep(h, -1, false)).toEqual({ type: 'load', sp: 1 })
  })

  it('loads fresh across a session the WebView on screen did not make', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    h = loadEntry(h, web('https://c.com/'), true, 2)
    h = loadEntry(h, h.stack[2], false, 3, 2) // back to /b, loaded fresh
    h = pageLoaded(h, 'https://a.com/b')
    // The WebView's own history is only /b now, whatever it reports, so /a loads fresh.
    expect(planStep(h, -1, true)).toEqual({ type: 'load', sp: 1 })
    expect(planStep(h, 1, true)).toEqual({ type: 'load', sp: 3 })
  })

  it('lets a redirect on the first load replace the entry', () => {
    let h = loadEntry(blank(), web('http://a.com/'), true, 1)
    h = pageLoaded(h, 'https://www.a.com/')
    expect(urls(h)).toEqual(['home', 'https://www.a.com/'])
    expect(h.settled).toBe(true)
  })

  it('ignores the same page loading again', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    expect(pageLoaded(h, 'https://a.com')).toBe(null)
  })

  it('updates the entry the WebView lands on after a back it was asked for', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    h = { ...h, sp: 1, pendingStep: true }
    h = pageLoaded(h, 'https://a.com/?from=b')
    expect(urls(h)).toEqual(['home', 'https://a.com/?from=b', 'https://a.com/b'])
    expect(h.sp).toBe(1)
    expect(h.pendingStep).toBe(false)
  })

  it('follows the WebView when the page goes back or forward by itself', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    // history.back() in the page: the WebView can now go forward, so it's a step, not a new entry.
    h = pageLoaded(h, 'https://a.com/', { canGoBack: false, canGoForward: true })
    expect(urls(h)).toEqual(['home', 'https://a.com/', 'https://a.com/b'])
    expect(h.sp).toBe(1)
    h = pageLoaded(h, 'https://a.com/b', { canGoBack: true, canGoForward: false })
    expect(h.sp).toBe(2)
    // A link to the page you came from is a new entry.
    h = pageLoaded(h, 'https://a.com/', { canGoBack: true, canGoForward: false })
    expect(urls(h)).toEqual(['home', 'https://a.com/', 'https://a.com/b', 'https://a.com/'])
  })

  it('drops the forward entries when a link is followed after going back', () => {
    let h = loadEntry(blank(), web('https://a.com/'), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    h = pageLoaded({ ...h, sp: 1, pendingStep: true }, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/c')
    expect(urls(h)).toEqual(['home', 'https://a.com/', 'https://a.com/c'])
  })

  it('keeps a drive page in its drive', () => {
    let h = loadEntry(blank(), { kind: 'hyper', url: 'hyper://abc/', driveType: 'autobase', ns: 'n' }, true, 1)
    h = pageLoaded(h, 'hyper://abc/')
    h = pageLoaded(h, 'hyper://abc/posts/')
    expect(h.stack[2]).toEqual({ kind: 'hyper', url: 'hyper://abc/posts/', driveType: 'autobase', ns: 'n', detect: false, session: 1 })
  })

  it('reopens the screens a page was opened from when back leaves it', () => {
    const returnTo = [{ name: 'library' }]
    let h = loadEntry(blank(), web('https://a.com/', { returnTo }), true, 1)
    h = pageLoaded(h, 'https://a.com/')
    h = pageLoaded(h, 'https://a.com/b')
    // Back inside the page stays in the page; back from the page itself reopens My Library.
    expect(planStep(h, -1, true)).toEqual({ type: 'native', sp: 1 })
    expect(planStep({ ...h, sp: 1 }, -1, true)).toEqual({ type: 'load', sp: 0, returnTo })
    // Forward never opens a screen.
    expect(planStep({ ...h, sp: 0 }, 1, false)).toEqual({ type: 'load', sp: 1 })
  })

  it('has nowhere to go past either end', () => {
    expect(planStep(blank(), -1, true)).toEqual({ type: 'none' })
    expect(planStep(blank(), 1, true)).toEqual({ type: 'none' })
  })
})
