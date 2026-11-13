// Plays an Asset's video or recording while it arrives, instead of after the whole file is in the
// app's cache. The viewer's <video> or <audio> asks a loopback server for the file
// (http://127.0.0.1:<port>/a/<token>) with HTTP Range requests, as it does any web video: the first
// bytes play at once, a seek asks for that part only, and a piece still on another Device comes
// over the swarm when it's asked for (Hyperblobs reads only the blocks a range needs).
//
// The server binds 127.0.0.1, and each file is behind a random token the app gets for it
// (`add`) and gives back when the viewer closes (`end`). A token lasts TOKEN_TTL_MS at most and
// only MAX_TOKENS are kept, so a token left behind stops working by itself.
//
// `http` is bare-http1 on the phone (node:http in the tests); `randomToken` gives a hex string.

export const PIECE_BYTES = 512 * 1024 // read and sent a piece at a time, so a seek or a close stops it soon
export const TOKEN_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_TOKENS = 8

// A Range header for a file of `size` bytes -> { start, end } (end inclusive), null for none (or one
// this doesn't serve, such as several ranges: the whole file goes then), or 'unsatisfiable'.
export function parseRange (header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  let start, end
  if (a === '') {
    // The last `b` bytes.
    const n = Number(b)
    if (!(n > 0)) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!(start >= 0) || start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

export function createAssetStreams ({ http, randomToken, now = () => Date.now(), host = '127.0.0.1' }) {
  const files = new Map() // token -> { size, mime, read(start, length), at }
  let server = null
  let port = 0
  let starting = null

  function prune () {
    for (const [token, f] of files) if (now() - f.at > TOKEN_TTL_MS) files.delete(token)
    while (files.size > MAX_TOKENS) files.delete(files.keys().next().value)
  }

  async function listen () {
    if (server) return
    if (!starting) {
      starting = new Promise((resolve, reject) => {
        const s = http.createServer((req, res) => {
          handle(req, res).catch(() => {
            try { if (!res.headersSent) res.statusCode = 500; res.end() } catch {}
          })
        })
        s.on('error', reject)
        s.listen(0, host, () => {
          server = s
          port = s.address().port
          resolve()
        })
      }).finally(() => { starting = null })
    }
    await starting
  }

  // Wait until `res` takes `buf` (or is gone). -> false once the player has hung up.
  function send (res, buf) {
    return new Promise((resolve) => {
      if (res.destroyed) return resolve(false)
      const done = (ok) => { res.off?.('drain', onDrain); res.off?.('close', onClose); resolve(ok) }
      const onDrain = () => done(true)
      const onClose = () => done(false)
      if (res.write(buf)) return resolve(!res.destroyed)
      res.on('drain', onDrain)
      res.on('close', onClose)
    })
  }

  async function handle (req, res) {
    const token = /^\/a\/([0-9a-f]{16,128})$/.exec(String(req.url || '').split('?')[0])?.[1]
    const f = token && files.get(token)
    if (!f || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.statusCode = f ? 405 : 404
      res.setHeader('Content-Length', '0')
      res.end()
      return
    }
    const range = parseRange(req.headers?.range, f.size)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', f.mime || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    if (range === 'unsatisfiable') {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${f.size}`)
      res.setHeader('Content-Length', '0')
      res.end()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end : f.size - 1
    res.statusCode = range ? 206 : 200
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${f.size}`)
    res.setHeader('Content-Length', String(Math.max(0, end - start + 1)))
    if (req.method === 'HEAD' || f.size === 0) { res.end(); return }
    for (let at = start; at <= end;) {
      const buf = await f.read(at, Math.min(PIECE_BYTES, end - at + 1))
      // A piece that isn't anywhere (the file was removed, or no Device has it): stop here, and the
      // player says it can't go on.
      if (!buf || !buf.length) { res.destroy(); return }
      if (!(await send(res, buf))) return
      at += buf.length
    }
    res.end()
  }

  return {
    // A file to stream: { size, mime, read(start, length) -> bytes or null }. -> its URL and token.
    async add (file) {
      await listen()
      const token = randomToken()
      files.set(token, { ...file, at: now() })
      prune()
      return { token, url: `http://${host}:${port}/a/${token}` }
    },
    end (token) {
      files.delete(token)
    },
    get size () { return files.size },
    close () {
      files.clear()
      try { server?.close() } catch {}
      server = null
    }
  }
}
