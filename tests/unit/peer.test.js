// The always-on Peer (peer/, ADR-0038). Two parts:
//  - Holdings: a real Vault Autobase with Space, Persona and Peer records; the Peer reads what it
//    should hold, follows edits to its record, and stops (and wipes) once a Device removes it.
//  - Spike S1: over a local DHT testnet, a Peer that is no writer mirrors an Autobase drive with a
//    blob file in full, and a third Device reads that file from the Peer after the owner is gone.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import path from 'path'
import os from 'os'
import fs from 'fs'
import DriveManager, { openAutobaseDrive } from '../../mobile/backend/lib/drive-manager.mjs'
import { inlineOp } from '../../mobile/backend/lib/vault.mjs'
import { DRIVE_AUTOBASE } from '../../mobile/rpc-commands.mjs'
import * as peers from '../../shared/peers.mjs'
import { readHoldings } from '../../peer/holdings.mjs'
import { createPeer } from '../../peer/peer.mjs'
import * as phonePeers from '../../mobile/backend/lib/peers.mjs'

const rq = createRequire(path.join(process.cwd(), 'mobile', 'package.json'))
const Corestore = rq('corestore')
const Hyperswarm = rq('hyperswarm')
const b4a = rq('b4a')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-peer-test-'))
const SPACE_A = 'a'.repeat(64)
const LIB_A = 'b'.repeat(64)
const SPACE_C = 'c'.repeat(64)
const DRIVE_D = 'd'.repeat(64)
const DRIVE_E = 'e'.repeat(64)
const PROFILE = 'f'.repeat(64)
const PEER = '1'.repeat(64)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until (fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await wait(100)
  }
  return false
}

describe('the Peer reads its Holdings from the Vault', () => {
  let store, base

  beforeAll(async () => {
    store = new Corestore(tmp())
    base = openAutobaseDrive(store, null)
    await base.ready()
    const put = (p, rec) => base.append(inlineOp(p, rec))
    await put(`/.vault/spaces/${SPACE_A}.json`, { rootDriveKey: SPACE_A, name: 'Home', library: LIB_A })
    await put(`/.vault/spaces/${SPACE_C}.json`, { rootDriveKey: SPACE_C, name: 'Work' })
    await put('/.vault/personas/p1.json', { id: 'p1', label: 'Me', profileUrl: `hyper://${PROFILE}/` })
    await put(peers.peerPath(PEER), peers.makePeer({ key: PEER, name: 'NAS', kind: 'own' }))
    await base.update()
  })

  afterAll(async () => {
    await base.close()
    await store.close()
  })

  const registries = { [LIB_A]: [{ key: DRIVE_D, type: 'autobase' }], [SPACE_C]: [{ key: DRIVE_E }] }
  const readRegistry = async (k) => registries[k] || []

  it('holds the Vault, every Space with its Library and drives, and the Profile Drives', async () => {
    const { record, holdings } = await readHoldings({ base, b4a, peerKey: PEER, readRegistry })
    expect(record.name).toBe('NAS')
    const by = Object.fromEntries(holdings.map((h) => [h.key, h.what]))
    expect(by[b4a.toString(base.key, 'hex')]).toBe('vault')
    expect(by[SPACE_A]).toBe('space')
    expect(by[LIB_A]).toBe('library')
    expect(by[DRIVE_D]).toBe('drive')
    expect(by[SPACE_C]).toBe('space')
    expect(by[DRIVE_E]).toBe('drive')
    expect(by[PROFILE]).toBe('profile')
    // A Space's registry is read from its Library once it's shared.
    expect(holdings.find((h) => h.key === DRIVE_D).type).toBe('autobase')
    expect(holdings.find((h) => h.key === DRIVE_E).type).toBe('hyperdrive')
  })

  it('has nothing to hold for a key the Vault does not list', async () => {
    const out = await readHoldings({ base, b4a, peerKey: '2'.repeat(64), readRegistry })
    expect(out).toEqual({ record: null, holdings: [] })
  })

  it('follows its record, then stops and wipes once a Device removes it', async () => {
    const hosting = new Map()
    const manager = {
      async open () { throw new Error('not used') },
      async setHosting (type, key, on) { hosting.set(b4a.toString(key, 'hex'), on) },
      release () {},
      hostingState: (type, key) => ({ hosted: true, synced: key === SPACE_A, length: 10, have: key === SPACE_A ? 10 : 4 })
    }
    let removed = 0
    const peer = createPeer({
      base,
      manager: { ...manager, open: async (_t, key) => ({ reader: { read: async () => b4a.from(JSON.stringify({ drives: registries[b4a.toString(key, 'hex')] || [] })) } }) },
      b4a,
      peerKey: PEER,
      version: '0.1.0',
      goneAfterMs: 0,
      refreshMs: 60000,
      diskUsage: async () => ({ bytes: 2048, freeBytes: 1 << 30 }),
      onRemoved: () => { removed++ }
    })
    await peer.start()
    expect(peer.seen).toBe(true)
    expect(hosting.get(SPACE_A)).toBe(true)
    expect(hosting.get(DRIVE_E)).toBe(true)
    expect(hosting.has(b4a.toString(base.key, 'hex'))).toBe(false) // the Vault is the open session
    const st = peer.status()
    expect(st.kind).toBe('peer')
    expect(st.holding).toBe(7)
    expect(st.synced).toBe(2) // the Vault and SPACE_A
    expect(st.behind).toBe(6 * 5)
    expect(st.bytes).toBe(2048)

    // A Device turns the Work Space off for this Peer.
    const prev = (await readHoldings({ base, b4a, peerKey: PEER, readRegistry })).record
    const hold = peers.withSpace(prev, SPACE_C, false, [SPACE_A, SPACE_C])
    await base.append(inlineOp(peers.peerPath(PEER), peers.makePeer({ key: PEER, hold }, prev)))
    await base.update()
    await peer.refresh()
    expect(hosting.get(SPACE_C)).toBe(false)
    expect(hosting.get(DRIVE_E)).toBe(false)
    expect(hosting.get(SPACE_A)).toBe(true)

    // A Device removes the Peer: it takes two reads that miss the record, then it stops for good.
    await base.append({ op: 'del', path: peers.peerPath(PEER) })
    await base.update()
    await peer.refresh()
    await peer.refresh()
    expect(await until(() => removed === 1)).toBe(true)
    await peer.refresh()
    expect(removed).toBe(1)
  })
})

