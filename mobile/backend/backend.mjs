import RPC from 'bare-rpc'
import URL from 'bare-url'
import fs from 'bare-fs'
import b4a from 'b4a'
import { join } from 'bare-path'
import Corestore from 'corestore'
import goodbye from 'graceful-goodbye'

import DriveManager from './lib/drive-manager.mjs'
import { parseHyperUrl } from './lib/hyper-url.mjs'
import { pairDevice, openVault, readVaultIndex, renameDevice, removeDevice, addSpaceToVault } from './lib/vault.mjs'
import * as drafts from './lib/drafts.mjs'
import { createAiBridge } from './lib/ai-bridge.mjs'
import {
  RPC_OPEN,
  RPC_CLOSE,
  RPC_CREATE,
  RPC_PAIR_SUBMIT,
  RPC_VAULT_STATUS,
  RPC_RENAME_DEVICE,
  RPC_REMOVE_DEVICE,
  RPC_VAULT_ADD_SPACE,
  RPC_SPACE_DRIVES,
  RPC_SPACE_ADD_DRIVE,
  RPC_BOOKMARKS,
  RPC_FS_LIST,
  RPC_FS_READ,
  RPC_FS_WRITE,
  RPC_FS_DELETE,
  RPC_FS_RENAME,
  RPC_FS_MKDIR,
  RPC_STATUS,
  RPC_CONTENT,
  RPC_ERROR,
  RPC_CREATED,
  RPC_PAIRED,
  RPC_VAULT,
  RPC_FS_RESULT,
  RPC_SPACE_DRIVES_RESULT,
  RPC_BOOKMARKS_RESULT,
  RPC_NOMAD,
  RPC_NOMAD_RESULT,
  RPC_AI_CHAT,
  RPC_AI_CANCEL,
  RPC_AI_PROMPT_RESULT,
  RPC_AI_EVENT,
  DRIVE_HYPERDRIVE,
  DRIVE_AUTOBASE
} from '../rpc-commands.mjs'

const { IPC } = BareKit

// Prefix every backend log line with [nomad] so the Bare worklet's logs land under the same
// filterable tag as the React-Native side (see lib/log.ts) in adb logcat / Xcode console.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = typeof console[level] === 'function' ? console[level].bind(console) : null
  if (orig) console[level] = (...args) => orig('[nomad]', ...args)
}

// Resilience: a rejected BACKGROUND promise deep in the P2P stack (e.g. autobase catching up a Vault
// whose writer core hasn't replicated yet — the "reading 'download' of null" TypeError) must NOT tear
// down the whole backend worklet. Log it and keep running; the drive/vault layer recovers on the next
// update. We deliberately do NOT swallow uncaughtException — a genuinely fatal error should let the
// worklet restart clean rather than limp on with a half-closed corestore ("closing core" cascades).
// Guarded because Bare's error-event surface can vary by version.
try {
  if (typeof Bare?.on === 'function') {
    Bare.on('unhandledRejection', (err) =>
      console.error('[nomad] unhandledRejection (ignored):', (err && (err.stack || err.message)) || err))
  }
} catch {}

// Bare.argv[0] is the app's document directory, passed in from the RN side.
const storagePath = join(URL.fileURLToPath(Bare.argv[0]), 'hyper-browser')
if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true })

const store = new Corestore(storagePath)
// Draft Mode (ADR-0012): the serve path resolves reads through this overlay when a Drive is being
// previewed, so a navigated page shows the merged Draft (not just the in-page bridge). `vault` is
// assigned later on pairing; the closure reads it at request time.
const manager = new DriveManager(store, {
  read: async (keyHex, path) =>
    drafts.isPreview(keyHex) ? drafts.stagedContent(vault, keyHex, path) : { override: false }
})
goodbye(() => manager.close())

// The Vault key (this device's link to its identity) is persisted next to the corestore.
const vaultKeyPath = join(storagePath, 'vault-key')
let vault = null // the opened Vault Autobase, once paired

// AI Bridge (ADR-0013): this phone is the AI Client. `getVault` is late-bound — it returns the
// Vault only once paired, which is exactly when the Bridge can key its channel and sign the auth
// challenge. install() is re-run after the Vault opens (below) to catch already-open connections.
const aiBridge = createAiBridge({ swarm: manager.swarm, getVault: () => vault })
// Set once we've seen THIS device's own record in the Vault index. If it later disappears while the
// index still holds other records, this device was removed on another device — see handleVaultStatus.
let ownDeviceSeen = false

