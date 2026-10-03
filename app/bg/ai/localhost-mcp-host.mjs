// Binds the MCP endpoint to 127.0.0.1. The protocol lives in localhost-mcp.mjs.

import http from 'http'
import { MCP_PORT, handleMcpHttp } from './localhost-mcp.mjs'

const MAX_BODY = 512 * 1024

export function startLocalhostMcp({ callTool, port = MCP_PORT } = {}) {
  const server = http.createServer((req, res) => {
    const chunks = []
    let size = 0
    let tooBig = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        tooBig = true
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(400).end()
    })
    req.on('end', async () => {
      if (tooBig || res.writableEnded) return
      try {
        const result = await handleMcpHttp({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          remoteAddress: req.socket && req.socket.remoteAddress,
          callTool,
        })
        res.writeHead(result.status, result.headers || {})
        res.end(result.body || '')
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end(err && err.message ? err.message : 'internal error')
        }
      }
    })
  })
  server.on('error', (err) => {
    console.error('[mcp] not listening:', err && err.message ? err.message : err)
  })
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address()
    const bound = addr && typeof addr === 'object' ? addr.port : port
    console.log(`[mcp] local agents: http://127.0.0.1:${bound}/mcp`)
  })
  return server
}
