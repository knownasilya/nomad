// The AI's scratch space: what it looked up in a chat, kept for later steps of the same chat. Code it
// runs with execute can save a value (saveScratch) and read it back (readScratch), so a long page,
// a fetched file or a list it built doesn't have to pass through the model again, or be fetched
// again. A long Note, post or page that a read cuts into parts (text-part.mjs) is saved whole here
// too, and the read says under which key.
//
// One store per chat: the AI Sidebar's chat, a Job's run, or (anything else) one turn. It lives in
// memory on this computer only, is never written to disk or sent to another Device, and is dropped
// when the chat has been idle for SCOPE_IDLE_MS, or when the turn or run ends.
//
// An entry remembers whether it holds the user's private data (egress.mjs, ADR-0037): reading one
// back counts as a private read, so a request after it asks the user as usual.
//
// No Electron imports: unit tests load this file.

import { textPart, isPartial } from './text-part.mjs'

// What one chat keeps, in characters (a value's text, or its JSON). Past it, the entries used
// longest ago go first.
export const MAX_CHARS = 4_000_000
// The most one value may be.
export const MAX_ENTRY_CHARS = 1_000_000
const MAX_KEY = 200
const MAX_NOTE = 300

/**
 * A scratch store.
 * @param {{ maxChars?: number, maxEntryChars?: number, now?: () => number }} [opts]
 */
export function createScratch({ maxChars = MAX_CHARS, maxEntryChars = MAX_ENTRY_CHARS, now = Date.now } = {}) {
  // Map order is use order: the first entry is the one used longest ago.
  const entries = new Map()
  let total = 0

  const drop = (key) => {
    const e = entries.get(key)
    if (!e) return false
    entries.delete(key)
    total -= e.chars
    return true
  }

  return {
    /**
     * Saves `value` (a string, or any JSON value) under `key`, replacing what was there.
     * @param {string} key
     * @param {unknown} value
     * @param {{ source?: string, note?: string, private?: boolean }} [meta]
     */
    set(key, value, { source = 'saveScratch', note = '', private: priv = false } = {}) {
      const k = checkKey(key)
      const chars = sizeOf(value)
      if (chars > maxEntryChars) {
        throw new Error(
          `That value is ${chars} characters; the scratch space keeps at most ${maxEntryChars} in one entry. ` +
            'Save the part you need, or split it under several keys.'
        )
      }
      drop(k)
      const entry = {
        key: k,
        value: typeof value === 'string' ? value : JSON.parse(JSON.stringify(value)),
        chars,
        source: String(source || ''),
        note: String(note || '').slice(0, MAX_NOTE),
        private: !!priv,
        savedAt: new Date(now()).toISOString(),
      }
      entries.set(k, entry)
      total += chars
      // The oldest go first, never the one just saved.
      for (const old of entries.keys()) {
        if (total <= maxChars) break
        if (old !== k) drop(old)
      }
      return describe(entry)
    },

    /** The entry under `key` ({ key, value, source, note, private, savedAt, chars }), or null. */
    get(key) {
      const k = String(key ?? '')
      const e = entries.get(k)
      if (!e) return null
      // Used now: it moves to the end, last to go.
      entries.delete(k)
      entries.set(k, e)
      return e
    },

    /** Every entry without its value, newest first. */
    list() {
      return [...entries.values()].reverse().map(describe)
    },

    /** Whether any entry holds the user's private data. */
    get holdsPrivate() {
      return [...entries.values()].some((e) => e.private)
    },

    delete(key) {
      return drop(String(key ?? ''))
    },

    clear() {
      entries.clear()
      total = 0
    },

    /** Characters kept. */
    get chars() {
      return total
    },
  }
}

function checkKey(key) {
  const k = typeof key === 'string' ? key.trim() : ''
  if (!k) throw new Error('Pass a `key`: a short name for what you save, like "flights" or "page:https://…"')
  if (k.length > MAX_KEY) throw new Error(`A key is at most ${MAX_KEY} characters`)
  return k
}

function sizeOf(value) {
  if (typeof value === 'string') return value.length
  if (value === undefined) throw new Error('Pass the `value` to save')
  let json
  try {
    json = JSON.stringify(value)
  } catch {
    throw new Error('The value must be text, or something JSON can hold')
  }
  if (json === undefined) throw new Error('The value must be text, or something JSON can hold')
  return json.length
}

function describe(e) {
  return {
    key: e.key,
    ...(e.note ? { note: e.note } : {}),
    source: e.source,
    type: typeof e.value === 'string' ? 'text' : Array.isArray(e.value) ? 'array' : e.value === null ? 'null' : typeof e.value,
    chars: e.chars,
    savedAt: e.savedAt,
  }
}

