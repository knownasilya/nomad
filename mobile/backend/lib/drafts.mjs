import b4a from 'b4a'
import { makeMetadata, decodeInlineJson } from '../../../shared/fs-core.mjs'
import { DRIVE_AUTOBASE } from '../../rpc-commands.mjs'

// Mobile side of Drive Draft Mode (ADR-0012). Mirrors app/bg/hyper/drafts.js: Drafts live in the
// Vault (already multi-writer across the user's devices), so staging on the phone syncs to desktop
// with no protocol change. Publish is gated to drives OWNED on this device (a per-drive namespace in
// `drivesNs`); a drive merely paired into can't be written here (multi-device-protocol §3), so its
// Draft is published from the owning device.
//
// Note: mobile records NO base baseline in staged entries (it has no cheap raw-record read), so it
// can't flag conflicts locally — desktop recomputes conflicts against its own base at Publish, and
// treats a missing baseline as "no conflict".

// Rendering the merged Draft is toggled per Drive (hex key). While a Drive is previewed, its reads
// through the in-page nomad.fs bridge merge Draft-over-base, so a drive app rendered in the WebView
// shows the unpublished Draft. Local to this device; the Draft is already synced via the Vault.
const _preview = new Set()
export function setPreview (driveKey, on) {
  if (!driveKey) return
  if (on) _preview.add(driveKey)
  else _preview.delete(driveKey)
}
export function isPreview (driveKey) {
  return !!driveKey && _preview.has(driveKey)
}

const filesPrefix = (baseKey) => `/.drafts/${baseKey}/files`
const filePath = (baseKey, path) =>
  `${filesPrefix(baseKey)}${path.startsWith('/') ? path : `/${path}`}`
const modePath = (baseKey) => `/.drafts/${baseKey}/mode.json`
const toOriginalPath = (baseKey, draftPath) => draftPath.slice(filesPrefix(baseKey).length) || '/'

function inlineOp (path, obj) {
  const bytes = b4a.from(typeof obj === 'string' ? obj : JSON.stringify(obj))
  return {
    op: 'put',
    path,
    metadata: makeMetadata({ mtime: Date.now(), ctime: Date.now() }),
    value: b4a.toString(bytes, 'base64')
  }
}

function requireVault (vault) {
  if (!vault) throw new Error('No Vault on this device — pair this device to use Draft Mode')
  if (!vault.writable) throw new Error('Vault is not yet writable on this device')
  return vault
}

async function readEntry (vault, baseKey, path) {
  if (!vault) return null
  const node = await vault.view.get(filePath(baseKey, path)).catch(() => null)
  return node ? decodeInlineJson(node.value, b4a) : null
}

export async function getMode (vault, baseKey) {
  if (!vault) return false
  const node = await vault.view.get(modePath(baseKey)).catch(() => null)
  const rec = node ? decodeInlineJson(node.value, b4a) : null
  return !!(rec && rec.on)
}

export async function setMode (vault, baseKey, on) {
  requireVault(vault)
  await vault.append(inlineOp(modePath(baseKey), { on: !!on }))
  await vault.update()
  return { on: !!on }
}

export async function stagePut (vault, baseKey, path, buf, opts = {}) {
  requireVault(vault)
  await vault.append(inlineOp(filePath(baseKey, path), {
    op: 'put',
    contentB64: b4a.toString(buf, 'base64'),
    executable: opts.executable || undefined,
    stagedAt: Date.now()
  }))
  await vault.update()
}

export async function stageDel (vault, baseKey, path) {
  requireVault(vault)
  await vault.append(inlineOp(filePath(baseKey, path), { op: 'del', stagedAt: Date.now() }))
  await vault.update()
}

// For the serve overlay (drive-manager): { override:true, buf } when a staged entry exists
// (buf=null = tombstone), else { override:false } to fall through to the published read.
export async function stagedContent (vault, baseKey, path) {
  const entry = await readEntry(vault, baseKey, path)
  if (!entry) return { override: false }
  if (entry.op === 'del') return { override: true, buf: null }
  return { override: true, buf: b4a.from(entry.contentB64, 'base64') }
}

// Content string for the merged view, or null (missing/tombstoned). Matches bridgeRead's utf8 return.
// `baseKey` is hex; the manager's bridge wants a Buffer key, so convert for the fall-through read.
export async function readMerged (vault, manager, baseKey, path) {
  const entry = await readEntry(vault, baseKey, path)
  if (entry) {
    if (entry.op === 'del') return null
    return b4a.toString(b4a.from(entry.contentB64, 'base64'))
  }
  return manager.bridgeRead(DRIVE_AUTOBASE, b4a.from(baseKey, 'hex'), path)
}

// [{ path, op, conflict:false }] — mobile can't compute conflicts (no baseline); desktop does at Publish.
export async function listDraft (vault, baseKey) {
  if (!vault) return []
  const prefix = filesPrefix(baseKey)
  const out = []
  for await (const node of vault.view.createReadStream({ gte: prefix, lt: `${prefix}\xff` })) {
    const entry = decodeInlineJson(node.value, b4a)
    if (!entry) continue
    const key = typeof node.key === 'string' ? node.key : b4a.toString(node.key)
    // `created` (new-file vs edit) needs a base baseline, which mobile doesn't record — always false.
    out.push({ path: toOriginalPath(baseKey, key), op: entry.op, created: false, conflict: false })
  }
  return out
}

export async function draftStatus (vault, baseKey) {
  const [mode, changes] = await Promise.all([getMode(vault, baseKey), listDraft(vault, baseKey)])
  return { mode, changes }
}

const selected = (p, paths) =>
  !paths || paths.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`))

// Fold staged changes onto the base drive. Owned drives only (drivesNs has the namespace).
export async function publish (vault, manager, drivesNs, baseKey, { paths = null } = {}) {
  const ns = drivesNs[baseKey]
  if (ns === undefined) {
    throw new Error('Publish from the device that owns this drive — it can’t be published here')
  }
  requireVault(vault)
  const keyB = b4a.from(baseKey, 'hex')
  const rows = (await listDraft(vault, baseKey)).filter((r) => selected(r.path, paths))
  const published = []
  for (const row of rows) {
    const entry = await readEntry(vault, baseKey, row.path)
    if (!entry) continue
    if (entry.op === 'del') await manager.deletePath(DRIVE_AUTOBASE, keyB, ns, row.path, false)
    else await manager.writeFile(DRIVE_AUTOBASE, keyB, ns, row.path, b4a.from(entry.contentB64, 'base64'))
    published.push(row.path)
  }
  for (const p of published) await vault.append({ op: 'del', path: filePath(baseKey, p) })
  if (published.length) await vault.update()
  return { published, conflicts: [] }
}

export async function discard (vault, baseKey, { paths = null } = {}) {
  requireVault(vault)
  const rows = (await listDraft(vault, baseKey)).filter((r) => selected(r.path, paths))
  for (const row of rows) await vault.append({ op: 'del', path: filePath(baseKey, row.path) })
  if (rows.length) await vault.update()
  return { discarded: rows.map((r) => r.path) }
}

// Recursive path overlay for the flat list()/readdir() bridge: { removed:Set<path>, put:Set<path> }.
export async function dirOverlay (vault, baseKey, dirPath) {
  const prefix = dirPath === '/' ? '/' : dirPath.endsWith('/') ? dirPath : `${dirPath}/`
  const removed = new Set()
  const put = new Set()
  for (const { path, op } of await listDraft(vault, baseKey)) {
    if (!path.startsWith(prefix)) continue
    if (op === 'del') removed.add(path)
    else put.add(path)
  }
  return { removed, put }
}
