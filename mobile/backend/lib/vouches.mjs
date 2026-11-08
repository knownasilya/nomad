// Vouches on the phone (ADR-0045): the same engine as desktop (shared/vouch-engine.mjs), with this
// phone's copy of the Vault, its Personas (the Inbox's writer check, lib/inbox.mjs) and the Profile
// Drives it can open and write. The phone takes Vouches in from Messages, accepts, declines and
// removes them, picks where each shows (writing the list on the profile where this phone writes
// the drive), renews and withdraws the ones the user gave, and shows a profile's Vouches.
//
// backend.mjs makes it once (createPhoneVouches) and hands it the Vault whenever that changes. The
// UI reaches it over RPC_APPS `vouches` (handle()).

import b4a from 'b4a'
import sodium from 'sodium-universal'
import hcrypto from 'hypercore-crypto'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as I from '../../../shared/inbox.mjs'
import * as V from '../../../shared/vouches.mjs'
import { NAMES_PREFIX } from '../../../shared/names.mjs'
import { createVouchEngine } from '../../../shared/vouch-engine.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'

const sha256hex = (s) => {
  const out = b4a.alloc(32)
  sodium.crypto_hash_sha256(out, b4a.from(s))
  return b4a.toString(out, 'hex')
}

// deps from backend.mjs:
//   inbox                      createPhoneInbox(): personas(), send(o), thread(pid, url)
//   openProfile(url, ms)       -> { drive, reader } | null
//   writeProfileFile(url, path, bytes | null) -> writes (or deletes) a file where this phone writes it
//   onChange()                 the UI should reload (RPC_VAULT_CHANGED)
export function createPhoneVouches (deps) {
  let vault = null
  let timer = null

  const store = {
    async read (path) {
      if (!vault) return null
      const node = await vault.view.get(path)
      return node ? decodeInlineJson(node.value, b4a) : null
    },
    async list (prefix) {
      const out = []
      if (!vault) return out
      for await (const node of vault.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
        const rec = decodeInlineJson(node.value, b4a)
        if (rec) out.push(rec)
      }
      return out
    },
    async listPaths (prefix) {
      const out = []
      if (!vault) return out
      for await (const node of vault.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) out.push(typeof node.key === 'string' ? node.key : b4a.toString(node.key))
      return out
    },
    async put (path, obj) {
      if (!vault?.writable) throw new Error('This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
      await vault.append(inlineOp(path, obj))
      await vault.update()
    },
    async del (path) {
      if (!vault?.writable) throw new Error('This phone can’t write to your Vault yet.')
      await vault.append({ op: 'del', path })
      await vault.update()
    }
  }

  // A Profile Drive's file: null when the drive can't be read now or hasn't synced its manifest.
  async function readProfileFile (url, path) {
    const entry = await deps.openProfile(url, 8000).catch(() => null)
    if (!entry) return null
    await entry.drive?.update?.().catch(() => {})
    const read = async (p) => {
      const buf = await entry.reader.read(p).catch(() => null)
      try { return buf ? JSON.parse(b4a.toString(buf)) : null } catch { return null }
    }
    const manifest = await read('/index.json')
    if (!manifest) return null
    if (path === '/index.json') return { value: manifest }
    return { value: await read(path) }
  }

  async function writeProfileFile (personaId, path, obj) {
    const p = deps.inbox.personas().find((x) => x.id === personaId)
    if (!p) return false
    const entry = await deps.openProfile(p.profileUrl, 8000).catch(() => null)
    if (!entry?.drive?.writable) return false
    await deps.writeProfileFile(p.profileUrl, path, obj == null ? null : b4a.from(JSON.stringify(obj, null, 2)))
    return true
  }

  // People the user knows (§6): Contacts and Names that point at a drive.
  async function known () {
    const out = new Set()
    for (const c of await store.list(I.CONTACTS_PREFIX).catch(() => [])) {
      if (I.isContact(c) && c.state === 'accepted') out.add(I.profileKeyOf(c.profileUrl))
    }
    for (const n of await store.list(NAMES_PREFIX).catch(() => [])) {
      const key = V.profileKeyOf(n?.url)
      if (key) out.add(key)
    }
    out.delete(null)
    return [...out]
  }

  const engine = createVouchEngine({
    store,
    sha256hex,
    randomBytes: (n) => new Uint8Array(hcrypto.randomBytes(n)),
    personas: () => deps.inbox.personas(),
    readProfileFile,
    writeProfileFile,
    send: ({ personaId, to, vouch, replyTo }) => deps.inbox.send({ personaId, to, text: '', vouch, replyTo: replyTo || null }),
    reachable: async (personaId, profileUrl) => !!(await deps.inbox.thread(personaId, profileUrl))?.reachable,
    known,
    onChange: () => deps.onChange?.()
  })

  function soon () {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!vault?.writable) return
      engine.intake().catch((e) => console.log('[vouches] intake', e?.message || e))
    }, 2000)
  }

  return {
    setVault (base) {
      vault = base || null
      soon()
    },
    vaultUpdated: soon,
    close () {
      clearTimeout(timer)
    },

    // RPC_APPS `vouches`
    async handle (action, args) {
      if (!vault) throw new Error('Link this phone to your computer to use vouches')
      const s = (v) => String(v || '')
      if (action === 'list') {
        await boundedUpdate(vault)
        await deps.inbox.refreshPersonas?.()
        await engine.intake().catch(() => {})
        return engine.summary()
      }
      if (action === 'accept') return engine.accept(s(args.personaId), s(args.id))
      if (action === 'decline') return engine.decline(s(args.personaId), s(args.id))
      if (action === 'setShown') return engine.setShown(s(args.personaId), s(args.id), s(args.shown))
      if (action === 'renew') return engine.renew(s(args.personaId), s(args.id))
      if (action === 'withdraw') return engine.withdraw(s(args.personaId), s(args.id))
      if (action === 'forget') return engine.forgetGiven(s(args.personaId), s(args.id))
      if (action === 'profile') return engine.profileVouches(s(args.url))
      if (action === 'forgetPersona') return engine.forgetPersona(s(args.personaId))
      throw new Error(`Unknown vouches action: ${action}`)
    }
  }
}
