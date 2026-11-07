// Tests for capability URL rules (app/bg/hyper/capability-rules.mjs): what a capability covers, the
// URL a picked item gets, what a page may see, and which records survive a restart.
import { describe, it, expect } from 'vitest'
import {
  normalizeDrivePath,
  pathCovers,
  scopeFor,
  capToken,
  capCovers,
  isScoped,
  capUrlFor,
  publicCap,
  keptPicked,
  MAX_PICKED_PER_ORIGIN,
} from '../../app/bg/hyper/capability-rules.mjs'

const KEY = 'a'.repeat(64)
const TOKEN = 'abcdefghijklmnopqrstuvwxyz'

describe('normalizeDrivePath', () => {
  it('roots, decodes and drops empty or . segments, keeping a folder slash', () => {
    expect(normalizeDrivePath('notes//./a.md')).toBe('/notes/a.md')
    expect(normalizeDrivePath('/notes/')).toBe('/notes/')
    expect(normalizeDrivePath('/a%20b.txt')).toBe('/a b.txt')
    expect(normalizeDrivePath('')).toBe('/')
  })

  it('refuses .., encoded .., backslashes, NUL and bad encoding', () => {
    expect(normalizeDrivePath('/notes/../secret')).toBe(null)
    expect(normalizeDrivePath('/notes/%2e%2e/secret')).toBe(null)
    expect(normalizeDrivePath('/notes\\secret')).toBe(null)
    expect(normalizeDrivePath('/a%00')).toBe(null)
    expect(normalizeDrivePath('/%zz')).toBe(null)
    expect(normalizeDrivePath(undefined)).toBe(null)
  })
})

describe('pathCovers', () => {
  it('a folder covers itself and everything under it, not a sibling with the same prefix', () => {
    expect(pathCovers('/photos/', '/photos')).toBe(true)
    expect(pathCovers('/photos/', '/photos/')).toBe(true)
    expect(pathCovers('/photos/', '/photos/2024/a.png')).toBe(true)
    expect(pathCovers('/photos/', '/photos-old/a.png')).toBe(false)
    expect(pathCovers('/photos/', '/')).toBe(false)
  })

  it('a file covers that file only', () => {
    expect(pathCovers('/a.png', '/a.png')).toBe(true)
    expect(pathCovers('/a.png', '/a.png.bak')).toBe(false)
    expect(pathCovers('/a.png', '/')).toBe(false)
  })

  it('/ covers the whole drive', () => {
    expect(pathCovers('/', '/anything/at/all')).toBe(true)
  })
})

describe('capCovers', () => {
  const folder = { key: KEY, path: '/notes/' }
  it('checks the request path after normalising it', () => {
    expect(capCovers(folder, '/notes/a.md')).toBe(true)
    expect(capCovers(folder, '/notes//a.md')).toBe(true)
    expect(capCovers(folder, '/notes/../index.json')).toBe(false)
    expect(capCovers(folder, '/notes%2f..%2findex.json')).toBe(false)
    expect(capCovers(folder, '/other.md')).toBe(false)
  })

  it('a whole-drive capability (a page made it, path "/") covers everything', () => {
    expect(capCovers({ key: KEY, path: '/' }, '/x/y')).toBe(true)
    expect(capCovers({ key: KEY }, '/x/y')).toBe(true)
  })

  it('no target covers nothing', () => {
    expect(capCovers(undefined, '/')).toBe(false)
  })
})

describe('scopeFor and isScoped', () => {
  it('a folder ends in /, a file does not', () => {
    expect(scopeFor('/photos', true)).toBe('/photos/')
    expect(scopeFor('/photos/', true)).toBe('/photos/')
    expect(scopeFor('/photos/a.png', false)).toBe('/photos/a.png')
    expect(scopeFor('/', true)).toBe('/')
    expect(scopeFor('/x/../y', false)).toBe(null)
  })

  it('only a path narrower than the drive is scoped', () => {
    expect(isScoped({ path: '/' })).toBe(false)
    expect(isScoped({ path: '/a.png' })).toBe(true)
    expect(isScoped({})).toBe(false)
  })
})

