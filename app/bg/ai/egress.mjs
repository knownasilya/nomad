// Where the user's own AI may send a request once it holds their private data (ADR-0037).
//
// A turn that has read the user's Notes, Reader, Mods, Jobs, drive files or the page in their tab
// can carry that data out in a URL, a query string or a body. A page, a feed post or a fetched
// file can tell the model to do exactly that. So once a turn holds private data, a request to a
// host the user didn't name (fetchUrl, httpRequest, openTab, a Job's openPage) needs the user's yes,
// asked once per host per turn (`aiSendData:<host>`). A Job has nobody to ask: it reaches only the
// hosts its prompt names, the hosts of the secrets it may use and the sites the user let it open
// (ADR-0038), and is refused anywhere else.
//
// Before a turn reads anything private, requests go out as before: there is nothing to leak.
//
// No Electron imports: unit tests load this file.

import { hostAllowed } from './secrets.mjs'

export const PERMISSION = 'aiSendData'

/** The permission that asks to send a request to `host` on this turn. */
export function sendPermission(host) {
  return `${PERMISSION}:${host}`
}

// Capabilities whose results hold the user's private data. A page tool (page_*) is the page's own
// data, which can be the user's mail or bank. The page-control actions return what is on the page.
export const PRIVATE_READS = new Set([
  'readDriveFile',
  'listDriveFiles',
  'searchDrives',
  'driveHistory',
  'currentTab',
  'readCurrentPage',
  'screenshotCurrentPage',
  // A Job's page is signed in as the user (ADR-0038).
  'openPage',
  'snapshotPage',
  'clickElement',
  'clickAt',
  'typeText',
  'pressKey',
  'selectOption',
  'scrollPage',
  'planPageActions',
  'listNotes',
  'readNote',
  'listReaderPosts',
  'readReaderPost',
  'listMods',
  'listJobs',
  'listCalendarEvents',
  'listContacts',
  // The cards pinned to the home page hold what earlier chats put there.
  'getDashboard',
  'previewLiveData',
])

/** Whether a capability's result holds the user's private data. */
export function readsPrivate(name) {
  const n = String(name || '')
  return PRIVATE_READS.has(n) || n.startsWith('page_')
}

// A host the way the guard compares them: lower case, no brackets, no trailing dot, no "www.".
export function normalizeHost(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

const URL_HOST = /\b(?:https?|hyper):\/\/([^\s/?#<>"'`()[\]{}|\\^]+)/gi
const BARE_HOST = /(^|[^\w@.\/-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi

/**
 * The hosts in text the user wrote: URLs (https://example.com/x) and bare domains (example.com).
 * The AI may send to these without asking: the user named them.
 */
export function hostsIn(text) {
  const s = typeof text === 'string' ? text : ''
  const out = new Set()
  for (const m of s.matchAll(URL_HOST)) {
    const host = normalizeHost(m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, ''))
    if (host) out.add(host)
  }
  for (const m of s.matchAll(BARE_HOST)) {
    const host = normalizeHost(m[2])
    // "e.g" and "file.md"-like words are harmless: they only let the AI reach a host the user typed.
    if (host && host.includes('.')) out.add(host)
  }
  return [...out]
}

/** The text of the user's own messages in a chat history (string or text-part content). */
export function userText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role === 'user')
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => (p && p.type === 'text' ? String(p.text || '') : '')).join('\n')
          : ''
    )
    .join('\n')
}

/**
 * Whether `host` (normalized) is one of `hosts`: the same host, ignoring "www.", or under a
 * "*.example.com" pattern (a secret's hosts can be one).
 */
export function covers(host, hosts) {
  const raw = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const h = normalizeHost(raw)
  if (!h) return false
  return (hosts || []).some((p) => {
    const s = String(p || '').toLowerCase()
    return s.startsWith('*.') ? hostAllowed(raw, [s]) : normalizeHost(s) === h
  })
}

/** The host a request goes to (lower case, as the prompt names it): '' for a URL it can't read, or a nomad:// page. */
export function requestHost(url) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'hyper:') return ''
  return u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/**
 * One turn's guard.
 * @param {{
 *   privateData?: boolean,
 *   trustedHosts?: string[],
 *   interactive?: boolean,
 *   onPrivate?: () => void,
 *   granted?: ((host: string) => boolean | Promise<boolean>) | null,
 * }} [opts]
 * `privateData`: the chat already read private data on an earlier turn. `trustedHosts`: hosts the
 * user named (their messages, a Job's prompt) or a Job's secrets cover. `interactive`: there is a
 * user to ask (the AI Sidebar, the phone); a Job is not. `onPrivate` runs once, when the turn
 * first holds private data, so the chat can remember it for its next turn. `granted` says whether
 * the user allowed a host for months (send-grants.js), so a request there doesn't ask.
 */
