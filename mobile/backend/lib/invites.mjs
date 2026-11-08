// Invite links on the phone (ADR-0040; desktop: app/bg/hyper/invites.js and the invite part of
// app/bg/hyper/space-library.js). The phone can now invite people to a shared Space it owns, and
// answer their joins, not only join one itself:
//
// - `link` makes a blind-pairing invite for the Space's Library, wraps it in an invite link signed
//   by the Space's Persona, and writes the invite record to the Vault, so the user's computers can
//   answer the join too (and the phone can answer one a computer made).
// - The phone listens for joins on every Library it manages (one member per Library on the shared
//   BlindPairing instance, space-library.mjs pairingFor). A join that matches an open invite record
//   waits for the owner: `joins` lists them, `approve` and `deny` answer.
// - `read` checks an invite link a friend sent (expiry, signature), for the join sheet.
//
// The payload, signature and records are shared/invites.mjs; roles and member records are
// shared/space-library.mjs.

import BlindPairing from 'blind-pairing'
import z32 from 'z32'
import b4a from 'b4a'
import sodium from 'sodium-universal'
import hcrypto from 'hypercore-crypto'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as inv from '../../../shared/invites.mjs'
import * as sl from '../../../shared/space-library.mjs'
import * as pe from '../../../shared/personas.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { libraryFor, pairingFor } from './space-library.mjs'

const hex = (buf) => (buf ? b4a.toString(buf, 'hex') : null)
const SPACES_PREFIX = '/.vault/spaces/'

async function readRecord (base, path) {
  const node = await base.view.get(path)
  return node ? decodeInlineJson(node.value, b4a) : null
}

async function readPrefix (base, prefix) {
  const out = []
  for await (const node of base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    if (rec) out.push(rec)
  }
  return out
}

function verify (sig, msg, publicKey) {
  return sodium.crypto_sign_verify_detached(b4a.from(sig), b4a.from(msg), b4a.from(publicKey))
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))])

