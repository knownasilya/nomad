// The AI chats that made a Note or an Asset, on the phone (ADR-0047). The chats are the desktop AI
// Sidebar's sessions, kept in /.ai-chat/ of the Root Drive of the Space they were in
// (app/bg/ai/chat-store.js), which every one of the user's Devices replicates. The phone reads them
// to say "Made in the AI chat …" with the rules desktop uses (shared/ai-origin.mjs), and to show the
// chat's messages. It never writes them.
//
// `manager` is the DriveManager, `vault` the opened Vault Autobase, `spaces()` the Vault's Space
// records ({ rootDriveKey, name, deleted? }).

import b4a from 'b4a'
import { resolveOrigins } from '../../../shared/ai-origin.mjs'
import { jobPath } from '../../../shared/jobs.mjs'
import { decodeInlineJson } from '../../../shared/fs-core.mjs'

const DRIVE_AUTOBASE = 'autobase'
const CHAT_ID = /^[a-z0-9]{1,40}$/
const KEY = /^[0-9a-f]{64}$/

export function createAiChats ({ manager, vault, spaces }) {
  async function readJson (rootDriveKey, path) {
    try {
      const entry = await manager.open(DRIVE_AUTOBASE, b4a.from(rootDriveKey, 'hex'), () => {}, null)
      const buf = await entry.reader.read(path)
      return buf ? JSON.parse(b4a.toString(buf)) : null
    } catch {
      return null
    }
  }

  // One of the user's Spaces, by key; null for any other drive.
  async function ownSpace (key) {
    if (!KEY.test(String(key || ''))) return null
    const list = await spaces().catch(() => [])
    return list.find((s) => s && !s.deleted && s.rootDriveKey === key) || null
  }

  async function findChat (id, space) {
    if (!CHAT_ID.test(String(id || '')) || !(await ownSpace(space))) return null
    const data = await readJson(space, `/.ai-chat/sessions/${id}.json`)
    if (!data) return null
    const names = await readJson(space, '/.ai-chat/names.json')
    const named = names && typeof names[id] === 'string' ? names[id] : ''
    return { title: named || data.title || '', data }
  }

  return {
    // What a Note or an Asset shows for its `ai` list. The phone has no AI Sidebar: a chat opens
    // read-only here (load), and a Job on the Jobs screen.
    async origins (list, currentSpace) {
      const base = vault()
      const all = await spaces().catch(() => [])
      return resolveOrigins(Array.isArray(list) ? list : [], {
        chat: async (id, space) => {
          const found = await findChat(id, space)
          return found ? { title: found.title } : null
        },
        job: async (id) => {
          if (!base) return null
          const node = await base.view.get(jobPath(id)).catch(() => null)
          return node ? decodeInlineJson(node.value, b4a) : null
        },
        currentSpace: KEY.test(String(currentSpace || '')) ? currentSpace : null,
        spaceName: (key) => all.find((s) => s.rootDriveKey === key)?.name || ''
      })
    },

    // A chat's title and its messages, as the AI Sidebar saved them: the user's and the AI's text
    // only, without tool steps or pictures.
    async load (id, space) {
      const found = await findChat(id, space)
      if (!found) throw new Error('That chat isn’t saved anymore')
      const messages = (Array.isArray(found.data.messages) ? found.data.messages : [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: textOf(m.content) }))
        .filter((m) => m.content.trim())
      return { id, title: found.title || 'Untitled chat', updatedAt: found.data.updatedAt || 0, messages }
    }
  }
}

function textOf (content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((p) => (p && p.type === 'text' && typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n\n')
  }
  return ''
}