function loadVaultKey () {
  try {
    return fs.existsSync(vaultKeyPath) ? b4a.toString(fs.readFileSync(vaultKeyPath)).trim() : null
  } catch {
    return null
  }
}

function saveVaultKey (key) {
  fs.writeFileSync(vaultKeyPath, b4a.from(key))
}

// Namespaces of drives CREATED on this device, keyed by drive key (hex). Lets the in-page
// nomad.fs bridge reopen an owned drive WRITABLE across restarts (the RN UI passes `ns` for its
// own writes; the WebView bridge only sees a URL, so we resolve `ns` from here). A drive with no
// entry here is read-only on this device — manager.writeFile throws a clear error for that.
const drivesNsPath = join(storagePath, 'drives-ns.json')
let drivesNs = {}
function loadDrivesNs () {
  try { return fs.existsSync(drivesNsPath) ? JSON.parse(b4a.toString(fs.readFileSync(drivesNsPath))) : {} } catch { return {} }
}
function saveDrivesNs () {
  try { fs.writeFileSync(drivesNsPath, b4a.from(JSON.stringify(drivesNs))) } catch {}
}
drivesNs = loadDrivesNs()

// Reopen the Vault on startup if this device has already been paired.
;(async () => {
  const key = loadVaultKey()
  if (key) {
    try {
      vault = await openVault(store, manager.swarm, key)
      // Open the Bridge channel proactively now the Vault is up — matches the desktop + the
      // peersockets/autobase-control pattern (both sides open on connection). Safe: openOnConn is
      // fully guarded so it can never throw into the swarm emitter.
      aiBridge.install()
    } catch (err) {
      // leave vault null; the UI will show an unpaired state and can retry
    }
  }
})()

const rpc = new RPC(IPC, (req) => {
  const msg = decode(req.data)
  if (req.command === RPC_OPEN) handleOpen(msg)
  else if (req.command === RPC_CLOSE) handleClose(msg)
  else if (req.command === RPC_CREATE) handleCreate(msg)
  else if (req.command === RPC_PAIR_SUBMIT) handlePairSubmit(msg)
  else if (req.command === RPC_VAULT_STATUS) handleVaultStatus(msg)
  else if (req.command === RPC_RENAME_DEVICE) handleRenameDevice(msg)
  else if (req.command === RPC_REMOVE_DEVICE) handleRemoveDevice(msg)
  else if (req.command === RPC_VAULT_ADD_SPACE) handleAddVaultSpace(msg)
  else if (req.command === RPC_SPACE_DRIVES) handleSpaceDrives(msg)
  else if (req.command === RPC_SPACE_ADD_DRIVE) handleSpaceAddDrive(msg)
  else if (req.command === RPC_BOOKMARKS) handleBookmarks(msg)
  else if (req.command === RPC_FS_LIST) handleFsList(msg)
  else if (req.command === RPC_FS_READ) handleFsRead(msg)
  else if (req.command === RPC_FS_WRITE) handleFsWrite(msg)
  else if (req.command === RPC_FS_DELETE) handleFsDelete(msg)
  else if (req.command === RPC_FS_RENAME) handleFsRename(msg)
  else if (req.command === RPC_FS_MKDIR) handleFsMkdir(msg)
  else if (req.command === RPC_NOMAD) handleNomad(msg)
  else if (req.command === RPC_AI_CHAT) handleAiChat(msg)
  else if (req.command === RPC_AI_CANCEL) handleAiCancel(msg)
  else if (req.command === RPC_AI_PROMPT_RESULT) handleAiPromptResult(msg)
})

// --- file-system ops on writable drives you own --------------------------
// Each replies with a single RPC_FS_RESULT keyed by reqId. `key` is the drive
// key hex; the manager opens the drive writable via its namespace `ns`.
const keyBuf = (key) => b4a.from(key, 'hex')
const fsFail = (reqId, err) => send(RPC_FS_RESULT, { reqId, ok: false, message: err.message || String(err) })

