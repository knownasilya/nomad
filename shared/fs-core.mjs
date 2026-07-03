// nomad/shared/fs-core.mjs
//
// The ONE canonical Autobase view-open (`open`) + reducer (`apply`) + wire-format helpers
// shared by BOTH runtimes: the desktop app (Electron/Node, rollup-bundled —
// app/bg/hyper/autobases.js) and the mobile backend (Bare, bare-pack-bundled —
// mobile/backend/lib/drive-manager.mjs).
//
// Why this file has NO bare imports (`import Hyperbee from 'hyperbee'` etc.):
//   The app and mobile keep SEPARATE node_modules and run on TWO engines. The repo root
//   (nomad/node_modules) does NOT contain the P2P deps. Node/Bare resolve a bare specifier
//   by walking up from THIS file's directory (nomad/shared/ -> nomad/node_modules), which
//   is empty — so a bare import here would fail to resolve for mobile (bare-pack) and for
//   any plain-Node test. Instead we use DEPENDENCY INJECTION: each app imports this module
//   by relative path and passes its own already-resolved constructors. That also makes the
//   version-parity contract explicit (see tests/unit/fs-core-parity.test.js).
//
// ─────────────────────────────────────────────────────────────────────────────
//  THE LOAD-BEARING INVARIANT — apply() MUST be a PURE, REPLAY-SAFE reducer.
//
//  Autobase RE-RUNS apply() on every reorg. For the linearized view to stay byte-identical
//  across peers — and to verify against the indexer's signature — apply() must be a
//  deterministic function of the op stream and NOTHING else:
//    • keyed view.put / view.del + host.addWriter / host.removeWriter ONLY
//    • NO side effects, NO opening cores, NO blob writes, NO I/O, no time/random
//  File BYTES are written to a per-writer Hyperblobs core OUTSIDE apply (see createBlobStore);
//  only a small pointer travels through the oplog. apply just records that pointer.
//
//  BYTE-DETERMINISM OF THE VIEW: apply stores the op's `metadata`/`blob` objects verbatim
//  into the signed Hyperbee view, so their JSON KEY ORDER is part of the wire format. Both
//  runtimes MUST build those objects through makeMetadata()/putBlob() (canonical key order)
//  or the serialized view diverges and replication fails with `DECODING_ERROR`.
// ─────────────────────────────────────────────────────────────────────────────
//
// WIRE FORMAT — FS_FORMAT_VERSION 1 (ADR-0010 Phase 1). The view is a Hyperbee of
// path -> RECORD (valueEncoding 'json'):
//
//   record = {
//     metadata: { mtime, ctime, executable? },        // real stat metadata (always present)
//     blob:  { core, blockOffset, blockLength, byteOffset, byteLength } | null,
//     value: <base64 string> | null
//   }
//
// Exactly one of blob / value is non-null for a file with content; both null = empty file.
//   • blob  — a Hyperblobs id (`{blockOffset,blockLength,byteOffset,byteLength}`) PLUS `core`,
//             the hex key of the OWNING WRITER's blobs core. Used for real file content, so the
//             bytes never enter the oplog. Resolve via createBlobStore().resolveBlob(store, blob).
//   • value — base64 of the raw bytes, stored INLINE in the view. Used for small control records
//             (index.json, /.vault/*, bookmarks, drives.json) and — necessarily — for the
//             writer-records apply() itself authors on addWriter (a pure reducer can't write a blob).
//
// Op shapes appended to the base:
//   { op:'put', path, metadata, blob?, value? }   // exactly one of blob/value (or neither = empty)
//   { op:'del', path }
//   { addWriter, profileUrl? }                     // apply writes the writer-record inline (value)
//   { removeWriter }
//
// This SUPERSEDES FS_FORMAT_VERSION 0 (raw-bytes binary view). Clean break — no migration
// (no production users). Bump the version and regenerate the golden vector on any change here.

// ─── Wire-format types (see the format block above) ─────────────────────────
// These describe the DATA shapes that travel through the oplog / linearized view.
// The injected P2P constructors (Hyperbee, Hyperblobs, b4a) stay loosely typed on
// purpose — the type value here is the record/op shape, not the vendored libs.

/**
 * Canonical file metadata. FIXED KEY ORDER — part of the wire format.
 * @typedef {object} FsMetadata
 * @property {number} mtime
 * @property {number} ctime
 * @property {boolean} [executable]  Only present when true (matches Hyperdrive).
 */

/**
 * A Hyperblobs id plus the hex key of the OWNING WRITER's blobs core.
 * @typedef {object} BlobPointer
 * @property {string} core  Hex key of the owning writer's blobs core.
 * @property {number} blockOffset
 * @property {number} blockLength
 * @property {number} byteOffset
 * @property {number} byteLength
 */

