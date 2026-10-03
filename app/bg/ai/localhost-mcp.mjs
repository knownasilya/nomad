// Loopback MCP for search and execute. No Electron — the HTTP host and the
// unit tests both call handleMcpHttp. A browser page cannot complete this
// request: application/json is not a simple content type, and this server
// sends no CORS headers, so a cross-origin page stops at the preflight.

import { MODEL_TOOLS } from './search-execute.mjs'

export const MCP_PORT = 47655
export const MCP_PATH = '/mcp'
const PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05']

export function mcpToolList() {
  return MODEL_TOOLS.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || '',
    inputSchema: tool.function.parameters,
  }))
}

export function isLoopback(address) {
  if (typeof address !== 'string' || !address) return false
  const host = address.replace(/^::ffff:/i, '')
  return host === '127.0.0.1' || host === '::1'
}

export function originAllowed(origin) {
  if (origin == null || origin === '') return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

export async function handleMcpHttp({ method, url, headers, body, remoteAddress, callTool }) {
  const header = (name) => {
    const value = headers && (headers[name] ?? headers[name.toLowerCase()])
    return Array.isArray(value) ? value[0] : value
  }
  if (!isLoopback(remoteAddress)) return text(403, 'loopback only')
  const path = String(url || '/').split('?')[0]
  if (path !== MCP_PATH) return text(404, 'not found')
  if (!originAllowed(header('origin'))) return text(403, 'origin not allowed')
  if (method === 'GET' || method === 'DELETE' || method === 'OPTIONS') return text(405, 'use POST')
  if (method !== 'POST') return text(405, 'use POST')
  const contentType = String(header('content-type') || '')
  if (!contentType.includes('application/json')) return text(415, 'content-type must be application/json')

  let message
  try {
    message = JSON.parse(body || '')
  } catch {
    return jsonRpc(null, { error: rpcError(-32700, 'parse error') })
  }
  if (Array.isArray(message) || !message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpc(message && message.id, { error: rpcError(-32600, 'invalid request') })
  }
  if (message.id == null) return { status: 202, headers: {}, body: '' }

  try {
    const result = await dispatch(message.method, message.params || {}, callTool)
    return jsonRpc(message.id, { result })
  } catch (err) {
    const code = err && err.rpcCode ? err.rpcCode : -32603
    return jsonRpc(message.id, { error: rpcError(code, err && err.message ? err.message : 'internal error') })
  }
}

async function dispatch(method, params, callTool) {
  if (method === 'initialize') {
    const requested = params && params.protocolVersion
    return {
      protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'nomad', version: '1' },
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: mcpToolList() }
  if (method === 'tools/call') return callMcpTool(params || {}, callTool)
  const err = new Error(`method not found: ${method}`)
  err.rpcCode = -32601
  throw err
}

async function callMcpTool(params, callTool) {
  const name = params.name
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  if (name !== 'search' && name !== 'execute') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  if (typeof callTool !== 'function') throw new Error('search and execute are not available')
  try {
    const value = await callTool(name, args)
    return { content: contentFrom(value), isError: false }
  } catch (err) {
    return {
      content: [{ type: 'text', text: err && err.message ? err.message : String(err) }],
      isError: true,
    }
  }
}

function contentFrom(value) {
  if (value && typeof value === 'object' && typeof value.imageDataUrl === 'string') {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(value.imageDataUrl)
    const content = [{ type: 'text', text: value.text || 'Screenshot captured.' }]
    if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] })
    return content
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return [{ type: 'text', text: text == null ? '' : text }]
}

function rpcError(code, message) {
  return { code, message }
}

function jsonRpc(id, payload) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id == null ? null : id, ...payload }),
  }
}

function text(status, body) {
  return { status, headers: { 'content-type': 'text/plain' }, body }
}