// The key a read saves its whole text under: `note:<id>`, `post:<url>`, `page:<url>`.
export function scratchKey(kind, id) {
  return `${kind}:${String(id ?? '')}`.slice(0, MAX_KEY)
}

// Chats
// =

// A chat's store stays this long after its last use. A sidebar chat the user comes back to within
// it finds what it saved; one they left is dropped.
export const SCOPE_IDLE_MS = 3 * 60 * 60 * 1000
// The most chats with a store at once; past it, the one used longest ago is dropped.
export const MAX_SCOPES = 20

const scopes = new Map()

/**
 * The store for a chat (`sidebar:<window>:<chatId>`), made on first use.
 * @param {string} scope
 * @param {{ now?: number }} [opts]
 */
export function scratchFor(scope, { now = Date.now() } = {}) {
  for (const [k, s] of scopes) {
    if (now - s.used > SCOPE_IDLE_MS) scopes.delete(k)
  }
  let s = scopes.get(scope)
  if (s) scopes.delete(scope)
  else s = { store: createScratch() }
  s.used = now
  scopes.set(scope, s)
  while (scopes.size > MAX_SCOPES) scopes.delete(scopes.keys().next().value)
  return s.store
}

/** Drops a chat's store (the user deleted the chat). */
export function dropScratch(scope) {
  scopes.delete(scope)
}

/** For tests: forget every chat's store. */
export function _resetScopes() {
  scopes.clear()
}

// Capabilities
// =

// saveScratch, readScratch, listScratch and deleteScratch against a turn's store. `egress` is the
// turn's guard (egress.mjs), or null: a value saved once the turn holds private data is private,
// and reading a private one back marks the turn as holding private data.
/**
 * @param {string} name
 * @param {any} args
 * @param {{ store: ReturnType<typeof createScratch> | null, egress?: any }} ctx
 */
export function runScratchTool(name, args, { store, egress = null }) {
  if (!store) throw new Error(`${name} is not available here`)
  const a = args && typeof args === 'object' ? args : {}
  switch (name) {
    case 'saveScratch': {
      const saved = store.set(a.key, a.value, {
        note: typeof a.note === 'string' ? a.note : '',
        private: !!egress?.holdsPrivate,
      })
      return JSON.stringify({ saved: true, ...saved })
    }
    case 'readScratch': {
      const e = store.get(a.key)
      if (!e) {
        const keys = store.list().map((x) => x.key)
        throw new Error(
          `Nothing is saved under "${a.key}".` +
            (keys.length ? ` Saved keys: ${keys.slice(0, 20).join(', ')}` : ' Nothing is saved in this chat yet.')
        )
      }
      if (e.private) egress?.notePrivate?.()
      return JSON.stringify({ key: e.key, value: e.value, source: e.source, ...(e.note ? { note: e.note } : {}), savedAt: e.savedAt })
    }
    case 'listScratch': {
      if (store.holdsPrivate) egress?.notePrivate?.()
      return JSON.stringify(store.list())
    }
    case 'deleteScratch': {
      const key = String(a.key ?? '')
      return store.delete(key) ? `Deleted "${key}"` : `Nothing was saved under "${key}"`
    }
    default:
      throw new Error(`unknown scratch capability ${name}`)
  }
}

export const SCRATCH_TOOLS = new Set(['saveScratch', 'readScratch', 'listScratch', 'deleteScratch'])

// A page's text for a read from `offset` (readCurrentPage, a Job's openPage). From offset 0 the page
// is read live with `load()`, and saved whole when it is long; a later part comes from that saved
// copy, so the parts line up even when the page changes between reads. Returns { part, saved }:
// the part (text-part.mjs) and the scratch key the whole text is under, or null.
/**
 * @param {ReturnType<typeof createScratch> | null} store
 * @param {{ url: string, offset?: number, load: () => Promise<string>, source: string }} opts
 */
export async function readPageText(store, { url, offset = 0, load, source }) {
  const key = scratchKey('page', url)
  const kept = offset > 0 && store ? store.get(key) : null
  const text = kept && typeof kept.value === 'string' ? kept.value : String((await load()) ?? '')
  const part = textPart(text, { offset })
  const saved = kept ? key : isPartial(part) ? saveWhole(store, key, text, source) : null
  return { part, saved }
}

// A long text a read cut into parts (text-part.mjs), saved whole so the rest is one readScratch
// away. Returns the key, or null when it couldn't be saved (no store, or too long for one entry).
export function saveWhole(store, key, text, source) {
  if (!store) return null
  try {
    store.set(key, text, { source, private: true })
    return key
  } catch {
    return null
  }
}