/**
 * A linearized-view record. Exactly one of blob/value is non-null for a file with
 * content; both null = empty file.
 * @typedef {object} FsRecord
 * @property {FsMetadata} metadata
 * @property {BlobPointer | null} blob
 * @property {string | null} value  base64 of inline bytes, or null.
 */

/** @typedef {{ start?: number, length?: number }} ContentRange */

/** @typedef {{ op: 'put', path: string, metadata: FsMetadata, blob?: BlobPointer | null, value?: string | null }} PutOp */
/** @typedef {{ op: 'del', path: string }} DelOp */
/** @typedef {{ addWriter: string, profileUrl?: string | null }} AddWriterOp */
/** @typedef {{ removeWriter: string }} RemoveWriterOp */
/** @typedef {PutOp | DelOp | AddWriterOp | RemoveWriterOp} FsOp */

// Options passed to `new Autobase(store, key, { open, apply, ...AUTOBASE_OPTS })`.
export const AUTOBASE_OPTS = { valueEncoding: 'json', ackInterval: 1000 }

// The named cores in a drive's namespace: the Hyperbee view, and this writer's blobs store.
export const VIEW_CORE_NAME = 'db'
export const BLOBS_CORE_NAME = 'blobs'

// Path prefix under which the reducer records one JSON file per writer on addWriter.
export const WRITERS_PREFIX = '/.data/walled.garden/writers/'

// Bump on ANY wire-format change (record shape, op shape, encoding). Phase 1 = 1.
export const FS_FORMAT_VERSION = 1

// Canonical file metadata. FIXED KEY ORDER — part of the wire format (see determinism note).
// `executable` is only included when true, matching Hyperdrive's optional metadata.
/**
 * @param {{ mtime?: number, ctime?: number, executable?: boolean }} [opts]
 * @returns {FsMetadata}
 */
export function makeMetadata ({ mtime = 0, ctime = 0, executable = false } = {}) {
  const m = { mtime, ctime }
  if (executable) m.executable = true
  return m
}

// Canonical view RECORD wrapper. FIXED KEY ORDER (metadata, blob, value).
/**
 * @param {{ metadata?: FsMetadata, blob?: BlobPointer | null, value?: string | null }} opts
 * @returns {FsRecord}
 */
export function makeRecord ({ metadata, blob = null, value = null }) {
  return { metadata: metadata || makeMetadata(), blob, value }
}

// Build the `{ open, apply }` pair bound to the caller's injected P2P constructors.
//   deps.Hyperbee — the app's resolved `hyperbee` default export
//   deps.b4a      — the app's resolved `b4a` module
export function createFsCore ({ Hyperbee, b4a }) {
  if (!Hyperbee) throw new Error('createFsCore: missing dep Hyperbee')
  if (!b4a) throw new Error('createFsCore: missing dep b4a')

  function open (store) {
    const core = store.get({ name: VIEW_CORE_NAME })
    return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  }

  // The pure, replay-safe reducer. See the invariant block at the top of this file.
  async function apply (nodes, view, host) {
    for (const { value } of nodes) {
      if (!value) continue

      if (value.addWriter) {
        await host.addWriter(b4a.from(value.addWriter, 'hex'), { indexer: true })
        // Writer-records are authored INSIDE apply, so they can't be blobs — store inline.
        // The JSON string's key order ({writerKey, profileUrl}) is fixed here for determinism.
        const record = JSON.stringify({ writerKey: value.addWriter, profileUrl: value.profileUrl || null })
        await view.put(`${WRITERS_PREFIX}${value.addWriter}.json`, makeRecord({
          metadata: makeMetadata(),
          value: b4a.toString(b4a.from(record), 'base64')
        }))
        continue
      }

      if (value.removeWriter) {
        try {
          await host.removeWriter(b4a.from(value.removeWriter, 'hex'))
          await view.del(`${WRITERS_PREFIX}${value.removeWriter}.json`)
        } catch {}
        continue
      }

      if (value.op === 'put') {
        // Store the op's metadata/blob/value verbatim (canonical order enforced by the
        // producer via makeMetadata()/putBlob()). apply performs NO blob I/O.
        await view.put(value.path, makeRecord({
          metadata: value.metadata,
          blob: value.blob || null,
          value: value.value != null ? value.value : null
        }))
      } else if (value.op === 'del') {
        await view.del(value.path)
      }
      // 'mkdir' is a no-op (keys are paths, directories are implicit)
    }
  }

  return { open, apply }
}

