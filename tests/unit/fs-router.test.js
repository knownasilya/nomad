// Tests for the nomad.fs backend router (app/bg/web-apis/bg/fs-router.js).
//
// Regression cover for the autobase-port breakage where `hyper://private/` (a root drive the Vault
// migration converted to an Autobase) was mis-routed to the Hyperdrive backend and hung ~60s:
//   1. hostname aliases (esp. `private`) are canonicalised to the real hex key BEFORE detection, so
//      an Autobase root/space drive is dispatched to the Autobase backend on its real key.
//   2. a "not here" result on a KNOWN-local drive does NOT retry the other backend (that wrong-
//      backend open is what hung); a genuinely-unknown remote drive still gets the fallback.
//
// createFsRouter is a pure DI module (imports nothing), so this test needs no vi.mock/vi.hoisted —
// it just injects plain fakes and runs in any runner.
import { describe, it, expect, beforeEach } from 'vitest'
import { createFsRouter } from '../../app/bg/web-apis/bg/fs-router.js'

const ROOTKEY = 'a'.repeat(64)   // the local root/private drive — an Autobase
const BLOGKEY = 'b'.repeat(64)   // a registered Autobase drive
const HDKEY = 'c'.repeat(64)     // a registered single-writer Hyperdrive
const REMOTEKEY = 'd'.repeat(64) // an unknown, never-registered remote drive

// Host segment minus any +version suffix (matches parseDriveUrl's hostname).
function hostOf(url) {
  const m = /^hyper:\/\/([^/]+)/.exec(url)
  let host = m ? m[1] : url
  const plus = host.indexOf('+')
  return plus === -1 ? host : host.slice(0, plus)
}
// Minimal stand-in for lib/urls parseDriveUrl — the router only reads these fields.
function fakeParseDriveUrl(url) {
  const m = /^hyper:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?/.exec(url) || []
  let host = m[1] || url
  let version = ''
  const plus = host.indexOf('+')
  if (plus !== -1) { version = host.slice(plus + 1); host = host.slice(0, plus) }
  return { hostname: host, version, pathname: m[2] || '', search: m[3] || '' }
}

let calls
// A backend whose every method records the (method, url) it was called with and returns a
// per-method canned value from `returns`.
function makeBackend(name, returns = {}) {
  return new Proxy({}, { get: (_t, method) => async (url, ...args) => {
    calls.push({ backend: name, method, url, args })
    const v = returns[method]
    return typeof v === 'function' ? v(url) : (v === undefined ? null : v)
  }})
}
const called = (backend, method) => calls.filter((c) => c.backend === backend && c.method === method)

// Build a router with the given backend return-maps + a fixed local topology.
function build({ hyper = {}, ab = {} } = {}) {
  const hyperdriveAPI = makeBackend('hyperdrive', hyper)
  const autobaseAPI = makeBackend('autobase', ab)
  return createFsRouter({
    hyperdriveAPI,
    autobaseAPI,
    isCollaborativeDrive: async (url) => [ROOTKEY, BLOGKEY].includes(hostOf(url)),
    isRootUrl: (url) => hostOf(url) === ROOTKEY,
    getDriveConfig: (key) => ({ [HDKEY]: { key: HDKEY }, [BLOGKEY]: { key: BLOGKEY, type: 'autobase' } })[key],
    fromURLToKey: async (url) => {
      const host = hostOf(url)
      if (/^[0-9a-f]{64}$/i.test(host)) return host
      return { private: ROOTKEY }[host] // resolve alias
    },
    spaceRootKeyForSender: async (ctx) => ctx?.spaceKey || null,
    parseDriveUrl: fakeParseDriveUrl,
  })
}

beforeEach(() => { calls = [] })

