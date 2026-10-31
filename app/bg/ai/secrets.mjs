// Secrets (ADR-0033): API keys and tokens the user saves for their own AI and Jobs to use without
// anyone seeing them again: not the model, not a page, not Nomad's own UI. The pure rules live here;
// app/bg/ai/secret-store.js keeps them encrypted on this computer, and app/bg/ai/http-request.mjs
// sends the requests.
//
// A secret is used by name. The model calls httpRequest with `secrets: ['GITHUB_TOKEN']`, and the
// main process adds the value where the user said it goes (`inject`): a header, a query parameter,
// a field of a JSON or form body, or the whole URL (a webhook). It goes only to the hosts the user
// listed (`hosts`), so the model can't move it into a body, a path, or another site. Any echo of a
// value in what comes back reads `[secret NAME]` (redact), and so does any tool result of any turn.
//
//   { name, note, hosts, inject, chat, jobs, hasValue, createdAt, updatedAt, valueSetAt, valueSetBy,
//     lastUsedAt }
//
// `chat`: the AI Sidebar and the phone's AI panel may ask to use it (once a turn, per secret).
// `jobs`: ids of the Jobs the user let use it on this computer. Kept here, not in the Job's Vault
// record, so a grant made on one computer can't be made from another Device.
//
// No Electron imports: unit tests load this file.

export const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/
export const MAX_VALUE = 16_384
export const MAX_NOTE = 200
export const MAX_HOSTS = 20
export const MAX_SECRETS_PER_REQUEST = 5
export const MAX_SAVES_PER_REQUEST = 3
export const INJECT_IN = ['header', 'query', 'body', 'url']
export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
export const PERMISSION = 'aiSecretUse'

const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/
const PARAM_RE = /^[A-Za-z0-9_.\-[\]]{1,64}$/
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
// Headers a request can't set: Nomad's HTTP client owns them.
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
])
const MAX_HEADERS = 50
const MAX_HEADER_VALUE = 8192
const MAX_URL = 8192
// A value shorter than this isn't searched for in output: "1" would redact every digit.
const MIN_REDACT = 4

export const DEFAULT_INJECT = Object.freeze({ in: 'header', name: 'Authorization', format: 'Bearer {value}' })

// Line breaks and NUL: a header or a value with one could start another header.
function hasBreak(s) {
  return s.includes('\r') || s.includes('\n') || s.includes('\u0000')
}

export function isSecretName(name) {
  return NAME_RE.test(String(name || ''))
}

export function permissionFor(name) {
  if (!isSecretName(name)) throw new Error('Not a secret name')
  return `${PERMISSION}:${name}`
}

// Hosts
// =

// A host the user allows: "api.github.com", "*.example.com" (any host under it, not itself), or an
// IP address ("192.168.1.5", for a device on the user's network). A URL is cut to its host.
export function normalizeHost(input) {
  let h = String(input || '').trim().toLowerCase()
  if (!h) throw new Error('Type a host, like api.github.com')
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) {
    try {
      h = new URL(h).hostname
    } catch {
      throw new Error(`“${input}” isn’t a host`)
    }
  }
  h = h.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (isIp(h)) return h
  const wild = h.startsWith('*.')
  const rest = wild ? h.slice(2) : h
  const labels = rest.split('.')
  if (!labels.every((l) => LABEL_RE.test(l))) throw new Error(`“${input}” isn’t a host`)
  // "*.com" would send the secret to every .com site.
  if (wild && labels.length < 2) throw new Error(`“${input}” covers too much: name the site, like *.example.com`)
  return h
}

export function normalizeHosts(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)
  const out = [...new Set(arr.filter((h) => String(h || '').trim()).map(normalizeHost))]
  if (!out.length) throw new Error('A secret needs at least one host it may be sent to')
  if (out.length > MAX_HOSTS) throw new Error(`A secret can have at most ${MAX_HOSTS} hosts`)
  return out
}

// Whether a request's hostname is one of `hosts`.
export function hostAllowed(hostname, hosts) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h) return false
  return (hosts || []).some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p))
}

function isIp(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(':') && /^[0-9a-f:.]+$/.test(h))
}

// Where an address is: 'loopback' (this computer, never reachable: the loopback MCP listens there),
// 'private' (the user's network, cloud metadata, CGNAT/Tailscale), or null (the internet).
export function addressKind(address) {
  let a = String(address || '').toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) a = mapped[1]
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a)
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])]
    if (p === 127 || p === 0) return 'loopback'
    if (p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) return 'private'
    if (p === 169 && q === 254) return 'private'
    if (p === 100 && q >= 64 && q <= 127) return 'private'
    return null
  }
  if (a === '::1' || a === '::') return 'loopback'
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return 'private'
  return null
}

