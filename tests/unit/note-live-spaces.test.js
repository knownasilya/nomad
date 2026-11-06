// Live Notes between the people of a shared Space (shared/note-live-spaces.mjs, ADR-0041
// amendment 2): two members' Devices join one session for a Note kept in the Space, the lowest key
// that can save writes the record, and only members who can edit get onto the Space's link. The
// user's own Notes stay on the Vault hub. The network is a stand-in that checks each side's proof
// with the other's `verify` and passes JSON frames a moment later.

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { LiveNote, MSG_SYNC, MSG_AWARENESS } from '../../app/bg/notes/live-note.mjs'
import { createLiveNotes } from '../../shared/note-live-hub.mjs'
import { createLiveRouter, editorKeys } from '../../shared/note-live-spaces.mjs'
import { canEdit } from '../../shared/space-library.mjs'

const b4a = {
  from: (x, enc) => (typeof x === 'string' ? Buffer.from(x, enc) : Buffer.from(x)),
  toString: (buf, enc) => Buffer.from(buf).toString(enc)
}

const SPACE = 'cc'.repeat(32)
const LIBRARY = 'dd'.repeat(32)
const SAM = 'aa'.repeat(32) // Sam's phone's writer key in the Library: the lowest, so it leads
const ILYA = 'bb'.repeat(32) // Ilya's computer's
const ILYA_VAULT = 'ee'.repeat(32)
const SHARED = 'groceries'
const PRIVATE = 'diary'

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

// The records: the Space's Groceries (both see it) and Ilya's own diary.
function recordsOf () {
  let n = 0
  const r = {
    notes: {
      [SHARED]: { id: SHARED, body: 'Groceries\n\n- [ ] milk', updatedAt: 't0' },
      [PRIVATE]: { id: PRIVATE, body: 'Dear diary', updatedAt: 't0' }
    },
    writes: [],
    store (id, who) {
      return {
        async save (text, known) {
          const rec = r.notes[id]
          if (rec.body === text) return { note: rec }
          if (known.updatedAt && rec.updatedAt !== known.updatedAt) return { stale: rec }
          r.notes[id] = { ...rec, body: text, updatedAt: `t${++n}` }
          r.writes.push([id, who])
          return { note: r.notes[id] }
        },
        async conflict () {}
      }
    }
  }
  return r
}

// A stand-in for the swarm: every link on the same Library meets every other, once each accepts
// the other's proof (a signature is `sig:<key>`).
function network () {
  const links = []
  function meet (a, b) {
    if (a.peers.has(b.key) || a.closed || b.closed) return
    Promise.all([a.opts.verify(b.key, 'proof', 'sig:' + b.key), b.opts.verify(a.key, 'proof', 'sig:' + a.key)]).then(([aOk, bOk]) => {
      if (!aOk || !bOk || a.peers.has(b.key)) return
      a.peers.set(b.key, b)
      b.peers.set(a.key, a)
      a.opts.onPeer(b.key, true)
      b.opts.onPeer(a.key, true)
      a.send(b.key, { t: 'open', ids: a.opts.openIds() })
      b.send(a.key, { t: 'open', ids: b.opts.openIds() })
    })
  }
  return {
    makeLink (opts) {
      const link = {
        opts,
        key: opts.getDeviceKey(),
        lib: opts.getVaultKey(),
        peers: new Map(),
        closed: false,
        install () {
          if (!links.includes(link)) links.push(link)
          for (const other of links) if (other !== link && other.lib === link.lib) meet(link, other)
        },
        send (key, frame) {
          const to = link.peers.get(key)
          if (!to) return false
          const f = JSON.parse(JSON.stringify(frame))
          setTimeout(() => to.opts.onFrame(link.key, f), 1)
          return true
        },
        broadcast (frame) {
          for (const key of link.peers.keys()) link.send(key, frame)
        },
        reset () {
          link.closed = true
          for (const [key, other] of link.peers) {
            other.peers.delete(link.key)
            other.opts.onPeer(link.key, false)
          }
          link.peers.clear()
        }
      }
      return link
    }
  }
}

