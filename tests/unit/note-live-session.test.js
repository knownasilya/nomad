// A live Note session (app/bg/notes/live-note.mjs, ADR-0041): pages and other Devices join it over
// y-protocols messages, the AI types into it, the leader saves the record and folds in changes made
// outside the session. Everything in memory: a store stands in for the Vault.

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { LiveNote, preferSession, seedClientId, MSG_SYNC, MSG_AWARENESS, MSG_RESET } from '../../app/bg/notes/live-note.mjs'

const tick = () => new Promise((r) => setTimeout(r, 0))

function memStore (record) {
  let rec = { ...record }
  let n = 0
  const store = {
    get: () => rec,
    copies: [],
    // What another Device (or the phone) does: write the record directly.
    outside (body) { rec = { ...rec, body, updatedAt: `t${++n}-outside` }; return rec },
    async save (body, known) {
      if (rec.body === body) return { note: rec }
      if (known.updatedAt && rec.updatedAt !== known.updatedAt) return { stale: rec }
      rec = { ...rec, body, updatedAt: `t${++n}` }
      return { note: rec }
    },
    async conflict (body) { store.copies.push(body) },
  }
  return store
}

// A page: its own Y.Doc and awareness, synced with the session like nomad://notes (./live.js).
function page (live, name, peerId) {
  const doc = new Y.Doc()
  const text = doc.getText('text')
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalStateField('user', { name })
  const resets = []
  const toHub = (bytes) => live.receive(peerId, bytes)
  live.addPeer(peerId, (bytes) => {
    const dec = decoding.createDecoder(bytes)
    const type = decoding.readVarUint(dec)
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.readSyncMessage(dec, enc, doc, 'hub')
      if (encoding.length(enc) > 1) toHub(encoding.toUint8Array(enc))
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), 'hub')
    } else if (type === MSG_RESET) resets.push(1)
  })
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeSyncStep1(enc, doc)
  toHub(encoding.toUint8Array(enc))
  const aw = encoding.createEncoder()
  encoding.writeVarUint(aw, MSG_AWARENESS)
  encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]))
  toHub(encoding.toUint8Array(aw))
  doc.on('update', (u, origin) => {
    if (origin === 'hub') return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_SYNC)
    syncProtocol.writeUpdate(e, u)
    toHub(encoding.toUint8Array(e))
  })
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin !== 'local') return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_AWARENESS)
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
    toHub(encoding.toUint8Array(e))
  })
  return { doc, text, awareness, resets }
}

// Two sessions on two Devices, joined as each other's device peer. Messages arrive a moment later,
// as over the network, so both sides have added each other before the first one lands.
async function link (a, b) {
  a.addPeer('dev:' + b.deviceKey, (bytes) => queueMicrotask(() => b.receive('dev:' + a.deviceKey, bytes)), { kind: 'device' })
  b.addPeer('dev:' + a.deviceKey, (bytes) => queueMicrotask(() => a.receive('dev:' + b.deviceKey, bytes)), { kind: 'device' })
  await settle()
}

async function settle () {
  for (let i = 0; i < 20; i++) await tick()
}

const REC = { body: '# Groceries\nmilk\neggs\n', updatedAt: 't0' }
const make = (store, deviceKey, isLeader = () => true) =>
  new LiveNote({ id: 'n1', record: store.get(), deviceKey, store, isLeader, saveDelay: 1 })

