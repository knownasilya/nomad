// The phone's side of always-on Peers (ADR-0038): list the Vault's Peers for the Devices screen,
// turn a Space on or off for one, and remove one. A Peer pairs with a computer (Settings → Devices);
// the phone only edits its record. Rules: shared/peers.mjs.

import b4a from 'b4a'
import * as peers from '../../../shared/peers.mjs'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'
import { inlineOp, boundedUpdate } from './vault.mjs'

const SPACES_PREFIX = '/.vault/spaces/'

async function readPrefix (base, prefix) {
  const out = []
  for await (const node of base.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    if (rec) out.push(rec)
  }
  return out
}

const liveSpaces = (spaces) => spaces.filter((s) => s && !s.movedTo && !s.removed && !s.deleted && peers.isKey(s.rootDriveKey))

// [{ ...record, online, status, summary, spaces: [{ rootDriveKey, name, kept }] }]
export async function listPeers (base, { connected = new Set(), statuses = new Map() } = {}) {
  const list = (await readPrefix(base, peers.PEERS_PREFIX)).filter(peers.isPeer)
  if (!list.length) return []
  const spaces = liveSpaces(await readPrefix(base, SPACES_PREFIX))
  return list.map((p) => {
    const online = connected.has(p.key)
    const status = peers.readStatus(statuses.get(p.key))
    return {
      ...p,
      online,
      status,
      summary: peers.describePeer(p, status, { online }),
      spaces: spaces.map((s) => ({ rootDriveKey: s.rootDriveKey, name: s.name || 'Space', kept: peers.holdsSpace(p, s.rootDriveKey) }))
    }
  })
}

async function readPeer (base, key) {
  const node = peers.isKey(key) ? await base.view.get(peers.peerPath(key)) : null
  const rec = node ? decodeInlineJson(node.value, b4a) : null
  if (!peers.isPeer(rec)) throw new Error('That Peer was removed')
  return rec
}

export async function setPeerSpace (base, { key, rootDriveKey, on } = {}) {
  if (!base.writable) throw new Error('This phone can’t change the Vault yet. Try again once it has synced.')
  const prev = await readPeer(base, key)
  const all = liveSpaces(await readPrefix(base, SPACES_PREFIX)).map((s) => s.rootDriveKey)
  const rec = peers.makePeer({ key, hold: peers.withSpace(prev, rootDriveKey, !!on, all) }, prev)
  await base.append(inlineOp(peers.peerPath(key), rec))
  await boundedUpdate(base)
  return rec
}

export async function removePeer (base, { key } = {}) {
  if (!base.writable) throw new Error('This phone can’t change the Vault yet. Try again once it has synced.')
  await readPeer(base, key)
  await base.append({ op: 'del', path: peers.peerPath(key) })
  await boundedUpdate(base)
  return true
}

// The Peers with whether each keeps drive `driveKey` of Space `rootDriveKey` online (shared/peers.mjs
// keepsDrive): [{ key, name, online, summary, keeps: 'space' | 'drive' | false }].
export async function peersForDrive (base, { driveKey, rootDriveKey = null } = {}, { connected = new Set(), statuses = new Map() } = {}) {
  if (!peers.isKey(driveKey)) throw new Error('Not a drive')
  const list = (await readPrefix(base, peers.PEERS_PREFIX)).filter(peers.isPeer)
  return list.map((p) => {
    const online = connected.has(p.key)
    const status = peers.readStatus(statuses.get(p.key))
    return {
      key: p.key,
      name: p.name,
      online,
      summary: peers.describePeer(p, status, { online }),
      keeps: peers.isKey(rootDriveKey) ? peers.keepsDrive(p, { key: driveKey }, rootDriveKey) : false
    }
  })
}

// Keep drive `driveKey` online on Peer `key` on its own, or stop.
export async function setPeerDrive (base, { key, driveKey, on } = {}) {
  if (!base.writable) throw new Error('This phone can’t change the Vault yet. Try again once it has synced.')
  const prev = await readPeer(base, key)
  const rec = peers.makePeer({ key, hold: peers.withDrive(prev, driveKey, !!on) }, prev)
  await base.append(inlineOp(peers.peerPath(key), rec))
  await boundedUpdate(base)
  return rec
}