describe('the phone lists and edits the Vault\'s Peers', () => {
  it('shows each Peer with its status, turns a Space off, and removes it', async () => {
    const store = new Corestore(tmp())
    const base = openAutobaseDrive(store, null)
    await base.ready()
    await base.append(inlineOp(`/.vault/spaces/${SPACE_A}.json`, { rootDriveKey: SPACE_A, name: 'Home' }))
    await base.append(inlineOp(`/.vault/spaces/${SPACE_C}.json`, { rootDriveKey: SPACE_C, name: 'Work' }))
    await base.append(inlineOp(peers.peerPath(PEER), peers.makePeer({ key: PEER, name: 'NAS' })))
    await base.update()
    const status = peers.makeStatus({ holding: 4, synced: 3, bytes: 5 * 1024 * 1024 })
    let list = await phonePeers.listPeers(base, { connected: new Set([PEER]), statuses: new Map([[PEER, status]]) })
    expect(list).toHaveLength(1)
    expect(list[0].summary).toBe('Online · 3 of 4 synced · 5.0 MB')
    expect(list[0].spaces.map((sp) => [sp.name, sp.kept])).toEqual([['Home', true], ['Work', true]])

    await phonePeers.setPeerSpace(base, { key: PEER, rootDriveKey: SPACE_C, on: false })
    list = await phonePeers.listPeers(base)
    expect(list[0].summary).toBe('Offline')
    expect(list[0].spaces.map((sp) => sp.kept)).toEqual([true, false])
    expect(list[0].hold.spaces).toEqual([SPACE_A])

    await phonePeers.setPeerSpace(base, { key: PEER, rootDriveKey: SPACE_C, on: true })
    expect((await phonePeers.listPeers(base))[0].hold.spaces).toBe('all')

    await phonePeers.removePeer(base, { key: PEER })
    expect(await phonePeers.listPeers(base)).toEqual([])
    await expect(phonePeers.removePeer(base, { key: PEER })).rejects.toThrow('removed')
    await base.close()
    await store.close()
  })
})

describe('spike S1: a Peer mirrors an Autobase drive in full and serves it', () => {
  let testnet, owner, peer, reader
  const dirs = []
  const swarm = () => new Hyperswarm({ bootstrap: testnet.bootstrap })
  const managerAt = () => {
    const d = tmp()
    dirs.push(d)
    return new DriveManager(new Corestore(d), null, { swarm: swarm() })
  }

  beforeAll(async () => {
    const createTestnet = rq('hyperdht/testnet')
    testnet = await createTestnet(4, { teardown: () => {} })
  }, 30000)

  afterAll(async () => {
    for (const m of [owner, peer, reader]) await m?.close().catch(() => {})
    await testnet?.destroy()
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  })

  it('keeps every block and serves the file once the owner is gone', async () => {
    owner = managerAt()
    const { key, ns } = await owner.createDrive(DRIVE_AUTOBASE, { title: 'Family' })
    const photo = b4a.alloc(300 * 1024, 7) // bigger than one blob block
    await owner.writeFile(DRIVE_AUTOBASE, b4a.from(key, 'hex'), ns, '/photos/one.jpg', photo)

    peer = managerAt()
    await peer.setHosting(DRIVE_AUTOBASE, b4a.from(key, 'hex'), true)
    const synced = await until(async () => {
      const st = peer.hostingState(DRIVE_AUTOBASE, key)
      if (!st.synced) await peer._mirror(peer.drives.get(peer.cacheKey(DRIVE_AUTOBASE, key))).catch(() => {})
      return peer.hostingState(DRIVE_AUTOBASE, key).synced
    }, 30000)
    expect(synced).toBe(true)
    const st = peer.hostingState(DRIVE_AUTOBASE, key)
    expect(st.cores).toBeGreaterThanOrEqual(2) // the view and the owner's blob core
    expect(st.have).toBe(st.length)

    await owner.close()
    owner = null

    reader = managerAt()
    const entry = await reader.open(DRIVE_AUTOBASE, b4a.from(key, 'hex'))
    let got = null
    await until(async () => {
      got = await entry.reader.read('/photos/one.jpg')
      if (!got) await entry.drive.update().catch(() => {})
      return !!got
    }, 30000)
    expect(got && b4a.equals(got, photo)).toBe(true)
  }, 90000)
})
