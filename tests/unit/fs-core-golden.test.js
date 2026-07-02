// Golden-vector + reducer + blob test for the shared Autobase fs-core (ADR-0010 Phase 1).
//
// The parity safety net that protects replication from silent wire-format drift. It exercises
// the REAL shared module (nomad/shared/fs-core.mjs) against the app's own resolved P2P deps:
//   1. The linearized Hyperbee view, built from a fixed op sequence of v1 RECORDS
//      ({metadata, blob, value}), serializes to a stored golden sha256. Any change to
//      open()/apply()/makeRecord()/makeMetadata() that alters on-view bytes breaks this.
//      Regenerate the golden ONLY when FS_FORMAT_VERSION is intentionally bumped.
//   2. apply() is a faithful, deterministic reducer for addWriter / removeWriter / put / del,
//      checked against a fake view+host.
//   3. The blob store round-trips: putBlob (writer side) -> resolveBlob / readContent (reader
//      side), including a ranged read, over a real Autobase + Hyperblobs core.
//
// Deps load from app/node_modules (the repo root has none — see fs-core.mjs header).

import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import {
  createFsCore, createBlobStore, createContentReader,
  makeMetadata, makeRecord, decodeInlineJson,
  AUTOBASE_OPTS, BLOBS_CORE_NAME, WRITERS_PREFIX, FS_FORMAT_VERSION
} from '../../shared/fs-core.mjs'

// Committed golden: sha256 of the serialized linearized view for FIXED_OPS below.
// Tied to FS_FORMAT_VERSION 1 (hybrid {metadata, blob, value} record).
const GOLDEN_SHA256 = '923e04f7364431fb929221c47ef76d9a406e78f92126cec84dd3dab8a54e4d2e'

const b64 = (s) => Buffer.from(s).toString('base64')

// Fixed op sequence covering the value-bearing branches. NO blob records here: a blob pointer
// embeds a random per-run core key, which would make the hash non-deterministic — blobs are
// covered functionally by the round-trip test below instead. NO addWriter here either (its key
// would need a real core); the addWriter branch is covered by the reducer test.
const FIXED_OPS = [
  { op: 'put', path: '/index.json', metadata: makeMetadata({ mtime: 1, ctime: 1 }), value: b64('{"title":"golden","v":1}') },
  { op: 'put', path: '/nested/a.txt', metadata: makeMetadata({ mtime: 2, ctime: 2 }), value: b64('hello world') },
  { op: 'put', path: '/empty.txt', metadata: makeMetadata({ mtime: 3, ctime: 3 }) },                       // empty: blob+value null
  { op: 'put', path: '/exec.sh', metadata: makeMetadata({ mtime: 4, ctime: 4, executable: true }), value: b64('#!/bin/sh') },
  { op: 'put', path: '/tmp.txt', metadata: makeMetadata({ mtime: 5, ctime: 5 }), value: b64('delete me') },
  { op: 'del', path: '/tmp.txt' },
]

let Autobase, Hyperbee, Corestore, Hyperblobs, b4a
let open, apply

