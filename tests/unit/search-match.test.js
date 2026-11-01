// Search in Notes and Reader: every word, in any order, ignoring case and accents. Desktop's lists
// and the canvas use app/userland/app-stdlib/js/search-match.js; the phone keeps a copy in
// mobile/lib/search.ts. The same cases run on both, so the two can't drift apart.

import { describe, it, expect } from 'vitest'
import * as desktop from '../../app/userland/app-stdlib/js/search-match.js'
import * as phone from '../../mobile/lib/search.ts'

for (const [name, m] of [['desktop', desktop], ['phone', phone]]) {
  describe(`search (${name})`, () => {
    it('splits a search into folded words', () => {
      expect(m.queryWords('  Café   PARIS ')).toEqual(['cafe', 'paris'])
      expect(m.queryWords('')).toEqual([])
      expect(m.queryWords('   ')).toEqual([])
    })

    it('matches every word, in any order, ignoring case and accents', () => {
      expect(m.matchesQuery('Le Café de Paris', 'paris cafe')).toBe(true)
      expect(m.matchesQuery('Le Café de Paris', 'CAFÉ')).toBe(true)
      expect(m.matchesQuery('Le Café de Paris', 'cafe london')).toBe(false)
      expect(m.matchesQuery('naïve résumé', 'naive resume')).toBe(true)
    })

    it('matches anything without a search', () => {
      expect(m.matchesQuery('anything', '')).toBe(true)
      expect(m.matchesWords('anything', [])).toBe(true)
      expect(m.matchesWords(undefined, [])).toBe(true)
    })

    it('matches part of a word', () => {
      expect(m.matchesQuery('Shopping list', 'shop')).toBe(true)
    })

    it('takes text folded already', () => {
      expect(m.matchesWords('le cafe', ['cafe'], { folded: true })).toBe(true)
      expect(m.matchesWords(m.foldText('Le CAFÉ'), ['cafe'], { folded: true })).toBe(true)
    })

    it('finds where the words are, in the text’s own indexes', () => {
      expect(m.matchRanges('Le Café de Paris', ['cafe', 'paris'])).toEqual([{ start: 3, end: 7 }, { start: 11, end: 16 }])
      // Every place a word is, and overlapping ones joined.
      expect(m.matchRanges('banana', ['ana'])).toEqual([{ start: 1, end: 4 }])
      expect(m.matchRanges('banana', ['an', 'na'])).toEqual([{ start: 1, end: 6 }])
      expect(m.matchRanges('abc', [])).toEqual([])
      // An accent written as a separate mark stays inside the match.
      expect(m.matchRanges('Cafe\u0301 au lait', ['cafe'])).toEqual([{ start: 0, end: 5 }])
    })

    it('cuts text into marked pieces', () => {
      expect(m.markPieces('Le Café de Paris', ['cafe'])).toEqual([
        { text: 'Le ', match: false },
        { text: 'Café', match: true },
        { text: ' de Paris', match: false },
      ])
      expect(m.markPieces('Paris', ['paris'])).toEqual([{ text: 'Paris', match: true }])
      expect(m.markPieces('nothing here', ['zzz'])).toEqual([{ text: 'nothing here', match: false }])
      expect(m.markPieces('', ['a'])).toEqual([{ text: '', match: false }])
    })

    it('shows the line of a note that matched, not its title', () => {
      const body = '# Trip to Paris\n\nPack light.\n- [ ] Book the café near the river\n> remember the museum pass'
      expect(m.matchSnippet(body, m.queryWords('cafe'))).toBe('Book the café near the river')
      expect(m.matchSnippet(body, m.queryWords('museum'))).toBe('remember the museum pass')
      // Only the title matched: the usual snippet stays.
      expect(m.matchSnippet(body, m.queryWords('trip'))).toBe(null)
      expect(m.matchSnippet(body, [])).toBe(null)
      expect(m.matchSnippet('', ['x'])).toBe(null)
    })

    it('cuts a long line around the word', () => {
      const long = 'word '.repeat(60) + 'needle ' + 'word '.repeat(60)
      const snip = m.matchSnippet('Title\n' + long, ['needle'], 80)
      expect(snip).toContain('needle')
      expect(snip.startsWith('…')).toBe(true)
      expect(snip.endsWith('…')).toBe(true)
      expect(snip.length).toBeLessThanOrEqual(80)
    })
  })
}
