// Tests for the private-drive gate (app/bg/web-apis/bg/private-drive-guard.ts).
//
// The Root Drive of every Space (`hyper://private/`) holds the user's address book, AI chat sessions
// and drive list. A page must not get in by default. The only way in is a grant the user approves for
// one file or one folder, for read or write, that ends after a set time. These tests lock that down.
//
// beaker-error-constants lives in app/node_modules, so denial is asserted by error name, as in
// fs-write-guard.test.js.
import { describe, it, expect } from 'vitest'
import {
  createPrivateDriveGuard,
  normalizePrivatePath,
  PRIVATE_GRANT_TTL_MS,
} from '../../app/bg/web-apis/bg/private-drive-guard.js'

const ROOT = 'a'.repeat(64) // the current Space's Root Drive
const OTHER_ROOT = 'c'.repeat(64) // another Space's Root Drive
const PUBLIC = 'b'.repeat(64) // an ordinary drive
const APP = 'hyper://' + 'd'.repeat(64)
const OTHER_APP = 'hyper://' + 'e'.repeat(64)

function build({ answer = true, ttlMs } = {}) {
  const state = { time: 1_000, trusted: false, servedFrom: null, requests: [], answer }
  const guard = createPrivateDriveGuard({
    isWcTrusted: () => state.trusted,
    isRootKey: (key) => key === ROOT || key === OTHER_ROOT,
    senderDriveKey: async () => state.servedFrom,
    senderOrigin: (sender) => sender.origin,
    requestPermission: async (permId, sender, opts) => {
      state.requests.push({ permId, opts })
      return state.answer
    },
    now: () => state.time,
    ttlMs,
  })
  const ctx = (origin = APP) => ({ sender: { origin } })
  return { guard, state, ctx }
}

describe('private-drive guard: closed by default', () => {
  it('denies a read and asks for that one file', async () => {
    const { guard, state, ctx } = build({ answer: false })
    await expect(guard.assert(ctx(), ROOT, '/address-book.json', 'read')).rejects.toMatchObject({
      name: 'UserDeniedError',
    })
    expect(state.requests).toEqual([
      { permId: 'privateRead:/address-book.json', opts: { path: '/address-book.json', minutes: 60 } },
    ])
  })

  it('check() never prompts', async () => {
    const { guard, state, ctx } = build()
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(false)
    expect(state.requests).toEqual([])
  })

  it('covers the Root Drive of every Space, not only the current one', async () => {
    const { guard, ctx } = build()
    expect(await guard.check(ctx(), OTHER_ROOT, '/address-book.json', 'read')).toBe(false)
  })

  it('never opens the whole drive: root reads, lists and writes throw with no prompt', async () => {
    const { guard, state, ctx } = build()
    for (const [path, access] of [
      ['/', 'read'],
      ['', 'read'],
      ['/', 'write'],
      ['/./', 'read'],
    ]) {
      await expect(guard.assert(ctx(), ROOT, path, access)).rejects.toMatchObject({
        name: 'PermissionsError',
      })
    }
    expect(state.requests).toEqual([])
  })

  it('never grants a drive-wide call (getInfo, watch, fork, writers, Draft Mode)', async () => {
    const { guard, state, ctx } = build()
    await expect(guard.assert(ctx(), ROOT, '/notes/a.md', 'drive')).rejects.toMatchObject({
      name: 'PermissionsError',
    })
    expect(state.requests).toEqual([])
  })

  it('refuses ".." and other tricks without a prompt', async () => {
    const { guard, state, ctx } = build()
    for (const path of [
      '/notes/../drives.json',
      '/notes/%2e%2e/drives.json',
      '/notes\\..\\drives.json',
      '/notes/%E0%A4%A',
      '/notes/\0',
    ]) {
      await expect(guard.assert(ctx(), ROOT, path, 'read')).rejects.toMatchObject({
        name: 'PermissionsError',
      })
    }
    expect(state.requests).toEqual([])
  })

  it('refuses a sender with no origin', async () => {
    const { guard, state } = build()
    await expect(
      guard.assert({ sender: { origin: null } }, ROOT, '/a.json', 'read')
    ).rejects.toMatchObject({ name: 'PermissionsError' })
    expect(state.requests).toEqual([])
  })
})

describe('private-drive guard: who gets in freely', () => {
  it('a trusted nomad:// UI', async () => {
    const { guard, state, ctx } = build()
    state.trusted = true
    await guard.assert(ctx('nomad://library'), ROOT, '/', 'drive')
    expect(state.requests).toEqual([])
  })

  it('a page served from that same private drive', async () => {
    const { guard, state, ctx } = build()
    state.servedFrom = ROOT
    await guard.assert(ctx('hyper://private'), ROOT, '/', 'drive')
    expect(state.requests).toEqual([])
  })

  it('but not a page served from another Space\'s private drive', async () => {
    const { guard, state, ctx } = build()
    state.servedFrom = OTHER_ROOT
    expect(await guard.check(ctx(), ROOT, '/a.json', 'read')).toBe(false)
  })

  it('an internal call with no sender', async () => {
    const { guard, state } = build()
    await guard.assert({}, ROOT, '/', 'drive')
    await guard.assert(undefined, ROOT, '/', 'drive')
    expect(state.requests).toEqual([])
  })

  it('any page, for a drive that is not private', async () => {
    const { guard, state, ctx } = build()
    await guard.assert(ctx(), PUBLIC, '/', 'drive')
    expect(state.requests).toEqual([])
  })
})