// One member's Device: a Vault hub for their own Notes and a router that puts the Space's Notes on
// the Space's link. `editors` are the writer keys on the editors' member records.
function member (net, records, { key, vaultKey, editors, canSave = () => true, shared = [SHARED] }) {
  const hubOf = (getDeviceKey, save) =>
    createLiveNotes({
      LiveNote,
      b4a,
      locate: async (id) => records.notes[id] || null,
      storeFor: (id) => records.store(id, getDeviceKey()),
      getDeviceKey,
      canSave: save,
      idleCloseMs: 20,
      joinWaitMs: 500
    })
  const vault = hubOf(() => vaultKey, () => true)
  const router = createLiveRouter({
    vault,
    spaceOf: async (id) => (shared.includes(id) ? SPACE : null),
    library: async (space) =>
      space === SPACE
        ? { key: LIBRARY, writerKey: key, sign: async () => 'sig:' + key, canSave, editors: async () => new Set(editors()) }
        : null,
    verifySig: async (k, _message, sig) => sig === 'sig:' + k,
    makeLink: net.makeLink,
    makeHub: (_space, lib) => hubOf(() => lib.writerKey, lib.canSave)
  })
  return { key, vault, router }
}

// A Notes page on one Device, as nomad://notes or the phone's editor joins its session.
async function page (dev, id, conn, name = conn) {
  const doc = new Y.Doc()
  const text = doc.getText('text')
  const awareness = new awarenessProtocol.Awareness(doc)
  const toHub = (bytes) => dev.router.pageReceive(id, conn, bytes)
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'hub') return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_AWARENESS)
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
    toHub(encoding.toUint8Array(e))
  })
  await dev.router.openPage(id, conn, {
    send (bytes) {
      const dec = decoding.createDecoder(bytes)
      const type = decoding.readVarUint(dec)
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.readSyncMessage(dec, enc, doc, 'hub')
        if (encoding.length(enc) > 1) toHub(encoding.toUint8Array(enc))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), 'hub')
      }
    }
  })
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeSyncStep1(enc, doc)
  toHub(encoding.toUint8Array(enc))
  doc.on('update', (u, origin) => {
    if (origin === 'hub') return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_SYNC)
    syncProtocol.writeUpdate(e, u)
    toHub(encoding.toUint8Array(e))
  })
  awareness.setLocalStateField('user', { name })
  const names = () => [...awareness.getStates().values()].map((s) => s && s.user && s.user.name).filter(Boolean)
  return { text, names, close: () => dev.router.closePage(id, conn) }
}

