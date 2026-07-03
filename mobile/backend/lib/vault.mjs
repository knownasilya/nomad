import Autobase from 'autobase'
import BlindPairing from 'blind-pairing'
import z32 from 'z32'
import b4a from 'b4a'
import { openAutobaseDrive } from './drive-manager.mjs'
import { makeMetadata, decodeInlineJson } from '../../../shared/fs-core.mjs'

// Vault index records are small JSON control records — stored inline in the v1 view
// ({ metadata, blob:null, value: base64(JSON) }); see shared/fs-core.mjs. This builds that op.
function _inlineOp (path, obj) {
  const bytes = b4a.from(typeof obj === 'string' ? obj : JSON.stringify(obj))
  return { op: 'put', path, metadata: makeMetadata({ mtime: Date.now(), ctime: Date.now() }), value: b4a.toString(bytes, 'base64') }
}

// Mobile side of the multi-device protocol (see nomad/docs/multi-device-protocol.md).
// The Vault is an Autobase in the shared collaborative-drive format, so openAutobaseDrive()
// — which already matches nomad byte-for-byte — opens it. Mobile is primarily a *candidate*:
// it joins an existing identity's Vault via an invite code from a trusted (desktop) device.

const SPACES_PREFIX = '/.vault/spaces/'
const DEVICES_PREFIX = '/.vault/devices/'

// Candidate-side pairing. Mirrors nomad app/bg/hyper/device-pairing.js submitInvite (autopass
// pattern): mint our local Autobase writer key up front, send it as userData, receive the Vault
// key on approval. Resolves once the inviter approves; rejects if pairing fails.
export async function pairDevice ({ store, swarm, code, name, platform = 'mobile' }) {
  const core = Autobase.getLocalCore(store)
  await core.ready()
  const localKey = b4a.toString(core.key, 'hex')
  await core.close()
  console.log('[pairing] candidate localKey', localKey)

  // poll: keep re-checking the DHT for the member's confirmation after our request is sent.
  const bp = new BlindPairing(swarm, { poll: 5000 })
  return await new Promise((resolve, reject) => {
    let candidate
    try {
      candidate = bp.addCandidate({
        invite: z32.decode(code),
        userData: b4a.from(JSON.stringify({ key: localKey, name, platform })),
        onadd: async (result) => {
          console.log('[pairing] onadd fired, vaultKey', b4a.toString(result.key, 'hex'))
          try {
            resolve({ vaultKey: b4a.toString(result.key, 'hex'), deviceKey: localKey })
          } catch (e) {
            reject(e)
          }
        }
      })
      console.log('[pairing] candidate added, waiting for approval')
    } catch (e) {
      console.log('[pairing] addCandidate threw', e && e.message)
      return reject(e)
    }
    candidate.pairing
      .then(() => console.log('[pairing] candidate.pairing resolved, paired =', candidate.paired))
      .catch((e) => { console.log('[pairing] candidate.pairing error', e && e.message); reject(e) })
  })
}

// base.update() can block on a freshly-paired Vault while it first replicates from the inviter.
// Bound it so callers (the Vault-status RPC) never hang on it; we read whatever's linearised.
function _boundedUpdate (base, ms = 4000) {
  return Promise.race([base.update().catch(() => {}), new Promise((r) => setTimeout(r, ms))])
}

// Open the Vault autobase (writable once our writer key has linearised) and join its swarm topic.
export async function openVault (store, swarm, vaultKey) {
  const base = openAutobaseDrive(store, b4a.from(vaultKey, 'hex'))
  await base.ready()
  swarm.join(base.discoveryKey)
  await _boundedUpdate(base)
  // localKey here MUST match the key sent during pairing ([pairing] candidate localKey). If it
  // doesn't, the desktop added the wrong writer and this device can never become writable.
  console.log('[vault] openVault', vaultKey.slice(0, 8),
    'writable', base.writable,
    'localKey', base.local?.key ? b4a.toString(base.local.key, 'hex').slice(0, 8) : null)
  return base
}

// Rename a device record in the Vault (requires the Vault to be writable on this device).
export async function renameDevice (base, deviceKey, name) {
  if (!base) return
  await base.update()
  const path = `/.vault/devices/${deviceKey}.json`
  const node = await base.view.get(path)
  const rec = node && decodeInlineJson(node.value, b4a)
  if (!rec) return
  rec.name = name
  await base.append(_inlineOp(path, rec))
  await base.update()
}

// Revoke a device: removeWriter from the Vault and drop its record. Mirrors nomad's removeDevice
// (app/bg/hyper/vault.js) minus the per-space-drive fan-out, which is best-effort there too.
// NOTE (ADR-0006): this stops future writes from the device but cannot un-share data it already
// replicated, and the device keeps its local copies. The UI must say so. Requires the Vault to be
// writable on this device. Removing the bootstrap/owner device is destructive to the Autobase, so
// the UI only offers it as an explicit, confirmed action.
export async function removeDevice (base, deviceKey) {
  if (!base || !deviceKey) return
  await base.update()
  const path = `/.vault/devices/${deviceKey}.json`
  const short = deviceKey.slice(0, 8)
  // Autobase mutations need a writable base. Surface read-only plainly instead of optimistically
  // "removing" the row and having it snap back when the view can't actually advance.
  if (!base.writable) {
    throw new Error('This device isn’t a writer of the Vault yet. Make sure your other device is online so it can finish syncing, then try again.')
  }
  const before = await base.view.get(path)
  console.log('[vault] removeDevice', short, 'writable', base.writable, 'recordExists', !!before)
  await base.append({ removeWriter: deviceKey })
  await base.append({ op: 'del', path })
  await base.update()
  const after = await base.view.get(path)
  // If the record is still here right after the delete, the view couldn't finalize the change —
  // typically the OTHER indexer (desktop) is offline, so there's no quorum to advance the index.
  console.log('[vault] removeDevice done', short, 'recordStillExists', !!after)
}

// Register a space in the Vault (keyed by rootDriveKey), matching nomad's record shape so the
// space syncs to other devices. Requires the Vault to be writable on this device.
export async function addSpaceToVault (base, { rootDriveKey, name, icon, color }) {
  if (!base || !rootDriveKey) return
  const rec = {
    rootDriveKey,
    name: name || 'Space',
    icon: icon || 'circle',
    color: color || '#6c6cff',
    sortOrder: 0,
    createdAt: new Date().toISOString()
  }
  await base.append(_inlineOp(`/.vault/spaces/${rootDriveKey}.json`, rec))
  await base.update()
}

export async function readVaultIndex (base) {
  await _boundedUpdate(base)
  return {
    spaces: await _readPrefix(base.view, SPACES_PREFIX),
    devices: await _readPrefix(base.view, DEVICES_PREFIX),
    writable: base.writable
  }
}

async function _readPrefix (view, prefix) {
  const out = []
  for await (const node of view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    if (rec) out.push(rec)
  }
  return out
}