async function handleFsList ({ reqId, driveType, key, ns, path = '/' }) {
  try {
    const { entries, writable } = await manager.listDir(driveType, keyBuf(key), ns, path)
    send(RPC_FS_RESULT, { reqId, ok: true, entries, writable })
  } catch (err) { fsFail(reqId, err) }
}

async function handleFsRead ({ reqId, driveType, key, ns, path }) {
  try {
    const { buf, mime } = await manager.readFile(driveType, keyBuf(key), ns, path)
    send(RPC_FS_RESULT, { reqId, ok: true, exists: !!buf, mime, base64: buf ? b4a.toString(buf, 'base64') : '' })
  } catch (err) { fsFail(reqId, err) }
}

async function handleFsWrite ({ reqId, driveType, key, ns, path, base64 = '' }) {
  try {
    await manager.writeFile(driveType, keyBuf(key), ns, path, b4a.from(base64, 'base64'))
    send(RPC_FS_RESULT, { reqId, ok: true })
  } catch (err) { fsFail(reqId, err) }
}

async function handleFsDelete ({ reqId, driveType, key, ns, path, isDir = false }) {
  try {
    await manager.deletePath(driveType, keyBuf(key), ns, path, isDir)
    send(RPC_FS_RESULT, { reqId, ok: true })
  } catch (err) { fsFail(reqId, err) }
}

async function handleFsRename ({ reqId, driveType, key, ns, from, to, isDir = false }) {
  try {
    await manager.renamePath(driveType, keyBuf(key), ns, from, to, isDir)
    send(RPC_FS_RESULT, { reqId, ok: true })
  } catch (err) { fsFail(reqId, err) }
}

async function handleFsMkdir ({ reqId, driveType, key, ns, path }) {
  try {
    await manager.mkdir(driveType, keyBuf(key), ns, path)
    send(RPC_FS_RESULT, { reqId, ok: true })
  } catch (err) { fsFail(reqId, err) }
}

// --- in-page nomad.* bridge ---------------------------------------------
// Backs the window.nomad shim injected into drive WebViews (see lib/types.ts
// NOMAD_SHIM). Each call from a page is forwarded here and replied to with a
// single RPC_NOMAD_RESULT keyed by reqId. Only the surface the blog template
// uses is implemented; reads work, writing/writer-management are stubbed until
// the mobile Vault exposes writable drives.
async function handleNomad ({ reqId, api, method, url, args = [] }) {
  try {
    const value = await dispatchNomad(api, method, url, args)
    send(RPC_NOMAD_RESULT, { reqId, ok: true, value })
  } catch (err) {
    send(RPC_NOMAD_RESULT, { reqId, ok: false, error: err.message || String(err) })
  }
}

// --- AI chat (streaming, over the AI Bridge) -----------------------------
// nomad.ai.chat() is a readable, so unlike handleNomad each RPC_AI_CHAT fans out many RPC_AI_EVENT
// frames keyed by reqId. The turn runs on a remote AI Provider (desktop); this phone is the Client.
const aiTurns = new Map() // reqId -> { signal, abort, promptResolve }

// Minimal AbortController-shaped primitive — Bare has no guaranteed global AbortController, and the
// Bridge only needs { aborted, addEventListener('abort'), abort() }.
function makeAbort () {
  const listeners = []
  const signal = {
    aborted: false,
    addEventListener: (type, cb) => { if (type === 'abort') listeners.push(cb) },
    removeEventListener: () => {}
  }
  return {
    signal,
    abort: () => {
      if (signal.aborted) return
      signal.aborted = true
      for (const cb of listeners) { try { cb() } catch {} }
    }
  }
}

async function handleAiChat ({ reqId, messages, opts = {} }) {
  console.log('[ai-bridge] handleAiChat', reqId)
  const { signal, abort } = makeAbort()
  const entry = { signal, abort, promptResolve: null }
  aiTurns.set(reqId, entry)
  try {
    await aiBridge.requestRemoteChat({
      messages,
      opts,
      signal,
      onChunk: (text) => send(RPC_AI_EVENT, { reqId, kind: 'chunk', text }),
      onTool: (event) => send(RPC_AI_EVENT, { reqId, kind: 'tool', event }),
      // Provider keepalive during model load / slow first token — resets the UI idle timeout.
      onHeartbeat: () => send(RPC_AI_EVENT, { reqId, kind: 'heartbeat' }),
      // Relayed modifyDrive consent — the human is on THIS phone. Surface it to the RN UI and wait.
      onPrompt: (permission) => new Promise((resolve) => {
        entry.promptResolve = resolve
        send(RPC_AI_EVENT, { reqId, kind: 'prompt', permission })
      })
    })
    send(RPC_AI_EVENT, { reqId, kind: 'done' })
  } catch (err) {
    send(RPC_AI_EVENT, { reqId, kind: 'error', message: err && err.message ? err.message : String(err) })
  } finally {
    aiTurns.delete(reqId)
  }
}