// --- Blob store: file bytes live OUTSIDE the oplog, in a per-writer Hyperblobs core -------
// Injected with Hyperblobs + b4a. putBlob is the WRITER side (write my bytes, return a
// pointer); resolveBlob is the READER side (fetch the owning writer's core through the shared
// corestore and read the bytes). Neither is ever called from inside apply().
export function createBlobStore ({ Hyperblobs, b4a }) {
  if (!Hyperblobs) throw new Error('createBlobStore: missing dep Hyperblobs')
  if (!b4a) throw new Error('createBlobStore: missing dep b4a')

  // Write bytes into a Hyperblobs core (this writer's own). `blobs` may be a Hyperblobs
  // instance or a raw hypercore. Returns the canonical wire pointer (FIXED KEY ORDER).
  async function putBlob (blobs, bytes) {
    const store = blobs instanceof Hyperblobs ? blobs : new Hyperblobs(blobs)
    const buf = b4a.isBuffer(bytes) ? bytes : b4a.from(bytes)
    const id = await store.put(buf)
    return {
      core: b4a.toString(store.core.key, 'hex'),
      blockOffset: id.blockOffset,
      blockLength: id.blockLength,
      byteOffset: id.byteOffset,
      byteLength: id.byteLength
    }
  }

  // Resolve a blob pointer to bytes through a corestore (opens the owning writer's core by
  // key; it replicates over the shared swarm). `range` is an optional { start, length }.
  async function resolveBlob (store, pointer, range) {
    const core = store.get({ key: b4a.from(pointer.core, 'hex') })
    await core.ready()
    const blobs = new Hyperblobs(core)
    const id = {
      blockOffset: pointer.blockOffset,
      blockLength: pointer.blockLength,
      byteOffset: pointer.byteOffset,
      byteLength: pointer.byteLength
    }
    return range ? blobs.get(id, range) : blobs.get(id)
  }

  return { putBlob, resolveBlob }
}

// --- Reading a record's content (inline value OR blob), backend-agnostic -----------------
// Injected with b4a (always) and Hyperblobs (only needed if blob records must be resolved).
// `opts.store` is the corestore used to resolve blob pointers. `opts.range` = {start,length}.
export function createContentReader ({ b4a, Hyperblobs }) {
  const blobStore = Hyperblobs ? createBlobStore({ Hyperblobs, b4a }) : null

  /**
   * @param {FsRecord | null} record
   * @param {{ store?: any, range?: ContentRange }} [opts]
   * @returns {Promise<any>}  Buffer-like content (b4a/Hyperblobs return type).
   */
  async function readContent (record, opts = {}) {
    if (!record) return null
    const { store, range } = opts
    if (record.value != null) {
      const buf = b4a.from(record.value, 'base64')
      if (!range) return buf
      const start = range.start || 0
      const end = range.length != null ? start + range.length : buf.length
      return buf.subarray(start, end)
    }
    if (record.blob) {
      if (!blobStore) throw new Error('readContent: blob record needs Hyperblobs injected')
      if (!store) throw new Error('readContent: blob record needs opts.store')
      return blobStore.resolveBlob(store, record.blob, range)
    }
    return b4a.alloc(0) // both null = empty file
  }

  // The on-disk byte length of a record's content without fetching blob bytes.
  /**
   * @param {FsRecord | null} record
   * @param {any} [b]  Optional b4a override.
   * @returns {number}
   */
  function contentLength (record, b) {
    const bb = b || b4a
    if (!record) return 0
    if (record.blob) return record.blob.byteLength || 0
    if (record.value != null) return bb.byteLength(bb.from(record.value, 'base64'))
    return 0
  }

  return { readContent, contentLength }
}

// Decode an inline writer-record (value = base64 JSON) back to its object. Convenience for
// listWriters()-style readers.
/**
 * @param {FsRecord | null} record
 * @param {any} b4a
 * @returns {any | null}
 */
export function decodeInlineJson (record, b4a) {
  if (!record || record.value == null) return null
  try { return JSON.parse(b4a.toString(b4a.from(record.value, 'base64'))) } catch { return null }
}

// True when the view has at least one key under `dirPath/` — i.e. the path is a DIRECTORY. The
// linearized view is a flat Hyperbee of file keys with no directory entries, so directory-ness is
// "has any child key". The serve path uses this to decide whether a path with no file/index should
// render the builtin file view (directory) or 404 (genuinely missing). `bee` is any Hyperbee-like
// view exposing createReadStream({ gte, lt, limit }).
/**
 * @param {any} bee  Any Hyperbee-like view exposing createReadStream({ gte, lt, limit }).
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
export async function viewDirHasChildren (bee, dirPath) {
  const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/'
  try {
    for await (const _ of bee.createReadStream({ gte: prefix, lt: prefix + '\xff', limit: 1 })) {
      return true
    }
  } catch { /* treat read errors as "no children" */ }
  return false
}
