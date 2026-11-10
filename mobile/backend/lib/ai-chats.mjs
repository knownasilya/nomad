// The phone AI panel's saved chats: the same files desktop's AI Sidebar keeps in the Space's Root
// Drive (hyper://private/.ai-chat/, app/bg/ai/chat-store.js), so a chat started on the computer can
// be carried on from the phone and the other way round. Rules and paths are shared/ai-chats.mjs.
//
// They are also what a Note or an Asset links back to when the user's AI made it (ADR-0047):
// `origins` says what the item shows, with the rules desktop uses (shared/ai-origin.mjs).
//
// `open(space, ns)` gives the Space's Root Drive entry to read ({ reader }), `openWritable(space, ns)`
// one to write ({ drive, reader }) or throws when this phone can't write it yet; `put`/`del` write
// through the drive manager. `spaces()` lists the Vault's Space records ({ rootDriveKey, name,
// deleted? }) and `jobOf(id)` reads a Job, for `origins`.

import b4a from 'b4a'
import {
  SESSIONS_DIR,
  LAST_SESSION_PATH,
  NAMES_PATH,
  isSessionId,
  sessionPath,
  sessionIdOf,
  sessionRow,
  sortRows,
  searchWords,
  sessionTitle,
  chatJobOf,
  cleanName,
  namesOf
} from '../../../shared/ai-chats.mjs'
import { resolveOrigins } from '../../../shared/ai-origin.mjs'

// What a saved message keeps. `error` is the sidebar's failed turn; `files` its Revert list. The
// phone keeps both when it saves a chat desktop started.
const MESSAGE_FIELDS = ['role', 'content', 'images', 'reasoning', 'privateData', 'files']
const ROLES = ['user', 'assistant', 'error']

function checkId (id) {
  if (!isSessionId(id)) throw new Error('Not a chat id')
  return id
}

async function readJson (reader, path) {
  try {
    const buf = await reader.read(path)
    return buf ? JSON.parse(b4a.toString(buf)) : null
  } catch {
    return null
  }
}

const json = (value) => b4a.from(JSON.stringify(value))

export function cleanMessages (messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && ROLES.includes(m.role) && typeof m.content === 'string')
    .map((m) => {
      const out = {}
      for (const k of MESSAGE_FIELDS) if (m[k] !== undefined) out[k] = m[k]
      return out
    })
}

export function createAiChats ({ open, openWritable, put, del, spaces = async () => [], jobOf = async () => null }) {
  async function list (at, { query = '' } = {}) {
    const { reader } = await at.open()
    const ids = []
    for await (const key of reader.keys(SESSIONS_DIR)) {
      const rel = key.slice(SESSIONS_DIR.length)
      if (!key.startsWith(SESSIONS_DIR) || rel.includes('/')) continue
      const id = sessionIdOf(rel)
      if (id) ids.push(id)
    }
    const [sessions, names, last] = await Promise.all([
      Promise.all(ids.map((id) => readJson(reader, sessionPath(id)))),
      readJson(reader, NAMES_PATH).then(namesOf),
      readJson(reader, LAST_SESSION_PATH)
    ])
    const words = searchWords(query)
    const chats = sortRows(sessions.map((data, i) => sessionRow(ids[i], data, names, words)))
    return { chats, lastId: (last && isSessionId(last.sessionId) && last.sessionId) || null }
  }

  // { id, title, named, messages, updatedAt, job } or null when there is no such chat.
  async function load (at, id) {
    checkId(id)
    const { reader } = await at.open()
    const [data, names] = await Promise.all([
      readJson(reader, sessionPath(id)),
      readJson(reader, NAMES_PATH).then(namesOf)
    ])
    if (!data) return null
    const named = typeof names[id] === 'string' && names[id] ? names[id] : ''
    return {
      id,
      title: named || (typeof data.title === 'string' ? data.title : ''),
      named: !!named,
      messages: cleanMessages(data.messages),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      job: chatJobOf(data)
    }
  }

  // The last chat the user had open, on any of their Devices in this Space.
  async function last (at) {
    const { reader } = await at.open()
    const rec = await readJson(reader, LAST_SESSION_PATH)
    return rec && isSessionId(rec.sessionId) ? load(at, rec.sessionId) : null
  }

  // Saved the way the sidebar saves it, so desktop opens it as one of its own.
  async function save (at, id, { messages, job } = {}) {
    checkId(id)
    const entry = await at.openWritable()
    const clean = cleanMessages(messages)
    const j = chatJobOf({ job })
    const data = { title: sessionTitle(clean, j), messages: clean, ...(j ? { job: j } : {}), id, updatedAt: Date.now() }
    await put(entry, sessionPath(id), json(data))
    await put(entry, LAST_SESSION_PATH, json({ sessionId: id }))
    return { id, updatedAt: data.updatedAt }
  }

  async function rename (at, id, name) {
    checkId(id)
    const entry = await at.openWritable()
    const data = await readJson(entry.reader, sessionPath(id))
    if (!data) throw new Error('No chat with that id')
    const clean = cleanName(name)
    const names = namesOf(await readJson(entry.reader, NAMES_PATH))
    if (clean) names[id] = clean
    else delete names[id]
    await put(entry, NAMES_PATH, json(names))
    return clean || data.title || ''
  }

  async function remove (at, id) {
    checkId(id)
    const entry = await at.openWritable()
    await del(entry, sessionPath(id))
    const names = namesOf(await readJson(entry.reader, NAMES_PATH))
    if (id in names) {
      delete names[id]
      await put(entry, NAMES_PATH, json(names))
    }
    return true
  }

  // What a Note or an Asset shows for its `ai` list. A chat is looked up only in the user's own
  // Spaces: an item in a shared Space can name a chat in someone else's.
  async function origins (list, currentSpace) {
    const all = await spaces().catch(() => [])
    const own = (key) => all.some((s) => s && !s.deleted && s.rootDriveKey === key)
    return resolveOrigins(Array.isArray(list) ? list : [], {
      chat: async (id, space) => {
        if (!isSessionId(id) || !own(space)) return null
        const found = await load({ open: () => open(space, null) }, id).catch(() => null)
        return found ? { title: found.title } : null
      },
      job: (id) => jobOf(id),
      currentSpace: /^[0-9a-f]{64}$/.test(String(currentSpace || '')) ? currentSpace : null,
      spaceName: (key) => all.find((s) => s && s.rootDriveKey === key)?.name || ''
    })
  }

  return {
    handle (action, args = {}) {
      const { space } = args
      if (action === 'origins') return origins(args.list, space)
      if (typeof space !== 'string' || !/^[0-9a-f]{64}$/i.test(space)) throw new Error('Open a Space first')
      // `ns`: this phone made the Space, and reopens its Root Drive writable from there.
      const ns = typeof args.ns === 'string' && args.ns ? args.ns : null
      const at = { open: () => open(space, ns), openWritable: () => openWritable(space, ns) }
      if (action === 'list') return list(at, { query: args.query })
      if (action === 'load') return load(at, args.id)
      if (action === 'last') return last(at)
      if (action === 'save') return save(at, args.id, args)
      if (action === 'rename') return rename(at, args.id, args.name)
      if (action === 'delete') return remove(at, args.id)
      throw new Error(`Unknown aiChats action: ${action}`)
    }
  }
}