// deps from backend.mjs:
//   vault()          the opened Vault (or null)
//   manager          the DriveManager
//   inbox            the phone's Inbox (lib/inbox.mjs): signInvite, publishedSign, personas, readProfile
//   onJoin({ space, spaceName, name, role })   someone asks to join (the UI posts a notification)
//   onChange()       what the UI shows changed
export function createInvites (deps) {
  const listening = new Map() // library -> blind-pairing member
  const joins = new Map() // library -> Map(memberId -> pending join)

  const ctx = () => ({ vault: deps.vault(), manager: deps.manager })

  async function manage (space) {
    const lib = await libraryFor(ctx(), space)
    if (!lib) throw new Error('This Space isn’t shared')
    if (!sl.canManage(lib.role) || !lib.writable) throw new Error('Only an owner can do that, from a device that can edit the Space')
    return lib
  }

  async function spaceName (lib) {
    const index = await readRecord(lib.base, sl.LIB_INDEX).catch(() => null)
    return String(index?.name || 'Space')
  }

  async function spaceOfLibrary (library) {
    const vault = deps.vault()
    if (!vault) return null
    const rec = (await readPrefix(vault, SPACES_PREFIX).catch(() => [])).find((s) => s && s.library === library && !s.movedTo)
    return rec || null
  }

  // Listen for joins to `lib` (an open Library this phone manages).
  function listen (lib) {
    if (listening.has(lib.library)) return
    const bp = pairingFor(deps.manager)
    listening.set(
      lib.library,
      bp.addMember({
        discoveryKey: lib.base.discoveryKey,
        onadd: (candidate) =>
          new Promise((resolve) => {
            onCandidate(lib, candidate, resolve).catch((e) => {
              console.log('[invites] could not read a join', e?.message || e)
              resolve()
            })
          })
      })
    )
  }

  async function onCandidate (lib, candidate, resolve) {
    const vault = deps.vault()
    if (!vault) return resolve()
    const open = inv.openInvitesFor(await readPrefix(vault, inv.INVITES_PREFIX), lib.library)
    const invite = open.find((r) => {
      try {
        candidate.open(b4a.from(r.space.publicKey, 'hex'))
        return true
      } catch {
        return false
      }
    })
    if (!invite) return resolve()
    const req = sl.parseJoinRequest(b4a.toString(candidate.userData))
    if (!req) return resolve()
    await boundedUpdate(lib.base, 2000)
    if (await readRecord(lib.base, sl.memberPath(req.memberId)).catch(() => null)) {
      // Approved already (here or on a computer): answer without asking twice.
      try { candidate.confirm({ key: lib.base.key, encryptionKey: lib.base.encryptionKey }) } catch {}
      return resolve()
    }
    if (!joins.has(lib.library)) joins.set(lib.library, new Map())
    const rec = await spaceOfLibrary(lib.library)
    joins.get(lib.library).set(req.memberId, {
      ...req,
      role: invite.space.role,
      recordId: invite.id,
      space: rec?.rootDriveKey || null,
      spaceName: rec?.name || invite.space.name,
      candidate,
      resolve,
      requestedAt: new Date().toISOString()
    })
    deps.onJoin?.({ space: rec?.rootDriveKey || null, spaceName: rec?.name || invite.space.name, name: req.name, role: invite.space.role })
    deps.onChange?.()
  }

  // Listen on every shared Space this phone can manage. Called when the Vault opens or changes.
  async function listenAll () {
    const vault = deps.vault()
    if (!vault) return
    for (const s of await readPrefix(vault, SPACES_PREFIX).catch(() => [])) {
      if (!sl.isShared(s) || s.movedTo || s.removed || !sl.canManage(s.role)) continue
      if (listening.has(s.library)) continue
      const lib = await libraryFor(ctx(), s.rootDriveKey).catch(() => null)
      if (lib && lib.writable) listen(lib)
    }
  }

  // The Space's Persona when it can sign (its profile's writers are the user's Devices), with the
  // title its profile shows, or null.
  async function personaFor (space) {
    const vault = deps.vault()
    const [recs, def, spaces] = await Promise.all([
      readPrefix(vault, pe.PERSONAS_PREFIX),
      readRecord(vault, pe.DEFAULT_PATH),
      readPrefix(vault, pe.SPACES_PREFIX)
    ])
    const personas = recs.filter(pe.isPersona)
    const spaceRec = spaces.find((x) => x && x.rootDriveKey === space && !x.movedTo) || null
    const override = spaceRec?.persona && personas.some((p) => p.id === spaceRec.persona) ? spaceRec.persona : null
    const defaultId = def?.personaId && personas.some((p) => p.id === def.personaId) ? def.personaId : null
    const p = pe.resolvePersona({ spaceOverride: override, defaultId, personas })
    if (!p) return null
    await deps.inbox.refreshPersonas().catch(() => {})
    if (!deps.inbox.personas().find((x) => x.id === p.id)?.usable) return null
    const manifest = await deps.inbox.readProfile(p.profileUrl).catch(() => null)
    const title = String(manifest?.title || '').trim()
    return title ? { id: p.id, profileUrl: p.profileUrl, title } : null
  }

  // Make an invite link: { id, link, role, expiresAt, signed }.
  async function link (space, role, days) {
    if (role !== 'editor' && role !== 'viewer') throw new Error('Pick Can edit or Can view')
    const vault = deps.vault()
    if (!vault?.writable) throw new Error('This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
    const lib = await manage(space)
    const made = BlindPairing.createInvite(lib.base.key)
    const code = z32.encode(made.invite)
    listen(lib)
    const id = b4a.toString(hcrypto.randomBytes(16), 'hex')
    const expiresAt = inv.expiryOf(days)
    const name = await spaceName(lib)
    const fields = { id, expiresAt, space: { code, name, role } }
    const persona = await personaFor(space).catch(() => null)
    let payload = null
    if (persona) {
      const from = pe.driveKeyOf(persona.profileUrl)
      try {
        const body = inv.encodeBody({ ...fields, from, name: persona.title, signed: true })
        const sig = await deps.inbox.signInvite(persona.id, inv.signedBytes(body))
        payload = inv.encodeInvite({ ...fields, from, name: persona.title }, () => sig)
      } catch (e) {
        console.log('[invites] could not sign; sending it unsigned', e?.message || e)
      }
    }
    const signed = !!payload
    if (!payload) payload = inv.encodeInvite(fields)
    const rec = inv.makeInviteRecord({
      id,
      personaId: signed ? persona.id : null,
      space: { space, library: lib.library, publicKey: hex(made.publicKey), role, name },
      device: hex(vault.local?.key),
      expiresAt,
      signed
    })
    await vault.append(inlineOp(inv.invitePath(id), rec))
    await boundedUpdate(vault)
    return { id, link: inv.linkOf(payload), role, expiresAt, signed, spaceName: name }
  }

  // The Space's invite links and who's waiting to join.
  async function list (space) {
    const vault = deps.vault()
    if (!vault) return { invites: [], joins: [], canInvite: false }
    const lib = await libraryFor(ctx(), space).catch(() => null)
    const canInvite = !!lib && sl.canManage(lib.role) && lib.writable
    if (canInvite) listen(lib)
    await boundedUpdate(vault)
    const { shown, stale } = inv.listFor(await readPrefix(vault, inv.INVITES_PREFIX), space)
    if (vault.writable) for (const id of stale) vault.append({ op: 'del', path: inv.invitePath(id) }).catch(() => {})
    let waiting = []
    if (lib && canInvite) {
      const members = new Set((await readPrefix(lib.base, sl.MEMBERS_PREFIX).catch(() => [])).filter(sl.isMember).map((m) => m.memberId))
      waiting = [...(joins.get(lib.library)?.values() || [])]
        .filter((j) => !members.has(j.memberId))
        .map(({ memberId, name, role, requestedAt }) => ({ memberId, name, role, requestedAt }))
    }
    return {
      canInvite,
      joins: waiting,
      invites: shown.map((r) => ({ id: r.id, role: r.space.role, state: r.state, createdAt: r.createdAt, expiresAt: r.expiresAt, usedBy: r.usedBy?.name || null, signed: !!r.signed }))
    }
  }

  async function revoke (space, id) {
    const vault = deps.vault()
    await manage(space)
    const rec = await readRecord(vault, inv.invitePath(String(id || ''))).catch(() => null)
    if (!inv.isInviteRecord(rec) || rec.space.space !== space) throw new Error('That invite is gone')
    await vault.append(inlineOp(inv.invitePath(rec.id), inv.markRevoked(rec)))
    await boundedUpdate(vault)
    return true
  }

  // Approve a join: the member record, the writer key when they can edit, then confirm (which hands
  // them the Library's key). The invite is used up.
  async function approve (space, memberId) {
    const lib = await manage(space)
    const req = joins.get(lib.library)?.get(memberId)
    if (!req) throw new Error('That request is gone. Ask them to open the invite again')
    const me = lib.memberId
    const rec = { ...sl.makeMember({ memberId, name: req.name, role: req.role, profileUrl: req.profileUrl, addedBy: me || memberId }), writers: [req.writerKey] }
    await lib.base.append(inlineOp(sl.memberPath(memberId), rec))
    if (sl.canEdit(req.role)) await lib.base.append({ addWriter: req.writerKey })
    await boundedUpdate(lib.base)
    try {
      req.candidate.confirm({ key: lib.base.key, encryptionKey: lib.base.encryptionKey })
    } finally {
      req.resolve()
      joins.get(lib.library).delete(memberId)
    }
    const vault = deps.vault()
    if (req.recordId && vault?.writable) {
      const prev = await readRecord(vault, inv.invitePath(req.recordId)).catch(() => null)
      if (inv.isInviteRecord(prev)) {
        await vault.append(inlineOp(inv.invitePath(req.recordId), inv.markUsed(prev, { name: req.name, profileUrl: req.profileUrl })))
        await boundedUpdate(vault)
      }
    }
    deps.onChange?.()
    return { memberId, name: req.name, role: req.role }
  }

  async function deny (space, memberId) {
    const lib = await manage(space)
    const req = joins.get(lib.library)?.get(memberId)
    if (!req) return false
    req.resolve()
    joins.get(lib.library).delete(memberId)
    deps.onChange?.()
    return true
  }

  // What the join sheet shows for an invite link (desktop: invites.js read).
  async function read (text) {
    const invite = inv.parseInviteLink(text)
    let check = 'unsigned'
    let from = null
    if (invite.signed) {
      const url = `hyper://${invite.from}/`
      const [sign, manifest] = await Promise.all([
        withTimeout(deps.inbox.publishedSign(url).catch(() => null), 15000),
        withTimeout(deps.inbox.readProfile(url).catch(() => null), 15000)
      ])
      check = inv.signatureState(invite, sign, verify)
      if (check === 'bad') throw new Error('This invite has been changed. Ask for a new one.')
      const profileTitle = String(manifest?.title || '').trim()
      from = { url, name: invite.name, profileTitle, nameDiffers: !!profileTitle && profileTitle !== invite.name }
    }
    return {
      ...inv.describeInvite(invite),
      from,
      check,
      expired: inv.isExpired(invite),
      expiresAt: invite.expiresAt,
      space: invite.space ? { name: invite.space.name, role: invite.space.role } : null
    }
  }

  // The code to join with: a bare code as it is, or the one inside an invite link once it checks out.
  async function codeFor (text) {
    const s = String(text || '').trim()
    if (!inv.isInviteLink(s) && !/^AQ[A-Za-z0-9_-]{40,}$/.test(s)) return s
    const invite = inv.parseInviteLink(s)
    if (!invite.space) throw new Error('This invite isn’t for a Space')
    if (inv.isExpired(invite)) throw new Error('This invite has run out. Ask for a new one.')
    if (invite.signed) {
      const sign = await withTimeout(deps.inbox.publishedSign(`hyper://${invite.from}/`).catch(() => null), 15000)
      if (inv.signatureState(invite, sign, verify) === 'bad') throw new Error('This invite has been changed. Ask for a new one.')
    }
    return invite.space.code
  }

  // Everyone waiting to join any Space this phone manages, for the UI's notifications.
  function pending () {
    const out = []
    for (const [library, m] of joins) {
      for (const j of m.values()) out.push({ key: library.slice(0, 16) + ':' + j.memberId, library, memberId: j.memberId, name: j.name, role: j.role, spaceName: j.spaceName || '', space: j.space || null })
    }
    return out
  }

  return { listenAll, link, list, revoke, approve, deny, read, codeFor, pending }
}