function handleAiCancel ({ reqId }) {
  console.log('[ai-bridge] handleAiCancel', reqId, '(if this fires right after handleAiChat, the UI is cancelling spuriously)')
  const entry = aiTurns.get(reqId)
  if (entry) entry.abort()
}

function handleAiPromptResult ({ reqId, allow }) {
  const entry = aiTurns.get(reqId)
  if (entry && entry.promptResolve) {
    const resolve = entry.promptResolve
    entry.promptResolve = null
    resolve(!!allow)
  }
}

// nomad.fs methods NOT yet supported on mobile: per-drive writer management (mobile's writer story
// is Vault device-pairing, not per-drive invites) + Hyperdrive-only / metadata ops. File writes
// (put/writeFile/del/mkdir) and createDrive ARE supported for drives owned on this device.
const NOMAD_UNSUPPORTED_METHODS = [
  'createInvite', 'claimInvite', 'requestAccess', 'approveRequest', 'denyRequest', 'removeWriter',
  'listWriters', 'listRequests', 'forkDrive', 'configure', 'updateMetadata', 'deleteMetadata',
  'mount', 'unmount', 'symlink', 'importFromFilesystem', 'exportToFilesystem', 'exportToDrive',
  'diff', 'loadDrive'
]

async function dispatchNomad (api, method, url, args) {
  if (api === 'markdown' && method === 'toHTML') return manager.bridgeMarkdown(args[0])
  if (api === 'schemas' && method === 'validate') return validateRecord(args[0], args[1])
  if (api === 'hyperdrive' && method === 'readFile') {
    const { key, path } = parseHyperUrl(url)
    return manager.bridgeRead(DRIVE_HYPERDRIVE, key, path)
  }
  // nomad.fs — the unified API (ADR-0010). All Nomad drives are Autobase. Reads route to the
  // Autobase bridge; writes go through the owned-drive path (ns resolved from drivesNs), so a page
  // can edit a drive this device created. Per-drive writer management is still deferred (see list).
  if (api === 'fs') {
    if (method === 'watch' || method === 'watchRequests' || method === 'watchDraft') return null // no live events on mobile yet
    if (method === 'isCollaborativeDrive') return true // every Nomad drive is an Autobase

    if (method === 'createDrive' || method === 'createCollaborativeDrive') {
      const meta = args[0] || {}
      const res = await manager.createDrive(DRIVE_AUTOBASE, meta)
      if (res && res.ns) { drivesNs[res.key] = res.ns; saveDrivesNs() }
      return `hyper://${res.key}/` // the shim wraps this into a scoped drive handle
    }

    // `key` is a Buffer (what the manager's bridge/write methods want); `keyHex` is the hex string
    // that the Vault-hosted Draft is keyed by (matching what desktop wrote), so drafts.* take keyHex.
    const { key, keyHex, path } = parseHyperUrl(url)

    // Draft Mode (ADR-0012). Drafts live in the Vault (writable on any device), so stage/preview/
    // discard work here; Publish is gated to drives owned on this device (drivesNs).
    if (method === 'beginDraft') return drafts.setMode(vault, keyHex, true)
    if (method === 'endDraft') return drafts.setMode(vault, keyHex, false)
    if (method === 'draftStatus') return drafts.draftStatus(vault, keyHex)
    if (method === 'publishDraft') return drafts.publish(vault, manager, drivesNs, keyHex, args[0] || {})
    if (method === 'discardDraft') return drafts.discard(vault, keyHex, args[0] || {})
    if (method === 'setDraftPreview') {
      const on = !!args[0]
      drafts.setPreview(keyHex, on)
      return { on }
    }

    const draftOn = async (opts) =>
      opts && opts.draft === true ? true : opts && opts.draft === false ? false : drafts.getMode(vault, keyHex)

    // Writes — stage into the Vault-hosted Draft while Draft Mode is on; otherwise write live (owned
    // drives only: manager.writeFile throws a clear read-only error when drivesNs[key] is undefined).
    if (method === 'put' || method === 'writeFile') {
      const data = args[0]; const opts = args[1] || {}
      const buf = opts && opts.encoding === 'base64' ? b4a.from(String(data), 'base64') : b4a.from(String(data == null ? '' : data))
      if (await draftOn(opts)) { await drafts.stagePut(vault, keyHex, path, buf, opts); return true }
      await manager.writeFile(DRIVE_AUTOBASE, keyBuf(key), drivesNs[keyHex], path, buf)
      return true
    }
    if (method === 'del' || method === 'unlink') {
      const opts = args[0] || {}
      if (await draftOn(opts)) { await drafts.stageDel(vault, keyHex, path); return true }
      await manager.deletePath(DRIVE_AUTOBASE, keyBuf(key), drivesNs[keyHex], path, false)
      return true
    }
    if (method === 'mkdir') {
      await manager.mkdir(DRIVE_AUTOBASE, keyBuf(key), drivesNs[keyHex], path)
      return true
    }

    if (NOMAD_UNSUPPORTED_METHODS.includes(method)) {
      throw new Error(`nomad.fs.${method} isn’t supported on mobile yet`)
    }

    // Reads. Merge the Draft over the base when { draft:true } is passed OR this Drive is being
    // previewed (drafts.isPreview) — so a drive app rendered in a previewing tab reads its own
    // merged content, mirroring desktop. { draft:false } opts out.
    const wantMerge = (opts) =>
      opts.draft === true ? true : opts.draft === false ? false : drafts.isPreview(keyHex)
    if (method === 'getInfo') return manager.bridgeInfo(DRIVE_AUTOBASE, key)
    if (method === 'get' || method === 'readFile') {
      const opts = args[0] || {}
      if (wantMerge(opts)) return drafts.readMerged(vault, manager, keyHex, path)
      return manager.bridgeRead(DRIVE_AUTOBASE, key, path)
    }
    if (method === 'list' || method === 'query' || method === 'readdir') {
      const opts = args[0] || {}
      let keys = await manager.bridgeListKeys(DRIVE_AUTOBASE, key, path)
      if (wantMerge(opts)) {
        const { removed, put } = await drafts.dirOverlay(vault, keyHex, path)
        keys = keys.filter((k) => !removed.has(k))
        for (const p of put) if (!keys.includes(p)) keys.push(p)
      }
      return keys.map((k) => ({ key: k }))
    }
    // stat/entry not wired yet (bridge has no per-file stat) — reject clearly rather than fake it.
    throw new Error(`nomad.fs.${method} isn’t supported on mobile yet`)
  }
  throw new Error(`Unsupported nomad call: ${api}.${method}`)
}

