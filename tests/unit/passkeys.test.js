import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { getDomain } from '../../app/node_modules/tldts/dist/cjs/index.js'
import * as R from '../../shared/passkeys.mjs'
import { register, authenticate } from '../../app/bg/passkeys/ceremony.mjs'

const registrable = (host) => getDomain(host, { allowPrivateDomains: true }) || (host === 'localhost' ? host : null)
const sha256 = (b) => new Uint8Array(crypto.createHash('sha256').update(b).digest())
const b64 = (n, fill = 7) => R.toB64url(new Uint8Array(n).fill(fill))

// A store like bg/passkeys/store.js, in memory, with real P-256 keys.
function memoryStore() {
  const keys = new Map()
  let recs = []
  return {
    recs: () => recs,
    async list() {
      return recs.slice()
    },
    async create(f) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const jwk = publicKey.export({ format: 'jwk' })
      const id = R.toB64url(crypto.randomBytes(16))
      const rec = R.makePasskey({ id, ...f })
      const old = R.replacedBy(recs, f.rpId, f.userId).map((p) => p.id)
      recs = recs.filter((p) => !old.includes(p.id)).concat(rec)
      keys.set(id, privateKey)
      return {
        rec,
        x: new Uint8Array(Buffer.from(jwk.x, 'base64url')),
        y: new Uint8Array(Buffer.from(jwk.y, 'base64url')),
        spki: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
      }
    },
    async sign(id, data) {
      return new Uint8Array(crypto.sign('sha256', Buffer.from(data), { key: keys.get(id), dsaEncoding: 'der' }))
    },
  }
}

// Just enough CBOR decoding to read back what Nomad wrote.
function cborDecode(bytes) {
  let i = 0
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  function len(info) {
    if (info < 24) return info
    if (info === 24) return bytes[i++]
    if (info === 25) return (i += 2), dv.getUint16(i - 2)
    if (info === 26) return (i += 4), dv.getUint32(i - 4)
    throw new Error('bad length')
  }
  function item() {
    const b = bytes[i++]
    const major = b >> 5
    const n = len(b & 31)
    if (major === 0) return n
    if (major === 1) return -1 - n
    if (major === 2) return (i += n), bytes.slice(i - n, i)
    if (major === 3) return (i += n), Buffer.from(bytes.slice(i - n, i)).toString('utf8')
    if (major === 4) return Array.from({ length: n }, item)
    if (major === 5) {
      const m = new Map()
      for (let k = 0; k < n; k++) m.set(item(), item())
      return m
    }
    throw new Error('unsupported')
  }
  const v = item()
  return { value: v, rest: bytes.length - i }
}

const page = { origin: 'https://login.example.com', host: 'login.example.com' }

const createOpts = (extra = {}) => ({
  challenge: b64(32, 1),
  rp: { id: 'example.com', name: 'Example' },
  user: { id: b64(16, 9), name: 'ada@example.com', displayName: 'Ada Lovelace' },
  pubKeyCredParams: [
    { type: 'public-key', alg: -8 },
    { type: 'public-key', alg: -7 },
  ],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  ...extra,
})

describe('base64url and UTF-8', () => {
  it('match Node’s', () => {
    for (let n = 0; n < 40; n++) {
      const b = crypto.randomBytes(n)
      expect(R.toB64url(b)).toBe(b.toString('base64url'))
      expect(Buffer.from(R.fromB64url(b.toString('base64url')))).toEqual(b)
    }
    for (const t of ['', 'abc', 'Ada Lovelace', 'Grüße', '日本語', 'emoji 🔑'])
      expect(Buffer.from(R.utf8(t)).toString('utf8')).toBe(t)
    expect(() => R.fromB64url('a+b/')).toThrow()
    expect(() => R.fromB64url('abcde')).toThrow()
  })
})

