// The AI's httpRequest capability (ADR-0033): one HTTP request from the main process, with the
// user's secrets added by name (secrets.mjs applySecrets) and every value taken back out of what
// returns (redact). The model and the execute sandbox only ever hold names.
//
// - This computer (127.0.0.0/8, ::1) is never reachable: the loopback MCP listens there, and a
//   request to it would be a way out of a Job's limits. The user's own network is reachable only
//   with a secret that names that host, so a page's text can't send the AI probing the LAN.
//   Addresses are checked after DNS, so a name that resolves to one is refused too.
// - A redirect is followed by hand, up to 5, and only to hosts every secret on the request allows.
// - A body is cut at MAX_BODY; binary bodies are described, not returned.
//
// No Electron imports: unit tests load this file with a fake `transport`.

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import {
  addressKind,
  applySecrets,
  captureValues,
  hostAllowed,
  normalizeRequest,
  redact,
  redirectAllowed,
} from './secrets.mjs'

export const MAX_BODY = 100_000
const MAX_DOWNLOAD = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000
const TEXT_TYPE = /^(text\/|application\/(json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|javascript|x-www-form-urlencoded|graphql|x-ndjson))/i

/**
 * Run one httpRequest call.
 * @param {any} args the model's arguments
 * @param {{
 *   resolveSecrets: (names: string[], host: string) => Promise<any[]>,
 *   saveSecret?: (name: string, value: string, host: string) => Promise<void>,
 *   allSecrets?: () => { name: string, value: string }[],
 *   transport?: (req: any) => Promise<{ status: number, statusText?: string, headers: Record<string, any>, body: Buffer }>,
 *   signal?: AbortSignal | null,
 * }} deps
 * `resolveSecrets` checks the turn may use each name (a permission, or the Job's grant) and returns
 * the records with their values; `saveSecret` checks and stores a value for saveToSecret.
 */
export async function runHttpRequest(args, deps) {
  const req = normalizeRequest(args)
  const transport = deps.transport || nodeTransport
  // `host` is what the permission prompt names: the request's host, or '' for a URL secret.
  const host = req.url ? safeHost(req.url) : ''
  const used = req.secrets.length ? await deps.resolveSecrets(req.secrets, host) : []
  const prepared = applySecrets(req, used)
  const known = () => [...(deps.allSecrets ? deps.allSecrets() : []), ...used]
  const allowPrivate = (hostname) => used.some((s) => hostAllowed(hostname, s.hosts))

  let url = prepared.url
  let method = prepared.method
  let body = prepared.body
  let headers = prepared.headers
  let res
  let hops = 0
  for (;;) {
    res = await transport({
      url,
      method,
      headers,
      body,
      allowPrivate: allowPrivate(url.hostname),
      signal: deps.signal || null,
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_DOWNLOAD,
    })
    const location = header(res.headers, 'location')
    if (![301, 302, 303, 307, 308].includes(res.status) || !location || hops >= MAX_REDIRECTS) break
    const next = new URL(location, url)
    if (next.protocol !== 'http:' && next.protocol !== 'https:') break
    if (!redirectAllowed(next.href, used)) break
    hops++
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET'
      body = null
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'content-type'))
    }
    url = next
  }

  const type = String(header(res.headers, 'content-type') || '')
  const raw = res.body || Buffer.alloc(0)
  const isText = !type || TEXT_TYPE.test(type)
  let text = isText ? raw.toString('utf8') : ''

  // saveToSecret: a value from the response goes into the secret, and out of what the model sees.
  const saved = []
  if (Object.keys(req.saveToSecret).length && res.status >= 200 && res.status < 300) {
    if (!deps.saveSecret) throw new Error('saveToSecret is not available here')
    const values = captureValues(req.saveToSecret, { headers: res.headers, body: text })
    for (const v of values) {
      await deps.saveSecret(v.name, v.value, url.hostname)
      saved.push(v)
    }
  }
  const secrets = [...known(), ...saved]
  const clean = (s) => redact(s, secrets)
  const outHeaders = {}
  for (const [k, v] of Object.entries(res.headers || {})) {
    outHeaders[k.toLowerCase()] = clean(Array.isArray(v) ? v.join(', ') : String(v))
  }
  let bodyOut
  if (!isText) bodyOut = `(${type || 'binary'} body, ${raw.length} bytes, not shown)`
  else {
    text = clean(text)
    bodyOut = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + `\n…[cut at ${MAX_BODY} of ${text.length} characters]` : text
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    url: clean(url.href),
    ...(hops ? { redirects: hops } : {}),
    ...(res.status >= 300 && res.status < 400 && header(res.headers, 'location')
      ? { note: 'Not followed: the redirect goes to a host the request’s secrets aren’t allowed on, or too many redirects.' }
      : {}),
    headers: outHeaders,
    body: bodyOut,
    ...(used.length ? { usedSecrets: used.map((s) => s.name) } : {}),
    ...(saved.length ? { savedSecrets: saved.map((s) => s.name) } : {}),
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function header(headers, name) {
  const hit = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === name)
  if (!hit) return undefined
  return Array.isArray(hit[1]) ? hit[1][0] : hit[1]
}

// Checks where an address is before connecting: loopback never, private only when allowed.
export function guardAddress(address, allowPrivate) {
  const kind = addressKind(address)
  if (kind === 'loopback') throw new Error('Requests to this computer aren’t allowed')
  if (kind === 'private' && !allowPrivate) {
    throw new Error('That address is on your local network. Save a secret for this host to reach it.')
  }
}

// node:http(s) with the address check in `lookup`, so a DNS answer can't point it somewhere else.
export function nodeTransport({ url, method, headers, body, allowPrivate, signal, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(hostname)) {
      try {
        guardAddress(hostname, allowPrivate)
      } catch (err) {
        return reject(err)
      }
    }
    const lookup = (host, opts, cb) => {
      dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
        if (err) return cb(err)
        const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts.family || 4 }]
        try {
          for (const a of list) guardAddress(a.address, allowPrivate)
        } catch (e) {
          return cb(e)
        }
        if (opts.all) return cb(null, list)
        cb(null, list[0].address, list[0].family)
      })
    }
    const lib = url.protocol === 'https:' ? https : http
    const r = lib.request(
      url,
      {
        method,
        headers: { 'User-Agent': 'Nomad', ...headers, ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
        lookup,
        signal: signal || undefined,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > maxBytes) {
            res.destroy()
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode || 0, statusText: res.statusMessage, headers: res.headers, body: Buffer.concat(chunks) }))
        res.on('close', () => resolve({ status: res.statusCode || 0, statusText: res.statusMessage, headers: res.headers, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      }
    )
    r.on('timeout', () => r.destroy(new Error('The request timed out')))
    r.on('error', reject)
    if (body != null) r.write(body)
    r.end()
  })
}
