// Protocol test for the shared device-presence channel (shared/device-presence.mjs).
//
// Runs the REAL shared module with the app's deps on one side and mobile's on the other, over a
// pair of piped secret streams, the way a desktop and a phone meet on the swarm.

import { describe, it, expect, beforeAll } from 'vitest'
import { EventEmitter } from 'events'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import { PRESENCE_PROTOCOL, encodeHello, decodeHello, createDevicePresence } from '../../shared/device-presence.mjs'

async function loadDep (side, name) {
  const rq = createRequire(path.join(process.cwd(), side, 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

let app, mobile, SecretStream

beforeAll(async () => {
  const deps = async (side) => ({
    Protomux: await loadDep(side, 'protomux'),
    c: await loadDep(side, 'compact-encoding'),
    b4a: await loadDep(side, 'b4a')
  })
  app = await deps('app')
  mobile = await deps('mobile')
  SecretStream = await loadDep('app', '@hyperswarm/secret-stream')
})

const VAULT = 'aa'.repeat(32)
const DESKTOP = 'd0'.repeat(32)
const PHONE = 'f0'.repeat(32)

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

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('device-presence codec', () => {
  it('round-trips a hello', () => {
    const { b4a } = app || { b4a: Buffer }
    expect(decodeHello(b4a, encodeHello(b4a, PHONE))).toEqual({ t: 'hello', deviceKey: PHONE })
  })

  it('rejects malformed frames', () => {
    expect(decodeHello(Buffer, Buffer.from('nope'))).toBeNull()
    expect(decodeHello(Buffer, Buffer.from(JSON.stringify({ t: 'hello', deviceKey: 'short' })))).toBeNull()
    expect(decodeHello(Buffer, Buffer.from(JSON.stringify({ t: 'other', deviceKey: PHONE })))).toBeNull()
  })

  it('has a stable protocol name', () => {
    expect(PRESENCE_PROTOCOL).toBe('nomad/device-presence')
  })
})

describe('device-presence channel', () => {
  it('tells each side which Device is on the other end, and forgets it on disconnect', async () => {
    const desktopSwarm = fakeSwarm()
    const phoneSwarm = fakeSwarm()
    const desktop = createDevicePresence({ swarm: desktopSwarm, ...app, getVaultKey: async () => VAULT, getDeviceKey: async () => DESKTOP })
    const phone = createDevicePresence({ swarm: phoneSwarm, ...mobile, getVaultKey: () => VAULT, getDeviceKey: () => PHONE })
    desktop.install()
    phone.install()

    const [a, b] = pipePair()
    desktopSwarm.connect(a)
    phoneSwarm.connect(b)

    await until(() => desktop.connectedDevices().has(PHONE) && phone.connectedDevices().has(DESKTOP))
    // A re-scan (install again) must not open a second channel.
    desktop.install()
    phone.install()
    await new Promise((r) => setTimeout(r, 50))
    expect([...desktop.connectedDevices()]).toEqual([PHONE])

    a.destroy()
    await until(() => desktop.connectedDevices().size === 0 && phone.connectedDevices().size === 0)
  })

  it('does not pair with a peer in another Vault', async () => {
    const s1 = fakeSwarm()
    const s2 = fakeSwarm()
    const one = createDevicePresence({ swarm: s1, ...app, getVaultKey: () => VAULT, getDeviceKey: () => DESKTOP })
    const two = createDevicePresence({ swarm: s2, ...mobile, getVaultKey: () => 'bb'.repeat(32), getDeviceKey: () => PHONE })
    one.install()
    two.install()
    const [a, b] = pipePair()
    s1.connect(a)
    s2.connect(b)
    await new Promise((r) => setTimeout(r, 200))
    expect(one.connectedDevices().size).toBe(0)
    expect(two.connectedDevices().size).toBe(0)
    a.destroy()
  })

  it('stays quiet until this Device has a Vault', async () => {
    const s1 = fakeSwarm()
    const s2 = fakeSwarm()
    let vaultKey = null
    const one = createDevicePresence({ swarm: s1, ...app, getVaultKey: () => vaultKey, getDeviceKey: () => vaultKey && DESKTOP })
    const two = createDevicePresence({ swarm: s2, ...mobile, getVaultKey: () => VAULT, getDeviceKey: () => PHONE })
    one.install()
    two.install()
    const [a, b] = pipePair()
    s1.connect(a)
    s2.connect(b)
    await new Promise((r) => setTimeout(r, 100))
    expect(two.connectedDevices().size).toBe(0)
    vaultKey = VAULT
    one.install() // the Vault opened: re-scan live connections
    await until(() => two.connectedDevices().has(DESKTOP) && one.connectedDevices().has(PHONE))
    a.destroy()
  })
})