describe('CBOR', () => {
  it('encodes integers, strings, bytes and canonical maps', () => {
    const hex = (v) => Buffer.from(R.cborEncode(v)).toString('hex')
    expect(hex(0)).toBe('00')
    expect(hex(23)).toBe('17')
    expect(hex(24)).toBe('1818')
    expect(hex(1000)).toBe('1903e8')
    expect(hex(-1)).toBe('20')
    expect(hex(-7)).toBe('26')
    expect(hex('fmt')).toBe('63666d74')
    expect(hex(new Uint8Array([1, 2]))).toBe('420102')
    // Shorter keys first, then bytewise (CTAP2 canonical).
    expect(hex({ authData: 1, fmt: 2, attStmt: 3 })).toBe(
      'a3' + '63666d74' + '02' + '6761747453746d74' + '03' + '68617574684461746101'
    )
  })

  it('writes the COSE EC2 key in the given order', () => {
    const x = new Uint8Array(32).fill(1)
    const y = new Uint8Array(32).fill(2)
    const m = cborDecode(R.coseEC2(x, y)).value
    expect([...m.keys()]).toEqual([1, 3, -1, -2, -3])
    expect(m.get(1)).toBe(2)
    expect(m.get(3)).toBe(-7)
    expect(m.get(-1)).toBe(1)
  })
})

describe('which pages, which RP ID', () => {
  it('allows https and http on this computer only', () => {
    expect(R.pageOrigin('https://Example.com/x')).toEqual({ origin: 'https://example.com', host: 'example.com' })
    expect(R.pageOrigin('http://localhost:3000/')).toEqual({ origin: 'http://localhost:3000', host: 'localhost' })
    expect(R.pageOrigin('http://example.com/')).toBe(null)
    expect(R.pageOrigin(`hyper://${'a'.repeat(64)}/`)).toBe(null)
    expect(R.pageOrigin('nomad://library/')).toBe(null)
    expect(R.pageOrigin('not a url')).toBe(null)
  })

  it('takes the host or a registrable domain above it', () => {
    expect(R.checkRpId(undefined, 'login.example.com', registrable)).toBe('login.example.com')
    expect(R.checkRpId('example.com', 'login.example.com', registrable)).toBe('example.com')
    expect(R.checkRpId('EXAMPLE.com', 'login.example.com', registrable)).toBe('example.com')
    expect(R.checkRpId(undefined, 'localhost', registrable)).toBe('localhost')
    expect(R.checkRpId('example.co.uk', 'a.example.co.uk', registrable)).toBe('example.co.uk')
  })

  it('refuses other sites, public suffixes and IP addresses', () => {
    const err = (rp, host) => {
      try {
        R.checkRpId(rp, host, registrable)
      } catch (e) {
        return e.domName
      }
      return 'ok'
    }
    expect(err('other.com', 'example.com')).toBe('SecurityError')
    expect(err('ample.com', 'example.com')).toBe('SecurityError')
    expect(err('com', 'example.com')).toBe('SecurityError')
    expect(err('co.uk', 'example.co.uk')).toBe('SecurityError')
    expect(err('github.io', 'me.github.io')).toBe('SecurityError')
    expect(err(undefined, '10.0.0.1')).toBe('SecurityError')
  })
})

describe('options from the page', () => {
  it('needs ES256 among the algorithms, or none listed', () => {
    expect(() => R.normalizeCreateOptions(createOpts({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }))).toThrow(
      /ES256/
    )
    expect(R.normalizeCreateOptions(createOpts({ pubKeyCredParams: [] })).challenge).toBe(b64(32, 1))
  })

  it('checks the challenge and user id', () => {
    expect(() => R.normalizeCreateOptions(createOpts({ challenge: b64(8) }))).toThrow(/challenge/)
    expect(() => R.normalizeCreateOptions(createOpts({ user: { id: b64(65), name: 'a' } }))).toThrow(/user.id/)
    expect(() => R.normalizeGetOptions({ challenge: 'not base64!' })).toThrow()
  })

  it('leaves a request only for a security key or phone to the browser', async () => {
    const store = memoryStore()
    const res = await register({
      publicKey: createOpts({ authenticatorSelection: { authenticatorAttachment: 'cross-platform' } }),
      page,
      store,
      sha256,
      registrable,
      ask: () => {
        throw new Error('no prompt')
      },
    })
    expect(res).toEqual({ fallback: true })
  })
})

