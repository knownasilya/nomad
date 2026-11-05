// The live Note sessions of two Devices, a computer and a phone (shared/note-live-hub.mjs, ADR-0041):
// they find each other's open Notes over the link's frames, join one session, and the one that
// leads saves the record. The AI on the computer types into a Note open only on the phone. The
// link is a stand-in that passes JSON frames a moment later, as over the network.

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { LiveNote, MSG_SYNC, MSG_AWARENESS } from '../../app/bg/notes/live-note.mjs'
import { createLiveNotes } from '../../shared/note-live-hub.mjs'
import { forgetClients } from '../../app/userland/notes/js/live.js'

// Just what the hub uses of b4a.
const b4a = {
  from: (x, enc) => (typeof x === 'string' ? Buffer.from(x, enc) : Buffer.from(x)),
  toString: (buf, enc) => Buffer.from(buf).toString(enc)
}

const ID = 'note-1'
const DESKTOP = 'bb'.repeat(32)
const PHONE = 'aa'.repeat(32) // the lower key: it leads when it can save

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

// The Vault both Devices see: one record, and who wrote each version.
function vaultOf (body) {
  let n = 0
  const v = {
    rec: { id: ID, body, updatedAt: 't0' },
    writes: [],
    store (who) {
      return {
        async save (text, known) {
          if (v.rec.body === text) return { note: v.rec }
          if (known.updatedAt && v.rec.updatedAt !== known.updatedAt) return { stale: v.rec }
          v.rec = { ...v.rec, body: text, updatedAt: `t${++n}` }
          v.writes.push(who)
          return { note: v.rec }
        },
        async conflict () {}
      }
    }
  }
  return v
}

function device (key, vault, { canSave = () => true } = {}) {
  const dev = { key, frames: [] }
  dev.notes = createLiveNotes({
    LiveNote,
    b4a,
    locate: async () => vault.rec,
    storeFor: () => vault.store(key),
    getDeviceKey: () => key,
    canSave,
    idleCloseMs: 20,
    joinWaitMs: 500
  })
  return dev
}

// Connect two Devices as the link would once both checked each other: each gets the other's OPEN.
function connect (a, b) {
  const deliver = (from, to) => (key, frame) => {
    if (key !== to.key) return false
    const f = JSON.parse(JSON.stringify(frame))
    setTimeout(() => to.notes.onFrame(from.key, f), 1)
    return true
  }
  const linkOf = (from, to) => ({
    send: deliver(from, to),
    broadcast: (frame) => deliver(from, to)(to.key, frame)
  })
  a.notes.useLink(linkOf(a, b))
  b.notes.useLink(linkOf(b, a))
  b.notes.onFrame(a.key, { t: 'open', ids: a.notes.openIds() })
  a.notes.onFrame(b.key, { t: 'open', ids: b.notes.openIds() })
}