describe('capToken and capUrlFor', () => {
  it('finds the token in a host or URL, with or without a version', () => {
    expect(capToken(`${TOKEN}.cap`)).toBe(TOKEN)
    expect(capToken(`hyper://${TOKEN}.cap/a/b?x=1`)).toBe(TOKEN)
    expect(capToken(`hyper://${TOKEN}.cap+5/`)).toBe(TOKEN)
    expect(capToken(`hyper://${KEY}/`)).toBe(undefined)
    expect(capToken('hyper://evil.cap.example/')).toBe(undefined)
    expect(capToken(null)).toBe(undefined)
  })

  it('a picked item keeps its own path in its URL', () => {
    expect(capUrlFor(TOKEN, '/notes/a.md')).toBe(`hyper://${TOKEN}.cap/notes/a.md`)
    expect(capUrlFor(TOKEN, '/notes/')).toBe(`hyper://${TOKEN}.cap/notes/`)
    expect(capUrlFor(TOKEN, '/')).toBe(`hyper://${TOKEN}.cap/`)
  })
})

describe('publicCap', () => {
  it("never shows the drive's key", () => {
    const pub = publicCap({
      token: TOKEN,
      owningOrigin: 'https://example.com',
      target: { key: KEY, version: null, path: '/notes/a.md' },
      picked: true,
      title: 'a.md',
      createdAt: 5,
    })
    expect(pub).toEqual({
      url: `hyper://${TOKEN}.cap/notes/a.md`,
      path: '/notes/a.md',
      picked: true,
      title: 'a.md',
      createdAt: 5,
    })
    expect(JSON.stringify(pub)).not.toContain(KEY)
  })
})

describe('keptPicked', () => {
  const good = (over = {}) => ({
    token: TOKEN,
    owningOrigin: 'https://example.com',
    target: { key: KEY, path: '/notes/a.md' },
    title: 'a.md',
    createdAt: 1,
    ...over,
  })

  it('keeps well-formed records as picked, latest version', () => {
    const [r] = keptPicked([good({ target: { key: KEY.toUpperCase(), path: '/notes/a.md', version: '9' } })])
    expect(r.picked).toBe(true)
    expect(r.target).toEqual({ key: KEY, version: null, path: '/notes/a.md' })
  })

  it('drops bad tokens, keys, origins and paths that are not normalised', () => {
    expect(keptPicked([good({ token: 'short' })])).toEqual([])
    expect(keptPicked([good({ token: 'UPPER'.repeat(4) })])).toEqual([])
    expect(keptPicked([good({ target: { key: 'private', path: '/a' } })])).toEqual([])
    expect(keptPicked([good({ owningOrigin: '' })])).toEqual([])
    expect(keptPicked([good({ target: { key: KEY, path: '/a/../b' } })])).toEqual([])
    expect(keptPicked([good({ target: { key: KEY, path: 'notes' } })])).toEqual([])
    expect(keptPicked('nope')).toEqual([])
    expect(keptPicked([null, 3])).toEqual([])
  })

  it('keeps the newest MAX_PICKED_PER_ORIGIN per site', () => {
    const many = Array.from({ length: MAX_PICKED_PER_ORIGIN + 3 }, (_, i) =>
      good({ token: TOKEN + i, createdAt: i })
    )
    const other = good({ token: TOKEN + 'z', owningOrigin: 'https://other.example', createdAt: 0 })
    const kept = keptPicked([...many, other])
    const mine = kept.filter((r) => r.owningOrigin === 'https://example.com')
    expect(mine).toHaveLength(MAX_PICKED_PER_ORIGIN)
    expect(mine.some((r) => r.createdAt < 3)).toBe(false)
    expect(kept.some((r) => r.owningOrigin === 'https://other.example')).toBe(true)
  })
})
