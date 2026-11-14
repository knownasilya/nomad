// Version history on the phone: a drive's changes, a file as it was, and restoring a file or the
// whole drive, as desktop's nomad://versions does (app/bg/hyper/drive-history.js). The rules are
// shared/drive-history.mjs; this opens the drive through the DriveManager and writes through it.
//
// Only Autobase drives (collaborative ones, and every drive desktop makes since ADR-0010) keep a
// history; a Hyperdrive answers null. A drive this phone made opens with its namespace (`ns`), so it
// is writable here; any other drive is writable only when the phone was added as one of its writers.
// Restoring needs a writable drive; looking does not.
//
// Runs on the Bare worklet (no TextDecoder there), and under Node in tests.

import b4a from 'b4a'
import * as rules from '../../../shared/drive-history.mjs'
import { DRIVE_AUTOBASE } from '../../rpc-commands.mjs'

// Text files bigger than this aren't shown; restoring still works (desktop's VIEW_MAX).
const VIEW_MAX = 1024 * 1024
// How long to wait for an old version's bytes from a peer.
const READ_TIMEOUT = 15000

const isKey = (k) => typeof k === 'string' && /^[0-9a-f]{64}$/i.test(k)

export function createDriveHistory (manager) {
  // The opened base for drive `key`, or null for a drive with no history here (a Hyperdrive).
  async function baseFor ({ key, type, ns } = {}, { write = false } = {}) {
    if (!isKey(key)) throw new Error('Not a drive address')
    if (type && type !== DRIVE_AUTOBASE) return null
    const entry = await manager.open(DRIVE_AUTOBASE, b4a.from(key, 'hex'), () => {}, ns || null)
    const base = entry.drive
    if (!base || !base.view) return null
    try { await base.update() } catch {}
    if (write && !manager.canWrite(base)) throw new Error('Only a device that can edit this drive can restore it')
    return base
  }

  const appendTo = (base) => async (ops) => {
    for (const op of ops) await base.append(op)
    await base.update()
  }

  return {
    // { title, writable, version, rows, before }, or null when the drive keeps no history.
    async history (drive, { before = null, limit, path = null } = {}) {
      const base = await baseFor(drive)
      if (!base) return null
      const page = await rules.historyPage(base.view, {
        before,
        limit,
        path: typeof path === 'string' && path.startsWith('/') ? path : null
      })
      let title = ''
      try {
        const buf = await withTimeout(manager.readFileOf(base, '/index.json'), 3000)
        const manifest = buf ? JSON.parse(b4a.toString(buf)) : null
        if (manifest && typeof manifest.title === 'string') title = manifest.title.trim()
      } catch {}
      return { title, writable: manager.canWrite(base), version: base.view.version, ...page }
    },

    // A file as it was at `version`: { exists, size, text }, text only for a text file that isn't too big.
    async fileAt (drive, path, version) {
      const base = await baseFor(drive)
      if (!base) throw new Error('This drive has no version history')
      const rec = await rules.recordAt(base.view, path, version)
      if (!rec) return { exists: false, size: 0, text: null }
      const size = manager.recordLength(rec)
      if (size > VIEW_MAX) return { exists: true, size, text: null }
      const buf = await withTimeout(manager.recordContent(rec), READ_TIMEOUT)
      if (buf == null) throw new Error('That version isn’t on this phone, and no device that has it is online')
      const bytes = b4a.from(buf)
      // Binary: a NUL byte in the first few KB.
      if (bytes.subarray(0, 8000).includes(0)) return { exists: true, size, text: null }
      return { exists: true, size, text: b4a.toString(bytes, 'utf8') }
    },

    async restoreFile (drive, path, version) {
      const base = await baseFor(drive, { write: true })
      if (!base) throw new Error('This drive has no version history')
      const op = await rules.restoreFile(base.view, appendTo(base), path, version)
      return { changed: !!op }
    },

    // What restoring the drive to `version` would change, without changing it.
    async restorePreview (drive, version) {
      const base = await baseFor(drive)
      if (!base) throw new Error('This drive has no version history')
      return rules.restoreSummary(await rules.restoreDiff(base.view, version))
    },

    async restoreDrive (drive, version) {
      const base = await baseFor(drive, { write: true })
      if (!base) throw new Error('This drive has no version history')
      return rules.restoreDrive(base.view, appendTo(base), version)
    }
  }
}

function withTimeout (p, ms) {
  let t
  return Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise((resolve) => { t = setTimeout(() => resolve(null), ms) })
  ]).finally(() => clearTimeout(t))
}
