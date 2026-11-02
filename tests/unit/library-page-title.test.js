// My Library's tab title (app/userland/library/js/lib/page-title.js): every page in the sidebar
// names itself in the tab, and a page with one item open names that item first.

import { describe, it, expect } from 'vitest'
import { PAGES, DEFAULT_PAGE, pageTitle, setItemTitle, ITEM_TITLE_EVENT } from '../../app/userland/library/js/lib/page-title.js'

describe('My Library tab title', () => {
  it('names every page', () => {
    for (const [id, label] of PAGES) expect(pageTitle(id)).toBe(`${label} · My Library`)
    expect(pageTitle('jobs')).toBe('Jobs · My Library')
    expect(PAGES.some(([id]) => id === DEFAULT_PAGE)).toBe(true)
  })

  it('has one entry per page', () => {
    const ids = PAGES.map(([id]) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PAGES) expect(p[1]).toBeTruthy()
  })

  it('puts the open item first', () => {
    expect(pageTitle('jobs', 'Morning digest')).toBe('Morning digest · Jobs · My Library')
    expect(pageTitle('mods', '  example.com\n')).toBe('example.com · Mods · My Library')
  })

  it('falls back to My Library for an unknown page', () => {
    expect(pageTitle('nope')).toBe('My Library')
    expect(pageTitle('')).toBe('My Library')
  })

  it('sends the item only when it changes', () => {
    const sent = []
    const el = new EventTarget()
    el.addEventListener(ITEM_TITLE_EVENT, (e) => sent.push(e.detail))
    setItemTitle(el, 'A')
    setItemTitle(el, 'A')
    setItemTitle(el, '')
    setItemTitle(el, undefined)
    setItemTitle(el, 'B')
    expect(sent).toEqual(['A', '', 'B'])
  })
})