export function createEgressGuard({ privateData = false, trustedHosts = [], interactive = true, onPrivate, granted = null } = {}) {
  let holds = !!privateData
  const trusted = [...trustedHosts]
  const answers = new Map()
  if (holds) onPrivate?.()
  return {
    get holdsPrivate() {
      return holds
    },
    /** A capability finished: note whether its result holds private data. */
    noteCall(name) {
      if (holds || !readsPrivate(name)) return
      holds = true
      onPrivate?.()
    },
    /** Something read back private data another way (the scratch space, scratch.mjs). */
    notePrivate() {
      if (holds) return
      holds = true
      onPrivate?.()
    },
    /** Hosts the user named mid-turn (a message they steered in). */
    trust(hosts) {
      for (const h of hosts || []) {
        if (h) trusted.push(String(h))
      }
    },
    /**
     * Resolves when a request to `url` may go; throws when it may not.
     * @param {string} url
     * @param {{ ask?: (host: string) => Promise<boolean> | boolean, secretHosts?: string[], trusted?: boolean }} [opts]
     * `ask` shows the user the prompt for this host. `secretHosts` are the hosts of the secrets
     * this request uses (the user chose them for that secret). `trusted` is the caller's own word
     * that this host is the user's (one of their names).
     */
    async check(url, { ask, secretHosts = [], trusted: callerTrusts = false } = {}) {
      if (!holds || callerTrusts) return
      const host = requestHost(url)
      if (!host) return
      if (covers(host, trusted) || covers(host, secretHosts)) return
      if (granted && (await Promise.resolve().then(() => granted(host)).catch(() => false))) return
      if (!interactive || !ask) {
        throw new Error(
          `This Job has read the user's private data, so it can now reach only the hosts its prompt names or its secrets cover, not ${host}. ` +
            'Fetch other pages before reading Notes, Reader or drives, or say in your answer that the Job’s prompt has to name the site.'
        )
      }
      const key = normalizeHost(host)
      if (!answers.has(key)) answers.set(key, Promise.resolve(ask(host)).then((v) => !!v, () => false))
      if (!(await answers.get(key))) {
        throw new Error(
          `The user didn't allow sending a request to ${host} on this turn. You read their private data earlier in this chat, ` +
            'so requests to sites they didn’t name ask first. Don’t try that host again; tell the user what you wanted it for.'
        )
      }
    },
  }
}

// How much of a request the prompt shows. The prompt only needs enough to tell what goes where;
// a longer value is cut and says how long it was.
export const PREVIEW_URL_MAX = 2000
export const PREVIEW_VALUE_MAX = 300
export const PREVIEW_BODY_MAX = 4000

function cut(s, max) {
  const str = String(s ?? '')
  return str.length > max ? { text: str.slice(0, max), cut: str.length } : { text: str, cut: 0 }
}

/**
 * @typedef {{
 *   kind: 'fetch' | 'request' | 'tab',
 *   url: string, urlLength?: number,
 *   method: string,
 *   headers: { name: string, value: string }[],
 *   body: string | null, bodyType?: 'text' | 'json' | 'form', bodyLength?: number,
 *   secrets: string[],
 *   secretDetails?: { name: string, hosts: string[], sentAs: string }[],
 * }} RequestPreview
 */

/**
 * What the `aiSendData` prompt shows of the request that asks: the URL, the method, the headers
 * and body the AI wrote, and the secrets Nomad adds for it (by name; values are added later and
 * never shown). `kind` is 'fetch' (fetchUrl), 'request' (httpRequest) or 'tab' (openTab).
 * Only plain strings and numbers, so it can go to the prompt window and over the AI Bridge.
 * @param {any} [request] `{ kind, url }`, plus an httpRequest's own arguments
 * @returns {RequestPreview}
 */