// Minimal stand-in for nomad.schemas.validate on mobile (the full Zod schemas
// live in the desktop app). Enough for read-time use; real validation happens on
// the writing device.
function validateRecord (type, data) {
  if (!data || typeof data !== 'object') return { success: false, error: 'data must be an object' }
  if (type && data.type && data.type !== type) return { success: false, error: `expected type ${type}` }
  return { success: true, data }
}

async function handleRenameDevice ({ reqId, deviceKey, name }) {
  try {
    if (vault) await renameDevice(vault, deviceKey, name)
    await handleVaultStatus({ reqId })
  } catch (err) {
    send(RPC_VAULT, { reqId, hasVault: !!vault, message: err.message || String(err) })
  }
}

// Remove a device from the Vault. `self` => unlink THIS phone: revoke its writer (best-effort) and
// then forget the Vault locally (drop the persisted key + close the base), so the phone reverts to
// local-only spaces. Removing another device just revokes it and drops its record.
async function handleRemoveDevice ({ reqId, deviceKey, self = false }) {
  console.log('[vault] handleRemoveDevice', deviceKey && deviceKey.slice(0, 8), 'self', self, 'hasVault', !!vault, 'peers', manager.peers)
  try {
    if (self) {
      // Unlink THIS phone. Forgetting the Vault locally is the part that must always succeed, so do
      // it FIRST, then best-effort revoke our writer in the BACKGROUND without awaiting it. Awaiting
      // removeWriter on our own key previously stalled, so the forget never ran — the device blinked
      // out (UI timeout) and then reappeared on the next status read.
      const base = vault
      vault = null
      ownDeviceSeen = false
      try { if (fs.existsSync(vaultKeyPath)) fs.unlinkSync(vaultKeyPath) } catch {}
      if (base) {
        removeDevice(base, deviceKey).catch(() => {}).then(() => base.close().catch(() => {}))
      }
      await handleVaultStatus({ reqId })
      return
    }
    if (vault && deviceKey) await removeDevice(vault, deviceKey)
    await handleVaultStatus({ reqId })
  } catch (err) {
    send(RPC_VAULT, { reqId, hasVault: !!vault, message: err.message || String(err) })
  }
}

