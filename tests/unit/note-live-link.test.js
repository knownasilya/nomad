// The link that carries live Note editing between the user's Devices (shared/note-live.mjs,
// ADR-0041): both sides prove a Vault writer key over this very connection before any Note frame
// flows, and a Device that can't is never sent one.

import { describe, it, expect, beforeAll } from 'vitest'
import { EventEmitter } from 'events'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import { createNoteLink, decodeFrame, encodeFrame, proofMessage, FRAME } from '../../shared/note-live.mjs'

async function loadDep (name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

let Protomux, c, b4a, SecretStream, crypto

beforeAll(async () => {
  Protomux = await loadDep('protomux')
  c = await loadDep('compact-encoding')
  b4a = await loadDep('b4a')
  SecretStream = await loadDep('@hyperswarm/secret-stream')
  crypto = await loadDep('hypercore-crypto')
})

const VAULT = 'aa'.repeat(32)

function fakeSwarm () {
  const swarm = new EventEmitter()
  swarm.connections = new Set()
  swarm.connect = (conn) => { swarm.connections.add(conn); swarm.emit('connection', conn) }
  return swarm
}

function pipePair () {
  const a = new SecretStream(true)
  const b = new SecretStream(false)
  a.rawStream.pipe(b.rawStream).pipe(a.rawStream)
  return [a, b]
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

// A Device: its key pair is its Vault writer key; `members` are the keys its Vault lists.
function device (members, kp = crypto.keyPair(), { lie = false } = {}) {
  const swarm = fakeSwarm()
  const key = b4a.toString(kp.publicKey, 'hex')
  const got = []
  const peers = []
  const link = createNoteLink({
    swarm,
    Protomux,
    c,
    b4a,
    getVaultKey: () => VAULT,
    getDeviceKey: () => key,
    randomHex: () => b4a.toString(crypto.randomBytes(32), 'hex'),
    // `lie`: signs with a key that isn't the one it names.
    sign: async (m) => b4a.toString(crypto.sign(b4a.from(m), lie ? crypto.keyPair().secretKey : kp.secretKey), 'hex'),
    verify: async (k, m, sig) => members.has(k) && crypto.verify(b4a.from(m), b4a.from(sig, 'hex'), b4a.from(k, 'hex')),
    onPeer: (k, up) => peers.push([k, up]),
    onFrame: (k, f) => got.push([k, f]),
    openIds: () => ['n1'],
  })
  link.install()
  return { swarm, key, link, got, peers }
}

describe('note-live frames', () => {
  it('drops malformed frames', () => {
    expect(decodeFrame(b4a, b4a.from('nope'))).toBe(null)
    expect(decodeFrame(b4a, encodeFrame(b4a, { t: FRAME.MSG, id: '../x', m: '' }))).toBe(null)
    expect(decodeFrame(b4a, encodeFrame(b4a, { t: 'future' }))).toBe(null)
    expect(decodeFrame(b4a, encodeFrame(b4a, { t: FRAME.OPEN, ids: ['n1', 5, 'BAD ID'] }))).toEqual({ t: FRAME.OPEN, ids: ['n1'] })
  })

  it('names the protocol and the connection in what it signs', () => {
    expect(proofMessage('ab', 'cd')).toBe('nomad/note-live\nab\ncd')
  })
})

describe('note-live link', () => {
  it('connects two of the user’s Devices and carries Note frames', async () => {
    const ka = crypto.keyPair()
    const kb = crypto.keyPair()
    const members = new Set([b4a.toString(ka.publicKey, 'hex'), b4a.toString(kb.publicKey, 'hex')])
    const A = device(members, ka)
    const B = device(members, kb)
    const [sa, sb] = pipePair()
    A.swarm.connect(sa)
    B.swarm.connect(sb)
    await until(() => A.link.devices().length && B.link.devices().length)
    // Each tells the other which Notes it has open.
    await until(() => A.got.some(([, f]) => f.t === FRAME.OPEN) && B.got.some(([, f]) => f.t === FRAME.OPEN))
    expect(B.link.send(A.key, { t: FRAME.JOIN, id: 'n1', seed: 't0', edited: false })).toBe(true)
    await until(() => A.got.some(([, f]) => f.t === FRAME.JOIN))
    expect(A.got.find(([, f]) => f.t === FRAME.JOIN)[0]).toBe(B.key)
    sa.destroy()
    await until(() => A.peers.some(([, up]) => up === false))
  })

  it('never sends a Note frame to a Device the Vault doesn’t list', async () => {
    const ka = crypto.keyPair()
    const A = device(new Set([b4a.toString(ka.publicKey, 'hex')]), ka)
    const M = device(new Set(), crypto.keyPair()) // knows the Vault key, isn't a Device of it
    const [sa, sm] = pipePair()
    A.swarm.connect(sa)
    M.swarm.connect(sm)
    await new Promise((r) => setTimeout(r, 300))
    expect(A.link.devices()).toEqual([])
    expect(M.got).toEqual([])
    expect(A.link.send(M.key, { t: FRAME.MSG, id: 'n1', m: 'AA==' })).toBe(false)
    sa.destroy()
  })

  it('refuses a Device that names a listed key it can’t sign for', async () => {
    const ka = crypto.keyPair()
    const kb = crypto.keyPair()
    const members = new Set([b4a.toString(ka.publicKey, 'hex'), b4a.toString(kb.publicKey, 'hex')])
    const A = device(members, ka)
    const B = device(members, kb, { lie: true })
    const [sa, sb] = pipePair()
    A.swarm.connect(sa)
    B.swarm.connect(sb)
    await new Promise((r) => setTimeout(r, 300))
    expect(A.link.devices()).toEqual([])
    expect(B.link.devices()).toEqual([]) // A never answered OK, so B doesn't count A either
    sa.destroy()
  })
})