// A Notes page: a Y.Doc synced with its Device's session, like nomad://notes or the phone's editor.
async function page (dev, conn) {
  const doc = new Y.Doc()
  const text = doc.getText('text')
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalStateField('user', { name: conn })
  const seen = [] // every user state that showed up
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'hub') return forgetClients(awareness, removed) // as live.js does
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MSG_AWARENESS)
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
    toHub(encoding.toUint8Array(e))
  })
  awareness.on('change', () => {
    for (const st of awareness.getStates().values()) if (st && st.user) seen.push(st.user)
  })
  const toHub = (bytes) => dev.notes.pageReceive(ID, conn, bytes)
  const status = await dev.notes.openPage(ID, conn, {
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
  return { doc, text, awareness, seen, status, close: () => dev.notes.closePage(ID, conn) }
}

describe('live Notes across a computer and a phone', () => {
  it('joins the same Note open on both, and their edits meet', async () => {
    const vault = vaultOf('Groceries\n\nmilk')
    const desktop = device(DESKTOP, vault)
    const phone = device(PHONE, vault)
    connect(desktop, phone)

    const onPhone = await page(phone, 'phone-page')
    await until(() => onPhone.text.toString() === 'Groceries\n\nmilk')
    const onDesktop = await page(desktop, 'desktop-page')
    await until(() => onDesktop.text.toString() === 'Groceries\n\nmilk')
    await until(() => desktop.notes.session(ID).peers.has('dev:' + PHONE) && phone.notes.session(ID).peers.has('dev:' + DESKTOP))

    onPhone.text.insert(onPhone.text.length, '\neggs')
    onDesktop.text.insert(0, '# ')
    await until(() => onDesktop.text.toString() === '# Groceries\n\nmilk\neggs' && onPhone.text.toString() === onDesktop.text.toString())

    // The phone has the lower key, so it saves; the computer doesn't write the record too.
    await phone.notes.session(ID).flush()
    await desktop.notes.session(ID).flush()
    expect(vault.rec.body).toBe('# Groceries\n\nmilk\neggs')
    expect(new Set(vault.writes)).toEqual(new Set([PHONE]))
    expect(phone.notes.session(ID).status().devices).toBe(1)
  })

  it('lets the AI on the computer type into a Note open only on the phone, with its cursor', async () => {
    const vault = vaultOf('Plan\n\n- call the vet')
    const desktop = device(DESKTOP, vault)
    const phone = device(PHONE, vault)
    connect(desktop, phone)

    const onPhone = await page(phone, 'phone-page')
    await until(() => onPhone.text.toString().startsWith('Plan'))
    await new Promise((r) => setTimeout(r, 10)) // the phone's OPEN reaches the computer
    expect(desktop.notes.isOpen(ID)).toBe(true)

    const res = await desktop.notes.aiWrite(ID, 'Plan\n\n- call the vet', 'Plan\n\n- call the vet\n- book the car in', { pace: 1 })
    expect(res && res.note && res.note.body).toBe('Plan\n\n- call the vet\n- book the car in')
    expect(onPhone.text.toString()).toBe('Plan\n\n- call the vet\n- book the car in')
    // The phone's editor drew the AI's cursor while it typed.
    expect(onPhone.seen.some((u) => u.ai && u.name === 'AI')).toBe(true)
    expect(vault.writes).toContain(PHONE)
  })

  it('leaves saving to the computer while the phone can’t write the Vault', async () => {
    const vault = vaultOf('Draft')
    const desktop = device(DESKTOP, vault)
    const phone = device(PHONE, vault, { canSave: () => false })
    connect(desktop, phone)

    const onDesktop = await page(desktop, 'desktop-page')
    const onPhone = await page(phone, 'phone-page')
    await until(() => desktop.notes.session(ID).peers.has('dev:' + PHONE) && phone.notes.session(ID).peers.has('dev:' + DESKTOP))
    await until(() => onPhone.text.toString() === 'Draft' && onDesktop.text.toString() === 'Draft')

    onPhone.text.insert(5, ' two')
    await until(() => onDesktop.text.toString() === 'Draft two')
    await phone.notes.session(ID).flush()
    await desktop.notes.session(ID).flush()
    expect(vault.rec.body).toBe('Draft two')
    expect(vault.writes).toEqual([DESKTOP])
  })

  it('shows the phone’s cursor again at once when the Devices reconnect', async () => {
    const vault = vaultOf('Draft')
    const desktop = device(DESKTOP, vault)
    const phone = device(PHONE, vault)
    connect(desktop, phone)
    const onDesktop = await page(desktop, 'desktop-page')
    const onPhone = await page(phone, 'phone-page')
    await until(() => onPhone.text.toString() === 'Draft' && onDesktop.text.toString() === 'Draft')
    onPhone.awareness.setLocalStateField('cursor', {
      anchor: Y.createRelativePositionFromTypeIndex(onPhone.text, 1),
      head: Y.createRelativePositionFromTypeIndex(onPhone.text, 3)
    })
    const phoneOnDesktop = () => onDesktop.awareness.getStates().get(onPhone.doc.clientID)
    await until(() => phoneOnDesktop()?.cursor)

    // The connection drops and comes back. Nothing on the phone changes meanwhile, so its
    // awareness clock is the one the computer already saw.
    desktop.notes.onPeer(PHONE, false)
    phone.notes.onPeer(DESKTOP, false)
    await until(() => !phoneOnDesktop())
    connect(desktop, phone)
    await until(() => phoneOnDesktop()?.cursor, 500) // not after the 15 s renewal
    expect(phoneOnDesktop().user).toEqual({ name: 'phone-page' })
  })

  it('saves the phone’s last edit as its page leaves, then closes the session', async () => {
    const vault = vaultOf('Note')
    const phone = device(PHONE, vault)
    const onPhone = await page(phone, 'phone-page')
    await until(() => onPhone.text.toString() === 'Note')
    onPhone.text.insert(4, '!')
    await until(() => phone.notes.session(ID).text() === 'Note!')
    await onPhone.close()
    expect(vault.rec.body).toBe('Note!')
    await until(() => phone.notes.sessions() === 0)
  })
})