describe('canonicalisation of the private alias', () => {
  it('routes hyper://private/ reads to the Autobase backend on the real root key', async () => {
    const router = build({ ab: { readFile: '{"profiles":[]}' } })
    const res = await router.read(null, 'readFile', 'hyper://private/address-book.json', [{}])

    expect(res).toBe('{"profiles":[]}')
    expect(called('autobase', 'readFile')).toHaveLength(1)
    expect(called('autobase', 'readFile')[0].url).toBe(`hyper://${ROOTKEY}/address-book.json`)
    expect(called('hyperdrive', 'readFile')).toHaveLength(0)
  })

  it('resolves private per-space via spaceRootKeyForSender(ctx)', async () => {
    const router = build({ ab: { list: [{ name: 'index.json' }] } })
    const res = await router.read({ spaceKey: ROOTKEY }, 'list', 'hyper://private/', [{}])

    expect(res).toEqual([{ name: 'index.json' }])
    expect(called('autobase', 'list')[0].url).toBe(`hyper://${ROOTKEY}/`)
    expect(called('hyperdrive', 'list')).toHaveLength(0)
  })

  it('preserves path, version and query when rewriting the URL', async () => {
    const router = build({ ab: { get: 'x' } })
    await router.read(null, 'get', `hyper://${BLOGKEY}+10/posts/a.json?raw=1`, [{}])
    expect(called('autobase', 'get')[0].url).toBe(`hyper://${BLOGKEY}+10/posts/a.json?raw=1`)
  })

  it('dispatch() reports the resolved url and backend for getInfo-style callers', async () => {
    const router = build()
    const d = await router.dispatch(null, 'hyper://private/')
    expect(d.isAutobase).toBe(true)
    expect(d.url).toBe(`hyper://${ROOTKEY}/`)
  })
})

describe('no wrong-backend fallback for known-local drives', () => {
  it('a missing file on a registered Hyperdrive returns null without opening the Autobase backend', async () => {
    const router = build({ hyper: { get: null } })
    const res = await router.read(null, 'get', `hyper://${HDKEY}/missing.txt`, [{}])

    expect(res).toBe(null)
    expect(called('hyperdrive', 'get')).toHaveLength(1)
    expect(called('autobase', 'get')).toHaveLength(0) // <- the hang-avoiding gate
  })

  it('a missing file on the root/private Autobase does not fall back to Hyperdrive', async () => {
    const router = build({ ab: { get: null } })
    const res = await router.read(null, 'get', 'hyper://private/nope', [{}])

    expect(res).toBe(null)
    expect(called('autobase', 'get')).toHaveLength(1)
    expect(called('hyperdrive', 'get')).toHaveLength(0)
  })
})

describe('fallback still works for genuinely-unknown remote drives', () => {
  it('falls back to the Autobase backend when the Hyperdrive read comes back empty', async () => {
    const router = build({ hyper: { get: null }, ab: { get: 'from-autobase' } })
    const res = await router.read(null, 'get', `hyper://${REMOTEKEY}/index.json`, [{}])

    expect(res).toBe('from-autobase')
    expect(called('hyperdrive', 'get')).toHaveLength(1)
    expect(called('autobase', 'get')).toHaveLength(1)
  })

  it('falls back to the other backend when the primary read throws', async () => {
    const router = build({
      hyper: { list: () => { throw new Error('opened wrong backend') } },
      ab: { list: [{ name: 'ok' }] },
    })
    const res = await router.read(null, 'list', `hyper://${REMOTEKEY}/`, [{}])

    expect(res).toEqual([{ name: 'ok' }])
    expect(called('autobase', 'list')).toHaveLength(1)
  })
})

describe('wrong-backend decode errors override "known" typing', () => {
  // Regression: an Autobase drive registered in /drives.json WITHOUT its `type: 'autobase'`
  // marker (e.g. by an old "Host This Hyperdrive" toggle) is "known" as a Hyperdrive, so its
  // reads hit the Hyperdrive backend and DECODING_ERROR — the explorer showed an empty '/'.
  // A decode error is authoritative evidence of mis-typing (blocks exist but don't decode),
  // so the router must cross-check the other backend even for a known drive.
  const decodeErr = () => {
    const e = new Error('DECODING_ERROR: Decoded message is not valid')
    e.code = 'DECODING_ERROR'
    throw e
  }

  it('retries a known-Hyperdrive readdir on the Autobase backend after DECODING_ERROR', async () => {
    const router = build({
      hyper: { readdir: decodeErr },
      ab: { readdir: [{ name: 'posts' }, { name: 'index.html' }] },
    })
    const res = await router.read(null, 'readdir', `hyper://${HDKEY}/`, [{}])

    expect(res).toEqual([{ name: 'posts' }, { name: 'index.html' }])
    expect(called('autobase', 'readdir')).toHaveLength(1)
  })

  it('still does NOT retry a known drive on a plain (non-decode) error', async () => {
    const router = build({
      hyper: { readdir: () => { throw new Error('boom') } },
      ab: { readdir: [{ name: 'nope' }] },
    })
    await expect(router.read(null, 'readdir', `hyper://${HDKEY}/`, [{}])).rejects.toThrow('boom')
    expect(called('autobase', 'readdir')).toHaveLength(0)
  })
})