async function handleAddVaultSpace ({ reqId, rootDriveKey, name, icon, color }) {
  try {
    if (vault) await addSpaceToVault(vault, { rootDriveKey, name, icon, color })
    await handleVaultStatus({ reqId })
  } catch (err) {
    send(RPC_VAULT, { reqId, hasVault: !!vault, message: err.message || String(err) })
  }
}

async function handleBookmarks ({ reqId, action, rootDriveKey, ns = null, href, title }) {
  try {
    const key = b4a.from(rootDriveKey, 'hex')
    if (action === 'add') await manager.addBookmark(key, ns, { href, title })
    else if (action === 'remove') await manager.removeBookmark(key, ns, href)
    const bookmarks = await manager.listBookmarks(key, ns)
    send(RPC_BOOKMARKS_RESULT, { reqId, ok: true, bookmarks })
  } catch (err) {
    send(RPC_BOOKMARKS_RESULT, { reqId, ok: false, bookmarks: [], message: err.message || String(err) })
  }
}

async function handleSpaceDrives ({ reqId, rootDriveKey, ns = null }) {
  console.log('[registry] handleSpaceDrives', rootDriveKey && rootDriveKey.slice(0, 8), 'ns', !!ns)
  try {
    const drives = await manager.readDriveRegistry(b4a.from(rootDriveKey, 'hex'), ns)
    send(RPC_SPACE_DRIVES_RESULT, { reqId, ok: true, drives })
  } catch (err) {
    console.log('[registry] handleSpaceDrives error', err && err.message)
    send(RPC_SPACE_DRIVES_RESULT, { reqId, ok: false, drives: [], message: err.message || String(err) })
  }
}

async function handleSpaceAddDrive ({ reqId, rootDriveKey, ns = null, key, type }) {
  try {
    const drives = await manager.addDriveToRegistry(b4a.from(rootDriveKey, 'hex'), ns, { key, type })
    send(RPC_SPACE_DRIVES_RESULT, { reqId, ok: true, drives })
  } catch (err) {
    send(RPC_SPACE_DRIVES_RESULT, { reqId, ok: false, drives: [], message: err.message || String(err) })
  }
}

async function handlePairSubmit ({ reqId, code, name = 'Mobile device' }) {
  console.log('[pairing] handlePairSubmit start, code len', code && code.length)
  try {
    const { vaultKey, deviceKey } = await pairDevice({ store, swarm: manager.swarm, code, name })
    console.log('[pairing] paired, vaultKey', vaultKey)
    saveVaultKey(vaultKey)
    // Report success as soon as pairing is accepted. Opening/replicating the Vault can take a
    // while (swarm join + base.update waiting on the writer add to linearise) and must NOT block
    // the UI — it only needs to know pairing succeeded. The Vault opens in the background;
    // vaultStatus() reflects it once ready.
    send(RPC_PAIRED, { reqId, ok: true, vaultKey, deviceKey })
    openVault(store, manager.swarm, vaultKey).then((b) => { vault = b; aiBridge.install() }).catch(() => {})
  } catch (err) {
    send(RPC_PAIRED, { reqId, ok: false, message: err.message || String(err) })
  }
}

