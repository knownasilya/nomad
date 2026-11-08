// The Persona Inbox on the phone (ADR-0036 §9): the same engine as desktop
// (shared/inbox-engine.mjs), with this phone's DHT node, its copy of the Vault and its Personas.
// The phone answers its own mailbox while the backend runs (the app on screen, and for
// BACKGROUND_GRACE_MS after it leaves, mobile/lib/useBackend.ts), sends from its own outbox, and
// sees everything the user's computer received through the Vault.
//
// backend.mjs makes it once (createPhoneInbox) and hands it the Vault whenever that changes.
// The UI reaches it over RPC_APPS `messages` (handle()).

import b4a from 'b4a'
import sodium from 'sodium-universal'
import hcrypto from 'hypercore-crypto'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as I from '../../../shared/inbox.mjs'
import * as pe from '../../../shared/personas.mjs'
import { createInboxEngine, dhtTransport } from '../../../shared/inbox-engine.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'

const CHECK_MS = 60 * 1000

// deps from backend.mjs:
//   dht                      manager.swarm.dht
//   openProfile(url, ms)     -> { drive, reader } | null (a Profile Drive, where this phone writes it)
//   profileWriters(base)     -> [writerKey]
//   writeProfileJson(url, manifest) -> writes /index.json where this phone writes the drive
//   onChange()               the UI should reload (RPC_VAULT_CHANGED)
export function createPhoneInbox (deps) {
  let vault = null
  let engine = null
  let personas = [] // [{ id, label, profileUrl, usable }]
  let deviceKeys = []
  let checkTimer = null
  let checking = null

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

  const ownKey = () => (vault?.local?.key ? b4a.toString(vault.local.key, 'hex') : null)

  // The writer check for each Persona (ADR-0031 §5): an Inbox runs only on a usable one (§7.3).
  function refreshPersonas () {
    if (checking) return checking
    checking = (async () => {
      if (!vault) {
        personas = []
        deviceKeys = []
        return
      }
      const [recs, asks, devices] = await Promise.all([
        store.list(pe.PERSONAS_PREFIX),
        store.list(pe.WRITERS_PREFIX),
        store.list('/.vault/devices/')
      ])
      deviceKeys = devices.map((d) => d && d.key).filter(Boolean)
      const next = []
      for (const p of recs.filter(pe.isPersona)) {
        const prev = personas.find((x) => x.id === p.id)
        let usable = prev?.usable || false
        const entry = await deps.openProfile(p.profileUrl, 8000).catch(() => null)
        if (entry?.drive) {
          const writers = await deps.profileWriters(entry.drive).catch(() => null)
          const driveKey = pe.driveKeyOf(p.profileUrl)
          const st = pe.profileState({
            persona: p,
            vaultReady: !!vault.writable,
            deviceKeys,
            writers,
            ownWriters: pe.ownWriterKeys(asks.filter(pe.isWriterAsk), { driveKey, deviceKeys })
          })
          if (st.state !== 'not-ready') usable = st.state === 'usable'
        }
        next.push({ id: p.id, label: p.label, profileUrl: p.profileUrl, usable })
      }
      personas = next
    })().finally(() => { checking = null })
    return checking
  }

  async function readProfile (url) {
    const entry = await deps.openProfile(url, 8000).catch(() => null)
    if (!entry) return null
    await entry.drive?.update?.().catch(() => {})
    const buf = await entry.reader.read('/index.json').catch(() => null)
    try {
      return buf ? JSON.parse(b4a.toString(buf)) : null
    } catch {
      return null
    }
  }

  async function writeProfileInbox (id, inbox) {
    const p = personas.find((x) => x.id === id)
    if (!p) return false
    const entry = await deps.openProfile(p.profileUrl, 8000).catch(() => null)
    if (!entry?.drive?.writable) return false
    const prev = (await readProfile(p.profileUrl)) || { type: 'walled.garden/person', title: p.label }
    const next = { ...prev }
    if (inbox) next.inbox = inbox
    else delete next.inbox
    await deps.writeProfileJson(p.profileUrl, next)
    return true
  }

  function start () {
    engine = createInboxEngine({
      crypto: I.cryptoFromSodium(sodium),
      randomBytes: (n) => new Uint8Array(hcrypto.randomBytes(n)),
      sha256hex: (s) => {
        const out = b4a.alloc(32)
        sodium.crypto_hash_sha256(out, b4a.from(s))
        return b4a.toString(out, 'hex')
      },
      store,
      ...dhtTransport(deps.dht, deps.dht.constructor, b4a),
      personas: () => personas,
      vaultReady: () => !!vault?.writable,
      deviceKey: ownKey,
      deviceKeys: () => deviceKeys,
      readProfile,
      writeProfileInbox,
      // The phone shows notifications from the UI (useMessageNotifications), for Messages any
      // Device received, so this one stays quiet.
      onChange: () => deps.onChange?.(),
      log: {
        info: (msg) => console.log('[inbox]', msg),
        warn: (msg, o) => console.log('[inbox]', msg, o?.error || '')
      }
    })
    engine.start()
    checkTimer = setInterval(() => { refreshPersonas().then(() => engine.poke()).catch(() => {}) }, CHECK_MS)
  }

  return {
    // The Vault opened, changed or went away.
    async setVault (base) {
      vault = base || null
      await refreshPersonas().catch(() => {})
      if (!engine && vault) start()
      engine?.poke()
    },
    vaultUpdated () {
      if (!engine) return
      refreshPersonas().then(() => engine.poke()).catch(() => {})
    },
    // The app came back to the screen: listen again and try the outbox at once.
    resume () {
      if (!engine) return
      engine.poke()
      engine.flush().catch(() => {})
    },
    async close () {
      clearInterval(checkTimer)
      await engine?.close()
    },

    // For Vouches (lib/vouches.mjs, ADR-0045): the Personas with their writer check, sending a
    // Message that carries a Vouch, and whether someone can be reached.
    personas: () => personas,
    refreshPersonas: () => refreshPersonas(),
    send: (o) => {
      if (!engine) throw new Error('Link this phone to your computer to use Messages')
      return engine.send(o)
    },
    thread: (personaId, profileUrl) => {
      if (!engine) throw new Error('Link this phone to your computer to use Messages')
      return engine.thread(personaId, profileUrl)
    },
    readProfile: (url) => readProfile(url),
    // Invite links (ADR-0040, lib/invites.mjs): sign with a Persona's key; read a profile's.
    signInvite: (personaId, bytes) => {
      if (!engine) throw new Error('Link this phone to your computer first')
      return engine.signInvite(personaId, bytes)
    },
    publishedSign: (profileUrl) => (engine ? engine.publishedSign(profileUrl) : Promise.resolve(null)),

    // RPC_APPS `messages`
    async handle (action, args) {
      if (!engine) throw new Error('Link this phone to your computer to use Messages')
      const s = (v) => String(v || '')
      if (action === 'summary') {
        await boundedUpdate(vault)
        await refreshPersonas()
        return engine.summary()
      }
      if (action === 'thread') return engine.thread(s(args.personaId), s(args.profileUrl))
      if (action === 'lookup') return engine.lookup(s(args.profileUrl))
      if (action === 'parseLink') return I.parseMessageLink(s(args.link))
      if (action === 'send') {
        const parsed = args.link ? I.parseMessageLink(s(args.link)) : null
        return engine.send({
          personaId: s(args.personaId),
          to: s(args.to || parsed?.profileUrl),
          text: s(args.text),
          inReplyTo: args.inReplyTo ? s(args.inReplyTo) : undefined,
          replyTo: parsed?.replyTo || null
        })
      }
      if (action === 'accept') return engine.accept(s(args.personaId), s(args.profileUrl))
      if (action === 'ignore') return engine.ignore(s(args.personaId), s(args.profileUrl))
      if (action === 'block') return engine.block(s(args.personaId), s(args.profileUrl))
      if (action === 'unblock') return engine.unblock(s(args.personaId), s(args.profileUrl))
      if (action === 'markRead') return engine.markRead(s(args.personaId), s(args.profileUrl))
      if (action === 'retry') return engine.retry(s(args.personaId), s(args.profileUrl), args.id ? s(args.id) : null)
      if (action === 'delete') return engine.deleteConversation(s(args.personaId), s(args.profileUrl))
      if (action === 'setMode') return engine.setMode(s(args.personaId), s(args.mode))
      if (action === 'rotate') return engine.rotate(s(args.personaId))
      if (action === 'link') return engine.linkFor(s(args.personaId))
      if (action === 'forget') return engine.forgetPersona(s(args.personaId))
      if (action === 'notifications') {
        await boundedUpdate(vault)
        const recs = await store.list(I.MESSAGES_PREFIX)
        const { notify, since } = I.pendingNotifications(recs, args.since || null)
        const sum = await engine.summary()
        const titleOf = (r) => {
          const c = [...sum.conversations].find((x) => x.personaId === r.personaId && x.other === r.message.from)
          return c?.title || r.fromTitle || I.shortKey(r.message.from)
        }
        return {
          notify: notify.map((r) => ({
            id: r.message.id,
            personaId: r.personaId,
            from: r.message.from,
            title: titleOf(r),
            body: ((t) => (t.length > 200 ? `${t.slice(0, 200)}…` : t))(I.messagePreview(r.message))
          })),
          since
        }
      }
      throw new Error(`Unknown messages action: ${action}`)
    }
  }
}