// Injection
// =

// How a secret goes into a request: { in: 'header', name, format } (format has {value} or
// {base64}), { in: 'query', name }, { in: 'body', name } (a field of a json or form body), or
// { in: 'url' } (the value is the whole URL, like a webhook's).
export function normalizeInject(input) {
  if (input == null) return { ...DEFAULT_INJECT }
  const i = typeof input === 'object' ? input : {}
  const where = i.in || 'header'
  if (!INJECT_IN.includes(where)) throw new Error('A secret goes in a header, the query, the body or the URL')
  if (where === 'url') return { in: 'url' }
  const name = String(i.name || (where === 'header' ? 'Authorization' : '')).trim()
  if (where === 'header') {
    if (!HEADER_NAME_RE.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new Error(`“${name}” can’t be the header`)
    }
    const format = String(i.format == null || i.format === '' ? '{value}' : i.format)
    if (format.length > 200 || !/\{(value|base64)\}/.test(format) || /[\r\n]/.test(format)) {
      throw new Error('The header’s format needs {value} (or {base64}), like “Bearer {value}”')
    }
    return { in: 'header', name, format }
  }
  if (!PARAM_RE.test(name)) throw new Error(`“${name}” can’t be the ${where === 'query' ? 'parameter' : 'field'} name`)
  return { in: where, name }
}

// In words, for the model and My Library.
export function describeInject(inject) {
  const i = inject || DEFAULT_INJECT
  if (i.in === 'url') return 'the whole URL (leave out url)'
  if (i.in === 'query') return `the ?${i.name}= query parameter`
  if (i.in === 'body') return `the "${i.name}" field of a json or form body`
  const shown = i.format.replace('{value}', '…').replace('{base64}', '…')
  return `the ${i.name} header (${i.name}: ${shown})`
}

// The record to keep (without its value): a new secret (no `prev`) or changes to `prev`; fields left
// out keep their values. The name can't change. Throws for a bad field.
export function makeSecret(fields, prev = null, now = new Date()) {
  const f = fields || {}
  const name = prev ? prev.name : String(f.name || '').trim().toUpperCase()
  if (!isSecretName(name)) {
    throw new Error('A secret’s name is capital letters, digits and _, starting with a letter, like GITHUB_TOKEN')
  }
  const note = f.note !== undefined ? String(f.note || '').trim().slice(0, MAX_NOTE) : prev?.note || ''
  const inject = f.inject !== undefined ? normalizeInject(f.inject) : prev?.inject || { ...DEFAULT_INJECT }
  const hosts = f.hosts !== undefined ? normalizeHosts(f.hosts) : prev?.hosts || normalizeHosts([])
  const chat = f.chat !== undefined ? !!f.chat : prev ? !!prev.chat : true
  const jobs = f.jobs !== undefined ? jobIds(f.jobs) : prev?.jobs || []
  const iso = now.toISOString()
  return {
    name,
    note,
    hosts,
    inject,
    chat,
    jobs,
    createdAt: prev?.createdAt || iso,
    updatedAt: iso,
    valueSetAt: prev?.valueSetAt || null,
    valueSetBy: prev?.valueSetBy || null,
    lastUsedAt: prev?.lastUsedAt || null,
  }
}

function jobIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => /^[a-z0-9-]{6,40}$/.test(id)))]
}