async function handleVaultStatus ({ reqId }) {
  try {
    if (!vault) {
      // Paired but the base hasn't finished opening yet (right after pairing, or during startup):
      // report paired + opening so the UI shows the linked state and keeps polling, instead of
      // snapping back to the invite form. No key => genuinely unpaired.
      const key = loadVaultKey()
      send(RPC_VAULT, { reqId, hasVault: !!key, opening: !!key })
      return
    }
    const index = await readVaultIndex(vault)
    // This device's own writer key, so the UI can tag "This device" and offer "Unlink this phone".
    // `vault` is the Autobase itself here (openVault returns the base), so the local writer is
    // vault.local — not vault.base.local as on desktop, where the base is wrapped in a session.
    const thisDeviceKey = vault.local?.key ? b4a.toString(vault.local.key, 'hex') : null
    const devices = index.devices || []
    const present = !!thisDeviceKey && devices.some((d) => d.key === thisDeviceKey)
    if (present) ownDeviceSeen = true
    // Removed remotely: our own record was deleted from a Vault we were registered in THIS session
    // (ownDeviceSeen guards against a not-yet-synced blank read at startup). Confirm it's real with a
    // second signal — another device record still present, or our writer revoked (writable false).
    // Leave the Vault — same end state as a local unlink.
    if (ownDeviceSeen && !present && (devices.length > 0 || index.writable === false)) {
      console.log('[vault] this device was removed remotely — unlinking')
      const base = vault
      vault = null
      ownDeviceSeen = false
      try { if (fs.existsSync(vaultKeyPath)) fs.unlinkSync(vaultKeyPath) } catch {}
      if (base) base.close().catch(() => {})
      send(RPC_VAULT, { reqId, hasVault: false, removed: true })
      return
    }
    console.log('[vault] status devices', devices.length, 'spaces', (index.spaces || []).length,
      'writable', index.writable, 'ownPresent', present,
      'thisKey', thisDeviceKey ? thisDeviceKey.slice(0, 8) : null,
      'localExists', !!vault.local,
      'deviceKeys', devices.map((d) => (d.key || '').slice(0, 8)).join(','),
      'peers', manager.peers)
    send(RPC_VAULT, { reqId, hasVault: true, vaultKey: loadVaultKey(), thisDeviceKey, ...index })
  } catch (err) {
    send(RPC_VAULT, { reqId, hasVault: false, message: err.message || String(err) })
  }
}

async function handleOpen ({ tabId, url, driveType = DRIVE_HYPERDRIVE, ns = null, detect = true }) {
  const onStatus = (phase, message, peers) =>
    send(RPC_STATUS, { tabId, phase, message, peers: peers ?? manager.peers })

  try {
    const { key, keyHex, path } = parseHyperUrl(url)
    // Try both drive types (hinted first) only when the type is unknown.
    const { result, driveType: detected, title } = await manager.resolveAuto(key, path, driveType, onStatus, ns, detect)

    if (result.kind === 'file') {
      send(RPC_CONTENT, {
        tabId,
        url,
        ok: true,
        key: keyHex,
        driveType: detected,
        title,
        isDir: false,
        mime: result.mime,
        bodyBase64: b4a.toString(result.buffer, 'base64')
      })
    } else {
      send(RPC_CONTENT, {
        tabId,
        url,
        ok: true,
        key: keyHex,
        driveType: detected,
        title,
        isDir: true,
        mime: 'application/x-directory',
        path,
        entries: result.entries
      })
    }
  } catch (err) {
    send(RPC_ERROR, { tabId, url, message: err.message || String(err) })
  }
}

function handleClose ({ driveType = DRIVE_HYPERDRIVE, key }) {
  if (key) manager.release(driveType, key)
}

async function handleCreate ({ reqId, type = DRIVE_HYPERDRIVE, title, description }) {
  try {
    const { key, ns, title: t } = await manager.createDrive(type, { title, description })
    if (ns) { drivesNs[key] = ns; saveDrivesNs() }
    send(RPC_CREATED, { reqId, ok: true, url: `hyper://${key}/`, key, type, ns, title: t })
  } catch (err) {
    send(RPC_CREATED, { reqId, ok: false, message: err.message || String(err) })
  }
}

function send (command, payload) {
  const req = rpc.request(command)
  req.send(b4a.from(JSON.stringify(payload)))
}

function decode (data) {
  try { return JSON.parse(b4a.toString(data)) } catch { return {} }
}