export function requestPreview(request = {}) {
  const { kind = 'request', url, method, headers, body, json, form, secrets, secret, secretDetails } = request || {}
  const k = kind === 'fetch' || kind === 'tab' ? kind : 'request'
  const u = cut(url, PREVIEW_URL_MAX)
  /** @type {RequestPreview} */
  const out = {
    kind: k,
    url: u.text,
    method: k === 'request' ? String(method || 'GET').toUpperCase().slice(0, 10) : 'GET',
    headers: [],
    body: null,
    secrets: [],
  }
  if (u.cut) out.urlLength = u.cut
  if (k !== 'request') return out
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    out.headers = Object.entries(headers)
      .slice(0, 50)
      .map(([name, value]) => ({ name: cut(name, 100).text, value: cut(value, PREVIEW_VALUE_MAX).text }))
  }
  let raw = null
  if (body != null) {
    raw = String(body)
    out.bodyType = 'text'
  } else if (json != null) {
    try {
      raw = JSON.stringify(json, null, 2)
    } catch {
      raw = String(json)
    }
    out.bodyType = 'json'
  } else if (form != null && typeof form === 'object') {
    raw = new URLSearchParams(Object.entries(form).map(([a, b]) => [a, String(b ?? '')])).toString()
    out.bodyType = 'form'
  }
  if (raw != null) {
    const b = cut(raw, PREVIEW_BODY_MAX)
    out.body = b.text
    if (b.cut) out.bodyLength = b.cut
  }
  const names = [...(Array.isArray(secrets) ? secrets : []), ...(secret ? [secret] : [])]
  out.secrets = [...new Set(names.map((n) => cut(n, 64).text))].slice(0, 10)
  // Where each secret goes and the hosts the user chose for it (secrets.mjs describeInject), never
  // its value. The prompt warns with these.
  if (Array.isArray(secretDetails) && secretDetails.length) {
    out.secretDetails = secretDetails
      .filter((d) => d && out.secrets.includes(String(d.name)))
      .map((d) => ({
        name: cut(d.name, 64).text,
        hosts: (Array.isArray(d.hosts) ? d.hosts : []).slice(0, 20).map((h) => cut(h, 253).text),
        sentAs: cut(d.sentAs, PREVIEW_VALUE_MAX).text,
      }))
  }
  return out
}

// Hosts the user allowed for months (ADR-0037 amendment): the `aiSendData` prompt's "Allow for 3
// months" box. A grant is { host, grantedAt, until } (ms), kept on this computer by send-grants.js.
// A turn on this computer (the sidebar, the phone's turns it serves, a Job) sends there without
// asking until `until`. The AI page lists them, extends one by another 3 months, or removes it.

export const SEND_GRANT_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** When a grant made (or extended) at `now` ends. */
export function sendGrantUntil(now = Date.now()) {
  return now + SEND_GRANT_DAYS * DAY_MS
}

/** The grants still running at `now`, one per host (the latest end wins), soonest to end first. */
export function liveSendGrants(grants, now = Date.now()) {
  const byHost = new Map()
  for (const g of Array.isArray(grants) ? grants : []) {
    const host = normalizeHost(g?.host)
    const until = Number(g?.until)
    if (!host || !Number.isFinite(until) || until <= now) continue
    const grantedAt = Number.isFinite(Number(g?.grantedAt)) ? Number(g.grantedAt) : now
    const prev = byHost.get(host)
    if (!prev || prev.until < until) byHost.set(host, { host, grantedAt, until })
  }
  return [...byHost.values()].sort((a, b) => a.until - b.until || a.host.localeCompare(b.host))
}

/** Whether a running grant covers `host` (the same host, ignoring "www."). */
export function sendGrantCovers(host, grants, now = Date.now()) {
  const h = normalizeHost(host)
  return !!h && liveSendGrants(grants, now).some((g) => g.host === h)
}

/** `grants` with `host` allowed for another 3 months from `now` (a new grant, or one extended). */
export function withSendGrant(grants, host, now = Date.now()) {
  const h = normalizeHost(host)
  if (!h || h.length > 253 || /[\s/?#@]/.test(h)) throw new Error('Not a host')
  const live = liveSendGrants(grants, now)
  const prev = live.find((g) => g.host === h)
  const rest = live.filter((g) => g.host !== h)
  return [...rest, { host: h, grantedAt: prev ? prev.grantedAt : now, until: sendGrantUntil(now) }]
}

/** `grants` without `host`. */
export function withoutSendGrant(grants, host, now = Date.now()) {
  const h = normalizeHost(host)
  return liveSendGrants(grants, now).filter((g) => g.host !== h)
}