// A value the user typed, or one a response gave (saveToSecret). A url secret's value is a URL on
// one of its hosts.
export function checkValue(secret, value) {
  if (typeof value !== 'string') throw new Error('A secret’s value is text')
  const v = value.replace(/^\s+|\s+$/g, '')
  if (!v) throw new Error('The value is empty')
  if (v.length > MAX_VALUE) throw new Error(`A secret can be at most ${MAX_VALUE} characters`)
  if (hasBreak(v)) throw new Error('A secret can’t have line breaks')
  if (secret.inject?.in === 'url') {
    let u
    try {
      u = new URL(v)
    } catch {
      throw new Error('This secret is a URL: paste the whole https:// URL')
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('This secret is an http(s) URL')
    if (!hostAllowed(u.hostname, secret.hosts)) throw new Error(`The URL’s host isn’t one of ${secret.hosts.join(', ')}`)
  }
  return v
}

// What the model sees: never the value.
export function secretForModel(s, usable) {
  return {
    name: s.name,
    ...(s.note ? { note: s.note } : {}),
    hosts: s.hosts,
    sentAs: describeInject(s.inject),
    hasValue: !!s.hasValue,
    usable: !!usable,
  }
}

// Requests
// =

// The model's httpRequest arguments, checked: { url, method, headers, body | json | form, secrets,
// saveToSecret }. Values stay out: secrets are names.
export function normalizeRequest(args) {
  const a = args && typeof args === 'object' ? args : {}
  const method = String(a.method || 'GET').toUpperCase()
  if (!METHODS.includes(method)) throw new Error(`method is one of ${METHODS.join(', ')}`)
  const names = [...new Set([...(Array.isArray(a.secrets) ? a.secrets : []), ...(a.secret ? [a.secret] : [])].map(String))]
  for (const n of names) if (!isSecretName(n)) throw new Error(`“${n}” isn’t a secret name. listSecrets lists them.`)
  if (names.length > MAX_SECRETS_PER_REQUEST) throw new Error(`A request can use at most ${MAX_SECRETS_PER_REQUEST} secrets`)
  const headers = {}
  const rawHeaders = a.headers && typeof a.headers === 'object' && !Array.isArray(a.headers) ? a.headers : {}
  if (Object.keys(rawHeaders).length > MAX_HEADERS) throw new Error(`A request can have at most ${MAX_HEADERS} headers`)
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (!HEADER_NAME_RE.test(k)) throw new Error(`“${k}” isn’t a header name`)
    if (RESERVED_HEADERS.has(k.toLowerCase())) throw new Error(`The ${k} header is set for you`)
    const val = String(v ?? '')
    if (hasBreak(val) || val.length > MAX_HEADER_VALUE) throw new Error(`The ${k} header’s value isn’t allowed`)
    headers[k] = val
  }
  const bodies = ['body', 'json', 'form'].filter((k) => a[k] !== undefined && a[k] !== null)
  if (bodies.length > 1) throw new Error('Pass one of body, json or form')
  if (bodies.length && (method === 'GET' || method === 'HEAD')) throw new Error(`A ${method} request has no body`)
  let body = null
  if (a.body != null) body = { kind: 'text', value: String(a.body) }
  if (a.json != null) body = { kind: 'json', value: a.json }
  if (a.form != null) {
    if (typeof a.form !== 'object' || Array.isArray(a.form)) throw new Error('form is an object of fields')
    body = { kind: 'form', value: Object.fromEntries(Object.entries(a.form).map(([k, v]) => [k, String(v ?? '')])) }
  }
  const saves = {}
  const rawSaves = a.saveToSecret && typeof a.saveToSecret === 'object' ? a.saveToSecret : {}
  for (const [n, from] of Object.entries(rawSaves)) {
    if (!isSecretName(n)) throw new Error(`“${n}” isn’t a secret name`)
    const f = String(from || '').trim()
    if (!f || f.length > 200) throw new Error(`saveToSecret.${n} is a JSON path like access_token, or header:<name>`)
    saves[n] = f
  }
  if (Object.keys(saves).length > MAX_SAVES_PER_REQUEST) {
    throw new Error(`A request can save at most ${MAX_SAVES_PER_REQUEST} secrets`)
  }
  const url = a.url == null || a.url === '' ? null : String(a.url)
  if (url && url.length > MAX_URL) throw new Error('The URL is too long')
  return { url, method, headers, body, secrets: names, saveToSecret: saves }
}