describe('live Notes between the people of a shared Space', () => {
  it('joins two members in one session, and one of them saves', async () => {
    const net = network()
    const records = recordsOf()
    const editors = () => [SAM, ILYA]
    const ilya = member(net, records, { key: ILYA, vaultKey: ILYA_VAULT, editors })
    const sam = member(net, records, { key: SAM, vaultKey: 'ff'.repeat(32), editors })
    await ilya.router.syncSpaces([SPACE])
    await sam.router.syncSpaces([SPACE])

    const atHome = await page(ilya, SHARED, 'ilya-page', 'Ilya')
    await until(() => atHome.text.toString().startsWith('Groceries'))
    const inStore = await page(sam, SHARED, 'sam-page', 'Sam')
    await until(() => inStore.text.toString() === atHome.text.toString())
    await until(() => ilya.router.hubOf(SPACE).session(SHARED)?.peers.has('dev:' + SAM))

    atHome.text.insert(atHome.text.length, '\n- [ ] eggs')
    inStore.text.insert(inStore.text.length, '\n- [ ] coffee')
    await until(() => atHome.text.toString() === inStore.text.toString() && atHome.text.toString().includes('eggs') && atHome.text.toString().includes('coffee'))
    // Each sees the other's name on their cursor.
    await until(() => atHome.names().includes('Sam') && inStore.names().includes('Ilya'))

    await sam.router.hubOf(SPACE).session(SHARED).flush()
    await ilya.router.hubOf(SPACE).session(SHARED).flush()
    expect(records.notes[SHARED].body).toBe(atHome.text.toString())
    // Sam's key is the lowest of the two that can save, so only Sam's Device wrote the record.
    expect(new Set(records.writes.map(([, who]) => who))).toEqual(new Set([SAM]))
    // The Space's Note never went near the Vault hub.
    expect(ilya.vault.sessions()).toBe(0)
  })

  it('keeps the user’s own Notes on their Vault hub', async () => {
    const net = network()
    const records = recordsOf()
    const ilya = member(net, records, { key: ILYA, vaultKey: ILYA_VAULT, editors: () => [ILYA] })
    await ilya.router.syncSpaces([SPACE])
    const diary = await page(ilya, PRIVATE, 'diary-page')
    await until(() => diary.text.toString() === 'Dear diary')
    expect(ilya.vault.sessions()).toBe(1)
    expect(ilya.router.hubOf(SPACE).sessions()).toBe(0)
  })

  it('lets only members who can edit onto the Space’s link', async () => {
    const net = network()
    const records = recordsOf()
    const ilya = member(net, records, { key: ILYA, vaultKey: ILYA_VAULT, editors: () => [ILYA] }) // Sam isn't listed
    const sam = member(net, records, { key: SAM, vaultKey: 'ff'.repeat(32), editors: () => [SAM, ILYA] })
    await ilya.router.syncSpaces([SPACE])
    await sam.router.syncSpaces([SPACE])
    const atHome = await page(ilya, SHARED, 'ilya-page')
    const inStore = await page(sam, SHARED, 'sam-page')
    await new Promise((r) => setTimeout(r, 50))
    expect(ilya.router.hubOf(SPACE).session(SHARED).peers.has('dev:' + SAM)).toBe(false)
    inStore.text.insert(0, 'x')
    await new Promise((r) => setTimeout(r, 30))
    expect(atHome.text.toString()).toBe('Groceries\n\n- [ ] milk')
  })

  it('sends the AI only to the hub of the Note’s own place', async () => {
    const net = network()
    const records = recordsOf()
    const editors = () => [SAM, ILYA]
    const ilya = member(net, records, { key: ILYA, vaultKey: ILYA_VAULT, editors })
    const sam = member(net, records, { key: SAM, vaultKey: 'ff'.repeat(32), editors })
    await ilya.router.syncSpaces([SPACE])
    await sam.router.syncSpaces([SPACE])
    // Sam claims to have Ilya's diary open on the Space's link.
    await until(() => sam.router.hubOf(SPACE) && ilya.router.hubOf(SPACE))
    await new Promise((r) => setTimeout(r, 20))
    ilya.router.hubOf(SPACE).onFrame(SAM, { t: 'open', ids: [PRIVATE] })
    // The diary isn't open on the Vault hub, so the AI's write goes the usual way (null), not into a
    // session on the Space's link.
    expect(await ilya.router.aiWrite(PRIVATE, 'Dear diary', 'Dear diary, hi')).toBeNull()
    expect(ilya.router.hubOf(SPACE).sessions()).toBe(0)
  })

  it('closes a Space’s link when it stops being shared here', async () => {
    const net = network()
    const ilya = member(net, recordsOf(), { key: ILYA, vaultKey: ILYA_VAULT, editors: () => [ILYA] })
    await ilya.router.syncSpaces([SPACE])
    expect(ilya.router.spaces()).toEqual([SPACE])
    await ilya.router.syncSpaces([])
    expect(ilya.router.spaces()).toEqual([])
  })

  it('reads the editors’ writer keys off the member records', () => {
    const k = (c) => c.repeat(64)
    const members = [
      { role: 'owner', writers: [k('1'), k('2')] },
      { role: 'editor', writers: [k('3'), 'nope'] },
      { role: 'viewer', writers: [k('4')] },
      { role: 'editor' }
    ]
    expect([...editorKeys(members, canEdit)].sort()).toEqual([k('1'), k('2'), k('3')])
  })
})
