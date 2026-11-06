// The running Peer (ADR-0038 §3, §5): reads its Holdings from the Vault, keeps a full mirror of each
// one (mobile/backend/lib/drive-manager.mjs setHosting, announced on the swarm), and reports a
// status the user's Devices show. It never writes: it has no writer in the Vault or in any drive.
//
// When the Vault no longer has this Peer's record (a Device removed it), it stops and calls
// `onRemoved`, which wipes the store (index.mjs).

import * as peers from '../shared/peers.mjs'
import { DRIVE_AUTOBASE, DRIVE_HYPERDRIVE } from '../mobile/rpc-commands.mjs'
import { readHoldings } from './holdings.mjs'

const REFRESH_MS = 30000
// A record seen once and then missing on two reads this far apart is a removal, not a view that
// is still catching up.
const GONE_AFTER_MS = 10000

export function createPeer ({ base, manager, b4a, peerKey, version = '', goneAfterMs = GONE_AFTER_MS, refreshMs = REFRESH_MS, diskUsage = async () => ({ bytes: 0, freeBytes: null }), onRemoved = () => {}, onChange = () => {}, log = () => {} }) {
  const startedAt = Date.now()
  const held = new Map() // key -> holding ({ key, type, what, space? })
  let seen = false
  let missingSince = 0
  let timer = null
  let refreshing = null
  let again = false
  let stopped = false
  let disk = { bytes: 0, freeBytes: null }

  const typeOf = (h) => (h.type === 'autobase' ? DRIVE_AUTOBASE : DRIVE_HYPERDRIVE)
  const keyBuf = (hex) => b4a.from(hex, 'hex')

  async function readRegistry (keyHex) {
    const entry = await manager.open(DRIVE_AUTOBASE, keyBuf(keyHex))
    const buf = await entry.reader.read('/drives.json')
    if (!buf) return []
    const parsed = JSON.parse(b4a.toString(buf))
    return Array.isArray(parsed.drives) ? parsed.drives : []
  }

  async function hold (h) {
    held.set(h.key, h)
    if (h.what === 'vault') return // open already, as the Vault session itself
    log('holding', h.what, h.key.slice(0, 8))
    await manager.setHosting(typeOf(h), keyBuf(h.key), true)
  }

  async function drop (h) {
    held.delete(h.key)
    if (h.what === 'vault') return
    log('no longer holding', h.what, h.key.slice(0, 8))
    await manager.setHosting(typeOf(h), keyBuf(h.key), false).catch(() => {})
    manager.release(typeOf(h), h.key)
  }

  async function refreshOnce () {
    try { await base.update() } catch {}
    disk = await diskUsage().catch(() => disk)
    const { record, holdings } = await readHoldings({ base, b4a, peerKey, readRegistry })
    if (!record) {
      if (!seen) return
      if (!missingSince) { missingSince = Date.now(); return }
      if (Date.now() - missingSince < goneAfterMs) return
      log('this Peer was removed from the Vault')
      await stop()
      await onRemoved()
      return
    }
    seen = true
    missingSince = 0
    const want = new Map(holdings.map((h) => [h.key, h]))
    for (const h of [...held.values()]) if (!want.has(h.key)) await drop(h)
    for (const h of want.values()) {
      if (stopped) return
      if (!held.has(h.key)) await hold(h).catch((e) => log('could not hold', h.key.slice(0, 8), e && e.message))
      else held.set(h.key, h)
    }
    onChange()
  }

  // Serialized: a Vault update during a refresh queues exactly one more.
  function refresh () {
    if (stopped) return Promise.resolve()
    if (refreshing) { again = true; return refreshing }
    refreshing = (async () => {
      try {
        do {
          again = false
          await refreshOnce()
        } while (again && !stopped)
      } catch (e) {
        log('refresh failed', e && e.message)
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  const onUpdate = () => { refresh() }

  function start () {
    base.on('update', onUpdate)
    timer = setInterval(() => { refresh() }, refreshMs)
    return refresh()
  }

  async function stop () {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    try { base.off('update', onUpdate) } catch {}
  }

  // The status this Peer sends in its presence HELLO (shared/peers.mjs makeStatus).
  function status () {
    let synced = 0
    let behind = 0
    for (const h of held.values()) {
      if (h.what === 'vault') { synced++; continue }
      const st = manager.hostingState(typeOf(h), h.key)
      if (st.synced) synced++
      behind += Math.max(0, st.length - st.have)
    }
    return peers.makeStatus({ version, startedAt, holding: held.size, synced, behind, bytes: disk.bytes, freeBytes: disk.freeBytes })
  }

  return { start, stop, refresh, status, holdings: () => [...held.values()], get seen () { return seen } }
}
