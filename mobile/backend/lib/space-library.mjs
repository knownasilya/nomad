import Autobase from 'autobase'
import BlindPairing from 'blind-pairing'
import crypto from 'hypercore-crypto'
import z32 from 'z32'
import b4a from 'b4a'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import * as sl from '../../../shared/space-library.mjs'
import { grantPath, grantsPrefix, makeGrantRequest, requestState } from '../../../shared/drive-writers.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'
import { DRIVE_AUTOBASE } from '../../rpc-commands.mjs'

// The phone's side of shared Spaces (ADR-0029; desktop: app/bg/hyper/space-library.js). A shared
// Space's drives, feeds, Notes and Names are in its Space Library, an Autobase its members
// replicate. The phone reads them there and writes them when this person can edit. It joins a
// shared Space with a code too. Sharing a Space and managing its people stay on desktop.
//
// `vault` is the opened Vault Autobase, `manager` the DriveManager. The Library opens through the
// manager, so its records and the drive registry read the same way any drive does.

const SPACES_PREFIX = '/.vault/spaces/'
const hex = (buf) => (buf ? b4a.toString(buf, 'hex') : null)
const randomHex = (n) => b4a.toString(crypto.randomBytes(n), 'hex')

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

// The Vault's record of the Space with Root Drive key `space`, if it is shared.
export async function shareOf (vault, space) {
  if (!vault || !sl.isKey(space)) return null
  const rec = await readRecord(vault, SPACES_PREFIX + space + '.json').catch(() => null)
  return sl.isShared(rec) && !rec.movedTo ? rec : null
}

// Libraries this module opened, kept open (a tab leaving one would otherwise close it).
const held = new Set()

// The open Space Library of a shared Space: { base, library, role, memberId, writable }, or null.
export async function libraryFor ({ vault, manager }, space) {
  const rec = await shareOf(vault, space)
  if (!rec) return null
  const entry = await manager.open(DRIVE_AUTOBASE, b4a.from(rec.library, 'hex'))
  if (!held.has(rec.library)) {
    held.add(rec.library)
    entry.refs++
  }
  return { base: entry.drive, library: rec.library, role: rec.role || 'viewer', memberId: rec.memberId || null, writable: !!entry.drive.writable }
}

// The Library's /drives.json registry key, so the phone's drive list reads it when shared.
export function registryKey (lib) {
  return b4a.from(lib.library, 'hex')
}

// Keep this phone's place in a shared Space it can edit: ask the user's Devices for a writer key
// on the Library (the Vault drive-writers flow, ADR-0026 §2, which a Device that writes the
// Library answers), and once it writes, list its key on its own member record so an owner can take
// it off. Returns true when it wrote something.
export async function keepWriter ({ vault }, lib) {
  if (!lib || !sl.canEdit(lib.role) || !vault?.writable) return false
  const writerKey = hex(lib.base.local?.key)
  const device = hex(vault.local?.key)
  if (!writerKey || !device) return false
  if (!lib.writable) {
    const grants = await readPrefix(vault, grantsPrefix(lib.library)).catch(() => [])
    if (requestState(grants, { drive: lib.library, writerKey })) return false
    const own = await readRecord(vault, `/.vault/devices/${device}.json`).catch(() => null)
    await vault.append(inlineOp(grantPath(lib.library, writerKey), makeGrantRequest({ drive: lib.library, writerKey, device, name: own?.name })))
    await boundedUpdate(vault)
    return true
  }
  if (!lib.memberId) return false
  const me = await readRecord(lib.base, sl.memberPath(lib.memberId)).catch(() => null)
  if (!sl.isMember(me) || (me.writers || []).includes(writerKey)) return false
  await lib.base.append(inlineOp(sl.memberPath(me.memberId), { ...me, writers: [...(me.writers || []), writerKey] }))
  await boundedUpdate(lib.base)
  return true
}

// Join a shared Space with a code. Mints the Library writer key in a fresh namespace first (the
// Library's key isn't known yet), asks, and once an owner approves, opens the Library there and
// waits for its index. `remember(library, ns)` keeps the namespace so the Library opens there
// again. Returns { library, memberId, index }; the caller makes the Space (attach below).
export async function join ({ store, manager }, code, { name } = {}, remember = () => {}) {
  let invite
  try {
    invite = z32.decode(String(code || '').trim())
  } catch {
    throw new Error('That code isn’t right. Check it and try again')
  }
  const ns = randomHex(32)
  const core = Autobase.getLocalCore(store.namespace(ns))
  await core.ready()
  const writerKey = hex(core.key)
  await core.close()
  const memberId = sl.newMemberId(randomHex)
  const userData = b4a.from(JSON.stringify(sl.makeJoinRequest({ memberId, name, writerKey })))

  const bp = new BlindPairing(manager.swarm, { poll: 5000 })
  let library
  try {
    library = await new Promise((resolve, reject) => {
      try {
        const candidate = bp.addCandidate({ invite, userData, onadd: (result) => resolve(hex(result.key)) })
        candidate.pairing.catch(reject)
      } catch (e) {
        reject(e)
      }
    })
  } finally {
    Promise.resolve().then(() => bp.close()).catch(() => {})
  }
  manager.joinedNs.set(library, ns)
  remember(library, ns)
  const entry = await manager.open(DRIVE_AUTOBASE, b4a.from(library, 'hex'))
  let index = null
  for (let end = Date.now() + 30000; !index && Date.now() < end;) {
    const buf = await entry.reader.read(sl.LIB_INDEX).catch(() => null)
    try { index = buf ? JSON.parse(b4a.toString(buf)) : null } catch {}
    if (!index) {
      await entry.drive.update().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  console.log('[space-library] joined', library.slice(0, 8), 'writable', entry.drive.writable)
  return { library, memberId, index: sl.isSpaceIndex(index) ? index : sl.makeSpaceIndex({}) }
}

// Mark the Space with Root Drive key `rootDriveKey` as the shared Space `library` in the Vault, so
// the user's other Devices open it too. Makes the Space's record first when it isn't there yet.
export async function attach ({ vault }, { rootDriveKey, name, icon, color, library, memberId }) {
  if (!vault) throw new Error('Link this phone to join a shared Space')
  if (!vault.writable) throw new Error('This phone can’t write to your Vault yet. Keep your other device online until it syncs, then try again.')
  if (!sl.isKey(rootDriveKey) || !sl.isKey(library) || !sl.isMemberId(memberId)) throw new Error('That Space isn’t ready yet')
  const path = SPACES_PREFIX + rootDriveKey + '.json'
  const prev = (await readRecord(vault, path)) || {
    rootDriveKey,
    name: name || 'Space',
    icon: icon || 'circle',
    color: color || '#6c6cff',
    sortOrder: 0,
    createdAt: new Date().toISOString()
  }
  await vault.append(inlineOp(path, { ...prev, library, memberId, role: prev.role || 'viewer' }))
  await boundedUpdate(vault)
}

// What the phone shows about a shared Space: { shared, role, writable, members }.
export async function status (ctx, space) {
  const lib = await libraryFor(ctx, space)
  if (!lib) return { shared: false }
  await boundedUpdate(lib.base, 2000)
  const members = sl.sortMembers((await readPrefix(lib.base, sl.MEMBERS_PREFIX)).filter(sl.isMember))
  const me = members.find((m) => m.memberId === lib.memberId)
  return {
    shared: true,
    role: me?.role || lib.role,
    writable: lib.writable,
    members: members.map((m) => ({ memberId: m.memberId, name: m.name, role: m.role, you: m.memberId === lib.memberId }))
  }
}
