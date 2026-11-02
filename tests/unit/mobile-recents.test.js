// The phone home page's Recent list (mobile/lib/recents.ts): pages from one site back to back show
// as one row, the newest.

import { describe, it, expect } from 'vitest'
import { collapseRecents, recentSite } from '../../mobile/lib/recents.ts'

const urls = (list) => collapseRecents(list.map((url) => ({ url }))).map((h) => h.url)

describe('collapseRecents', () => {
  it('keeps only the newest page of a run from one site', () => {
    expect(urls([
      'https://example.com/c',
      'https://example.com/b',
      'https://example.com/a',
      'https://other.org/'
    ])).toEqual(['https://example.com/c', 'https://other.org/'])
  })

  it('keeps the same site apart when another site came between', () => {
    expect(urls([
      'https://example.com/b',
      'https://other.org/',
      'https://example.com/a'
    ])).toEqual(['https://example.com/b', 'https://other.org/', 'https://example.com/a'])
  })

  it('treats www, case and ports as the same site, and subdomains as different ones', () => {
    expect(urls(['https://www.Example.com/b', 'https://example.com:443/a'])).toEqual(['https://www.Example.com/b'])
    expect(urls(['https://docs.google.com/', 'https://mail.google.com/'])).toEqual(['https://docs.google.com/', 'https://mail.google.com/'])
  })

  it('folds pages of one hyper:// drive, not two drives', () => {
    const a = 'hyper://' + 'a'.repeat(64)
    const b = 'hyper://' + 'b'.repeat(64)
    expect(urls([a + '/x', a + '/', b + '/'])).toEqual([a + '/x', b + '/'])
  })

  it('never folds entries without a host', () => {
    expect(urls(['about:blank', 'about:blank'])).toEqual(['about:blank', 'about:blank'])
  })

  it('counts http and https of one host as one site', () => {
    expect(recentSite('http://example.com/')).toBe(recentSite('https://example.com/a'))
    expect(recentSite('hyper://example.com/')).not.toBe(recentSite('https://example.com/'))
  })
})
