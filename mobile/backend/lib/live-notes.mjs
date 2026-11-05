// Live Notes on the phone (ADR-0041): the session of a Note open in the phone's editor, joined to
// the same Note open on the user's computers, so their edits and the AI's (typed in on a computer,
// with its cursor) show here as they happen, and the phone's show there.
//
//   the Notes editor (WebView) ── RN ── RPC_NOTE_LIVE ──┐
//                                                       ├ LiveNote (Yjs) ── the Note record
//   a computer's session ── the nomad/note-live link ───┘
//
// The sessions and their frames are shared/note-live-hub.mjs and shared/note-live-session.mjs, the
// same code desktop runs (app/bg/notes/live-notes.js); the link is shared/note-live.mjs. This file
// gives them the phone's Yjs, swarm, Vault and records.
//
// Yjs's lib0 reaches for `node:crypto` for random client ids, which the Bare worklet doesn't have:
// tools/bare-imports.cjs points it at ./node-crypto-shim.mjs when the backend is bundled.

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { createNoteLink } from '../../../shared/note-live.mjs'
import { createLiveNotes } from '../../../shared/note-live-hub.mjs'
import { makeLiveNote } from '../../../shared/note-live-session.mjs'
import { isNoteId } from '../../../shared/vault-apps.mjs'
import { readVaultIndex } from './vault.mjs'
import * as vaultApps from './vault-apps.mjs'

const { LiveNote } = makeLiveNote({ Y, syncProtocol, awarenessProtocol, encoding, decoding })

const CONN_RE = /^[a-z0-9-]{4,64}$/i

/**
 * swarm, store   the backend's Hyperswarm and Corestore
 * getVault()     the opened Vault Autobase, or null before pairing
 * emit(event)    to the UI: { id, conn, kind: 'message' | 'status' | 'failed', data?, status?, message? }
 */
export function createPhoneLiveNotes ({ swarm, store, getVault, emit }) {
  const vaultKeyHex = () => {
    const v = getVault()
    return v && v.key ? b4a.toString(v.key, 'hex') : null
  }
  const deviceKeyHex = () => {
    const v = getVault()
    return v && v.local && v.local.key ? b4a.toString(v.local.key, 'hex') : null
  }

  const notes = createLiveNotes({
    LiveNote,
    b4a,
    locate: (id, ctx) => {
      const v = getVault()
      return v ? vaultApps.locateNote(v, id, ctx && ctx.space) : null
    },
    storeFor: (id, ctx) => vaultApps.liveNoteStore(getVault, id, ctx && ctx.space),
    getDeviceKey: deviceKeyHex,
    // Only a Vault writer saves the record; until this phone is one, a computer in the session does.
    canSave: () => !!getVault()?.writable,
    log: (...args) => console.log('[notes-live]', ...args)
  })

  let link = null
  function install () {
    if (!swarm) return
    if (!link) {
      link = createNoteLink({
        swarm,
        Protomux,
        c,
        b4a,
        getVaultKey: vaultKeyHex,
        getDeviceKey: deviceKeyHex,
        randomHex: () => b4a.toString(crypto.randomBytes(32), 'hex'),
        sign: async (message) => {
          const kp = getVault()?.local?.keyPair
          if (!kp?.secretKey) return ''
          return b4a.toString(crypto.sign(b4a.from(message), kp.secretKey), 'hex')
        },
        verify: verifyDevice,
        openIds: () => notes.openIds(),
        onPeer: (key, up) => notes.onPeer(key, up),
        onFrame: (key, f) => notes.onFrame(key, f).catch((err) => console.log('[notes-live] frame failed', err && err.message)),
        log: (...args) => console.log('[notes-live]', ...args)
      })
      notes.useLink(link)
    }
    link.install()
  }

  // The Vault changed hands (linked, unlinked, removed): drop every session and channel.
  function reset () {
    notes.closeAll()
    if (link) link.reset()
  }

  // A Vault Device, and its signature over `message` by the signer of its Vault writer core (as
  // desktop's verifyDevice).
  async function verifyDevice (key, message, sigHex) {
    try {
      const v = getVault()
      if (!v) return false
      const { devices } = await readVaultIndex(v)
      if (!devices.some((d) => d.key === key)) return false
      const core = store.get({ key: b4a.from(key, 'hex') })
      await core.ready()
      const signer = core.manifest?.signers?.[0]
      const pub = signer?.publicKey || b4a.from(key, 'hex')
      const sig = b4a.from(sigHex, 'hex')
      return sig.length === 64 && crypto.verify(b4a.from(message), sig, pub)
    } catch (err) {
      console.log('[notes-live] verify failed', err && err.message)
      return false
    }
  }

  // This phone as the editor shows it to the others: its name in the Vault, and its key for a color.
  async function me () {
    const key = deviceKeyHex()
    try {
      const { devices } = await readVaultIndex(getVault())
      const d = devices.find((x) => x.key === key)
      return { key, name: (d && d.name) || 'Phone' }
    } catch {
      return { key, name: 'Phone' }
    }
  }

  const pages = new Map() // conn -> { id, closed }

  // The UI's RPC_NOTE_LIVE: { action: 'open' | 'send' | 'close', id, conn, data?, space? }.
  async function handle ({ action, id, conn, data, space }) {
    if (!isNoteId(id)) throw new Error('Not a note id')
    if (typeof conn !== 'string' || !CONN_RE.test(conn)) throw new Error('Bad connection id')
    if (action === 'open') {
      const v = getVault()
      if (!v) throw new Error('Link this phone to use Notes')
      if (!(await vaultApps.canWriteNote(v, id, space))) throw new Error('This note is read only here')
      install()
      const page = { id, closed: false }
      pages.set(conn, page)
      const status = await notes.openPage(id, conn, {
        ctx: { space: space || null },
        send: (bytes) => emit({ id, conn, kind: 'message', data: b4a.toString(b4a.from(bytes), 'base64') }),
        onStatus: (st) => emit({ id, conn, kind: 'status', status: st }),
        isClosed: () => page.closed
      })
      return { status, me: await me() }
    }
    if (action === 'send') {
      return notes.pageReceive(id, conn, new Uint8Array(b4a.from(String(data || ''), 'base64')))
    }
    if (action === 'close') {
      const page = pages.get(conn)
      if (page) page.closed = true
      pages.delete(conn)
      await notes.closePage(id, conn)
      return true
    }
    throw new Error('Unknown live note action: ' + action)
  }

  return {
    install,
    reset,
    handle,
    // The Vault (or a Space Library) changed: the leader folds a change made elsewhere in.
    recordsChanged: () => notes.recordsChanged(),
    isOpen: (id) => notes.isOpen(id)
  }
}
