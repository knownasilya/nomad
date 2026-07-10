// Protocol test for the shared AI Bridge wire format (ADR-0013).
//
// Exercises the REAL shared module (nomad/shared/ai-bridge.mjs) against the app's own resolved
// crypto deps (hypercore-crypto + b4a), the same way fs-core-golden loads app/node_modules.
// Covers: frame codec round-trip + malformed handling, and the Vault-writer signature challenge
// that gates the Bridge (a peer that isn't the keyholder cannot authenticate).

import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import {
  AI_BRIDGE_PROTOCOL, AI_BRIDGE_VERSION, FRAME,
  encodeFrame, decodeFrame,
  makeChallenge, signChallenge, verifyChallenge,
} from '../../shared/ai-bridge.mjs'

let crypto, b4a
let mCrypto, mB4a // mobile's SEPARATE node_modules — the Bridge spans two engines (ADR-0013)

async function loadDep (side, name) {
  const rq = createRequire(path.join(process.cwd(), side, 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

beforeAll(async () => {
  crypto = await loadDep('app', 'hypercore-crypto')
  b4a = await loadDep('app', 'b4a')
  mCrypto = await loadDep('mobile', 'hypercore-crypto')
  mB4a = await loadDep('mobile', 'b4a')
})

describe('ai-bridge frame codec', () => {
  it('round-trips a frame', () => {
    const frame = { t: FRAME.REQUEST, id: 'r1', messages: [{ role: 'user', content: 'hi' }], opts: { driveUrl: 'hyper://abc/' } }
    const decoded = decodeFrame(b4a, encodeFrame(b4a, frame))
    expect(decoded).toEqual(frame)
  })

  it('preserves unicode in chunk text', () => {
    const frame = { t: FRAME.CHUNK, id: 'r1', text: 'héllo — 世界 🌍' }
    const decoded = decodeFrame(b4a, encodeFrame(b4a, frame))
    expect(decoded.text).toBe(frame.text)
  })

  it('returns null on malformed bytes', () => {
    expect(decodeFrame(b4a, b4a.from('not json'))).toBeNull()
  })

  it('returns null on JSON without a type tag', () => {
    expect(decodeFrame(b4a, b4a.from(JSON.stringify({ id: 'r1' })))).toBeNull()
  })

  it('exposes stable protocol identity', () => {
    expect(AI_BRIDGE_PROTOCOL).toBe('nomad/ai-bridge')
    expect(AI_BRIDGE_VERSION).toBe(1)
  })
})

describe('ai-bridge auth challenge', () => {
  it('accepts a signature from the keyholder', () => {
    const kp = crypto.keyPair()                         // stands in for a Device Vault writer keypair
    const deviceKeyHex = b4a.toString(kp.publicKey, 'hex')
    const { nonceHex } = makeChallenge(crypto)
    const sig = signChallenge(crypto, b4a, nonceHex, kp.secretKey)
    expect(verifyChallenge(crypto, b4a, nonceHex, sig, deviceKeyHex)).toBe(true)
  })

  it('rejects a signature over a different nonce (replay/tamper)', () => {
    const kp = crypto.keyPair()
    const deviceKeyHex = b4a.toString(kp.publicKey, 'hex')
    const sig = signChallenge(crypto, b4a, makeChallenge(crypto).nonceHex, kp.secretKey)
    const otherNonce = makeChallenge(crypto).nonceHex
    expect(verifyChallenge(crypto, b4a, otherNonce, sig, deviceKeyHex)).toBe(false)
  })

  it('rejects a signature by a non-member key (wrong keypair)', () => {
    const signer = crypto.keyPair()
    const impostorKeyHex = b4a.toString(crypto.keyPair().publicKey, 'hex')
    const { nonceHex } = makeChallenge(crypto)
    const sig = signChallenge(crypto, b4a, nonceHex, signer.secretKey)
    expect(verifyChallenge(crypto, b4a, nonceHex, sig, impostorKeyHex)).toBe(false)
  })

  it('rejects malformed signature / key lengths without throwing', () => {
    const { nonceHex } = makeChallenge(crypto)
    expect(verifyChallenge(crypto, b4a, nonceHex, 'ab', 'cd')).toBe(false)
    expect(verifyChallenge(crypto, b4a, nonceHex, '', '')).toBe(false)
  })

  it('mints distinct nonces', () => {
    expect(makeChallenge(crypto).nonceHex).not.toBe(makeChallenge(crypto).nonceHex)
  })
})

// The Bridge runs desktop↔mobile, and each app resolves its OWN hypercore-crypto/b4a from a
// separate node_modules (like fs-core-parity). If those ever diverge in signing/hex encoding the
// auth handshake breaks silently. This proves a mobile-signed challenge verifies on the desktop
// and vice versa — the real cross-engine path.
describe('ai-bridge cross-runtime parity (app ↔ mobile)', () => {
  it('a mobile AI Client authenticates to a desktop AI Provider', () => {
    const kp = mCrypto.keyPair()                                   // Client (mobile) writer keypair
    const deviceKeyHex = mB4a.toString(kp.publicKey, 'hex')
    const { nonceHex } = makeChallenge(crypto)                     // Provider (desktop) mints nonce
    const sig = signChallenge(mCrypto, mB4a, nonceHex, kp.secretKey) // Client signs (mobile crypto)
    expect(verifyChallenge(crypto, b4a, nonceHex, sig, deviceKeyHex)).toBe(true) // Provider verifies (desktop)
  })

  it('a desktop AI Client authenticates to a mobile AI Provider', () => {
    const kp = crypto.keyPair()
    const deviceKeyHex = b4a.toString(kp.publicKey, 'hex')
    const { nonceHex } = makeChallenge(mCrypto)
    const sig = signChallenge(crypto, b4a, nonceHex, kp.secretKey)
    expect(verifyChallenge(mCrypto, mB4a, nonceHex, sig, deviceKeyHex)).toBe(true)
  })

  it('encodes frames identically across engines', () => {
    const frame = { t: FRAME.REQUEST, id: 'r1', messages: [{ role: 'user', content: 'héllo 世界' }] }
    const onApp = encodeFrame(b4a, frame)
    const onMobile = encodeFrame(mB4a, frame)
    expect(b4a.toString(onApp, 'hex')).toBe(mB4a.toString(onMobile, 'hex'))     // byte-identical
    expect(decodeFrame(mB4a, onApp)).toEqual(decodeFrame(b4a, onMobile))        // cross-decodes
  })
})
