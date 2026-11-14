// Search inside the user's drives on the phone: the drives My Library lists, read file by file into
// an index kept in memory, as desktop's nomad://search does (app/bg/hyper/drive-search.js). Which
// files count, their text and the ranking are shared/drive-search.mjs.
//
// The UI sends the drives to search ({ key, type, ns }), the ones it shows. A drive's index is
// rebuilt only where it changed: the drive's version, then each file's mtime and size. A file whose
// bytes can't be read in time (they're on a device that is away) is left out and tried on the next
// search. Unlike desktop, the phone searches Hyperdrives too, since that is what its New drive
// makes by default; a Hyperdrive file has no mtime of its own, so its entry's seq tells a change.

import b4a from 'b4a'
import { indexFiles, searchIndexes, queryWords } from '../../../shared/drive-search.mjs'
import { DRIVE_AUTOBASE, DRIVE_HYPERDRIVE } from '../../rpc-commands.mjs'

const FILE_TIMEOUT = 3000
const OPEN_TIMEOUT = 8000
const SEARCH_BUDGET = 12000
const PARALLEL = 3
const MAX_DRIVES = 60

const isKey = (k) => typeof k === 'string' && /^[0-9a-f]{64}$/i.test(k)

export function createDriveSearch (manager) {
  // `${type}:${key}` -> { key, version, title, docs, missing }
  const indexes = new Map()

  async function titleOf (reader, key) {
    try {
      const buf = await withTimeout(reader.read('/index.json'), 2000)
      const manifest = buf ? JSON.parse(b4a.toString(buf)) : null
      if (manifest && typeof manifest.title === 'string' && manifest.title.trim()) return manifest.title.trim()
    } catch {}
    return `${key.slice(0, 6)}…`
  }

  // Bring one drive's index up to date. Returns it, or undefined when the drive didn't open in time.
  async function indexDrive ({ key, type, ns }, deadline) {
    const driveType = type === DRIVE_HYPERDRIVE ? DRIVE_HYPERDRIVE : DRIVE_AUTOBASE
    const entry = await withTimeout(manager.open(driveType, b4a.from(key, 'hex'), () => {}, ns || null), Math.min(OPEN_TIMEOUT, Math.max(0, deadline - Date.now())))
    if (!entry || !entry.drive) return undefined
    const drive = entry.drive
    const ck = `${driveType}:${key}`
    let idx = indexes.get(ck)
    let version
    let files
    let read
    if (driveType === DRIVE_AUTOBASE) {
      try { await withTimeout(drive.update(), 2000) } catch {}
      const view = drive.view
      if (!view) return undefined
      version = view.version
      files = (async function * () {
        for await (const node of view.createReadStream()) {
          const rec = node.value
          if (!rec) continue
          yield {
            path: typeof node.key === 'string' ? node.key : b4a.toString(node.key),
            size: manager.recordLength(rec),
            mtime: Number(rec.metadata?.mtime) || 0,
            rec
          }
        }
      })()
      read = async (path, f) => toText(await withTimeout(manager.recordContent(f.rec), FILE_TIMEOUT))
    } else {
      version = drive.version
      files = (async function * () {
        for await (const node of drive.list('/', { recursive: true })) {
          const v = node.value || {}
          if (v.linkname) continue
          // A Hyperdrive keeps no mtime unless the writer put one in its metadata, so its entry's seq
          // tells a changed file.
          yield { path: node.key, size: v.blob?.byteLength || 0, mtime: Number(v.metadata?.mtime) || 0, stamp: node.seq }
        }
      })()
      read = async (path) => toText(await withTimeout(drive.get(path), FILE_TIMEOUT))
    }
    if (idx && idx.version === version && !idx.missing) return idx
    let docs
    let missing
    try {
      ({ docs, missing } = await indexFiles(files, { old: idx?.docs, read, deadline }))
    } catch {
      // A view still replicating can throw mid-stream: keep what was there and try again next time.
      return idx ? { ...idx, missing: true } : undefined
    }
    idx = { key, version, title: await titleOf(entry.reader, key), docs, missing }
    indexes.set(ck, idx)
    return idx
  }

  return {
    /**
     * Search `query` in `drives` ([{ key, type, ns }]):
     * { results: [{ driveKey, driveTitle, url, path, title, snippet, mtime }], searched, partial }.
     */
    async search (query, drives, { limit = 50 } = {}) {
      const words = queryWords(query)
      if (!words.length) return { results: [], searched: 0, partial: false }
      const seen = new Set()
      const list = (Array.isArray(drives) ? drives : [])
        .filter((d) => d && isKey(d.key) && !seen.has(d.key.toLowerCase()) && seen.add(d.key.toLowerCase()))
        .slice(0, MAX_DRIVES)
      const deadline = Date.now() + SEARCH_BUDGET
      const ready = []
      let searched = 0
      let partial = false
      let next = 0
      const worker = async () => {
        while (next < list.length) {
          const d = list[next++]
          const left = Math.max(0, deadline - Date.now())
          const idx = left ? await withTimeout(indexDrive({ ...d, key: d.key.toLowerCase() }, deadline), left + 500) : undefined
          if (!idx) {
            partial = true
            continue
          }
          searched++
          if (idx.missing) partial = true
          ready.push(idx)
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker))
      return { results: searchIndexes(ready, words, Math.min(Math.max(Number(limit) || 50, 1), 200)), searched, partial }
    }
  }
}

function toText (buf) {
  return buf == null ? null : b4a.toString(b4a.from(buf), 'utf8')
}

// Resolves null on timeout or error.
function withTimeout (p, ms) {
  let t
  return Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise((resolve) => { t = setTimeout(() => resolve(null), ms) })
  ]).finally(() => clearTimeout(t))
}
