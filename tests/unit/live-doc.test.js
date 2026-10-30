// The Live Doc provider in the Document drive template (ADR-0025): merging update files in any
// order, when edits are saved, and compaction (a snapshot first, then the deletes of exactly the
// files it read), against an in-memory stand-in for a nomad.fs drive handle.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as Y from 'yjs'
import {
  treeMerge,
  flushDelay,
  updatePath,
  snapshotPath,
  isUpdateFile,
  isSnapshotFile,
  openLiveDoc,
  b64,
  FLUSH_IDLE_MS,
  FLUSH_MAX_MS,
  COMPACT_AT,
} from '../../app/drive-templates/document/src/live-doc.js'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

beforeAll(() => {
  // openLiveDoc listens for the page being hidden; node has no page.
  globalThis.document = { visibilityState: 'visible', addEventListener () {}, removeEventListener () {} }
  globalThis.window = { addEventListener () {}, removeEventListener () {} }
})
afterAll(() => {
  delete globalThis.document
  delete globalThis.window
})

// Two people typing at once, each applying the other's edits as they go (the live room), one
// update per "second" each, like the spike.
function typeTogether (n) {
  const a = new Y.Doc(); const b = new Y.Doc()
  const ups = { a: [], b: [] }
  a.on('update', (u, o) => { if (o !== 'peer') { ups.a.push(u); Y.applyUpdate(b, u, 'peer') } })
  b.on('update', (u, o) => { if (o !== 'peer') { ups.b.push(u); Y.applyUpdate(a, u, 'peer') } })
  for (let i = 0; i < n; i++) {
    a.getText('text').insert(a.getText('text').length, 'a')
    b.getText('text').insert(0, 'b')
  }
  return { text: a.getText('text').toString(), ups }
}

function memoryDrive (files = new Map()) {
  const writes = []
  const deletes = []
  return {
    files,
    writes,
    deletes,
    async list (prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })) },
    async readFile (key) { if (!files.has(key)) throw new Error('not found'); return files.get(key) },
    async writeFile (key, data, opts = {}) {
      writes.push({ key, opts })
      files.set(key, opts.encoding === 'base64' ? data : Buffer.from(data).toString('base64'))
    },
    async unlink (key) { deletes.push(key); files.delete(key) },
    watch () { return { close () {} } },
  }
}

describe('treeMerge', () => {
  it('gives the same document whatever order the files come in', () => {
    const { text, ups } = typeTogether(300)
    for (const order of [[...ups.a, ...ups.b], [...ups.b, ...ups.a], [...ups.a, ...ups.b].reverse()]) {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, treeMerge(order))
      expect(doc.getText('text').toString()).toBe(text)
    }
  })
  it('is null for no files', () => {
    expect(treeMerge([])).toBeNull()
  })
})

describe('when edits are saved', () => {
  it('waits for a pause in typing', () => {
    expect(flushDelay({ firstUnsavedAt: 0, lastEditAt: 0, now: 500 })).toBe(FLUSH_IDLE_MS - 500)
  })
  it('saves at least every FLUSH_MAX_MS while typing goes on', () => {
    expect(flushDelay({ firstUnsavedAt: 0, lastEditAt: FLUSH_MAX_MS - 100, now: FLUSH_MAX_MS - 100 })).toBe(100)
  })
  it('never waits a negative time', () => {
    expect(flushDelay({ firstUnsavedAt: 0, lastEditAt: 0, now: FLUSH_MAX_MS * 2 })).toBe(0)
  })
})

describe('file names', () => {
  it('puts each Writer under its own key', () => {
    expect(updatePath('/doc', KEY_A, 5)).toMatch(new RegExp(`^/doc/updates/${KEY_A}/5-[a-z0-9]+\\.yupdate$`))
    expect(isUpdateFile(updatePath('/doc', KEY_A))).toBe(true)
    expect(isSnapshotFile(snapshotPath('/doc', KEY_B))).toBe(true)
    expect(isUpdateFile('/doc/content.md')).toBe(false)
    expect(isUpdateFile(`/doc/updates/not-a-key/1.yupdate`)).toBe(false)
  })
})

describe('openLiveDoc', () => {
  function seed (drive, ups, key) {
    ups.forEach((u, i) => drive.files.set(`/doc/updates/${key}/${String(i).padStart(6, '0')}.yupdate`, b64.encode(u)))
  }

  it('loads the document from the files', async () => {
    const { text, ups } = typeTogether(20)
    const drive = memoryDrive()
    seed(drive, ups.a, KEY_A)
    seed(drive, ups.b, KEY_B)
    const live = openLiveDoc({ drive, path: '/doc', writerKey: null, writable: false, sockets: null, user: { name: 'x' } })
    await live.whenLoaded
    expect(live.ytext.toString()).toBe(text)
    await live.destroy()
  })

  it('saves its own edits as one inline file under its key, and not what it loaded', async () => {
    vi.useFakeTimers()
    try {
      const { ups } = typeTogether(5)
      const drive = memoryDrive()
      seed(drive, ups.b, KEY_B)
      const live = openLiveDoc({ drive, path: '/doc', writerKey: KEY_A, writable: true, sockets: null, user: { name: 'x' } })
      await live.whenLoaded
      expect(drive.writes).toHaveLength(0)
      live.ytext.insert(0, 'hello ')
      live.ytext.insert(6, 'world')
      await vi.advanceTimersByTimeAsync(FLUSH_IDLE_MS + 10)
      const saved = drive.writes.filter((w) => isUpdateFile(w.key))
      expect(saved).toHaveLength(1)
      expect(saved[0].key.startsWith(`/doc/updates/${KEY_A}/`)).toBe(true)
      expect(saved[0].opts).toMatchObject({ encoding: 'base64', inline: true, draft: false })
      await live.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('compacts past COMPACT_AT files: snapshot first, then deletes only what it read', async () => {
    const { text, ups } = typeTogether(Math.ceil(COMPACT_AT / 2) + 10)
    const drive = memoryDrive()
    seed(drive, ups.a, KEY_A)
    seed(drive, ups.b, KEY_B)
    const before = [...drive.files.keys()]
    const live = openLiveDoc({ drive, path: '/doc', writerKey: KEY_A, writable: true, sockets: null, user: { name: 'x' } })
    await live.whenLoaded
    await vi.waitFor(() => expect(drive.deletes.length).toBe(before.length))
    const snapIdx = drive.writes.findIndex((w) => isSnapshotFile(w.key))
    expect(snapIdx).toBeGreaterThanOrEqual(0)
    expect(drive.writes[snapIdx].opts.inline).toBeFalsy() // snapshots are blobs
    expect(new Set(drive.deletes)).toEqual(new Set(before))
    const left = [...drive.files.keys()]
    expect(left).toHaveLength(1)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, b64.decode(drive.files.get(left[0])))
    expect(doc.getText('text').toString()).toBe(text)
    await live.destroy()
  })

  it('a reader never compacts', async () => {
    const { ups } = typeTogether(COMPACT_AT)
    const drive = memoryDrive()
    seed(drive, ups.a, KEY_A)
    const live = openLiveDoc({ drive, path: '/doc', writerKey: null, writable: false, sockets: null, user: { name: 'x' } })
    await live.whenLoaded
    await new Promise((r) => setTimeout(r, 20))
    expect(drive.writes).toHaveLength(0)
    expect(drive.deletes).toHaveLength(0)
    await live.destroy()
  })
})