describe('the ceremonies', () => {
  it('makes a passkey a server can check, then signs in with it', async () => {
    const store = memoryStore()
    const prompts = []
    const ask = async (p) => (prompts.push(p), { action: 'allow', id: p.passkeys?.[0]?.id, verified: true })
    const reg = await register({ publicKey: createOpts(), page, store, ask, sha256, registrable })
    const c = reg.credential
    expect(prompts[0]).toMatchObject({
      kind: 'create',
      rpId: 'example.com',
      account: { title: 'Ada Lovelace', sub: 'ada@example.com' },
    })

    // clientDataJSON, as a server reads it.
    const cd = JSON.parse(Buffer.from(c.response.clientDataJSON, 'base64url').toString())
    expect(cd).toEqual({ type: 'webauthn.create', challenge: b64(32, 1), origin: page.origin, crossOrigin: false })

    // The attestation object: "none", and authData with the credential and its key.
    const att = cborDecode(R.fromB64url(c.response.attestationObject))
    expect(att.rest).toBe(0)
    expect(att.value.get('fmt')).toBe('none')
    expect(att.value.get('attStmt').size).toBe(0)
    const ad = att.value.get('authData')
    expect(Buffer.from(ad.slice(0, 32))).toEqual(Buffer.from(sha256(R.utf8('example.com'))))
    expect(ad[32]).toBe(R.FLAG_UP | R.FLAG_UV | R.FLAG_AT)
    expect(ad[32] & (R.FLAG_BE | R.FLAG_BS)).toBe(0) // on this computer only, never synced
    expect(Buffer.from(ad.slice(37, 53)).toString('hex')).toBe(R.AAGUID_HEX)
    const idLen = (ad[53] << 8) | ad[54]
    expect(R.toB64url(ad.slice(55, 55 + idLen))).toBe(c.id)
    const cose = cborDecode(ad.slice(55 + idLen))
    expect(cose.rest).toBe(0)
    const pub = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(cose.value.get(-2)).toString('base64url'),
        y: Buffer.from(cose.value.get(-3)).toString('base64url'),
      },
      format: 'jwk',
    })
    expect(Buffer.from(pub.export({ format: 'der', type: 'spki' })).toString('base64url')).toBe(c.response.publicKey)
    expect(c.clientExtensionResults).toEqual({})

    // Sign in: the assertion verifies with that key.
    const auth = await authenticate({
      publicKey: { challenge: b64(32, 3), rpId: 'example.com', allowCredentials: [] },
      page,
      store,
      ask,
      sha256,
      registrable,
    })
    expect(prompts[1].kind).toBe('get')
    expect(prompts[1].passkeys.map((p) => p.id)).toEqual([c.id])
    const a = auth.credential.response
    expect(a.userHandle).toBe(b64(16, 9))
    const aData = R.fromB64url(a.authenticatorData)
    expect(aData.length).toBe(37)
    expect(aData[32]).toBe(R.FLAG_UP | R.FLAG_UV)
    const signed = Buffer.concat([Buffer.from(aData), Buffer.from(sha256(R.fromB64url(a.clientDataJSON)))])
    expect(crypto.verify('sha256', signed, { key: pub, dsaEncoding: 'der' }, Buffer.from(R.fromB64url(a.signature)))).toBe(
      true
    )
    expect(JSON.parse(Buffer.from(R.fromB64url(a.clientDataJSON)).toString()).type).toBe('webauthn.get')
  })

  it('says InvalidStateError for an account it already has, after the user sees it', async () => {
    const store = memoryStore()
    const ask = async () => ({ action: 'allow' })
    const first = await register({ publicKey: createOpts(), page, store, ask, sha256, registrable })
    let prompt = null
    const again = register({
      publicKey: createOpts({ excludeCredentials: [{ type: 'public-key', id: first.credential.id }] }),
      page,
      store,
      ask: async (p) => ((prompt = p), { action: 'allow' }),
      sha256,
      registrable,
    })
    await expect(again).rejects.toMatchObject({ domName: 'InvalidStateError' })
    expect(prompt.kind).toBe('exists')
    expect(store.recs().length).toBe(1)
  })

  it('replaces a passkey for the same account, keeps others', async () => {
    const store = memoryStore()
    const ask = async () => ({ action: 'allow' })
    await register({ publicKey: createOpts(), page, store, ask, sha256, registrable })
    await register({
      publicKey: createOpts({ user: { id: b64(16, 2), name: 'bob@example.com' } }),
      page,
      store,
      ask,
      sha256,
      registrable,
    })
    let prompt = null
    await register({
      publicKey: createOpts(),
      page,
      store,
      ask: async (p) => ((prompt = p), { action: 'allow' }),
      sha256,
      registrable,
    })
    expect(prompt.replaces).toBe(1)
    expect(store.recs().map((p) => p.userName).sort()).toEqual(['ada@example.com', 'bob@example.com'])
  })

  it('offers only the listed passkeys, and none for another site', async () => {
    const store = memoryStore()
    const ask = async (p) => ({ action: 'allow', id: p.passkeys?.[0]?.id })
    const a = await register({ publicKey: createOpts(), page, store, ask, sha256, registrable })
    await register({
      publicKey: createOpts({ user: { id: b64(16, 2), name: 'bob@example.com' } }),
      page,
      store,
      ask,
      sha256,
      registrable,
    })
    let prompt = null
    const spy = async (p) => ((prompt = p), { action: 'deny' })
    await expect(
      authenticate({
        publicKey: { challenge: b64(32), rpId: 'example.com', allowCredentials: [{ type: 'public-key', id: a.credential.id }] },
        page,
        store,
        ask: spy,
        sha256,
        registrable,
      })
    ).rejects.toMatchObject({ domName: 'NotAllowedError' })
    expect(prompt.passkeys.map((p) => p.title)).toEqual(['Ada Lovelace'])

    await expect(
      authenticate({
        publicKey: { challenge: b64(32) },
        page: { origin: 'https://other.org', host: 'other.org' },
        store,
        ask: spy,
        sha256,
        registrable,
      })
    ).rejects.toMatchObject({ domName: 'NotAllowedError' })
    expect(prompt.kind).toBe('none')
  })

  it('never signs with a passkey the prompt didn’t offer', async () => {
    const store = memoryStore()
    await register({ publicKey: createOpts(), page, store, ask: async () => ({ action: 'allow' }), sha256, registrable })
    const other = await register({
      publicKey: { ...createOpts(), rp: { id: 'other.org', name: 'Other' } },
      page: { origin: 'https://other.org', host: 'other.org' },
      store,
      ask: async () => ({ action: 'allow' }),
      sha256,
      registrable,
    })
    await expect(
      authenticate({
        publicKey: { challenge: b64(32), rpId: 'example.com' },
        page,
        store,
        ask: async () => ({ action: 'allow', id: other.credential.id }),
        sha256,
        registrable,
      })
    ).rejects.toMatchObject({ domName: 'NotAllowedError' })
  })

  it('hands the call to the browser when the user picks a phone or security key', async () => {
    const store = memoryStore()
    const res = await authenticate({
      publicKey: { challenge: b64(32) },
      page,
      store,
      ask: async () => ({ action: 'fallback' }),
      sha256,
      registrable,
    })
    expect(res).toEqual({ fallback: true })
  })

  it('leaves UV off when the user wasn’t verified', async () => {
    const store = memoryStore()
    const reg = await register({
      publicKey: createOpts({ authenticatorSelection: { userVerification: 'discouraged' } }),
      page,
      store,
      ask: async () => ({ action: 'allow', verified: false }),
      sha256,
      registrable,
    })
    const ad = cborDecode(R.fromB64url(reg.credential.response.attestationObject)).value.get('authData')
    expect(ad[32] & R.FLAG_UV).toBe(0)
  })
})