describe('LiveNote', () => {
  it('gives a page the note and takes its typing', async () => {
    const store = memStore(REC)
    const live = make(store, 'a')
    const p = page(live, 'Laptop', 'page:1')
    expect(p.text.toString()).toBe(REC.body)
    p.text.insert(p.text.length, 'bread\n')
    expect(live.text()).toBe(REC.body + 'bread\n')
    await live.flush()
    expect(store.get().body).toBe(REC.body + 'bread\n')
    live.close()
  })

  it('types the AI’s change in with its own cursor, beside the user’s typing', async () => {
    const store = memStore(REC)
    const live = make(store, 'a')
    const p = page(live, 'Laptop', 'page:1')
    p.text.insert(0, 'X') // the user types at the top while the AI works
    const cursors = []
    p.awareness.on('change', () => {
      for (const [, st] of p.awareness.getStates()) if (st.user?.ai && st.cursor) cursors.push(st.cursor)
    })
    const ok = await live.aiEdit(REC.body, '# Groceries\nmilk\neggs\nbutter\n', { pace: 0 })
    expect(ok).toBe(true)
    expect(p.text.toString()).toBe('X# Groceries\nmilk\neggs\nbutter\n')
    expect(cursors.length).toBeGreaterThan(0)
    await tick()
    // Its cursor goes once it's done.
    expect([...p.awareness.getStates().values()].some((st) => st.user?.ai)).toBe(false)
    live.close()
  })

  it('refuses an AI change to text the user changed since it read it', async () => {
    const store = memStore(REC)
    const live = make(store, 'a')
    const p = page(live, 'Laptop', 'page:1')
    p.text.delete(REC.body.indexOf('milk'), 4)
    p.text.insert(REC.body.indexOf('milk'), 'oat milk')
    expect(await live.aiEdit(REC.body, REC.body.replace('milk', 'whole milk'), { pace: 0 })).toBe(false)
    live.close()
  })

  it('merges two Devices typing at once, and only the leader saves', async () => {
    const store = memStore(REC)
    const a = make(store, 'a', () => true)
    const b = make(store, 'b', () => false)
    await link(a, b)
    const pa = page(a, 'Laptop', 'page:a')
    const pb = page(b, 'Phone', 'page:b')
    await settle()
    // Both started from the same record, so the seed text isn't doubled.
    expect(pb.text.toString()).toBe(REC.body)
    pa.text.insert(0, 'A ')
    pb.text.insert(pb.text.length, 'B\n')
    await settle()
    expect(pa.text.toString()).toBe('A ' + REC.body + 'B\n')
    expect(pb.text.toString()).toBe(pa.text.toString())
    // Cursors cross over too.
    expect([...pa.awareness.getStates().values()].some((st) => st.user?.name === 'Phone')).toBe(true)
    await a.flush()
    await b.flush()
    expect(store.get().body).toBe('A ' + REC.body + 'B\n')
    expect(store.get().updatedAt).toBe('t1') // one save: the leader's
    a.close(); b.close()
  })

  it('folds a change made outside the session into it', async () => {
    const store = memStore(REC)
    const live = make(store, 'a')
    const p = page(live, 'Laptop', 'page:1')
    p.text.insert(0, 'TOP ') // typed here, not saved yet
    const rec = store.outside(REC.body + 'apples\n') // the phone saved meanwhile
    await live.checkRecord(rec)
    expect(p.text.toString()).toBe('TOP ' + REC.body + 'apples\n')
    await live.flush()
    expect(store.get().body).toBe('TOP ' + REC.body + 'apples\n')
    expect(store.copies).toEqual([])
    live.close()
  })

  it('keeps an outside change that can’t merge as a conflict copy', async () => {
    const store = memStore(REC)
    const live = make(store, 'a')
    const p = page(live, 'Laptop', 'page:1')
    const at = REC.body.indexOf('eggs')
    p.text.delete(at, 4)
    p.text.insert(at, 'EGGS')
    await live.checkRecord(store.outside(REC.body.replace('eggs', 'eggz')))
    expect(store.copies).toEqual([REC.body.replace('eggs', 'eggz')])
    expect(p.text.toString()).toBe(REC.body.replace('eggs', 'EGGS'))
    live.close()
  })

  it('joins another session that started from a different version, keeping its own edits', async () => {
    const storeA = memStore(REC)
    const a = make(storeA, 'a')
    const pa = page(a, 'Laptop', 'page:a')
    pa.text.insert(pa.text.length, 'from A\n')
    const storeB = memStore({ body: REC.body + 'older\n', updatedAt: 't-1' })
    const b = make(storeB, 'b')
    const pb = page(b, 'Phone', 'page:b')
    pb.text.insert(0, 'B: ')
    expect(preferSession(a.info(), b.info())).toBe(true) // newer seed wins when both edited
    b.reset(a.state(), a.info())
    expect(pb.resets.length).toBe(1)
    expect(b.text()).toBe('B: ' + REC.body + 'from A\n')
    await link(a, b)
    expect(a.text()).toBe(b.text())
    expect(pa.text.toString()).toBe('B: ' + REC.body + 'from A\n')
    a.close(); b.close()
  })

  it('seeds the same record the same way on every Device', () => {
    expect(seedClientId('n1', 't0', 'x')).toBe(seedClientId('n1', 't0', 'x'))
    expect(seedClientId('n1', 't0', 'x')).not.toBe(seedClientId('n1', 't1', 'x'))
  })
})
