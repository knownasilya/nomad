#!/usr/bin/env node
// nomad-peer: an always-on Peer (ADR-0038). A Nomad with no windows that keeps a full copy of what
// the user's Vault says it should hold and serves it, so their Devices and the people in their
// shared Spaces sync through it while laptops sleep. It never writes.
//
//   nomad-peer join <invite-code> [--name "Home NAS"]   pair with the Vault (Settings → Devices)
//   nomad-peer run                                      keep everything online
//   nomad-peer status                                   what the running Peer holds
//   nomad-peer leave --yes                              forget the Vault and delete the copies
//
// Every command takes --dir <folder> (default ~/.nomad-peer, or $NOMAD_PEER_DIR).

import fs from 'fs'
import os from 'os'
import path from 'path'
import { Corestore, Hyperswarm, Protomux, c, b4a } from './deps.mjs'
import DriveManager from '../mobile/backend/lib/drive-manager.mjs'
import { pairDevice, openVault } from '../mobile/backend/lib/vault.mjs'
import { createDevicePresence } from '../shared/device-presence.mjs'
import { describePeer, bytesText, PEER_PLATFORM } from '../shared/peers.mjs'
import { createPeer } from './peer.mjs'

const VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const ANNOUNCE_MS = 30000

function parseArgs (argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const dir = path.resolve(args.dir || process.env.NOMAD_PEER_DIR || path.join(os.homedir(), '.nomad-peer'))
const storeDir = path.join(dir, 'store')
const vaultKeyPath = path.join(dir, 'vault-key')
const statusPath = path.join(dir, 'status.json')

const say = (...a) => console.log(...a)
const fail = (msg) => { console.error(msg); process.exit(1) }

function usage () {
  say(`nomad-peer ${VERSION}: keep your Nomad drives online from a machine that stays on.

  nomad-peer join <invite-code> [--name "Home NAS"]
      On a computer with Nomad: Settings → Devices → Add an always-on Peer shows the code.
  nomad-peer run
      Keep everything the Vault says this Peer holds downloaded and online.
  nomad-peer status
      What the running Peer holds and how far it has synced.
  nomad-peer leave --yes
      Forget the Vault and delete every copy this Peer holds.

Options: --dir <folder>   where the Peer keeps its copies (default ~/.nomad-peer, or $NOMAD_PEER_DIR)`)
}

const readVaultKey = () => (fs.existsSync(vaultKeyPath) ? fs.readFileSync(vaultKeyPath, 'utf8').trim() : null)

async function join (code) {
  if (!code) fail('Usage: nomad-peer join <invite-code> [--name "Home NAS"]')
  if (readVaultKey()) fail(`This Peer is already joined to a Vault. Run "nomad-peer leave --yes" first, or use another --dir.`)
  fs.mkdirSync(storeDir, { recursive: true })
  const name = String(args.name || os.hostname() || 'Always-on Peer').slice(0, 80)
  const store = new Corestore(storeDir)
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store.replicate(conn))
  say(`Asking to join as "${name}". Approve it on the computer that showed the code…`)
  try {
    const { vaultKey, deviceKey } = await pairDevice({ store, swarm, code: code.trim(), name, platform: PEER_PLATFORM })
    fs.writeFileSync(vaultKeyPath, vaultKey + '\n')
    say(`Joined. This Peer's key is ${deviceKey}.`)
    say('Now run "nomad-peer run" (as a service, so it starts again after a reboot).')
  } finally {
    await swarm.destroy().catch(() => {})
    await store.close().catch(() => {})
  }
}

async function dirSize (p) {
  let total = 0
  const walk = async (d) => {
    let entries = []
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) await walk(f)
      else if (e.isFile()) { try { total += (await fs.promises.stat(f)).size } catch {} }
    }
  }
  await walk(p)
  return total
}

async function diskUsage () {
  let freeBytes = null
  try {
    const st = await fs.promises.statfs(dir)
    freeBytes = st.bavail * st.bsize
  } catch {}
  return { bytes: await dirSize(storeDir), freeBytes }
}

