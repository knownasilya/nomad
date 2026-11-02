// Where the user's own AI may send a request once it holds their private data (ADR-0037).
//
// A turn that has read the user's Notes, Reader, Mods, Jobs, drive files or the page in their tab
// can carry that data out in a URL, a query string or a body. A page, a feed post or a fetched
// file can tell the model to do exactly that. So once a turn holds private data, a request to a
// host the user didn't name (fetchUrl, httpRequest, openTab) needs the user's yes, asked once per
// host per turn (`aiSendData:<host>`). A Job has nobody to ask: it reaches only the hosts its
// prompt names and the hosts of the secrets it may use, and is refused anywhere else.
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
  'currentTab',
  'readCurrentPage',
  'screenshotCurrentPage',
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
 * }} [opts]
 * `privateData`: the chat already read private data on an earlier turn. `trustedHosts`: hosts the
 * user named (their messages, a Job's prompt) or a Job's secrets cover. `interactive`: there is a
 * user to ask (the AI Sidebar, the phone); a Job is not. `onPrivate` runs once, when the turn
 * first holds private data, so the chat can remember it for its next turn.
 */
export function createEgressGuard({ privateData = false, trustedHosts = [], interactive = true, onPrivate } = {}) {
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