// The request to send: the model's request with each secret's value put where its `inject` says.
// `secrets` are records with their `value`. Throws when a secret can't go to the request's host.
// Resolves { url: URL, method, headers, body: string | null, hosts } where `hosts` is every host the
// secrets allow (a redirect may follow only within them).
export function applySecrets(req, secrets) {
  const urlSecret = secrets.find((s) => s.inject?.in === 'url')
  if (secrets.filter((s) => s.inject?.in === 'url').length > 1) throw new Error('Use one URL secret at a time')
  if (urlSecret && req.url) throw new Error(`Leave out url: ${urlSecret.name} is the URL`)
  if (!urlSecret && !req.url) throw new Error('httpRequest needs url')
  let url
  try {
    url = new URL(urlSecret ? urlSecret.value : req.url)
  } catch {
    throw new Error(`“${req.url}” isn’t a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported')
  if (url.username || url.password) throw new Error('Put credentials in a secret, not the URL')
  const headers = { ...req.headers }
  let body = req.body ? { ...req.body, value: req.body.kind === 'text' ? req.body.value : clone(req.body.value) } : null
  for (const s of secrets) {
    if (typeof s.value !== 'string' || !s.value) {
      throw new Error(`${s.name} has no value yet. The user sets it in My Library → Secrets.`)
    }
    if (!hostAllowed(url.hostname, s.hosts)) {
      throw new Error(`${s.name} can only be sent to ${s.hosts.join(', ')}, not ${url.hostname}`)
    }
    const i = s.inject || DEFAULT_INJECT
    if (i.in === 'header') {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === i.name.toLowerCase()) delete headers[k]
      headers[i.name] = i.format.replace('{value}', s.value).replace('{base64}', base64(s.value))
    } else if (i.in === 'query') {
      url.searchParams.set(i.name, s.value)
    } else if (i.in === 'body') {
      if (!body || body.kind === 'text') {
        throw new Error(`${s.name} goes in the "${i.name}" field of the body: pass json or form`)
      }
      if (body.kind === 'json' && (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value))) {
        throw new Error(`${s.name} goes in a field: json must be an object`)
      }
      body.value[i.name] = s.value
    }
  }
  const has = (name) => Object.keys(headers).some((k) => k.toLowerCase() === name)
  let text = null
  if (body?.kind === 'text') text = body.value
  if (body?.kind === 'json') {
    text = JSON.stringify(body.value)
    if (!has('content-type')) headers['Content-Type'] = 'application/json'
  }
  if (body?.kind === 'form') {
    text = new URLSearchParams(body.value).toString()
    if (!has('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }
  return { url, method: req.method, headers, body: text, hosts: [...new Set(secrets.flatMap((s) => s.hosts))] }
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v))
}

function base64(s) {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)))
}

// Whether a redirect from a request that carried secrets may be followed: only to a host every one
// of them allows, so a value is never sent anywhere else.
export function redirectAllowed(location, secrets) {
  if (!secrets.length) return true
  let host
  try {
    host = new URL(location).hostname
  } catch {
    return false
  }
  return secrets.every((s) => hostAllowed(host, s.hosts))
}

// Values a response gave for saveToSecret: { NAME: from } where `from` is "header:<name>" or a path
// in the JSON body ("access_token", "data.token", "items[0].key"). Returns [{ name, value }] and
// throws when one is missing, so a failed refresh never empties a secret.
export function captureValues(saves, { headers = {}, body = '' }) {
  const out = []
  let parsed
  for (const [name, from] of Object.entries(saves || {})) {
    let v
    if (/^header:/i.test(from)) {
      const want = from.slice(7).trim().toLowerCase()
      const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === want)
      v = hit ? (Array.isArray(hit[1]) ? hit[1][0] : hit[1]) : undefined
    } else {
      if (parsed === undefined) {
        try {
          parsed = JSON.parse(body)
        } catch {
          throw new Error(`Couldn’t save ${name}: the response isn’t JSON`)
        }
      }
      v = pickPath(parsed, from)
    }
    if (typeof v === 'number') v = String(v)
    if (typeof v !== 'string' || !v) throw new Error(`Couldn’t save ${name}: the response has no ${from}`)
    out.push({ name, value: v })
  }
  return out
}

export function pickPath(obj, path) {
  const parts = String(path)
    .replace(/^\$\.?/, '')
    .split(/\.|\[(\d+)\]/)
    .filter((p) => p !== undefined && p !== '')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined
    cur = Object.prototype.hasOwnProperty.call(cur, p) ? cur[p] : undefined
  }
  return cur
}

// Redaction
// =

// `text` with every value of `secrets` ([{ name, value }]) replaced by [secret NAME]: as it is, URL
// encoded, base64 (the forms a server most often echoes back) and JSON-escaped.
export function redact(text, secrets) {
  if (typeof text !== 'string' || !text || !secrets?.length) return text
  const forms = []
  for (const s of secrets) {
    if (typeof s.value !== 'string' || s.value.length < MIN_REDACT) continue
    const mark = `[secret ${s.name}]`
    const variants = new Set([s.value, encodeURIComponent(s.value), base64(s.value), JSON.stringify(s.value).slice(1, -1)])
    // A base64 of a longer text that holds the value ("user:token" in Basic auth) can't be found by
    // the value alone; the plain and encoded forms cover what servers echo.
    for (const v of variants) if (v.length >= MIN_REDACT) forms.push([v, mark])
  }
  forms.sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [v, mark] of forms) if (out.includes(v)) out = out.split(v).join(mark)
  return out
}

// A tool result (a string, or an object such as { text, imageDataUrl }) with its text redacted.
// An image is kept: a screenshot isn't searched.
export function redactResult(value, secrets) {
  if (!secrets?.length) return value
  if (typeof value === 'string') return redact(value, secrets)
  if (value && typeof value === 'object' && typeof value.imageDataUrl === 'string') {
    return { ...value, text: redact(value.text, secrets) }
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.parse(redact(JSON.stringify(value), secrets))
    } catch {
      return value
    }
  }
  return value
}