async function run () {
  const vaultKey = readVaultKey()
  if (!vaultKey) fail('This Peer has not joined a Vault yet. Run "nomad-peer join <invite-code>" first.')
  const store = new Corestore(storeDir)
  const manager = new DriveManager(store)
  const base = await openVault(store, manager.swarm, vaultKey)
  const peerKey = b4a.toString(base.local.key, 'hex')
  let removed = false

  const writeStatus = () => {
    const st = peer.status()
    const list = peer.holdings().map((h) => ({ ...h, ...(h.what === 'vault' ? { synced: true } : { synced: manager.hostingState(h.type, h.key).synced }) }))
    try { fs.writeFileSync(statusPath, JSON.stringify({ at: Date.now(), pid: process.pid, peerKey, vaultKey, approved: peer.seen, status: st, connected: manager.peers, holdings: list }, null, 2)) } catch {}
  }

  const presence = createDevicePresence({
    swarm: manager.swarm,
    Protomux,
    c,
    b4a,
    getVaultKey: () => vaultKey,
    getDeviceKey: () => peerKey,
    getStatus: () => peer.status()
  })

  const shutdown = async (code = 0) => {
    await peer.stop()
    presence.reset()
    try { fs.rmSync(statusPath, { force: true }) } catch {}
    await base.close().catch(() => {})
    await manager.close().catch(() => {})
    await store.close().catch(() => {})
    process.exit(code)
  }

  const peer = createPeer({
    base,
    manager,
    b4a,
    peerKey,
    version: VERSION,
    diskUsage,
    log: (...a) => say('[peer]', ...a),
    onChange: () => { writeStatus(); presence.announce() },
    onRemoved: async () => {
      removed = true
      say('This Peer was removed on one of your Devices. Deleting its copies…')
      presence.reset()
      await base.close().catch(() => {})
      await manager.close().catch(() => {})
      await store.close().catch(() => {})
      fs.rmSync(dir, { recursive: true, force: true })
      say('Done. Nothing of that Vault is left on this machine.')
      process.exit(0)
    }
  })

  presence.install()
  say(`nomad-peer ${VERSION}: key ${peerKey.slice(0, 8)}…, Vault ${vaultKey.slice(0, 8)}…, data in ${dir}`)
  await peer.start()
  if (!peer.seen) say('Waiting for this Peer\'s record to arrive from your Devices…')
  writeStatus()
  const tick = setInterval(() => { if (!removed) { writeStatus(); presence.announce() } }, ANNOUNCE_MS)
  process.on('SIGINT', () => { clearInterval(tick); shutdown(0) })
  process.on('SIGTERM', () => { clearInterval(tick); shutdown(0) })
}

function status () {
  if (!readVaultKey()) fail('This Peer has not joined a Vault.')
  let s = null
  try { s = JSON.parse(fs.readFileSync(statusPath, 'utf8')) } catch {}
  if (!s || Date.now() - s.at > ANNOUNCE_MS * 3) {
    say('Not running. Start it with "nomad-peer run".')
    return
  }
  if (!s.approved) say('Running, and waiting for this Peer\'s record to arrive from your Devices.')
  else say(describePeer(null, s.status, { online: true }))
  const free = s.status.freeBytes == null ? '' : `; ${bytesText(s.status.freeBytes)} free on this disk`
  say(`Connected to ${s.connected} peer${s.connected === 1 ? '' : 's'}${free}.`)
  for (const h of s.holdings) say(`  ${h.synced ? '✓' : '…'} ${h.what.padEnd(8)} ${h.key}`)
}

function leave () {
  if (!readVaultKey()) fail('This Peer has not joined a Vault.')
  if (!args.yes) fail('This deletes every copy this Peer holds. Run "nomad-peer leave --yes" to go ahead.\nAlso remove the Peer in Settings → Devices, so your Devices stop listing it.')
  fs.rmSync(dir, { recursive: true, force: true })
  say('Left the Vault and deleted its copies. Remove the Peer in Settings → Devices too.')
}

const cmd = args._[0]
if (args.help || !cmd) usage()
else if (cmd === 'join') join(args._[1]).catch((e) => fail('Could not join: ' + (e && e.message)))
else if (cmd === 'run') run().catch((e) => fail('The Peer stopped: ' + (e && (e.stack || e.message))))
else if (cmd === 'status') status()
else if (cmd === 'leave') leave()
else { usage(); process.exit(1) }
