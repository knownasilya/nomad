import http from 'bare-http1'
import b4a from 'b4a'
import mime from 'mime'
import { isDocumentNavigation } from '../../../shared/frontend-routing.mjs'

// Loopback HTTP gateway — the mobile stand-in for desktop's native hyper:// protocol handler.
//
// The WebView can't speak hyper:// (and Blink parses unregistered schemes as opaque, so a
// hyper:// baseUrl never yields a truthful `location`). Instead we serve each drive from its own
// 127.0.0.1 port and point the WebView at `http://127.0.0.1:<port>/<route>`:
//   - location.pathname is the REAL drive route — SPA frontends route exactly like desktop
//   - links / back-forward / sub-resource fetches (/.ui/app.js, images, post.json) are native
//     browser behavior, served per-request by drive-manager.resolve() — no more inlining every
//     asset as a data: URI (which produced giant documents that OOM-killed Android renderers)
//   - one port per drive keeps per-drive origin isolation (localStorage etc. don't cross drives)
//
// Servers bind 127.0.0.1 only. Anything on-device can read loopback ports — same standing
// tradeoff every local dev server makes; drives are readable by any local peer anyway.
export class HttpGateway {
  constructor (manager) {
    this.manager = manager
    this.servers = new Map() // keyHex → { server, port, driveType }
  }

  // Ensure a server exists for this drive; resolves to its port.
  async serverFor (driveType, keyHex) {
    const existing = this.servers.get(keyHex)
    if (existing) return existing
    const server = http.createServer((req, res) => {
      this._handle(driveType, keyHex, req, res).catch((err) => {
        try {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain')
          res.end('Gateway error: ' + (err && err.message))
        } catch {}
      })
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const entry = { server, port: server.address().port, driveType }
    this.servers.set(keyHex, entry)
    return entry
  }

  async urlFor (driveType, keyHex, path = '/') {
    const { port } = await this.serverFor(driveType, keyHex)
    return `http://127.0.0.1:${port}${path.startsWith('/') ? path : '/' + path}`
  }

  portFor (keyHex) {
    return this.servers.get(keyHex)?.port ?? null
  }

  closeFor (keyHex) {
    const entry = this.servers.get(keyHex)
    if (!entry) return
    this.servers.delete(keyHex)
    try { entry.server.close() } catch {}
  }

  close () {
    for (const keyHex of [...this.servers.keys()]) this.closeFor(keyHex)
  }

  async _handle (driveType, keyHex, req, res) {
    const key = b4a.from(keyHex, 'hex')
    // Strip query/fragment — a drive path addresses a file (mirrors desktop's pathname-only lookup).
    let path = String(req.url || '/')
    const q = path.indexOf('?')
    if (q !== -1) path = path.slice(0, q)
    path = decodeURIComponent(path) || '/'

    // Mirror desktop's protocol handler: only an HTML *navigation* gets the /.ui SPA (or a
    // directory listing); a fetch()/sub-resource request (Accept: */*) resolves actual files.
    // `navigation` is the stricter page-load signal for `fallback` routing (Sec-Fetch-Dest
    // when the WebView sends it, Accept sniffing otherwise).
    const wantsHTML = /text\/html/i.test(String(req.headers?.accept || ''))
    const navigation = isDocumentNavigation(req.headers)

    let result
    try {
      result = await this.manager.resolve(driveType, key, path, () => {}, null, { wantsHTML, navigation })
    } catch (err) {
      res.statusCode = /not found/i.test(String(err?.message)) ? 404 : 500
      res.setHeader('Content-Type', 'text/plain')
      res.end(String(err?.message || 'Error'))
      return
    }

    if (result.kind === 'file') {
      res.statusCode = 200
      res.setHeader('Content-Type', result.mime || mime.getType(path) || 'application/octet-stream')
      res.setHeader('Content-Length', result.buffer.byteLength)
      res.setHeader('Cache-Control', 'no-cache') // drives replicate live; let the WebView revalidate
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(result.buffer)
      return
    }

    // Directory with no index and no SPA: minimal HTML listing so in-page navigation to a bare
    // folder doesn't 404 (top-level opens still use the app's native directory view via RPC).
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    const items = (result.entries || []).map((e) => {
      const href = (path.endsWith('/') ? path : path + '/') + e.name + (e.isDir ? '/' : '')
      return `<li><a href="${href}">${e.isDir ? '&#128193; ' : ''}${e.name}</a></li>`
    }).join('\n')
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${path}</title><body style="font:14px system-ui;padding:16px"><h3>${path}</h3><ul>${items}</ul></body>`)
  }
}
