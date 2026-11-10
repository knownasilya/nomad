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
  liveGrants,
  normalizePrivatePath,
  PRIVATE_GRANT_TTL_MS,
} from '../../app/bg/web-apis/bg/private-drive-guard.js'
import {
  PRIVATE_GRANT_DURATIONS,
  PRIVATE_GRANT_MINUTES,
  durationLabel,
  grantedMinutes,
} from '../../app/lib/private-grant-durations.mjs'

const ROOT = 'a'.repeat(64) // the current Space's Root Drive
const OTHER_ROOT = 'c'.repeat(64) // another Space's Root Drive
const PUBLIC = 'b'.repeat(64) // an ordinary drive
const APP = 'hyper://' + 'd'.repeat(64)
const OTHER_APP = 'hyper://' + 'e'.repeat(64)

function build({ answer = true, ttlMs, store } = {}) {
  const state = { time: 1_000, trusted: false, servedFrom: null, requests: [], answer, ids: 0 }
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
    store,
    newId: () => `g${++state.ids}`,
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
      {
        permId: 'privateRead:/address-book.json',
        opts: { path: '/address-book.json', minutes: 60, durations: PRIVATE_GRANT_MINUTES },
      },
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
    expect(await guard.list()).toHaveLength(1)
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
    expect(await guard.list()).toEqual([])

    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    expect(state.requests).toHaveLength(2)
  })

  it('a new grant for the same path starts a new period', async () => {
    const { guard, state, ctx } = build({ ttlMs: 10_000 })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    state.time += 10_000
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    expect(await guard.list()).toEqual([
      {
        id: 'g2',
        origin: APP,
        rootKey: ROOT,
        path: '/a.json',
        access: 'read',
        grantedAt: state.time,
        expiresAt: state.time + 10_000,
      },
    ])
  })
})

describe('private-drive guard: the user picks how long', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('offers 1 hour, 1 day, 1 week, 1 month and 3 months', () => {
    expect(PRIVATE_GRANT_DURATIONS.map((d) => d.label)).toEqual([
      '1 hour',
      '1 day',
      '1 week',
      '1 month',
      '3 months',
    ])
    expect(PRIVATE_GRANT_MINUTES).toEqual([60, 1440, 10080, 43200, 129600])
  })

  it('a grant lasts the length the prompt answers', async () => {
    const { guard, state, ctx } = build({ answer: 7 * 24 * 60 })
    await guard.assert(ctx(), ROOT, '/address-book.json', 'read')
    state.time += 7 * DAY - 1
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(true)
    state.time += 1
    expect(await guard.check(ctx(), ROOT, '/address-book.json', 'read')).toBe(false)
  })

  it('a length that was not offered counts as a plain yes', async () => {
    const { guard, state, ctx } = build({ answer: 10 * 365 * 24 * 60 })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    const [g] = await guard.list()
    expect(g.expiresAt - state.time).toBe(PRIVATE_GRANT_TTL_MS)
  })

  it('a "similar" answer or any other yes is the default hour', async () => {
    const { guard, state, ctx } = build({ answer: 'similar' })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    const [g] = await guard.list()
    expect(g.expiresAt - state.time).toBe(PRIVATE_GRANT_TTL_MS)
  })

  it('remove() ends a grant now, and the next call asks again', async () => {
    const { guard, state, ctx } = build({ answer: 1440 })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    const [g] = await guard.list()
    expect(await guard.remove(g.id)).toBe(true)
    expect(await guard.remove(g.id)).toBe(false)
    expect(await guard.check(ctx(), ROOT, '/a.json', 'read')).toBe(false)
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    expect(state.requests).toHaveLength(2)
  })

  it('list(origin) is one site\'s grants, soonest to end first', async () => {
    const { guard, state, ctx } = build()
    state.answer = 1440
    await guard.assert(ctx(APP), ROOT, '/a.json', 'read')
    state.answer = 60
    await guard.assert(ctx(APP), ROOT, '/b.json', 'read')
    await guard.assert(ctx(OTHER_APP), ROOT, '/a.json', 'read')
    expect((await guard.list(APP)).map((g) => g.path)).toEqual(['/b.json', '/a.json'])
    expect((await guard.list(OTHER_APP)).map((g) => g.path)).toEqual(['/a.json'])
  })
})

describe('private-drive guard: grants are kept until they end', () => {
  function memoryStore(initial) {
    const store = {
      saved: initial,
      async load() {
        return store.saved
      },
      save(grants) {
        store.saved = grants
      },
    }
    return store
  }

  it('saves a new grant, and a guard made later (a restart) still has it', async () => {
    const store = memoryStore(undefined)
    const first = build({ answer: 1440, store })
    await first.guard.assert(first.ctx(), ROOT, '/a.json', 'read')
    expect(store.saved).toHaveLength(1)

    const second = build({ answer: false, store })
    second.state.time = first.state.time + 60_000
    expect(await second.guard.check(second.ctx(), ROOT, '/a.json', 'read')).toBe(true)
    expect(second.state.requests).toEqual([])
  })

  it('saves when a grant is removed', async () => {
    const store = memoryStore(undefined)
    const { guard, ctx } = build({ store })
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    const [g] = await guard.list()
    await guard.remove(g.id)
    expect(store.saved).toEqual([])
  })

  it('a store that fails to load leaves the guard closed, not broken', async () => {
    const store = { load: async () => Promise.reject(new Error('no file')), save() {} }
    const { guard, ctx } = build({ store })
    expect(await guard.check(ctx(), ROOT, '/a.json', 'read')).toBe(false)
    await guard.assert(ctx(), ROOT, '/a.json', 'read')
    expect(await guard.check(ctx(), ROOT, '/a.json', 'read')).toBe(true)
  })

  it('liveGrants drops ended, odd and widened grants, and caps the length', () => {
    const t = 1_000_000
    const good = { id: 'x', origin: APP, rootKey: ROOT, path: '/a.json', access: 'read', grantedAt: t, expiresAt: t + 5 }
    const longest = Math.max(...PRIVATE_GRANT_MINUTES) * 60 * 1000
    expect(
      liveGrants(
        [
          good,
          { ...good, expiresAt: t }, // ended
          { ...good, path: '/' }, // the whole drive
          { ...good, path: '/notes/../drives.json' }, // a trick
          { ...good, path: 'a.json' }, // not in its normal form
          { ...good, access: 'drive' },
          { ...good, rootKey: 'nope' },
          { ...good, origin: '' },
          null,
          'x',
        ],
        t
      )
    ).toEqual([good])
    expect(liveGrants([{ ...good, expiresAt: t + 10 * longest }], t)[0].expiresAt).toBe(t + longest)
    expect(liveGrants({ grants: [] }, t)).toEqual([])
  })
})

describe('private-grant-durations', () => {
  it('labels each length', () => {
    expect(durationLabel(60)).toBe('1 hour')
    expect(durationLabel(129600)).toBe('3 months')
    expect(durationLabel(120)).toBe('2 hours')
    expect(durationLabel(5)).toBe('5 minutes')
  })

  it('reads a prompt answer', () => {
    expect(grantedMinutes(false)).toBe(0)
    expect(grantedMinutes(undefined)).toBe(0)
    expect(grantedMinutes(true)).toBe(60)
    expect(grantedMinutes(1440)).toBe(1440)
    expect(grantedMinutes(1441)).toBe(60)
    expect(grantedMinutes('1440')).toBe(60)
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