async function loadAppDep (name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

beforeAll(async () => {
  ;[Autobase, Hyperbee, Corestore, Hyperblobs, b4a] = await Promise.all(
    ['autobase', 'hyperbee', 'corestore', 'hyperblobs', 'b4a'].map(loadAppDep)
  )
  ;({ open, apply } = createFsCore({ Hyperbee, b4a }))
})

// Deterministic serialization: sorted `path=json(record)` lines. Records are JSON objects with
// canonical key order (metadata, blob, value), so this is stable across runs and runtimes.
async function serializeView (view) {
  const lines = []
  for await (const e of view.createReadStream()) lines.push(`${e.key}=${JSON.stringify(e.value)}`)
  return lines.sort().join('\n')
}

async function withDrive (fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-core-'))
  const store = new Corestore(dir)
  await store.ready()
  const ns = store.namespace('golden')
  const base = new Autobase(ns, null, { open, apply, ...AUTOBASE_OPTS })
  await base.ready()
  try {
    return await fn({ store, ns, base })
  } finally {
    await base.close()
    await store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('shared fs-core golden vector (v1)', () => {
  it('linearized view matches the committed golden sha256', async () => {
    const serialized = await withDrive(async ({ base }) => {
      for (const op of FIXED_OPS) await base.append(op)
      await base.update()
      return serializeView(base.view)
    })
    const hash = crypto.createHash('sha256').update(serialized).digest('hex')
    if (GOLDEN_SHA256 === '__PLACEHOLDER__') {
      console.log('\n[fs-core golden] FS_FORMAT_VERSION', FS_FORMAT_VERSION)
      console.log('[fs-core golden] serialized view:\n' + serialized)
      console.log('[fs-core golden] sha256 =', hash)
    }
    expect(hash).toBe(GOLDEN_SHA256)
  })
})

describe('shared fs-core blob store round-trip', () => {
  it('putBlob (writer) -> readContent (reader) round-trips, incl. ranged read', async () => {
    await withDrive(async ({ store, ns, base }) => {
      const { putBlob } = createBlobStore({ Hyperblobs, b4a })
      const { readContent, contentLength } = createContentReader({ Hyperblobs, b4a })

      const blobsCore = ns.get({ name: BLOBS_CORE_NAME })
      await blobsCore.ready()

      const bytes = b4a.alloc(150000)
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 255
      const ptr = await putBlob(blobsCore, bytes)

      // pointer carries the owning core key + a hyperblobs id, NO inline bytes
      expect(typeof ptr.core).toBe('string')
      expect(ptr.byteLength).toBe(bytes.length)

      await base.append({ op: 'put', path: '/big.bin', metadata: makeMetadata({ mtime: 1, ctime: 1 }), blob: ptr })
      await base.update()

      const rec = (await base.view.get('/big.bin')).value
      expect(rec.value).toBe(null)
      expect(rec.blob.core).toBe(ptr.core)
      expect(contentLength(rec)).toBe(bytes.length)

      const full = await readContent(rec, { store })
      expect(b4a.compare(full, bytes)).toBe(0)

      const range = await readContent(rec, { store, range: { start: 1000, length: 256 } })
      expect(b4a.compare(range, bytes.subarray(1000, 1256))).toBe(0)
    })
  })

  it('readContent returns empty buffer for an empty record', async () => {
    const { readContent } = createContentReader({ Hyperblobs, b4a })
    const empty = await readContent(makeRecord({ metadata: makeMetadata() }), {})
    expect(b4a.byteLength(empty)).toBe(0)
  })
})

describe('shared fs-core apply() reducer branches (v1)', () => {
  function fakes () {
    const puts = []; const dels = []; const added = []; const removed = []
    const view = {
      async put (k, v) { puts.push([k, v]) },
      async del (k) { dels.push(k) },
    }
    const host = {
      async addWriter (key, opts) { added.push([b4a.toString(key, 'hex'), opts]) },
      async removeWriter (key) { removed.push(b4a.toString(key, 'hex')) },
    }
    return { view, host, puts, dels, added, removed }
  }
  const WKEY = 'aa'.repeat(32)

  it('put records {metadata, blob, value} verbatim with canonical shape', async () => {
    const { view, host, puts } = fakes()
    const blob = { core: 'bb'.repeat(32), blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 3 }
    await apply([
      { value: { op: 'put', path: '/a', metadata: makeMetadata({ mtime: 7, ctime: 3 }), value: 'aGk=' } },
      { value: { op: 'put', path: '/b', metadata: makeMetadata({ mtime: 1, ctime: 1 }), blob } },
      { value: { op: 'put', path: '/empty', metadata: makeMetadata() } },
    ], view, host)
    expect(puts[0]).toEqual(['/a', { metadata: { mtime: 7, ctime: 3 }, blob: null, value: 'aGk=' }])
    expect(puts[1]).toEqual(['/b', { metadata: { mtime: 1, ctime: 1 }, blob, value: null }])
    expect(puts[2]).toEqual(['/empty', { metadata: { mtime: 0, ctime: 0 }, blob: null, value: null }])
  })

  it('addWriter: indexer add + inline writer-record (value = base64 JSON) at writers path', async () => {
    const { view, host, puts, added } = fakes()
    await apply([{ value: { addWriter: WKEY, profileUrl: 'hyper://xyz/' } }], view, host)
    expect(added).toEqual([[WKEY, { indexer: true }]])
    const [key, rec] = puts[0]
    expect(key).toBe(`${WRITERS_PREFIX}${WKEY}.json`)
    expect(rec.blob).toBe(null)
    expect(decodeInlineJson(rec, b4a)).toEqual({ writerKey: WKEY, profileUrl: 'hyper://xyz/' })
  })

  it('addWriter: profileUrl defaults to null when absent', async () => {
    const { view, host, puts } = fakes()
    await apply([{ value: { addWriter: WKEY } }], view, host)
    expect(decodeInlineJson(puts[0][1], b4a)).toEqual({ writerKey: WKEY, profileUrl: null })
  })

  it('removeWriter: host.removeWriter + deletes the writers file', async () => {
    const { view, host, dels, removed } = fakes()
    await apply([{ value: { removeWriter: WKEY } }], view, host)
    expect(removed).toEqual([WKEY])
    expect(dels).toEqual([`${WRITERS_PREFIX}${WKEY}.json`])
  })

  it('del removes; null/empty nodes are skipped (replay-safe)', async () => {
    const { view, host, dels, puts } = fakes()
    await apply([{ value: { op: 'del', path: '/gone' } }, { value: null }, { value: undefined }, {}], view, host)
    expect(dels).toEqual(['/gone'])
    expect(puts).toEqual([])
  })
})