describe('private-drive guard: a grant is one path', () => {
  it('a file grant allows that file and nothing else', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(true)
    expect(await guard.check(ctx(), ROOT, '/address-book.json.bak', 'read')).toBe(false)
    expect(await guard.check(ctx(), ROOT, '/address-book.json/x', 'read')).toBe(false)
    expect(await guard.check(ctx(), ROOT, '/drives.json', 'read')).toBe(false)
    expect(await guard.check(ctx(), ROOT, '/', 'read')).toBe(false)
  })

  it('a folder grant allows the folder and everything below it', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/notes/', 'read')
    expect(await guard.check(ctx(), ROOT, '/notes', 'read')).toBe(true)
    expect(await guard.check(ctx(), ROOT, '/notes/', 'read')).toBe(true)
    expect(await guard.check(ctx(), ROOT, '/notes/a/b.md', 'read')).toBe(true)
    expect(await guard.check(ctx(), ROOT, '/notes-old/a.md', 'read')).toBe(false)
    expect(await guard.check(ctx(), ROOT, '/notes/../drives.json', 'read')).toBe(false)
  })

  it('a grant does not cover the root, even for a folder grant', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/notes/', 'read')
    expect(await guard.check(ctx(), ROOT, '/', 'read')).toBe(false)
  })

  it('a read grant does not allow a write', async () => {
    const { guard, state, ctx } = build()
    await guard.assert(ctx(), ROOT, '/notes/', 'read')
    expect(await guard.check(ctx(), ROOT, '/notes/a.md', 'write')).toBe(false)
    await guard.assert(ctx(), ROOT, '/notes/a.md', 'write')
    expect(state.requests.map((r) => r.permId)).toEqual([
      'privateRead:/notes/',
      'privateWrite:/notes/a.md',
    ])
  })

  it('a write grant also allows a read', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/notes/a.md', 'write')
    expect(await guard.check(ctx(), ROOT, '/notes/a.md', 'read')).toBe(true)
  })

  it('a grant belongs to one site', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(APP), ROOT, '/address-book.json', 'read')
    expect(await guard.check(ctx(OTHER_APP), ROOT, '/address-book.json', 'read')).toBe(false)
  })

  it('a grant belongs to one Space\'s drive', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(await guard.check(ctx(), OTHER_ROOT, '/address-book.json', 'read')).toBe(false)
  })

  it('a granted path never opens a drive-wide call', async () => {
    const { guard, ctx } = build()
    await guard.assert(ctx(), ROOT, '/notes/', 'write')
    expect(await guard.check(ctx(), ROOT, '/notes/', 'drive')).toBe(false)
  })

  it('a grant asks once, then not again', async () => {
    const { guard, state, ctx } = build()
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(state.requests).toHaveLength(1)
    expect(guard.list()).toHaveLength(1)
  })

  it('normalises the path it grants', async () => {
    const { guard, state, ctx } = build()
    await guard.assert(ctx(), ROOT, '//notes/./a.md', 'read')
    expect(state.requests[0].permId).toBe('privateRead:/notes/a.md')
    expect(await guard.check(ctx(), ROOT, '/notes/a.md', 'read')).toBe(true)
  })
})

describe('private-drive guard: a grant ends', () => {
  it('lasts one hour by default', () => {
    expect(PRIVATE_GRANT_TTL_MS).toBe(60 * 60 * 1000)
  })

  it('ends at its expiry time, then asks again', async () => {
    const { guard, state, ctx } = build({ ttlMs: 10_000 })
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(state.requests[0].opts.minutes).toBe(0)

    state.time += 9_999
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(true)

    state.time += 1
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(false)
    expect(guard.list()).toEqual([])

    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(state.requests).toHaveLength(2)
  })

  it('a new grant for the same path starts a new period', async () => {
    const { guard, state, ctx } = build({ ttlMs: 10_000 })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    state.time += 10_000
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    expect(guard.list()).toEqual([
      { origin: APP, rootKey: ROOT, path: '/a.json', access: 'read', expiresAt: state.time + 10_000 },
    ])
  })
})

describe('normalizePrivatePath', () => {
  it.each([
    ['/a.json', '/a.json'],
    ['a.json', '/a.json'],
    ['//a//b.json', '/a/b.json'],
    ['/a/./b/', '/a/b/'],
    ['/', '/'],
    ['', '/'],
    ['/%20x.md', '/ x.md'],
  ])('%j → %j', (input, out) => {
    expect(normalizePrivatePath(input)).toBe(out)
  })

  it.each([['/a/../b'], ['/%2e%2e/b'], ['/a\\b'], ['/%E0%A4%A'], [null], [undefined], [42]])(
    'rejects %j',
    (input) => {
      expect(normalizePrivatePath(input)).toBe(null)
    }
  )
})
