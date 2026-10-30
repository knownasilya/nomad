// Proving a peer is a current Writer of a Drive over one connection (ADR-0025 §5), against real
// Autobases replicating over a corestore stream pair, on the shared fs-core reducer.
//
// Deps load from app/node_modules (the repo root has none — see fs-core.mjs header).

import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { createFsCore, AUTOBASE_OPTS } from '../../shared/fs-core.mjs'
import {
  makeWriterProof,
  decodeWriterProof,
  verifyWriterProof,
} from '../../app/bg/hyper/writer-proof.js'

let Autobase, Hyperbee, Corestore, b4a, crypto
let open, apply

async function loadAppDep (name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

beforeAll(async () => {
  ;[Autobase, Hyperbee, Corestore, b4a, crypto] = await Promise.all(
    ['autobase', 'hyperbee', 'corestore', 'b4a', 'hypercore-crypto'].map(loadAppDep)
  )
  ;({ open, apply } = createFsCore({ Hyperbee, b4a }))
})

const hex = (b) => b4a.toString(b, 'hex')

async function until (fn, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timed out')
}

async function withDrive (fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-proof-'))
  const sa = new Corestore(path.join(dir, 'a'))
  const sb = new Corestore(path.join(dir, 'b'))
  const sc = new Corestore(path.join(dir, 'c'))
  const A = new Autobase(sa.namespace('a'), null, { ...AUTOBASE_OPTS, open, apply })
  await A.ready()
  const B = new Autobase(sb, A.key, { ...AUTOBASE_OPTS, open, apply })
  const C = new Autobase(sc, A.key, { ...AUTOBASE_OPTS, open, apply })
  await Promise.all([B.ready(), C.ready()])
  const s1 = sa.replicate(true)
  const s2 = sb.replicate(false)
  s1.pipe(s2).pipe(s1)
  const s3 = sa.replicate(true)
  const s4 = sc.replicate(false)
  s3.pipe(s4).pipe(s3)
  await A.append({ addWriter: hex(B.local.key) })
  await A.update()
  await until(async () => (await B.update(), B.writable))
  try {
    await fn({ A, B, C, sa, conn: { a: s1.noiseStream, b: s2.noiseStream } })
  } finally {
    for (const s of [s1, s2, s3, s4]) s.destroy()
    await Promise.all([A.close(), B.close(), C.close()])
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const roomId = () => crypto.randomBytes(32)

describe('writer proof', () => {
  it('proves a Writer added by addWriter, bound to this connection and room', async () => {
    await withDrive(async ({ A, B, sa, conn }) => {
      const room = roomId()
      const proof = makeWriterProof(B, room, conn.b.handshakeHash)
      expect(proof.writerKey).toBe(hex(B.local.key))
      const frame = decodeWriterProof(b4a.from(JSON.stringify(proof)))
      const ok = await verifyWriterProof({ base: A, store: sa, roomId: room, handshakeHash: conn.a.handshakeHash, proof: frame })
      expect(ok).toBe(hex(B.local.key))
      // Replayed onto another connection or room, it fails.
      expect(await verifyWriterProof({ base: A, store: sa, roomId: room, handshakeHash: crypto.randomBytes(32), proof: frame })).toBeNull()
      expect(await verifyWriterProof({ base: A, store: sa, roomId: roomId(), handshakeHash: conn.a.handshakeHash, proof: frame })).toBeNull()
    })
  })

  it('proves the Drive creator, whose key is the bootstrap', async () => {
    await withDrive(async ({ A, B, conn }) => {
      const room = roomId()
      const proof = makeWriterProof(A, room, conn.a.handshakeHash)
      const ok = await verifyWriterProof({ base: B, store: B.store, roomId: room, handshakeHash: conn.b.handshakeHash, proof })
      expect(ok).toBe(hex(A.local.key))
    })
  })

  it('a reader has no proof to give', async () => {
    await withDrive(async ({ C, conn }) => {
      expect(makeWriterProof(C, roomId(), conn.a.handshakeHash)).toBeNull()
    })
  })

  it('a removed Writer fails', async () => {
    await withDrive(async ({ A, B, sa, conn }) => {
      const room = roomId()
      const proof = makeWriterProof(B, room, conn.b.handshakeHash)
      await A.append({ removeWriter: hex(B.local.key) })
      await A.update()
      expect(await verifyWriterProof({ base: A, store: sa, roomId: room, handshakeHash: conn.a.handshakeHash, proof })).toBeNull()
    })
  })

  it('drops malformed frames', () => {
    expect(decodeWriterProof(b4a.from('nope'))).toBeNull()
    expect(decodeWriterProof(b4a.from(JSON.stringify({ writerKey: 'x', signature: 'y' })))).toBeNull()
  })
})
