// What this Peer holds, read from the Vault (ADR-0038 §5). The rules are shared/peers.mjs; this reads
// the records they need: this Peer's own record, the Space records, each held Space's Drive Registry
// and the Personas. `readRegistry(driveKeyHex)` returns a drive's /drives.json entries (the Space
// Library's once the Space is shared, else its Root Drive's).

import * as peers from '../shared/peers.mjs'
import { PERSONAS_PREFIX } from '../shared/personas.mjs'
import { decodeInlineJson } from '../shared/fs-core.mjs'

const SPACES_PREFIX = '/.vault/spaces/'

export async function readPrefix (view, prefix, b4a) {
  const out = []
  for await (const node of view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
    const rec = decodeInlineJson(node.value, b4a)
    if (rec) out.push(rec)
  }
  return out
}

export async function readRecord (view, path, b4a) {
  const node = await view.get(path)
  return node ? decodeInlineJson(node.value, b4a) : null
}

// { record, holdings } for Peer `peerKey` in Vault `base`. `record` is null until the approving
// Device's write has reached this Peer, and after a Device removed it.
export async function readHoldings ({ base, b4a, peerKey, readRegistry = async () => [] }) {
  const record = await readRecord(base.view, peers.peerPath(peerKey), b4a).catch(() => null)
  if (!peers.isPeer(record)) return { record: null, holdings: [] }
  const vaultKey = b4a.toString(base.key, 'hex')
  const spaces = await readPrefix(base.view, SPACES_PREFIX, b4a)
  const personas = await readPrefix(base.view, PERSONAS_PREFIX, b4a)
  const hold = peers.normalizeHold(record.hold, record.kind)
  const registries = {}
  for (const s of spaces) {
    const root = s && s.rootDriveKey
    if (!peers.isKey(root) || s.removed || s.movedTo || s.deleted) continue
    // A Space it doesn't keep only matters when the Peer was given single drives from it.
    if (!peers.holdsSpace(record, root) && hold.drives === 'all' && !hold.extra.length) continue
    const from = peers.isKey(s.library) ? s.library : root
    registries[root] = await readRegistry(from).catch(() => [])
  }
  return { record, holdings: peers.holdingsOf(record, { vaultKey, spaces, registries, personas }) }
}
