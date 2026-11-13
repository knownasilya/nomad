// The phone's loopback stream for videos and recordings in Assets (mobile/backend/lib/asset-stream.mjs):
// Range requests answered from the blob store a piece at a time, behind a token per file.
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import crypto from 'node:crypto'
import { createAssetStreams, parseRange, PIECE_BYTES, MAX_TOKENS, TOKEN_TTL_MS } from '../../mobile/backend/lib/asset-stream.mjs'

describe('parseRange', () => {
  it('reads one byte range, an open end, and a suffix', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('serves the whole file for none, or for several ranges', () => {
    expect(parseRange(undefined, 1000)).toBe(null)
    expect(parseRange('bytes=0-1,5-6', 1000)).toBe(null)
    expect(parseRange('items=0-1', 1000)).toBe(null)
  })

  it('refuses a range past the end', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=5-2', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
  })
})

describe('createAssetStreams', () => {
  let streams
  afterEach(() => streams?.close())

  const bytes = Buffer.from(Array.from({ length: PIECE_BYTES * 2 + 1000 }, (_, i) => i % 251))
  const file = (reads = []) => ({
    size: bytes.length,
    mime: 'video/mp4',
    read: async (start, length) => { reads.push([start, length]); return bytes.subarray(start, start + length) }
  })
  const make = (opts = {}) => (streams = createAssetStreams({ http, randomToken: () => crypto.randomBytes(24).toString('hex'), ...opts }))

  it('serves a range with 206, Content-Range and only the pieces it needs', async () => {
    make()
    const reads = []
    const { url } = await streams.add(file(reads))
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/[0-9a-f]{48}$/)
    const res = await fetch(url, { headers: { range: `bytes=${PIECE_BYTES + 10}-${PIECE_BYTES + 19}` } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${PIECE_BYTES + 10}-${PIECE_BYTES + 19}/${bytes.length}`)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(PIECE_BYTES + 10, PIECE_BYTES + 20))
    expect(reads).toEqual([[PIECE_BYTES + 10, 10]])
  })

  it('serves the whole file without a range, a piece at a time', async () => {
    make()
    const reads = []
    const { url } = await streams.add(file(reads))
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length)
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
    expect(reads.map(([, n]) => n)).toEqual([PIECE_BYTES, PIECE_BYTES, 1000])
  })

  it('answers 416 for a range past the end, and HEAD without reading', async () => {
    make()
    const reads = []
    const { url } = await streams.add(file(reads))
    const bad = await fetch(url, { headers: { range: `bytes=${bytes.length}-` } })
    expect(bad.status).toBe(416)
    expect(bad.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(Number(head.headers.get('content-length'))).toBe(bytes.length)
    expect(reads).toEqual([])
  })

  it('stops reading once the player hangs up', async () => {
    make()
    const reads = []
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const slow = { ...file(reads), read: async (start, length) => { reads.push([start, length]); if (reads.length > 1) await gate; return bytes.subarray(start, start + length) } }
    const { url } = await streams.add(slow)
    const ctl = new AbortController()
    const res = await fetch(url, { signal: ctl.signal })
    const reader = res.body.getReader()
    await reader.read()
    ctl.abort()
    release()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(reads.length).toBeLessThanOrEqual(2)
  })

  it('cuts the connection when a piece isn’t anywhere', async () => {
    make()
    const { url } = await streams.add({ ...file(), read: async (start, length) => (start === 0 ? bytes.subarray(0, length) : null) })
    const res = await fetch(url)
    await expect(res.arrayBuffer()).rejects.toThrow()
  })

  it('knows a file only by its token, until it ends, expires or too many come after it', async () => {
    let t = 0
    make({ now: () => t })
    const { url, token } = await streams.add(file())
    expect((await fetch(url.replace(token, '0'.repeat(48)))).status).toBe(404)
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
    streams.end(token)
    expect((await fetch(url)).status).toBe(404)

    const old = await streams.add(file())
    t = TOKEN_TTL_MS + 1
    await streams.add(file())
    expect((await fetch(old.url, { method: 'HEAD' })).status).toBe(404)

    const first = await streams.add(file())
    for (let i = 0; i < MAX_TOKENS; i++) await streams.add(file())
    expect((await fetch(first.url, { method: 'HEAD' })).status).toBe(404)
    expect(streams.size).toBe(MAX_TOKENS)
  })
})
