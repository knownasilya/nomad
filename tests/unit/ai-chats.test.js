// The AI's saved chats, shared by desktop's AI Sidebar (app/bg/ai/chat-store.js) and the phone's AI
// panel (mobile/backend/lib/ai-chats.mjs): the rules in shared/ai-chats.mjs, the phone's backend
// over an in-memory Root Drive, and the panel's list helpers (mobile/lib/aiChats.ts).

import { describe, it, expect } from 'vitest'
import {
  isSessionId,
  sessionIdOf,
  sessionPath,
  sessionRow,
  sessionTitle,
  sortRows,
  cleanName,
  namesOf,
  newSessionId,
  LAST_SESSION_PATH,
  NAMES_PATH
} from '../../shared/ai-chats.mjs'
import { createAiChats, cleanMessages } from '../../mobile/backend/lib/ai-chats.mjs'
import { chatGroupOf, groupChats, chatAgo, chatMeta, chatSuggestions, retryHistory, newChatId } from '../../mobile/lib/aiChats.ts'

const SPACE = 'a'.repeat(64)

describe('shared rules', () => {
  it('takes only short lower-case ids, so a name can never leave sessions/', () => {
    expect(isSessionId(newSessionId())).toBe(true)
    expect(isSessionId(newChatId())).toBe(true)
    expect(isSessionId('../names')).toBe(false)
    expect(isSessionId('ABC')).toBe(false)
    expect(isSessionId('')).toBe(false)
    expect(sessionIdOf('/.ai-chat/sessions/abc123.json')).toBe('abc123')
    expect(sessionIdOf('abc123.txt')).toBe(null)
    expect(sessionIdOf('a.b.json')).toBe(null)
    expect(sessionPath('abc')).toBe('/.ai-chat/sessions/abc.json')
  })

  it('titles a chat after its first message, or its Job', () => {
    const msgs = [{ role: 'assistant', content: 'hi' }, { role: 'user', content: '  Plan a weekend in Lisbon  ' }]
    expect(sessionTitle(msgs)).toBe('Plan a weekend in Lisbon')
    expect(sessionTitle([{ role: 'user', content: 'x'.repeat(100) }])).toHaveLength(60)
    expect(sessionTitle(msgs, { id: 'j', title: 'Morning news' })).toBe('Morning news')
    expect(sessionTitle([])).toBe('')
  })

  it('keeps a name to one line of 80 characters', () => {
    expect(cleanName('  Trip\n plans ')).toBe('Trip plans')
    expect(cleanName('y'.repeat(200))).toHaveLength(80)
    expect(cleanName(null)).toBe('')
    expect(namesOf([1])).toEqual({})
  })

  it('builds a row with the user\'s name, the count and a preview', () => {
    const data = { title: 'Plan', updatedAt: 5, messages: [{ role: 'user', content: 'Plan' }, { role: 'assistant', content: 'Here  is\na plan' }, { role: 'error', content: 'x' }] }
    expect(sessionRow('c1', data, { c1: 'Lisbon' })).toEqual({
      id: 'c1', title: 'Lisbon', named: true, updatedAt: 5, messageCount: 2, preview: 'Here is a plan', job: null
    })
    expect(sessionRow('c1', data, {}, ['lisbon'])).toBe(null)
    expect(sessionRow('c1', data, { c1: 'Lisbon' }, ['lisbon']).snippet).toBe('')
    expect(sessionRow('c1', data, {}, ['plan']).snippet).toBe('Plan')
    expect(sortRows([{ updatedAt: 1 }, null, { updatedAt: 3 }])).toEqual([{ updatedAt: 3 }, { updatedAt: 1 }])
  })
})

// A Space's Root Drive in memory: the reader the drive manager gives, and put/del.
function memoryDrive (writable = true, extra = {}) {
  const files = new Map()
  const entry = {
    reader: {
      async read (path) { return files.has(path) ? files.get(path) : null },
      async * keys (prefix) { for (const k of [...files.keys()].sort()) if (k.startsWith(prefix)) yield k }
    }
  }
  const chats = createAiChats({
    open: async (space, ns) => { entry.opened = { space, ns }; return entry },
    openWritable: async () => {
      if (!writable) throw new Error('This phone asked your computer for permission to change this space.')
      return entry
    },
    put: async (e, path, buf) => { files.set(path, buf) },
    del: async (e, path) => { files.delete(path) },
    ...extra
  })
  const json = (path) => JSON.parse(files.get(path).toString())
  return { files, chats, entry, json }
}

describe('the phone backend', () => {
  it('saves a chat the way the sidebar does, and lists, loads, renames and deletes it', async () => {
    const { chats, json, files } = memoryDrive()
    const messages = [
      { role: 'user', content: 'Weekend in Lisbon?', images: ['data:image/png;base64,AA'] },
      { role: 'assistant', content: 'Alfama on Saturday.', reasoning: 'hmm', steps: ['dropped'] }
    ]
    await chats.handle('save', { space: SPACE, id: 'abc', messages })
    const saved = json('/.ai-chat/sessions/abc.json')
    expect(saved).toMatchObject({ id: 'abc', title: 'Weekend in Lisbon?' })
    expect(saved.messages[1]).toEqual({ role: 'assistant', content: 'Alfama on Saturday.', reasoning: 'hmm' })
    expect(json(LAST_SESSION_PATH)).toEqual({ sessionId: 'abc' })

    // One the desktop sidebar wrote, with a failed turn and its Revert list.
    files.set('/.ai-chat/sessions/old.json', Buffer.from(JSON.stringify({
      id: 'old', title: 'Older', updatedAt: 1, messages: [{ role: 'user', content: 'Older' }, { role: 'error', content: 'Error: boom', files: [] }]
    })))
    files.set('/.ai-chat/sessions/nested/x.json', Buffer.from('{}'))

    const list = await chats.handle('list', { space: SPACE })
    expect(list.lastId).toBe('abc')
    expect(list.chats.map((c) => c.id)).toEqual(['abc', 'old'])
    expect((await chats.handle('list', { space: SPACE, query: 'alfama' })).chats.map((c) => c.id)).toEqual(['abc'])

    const old = await chats.handle('load', { space: SPACE, id: 'old' })
    expect(old.messages).toEqual([{ role: 'user', content: 'Older' }, { role: 'error', content: 'Error: boom', files: [] }])
    expect((await chats.handle('last', { space: SPACE })).id).toBe('abc')

    expect(await chats.handle('rename', { space: SPACE, id: 'old', name: ' Trip ' })).toBe('Trip')
    expect(json(NAMES_PATH)).toEqual({ old: 'Trip' })
    expect((await chats.handle('load', { space: SPACE, id: 'old' })).named).toBe(true)
    expect(await chats.handle('rename', { space: SPACE, id: 'old', name: '' })).toBe('Older')

    await chats.handle('rename', { space: SPACE, id: 'old', name: 'Trip' })
    await chats.handle('delete', { space: SPACE, id: 'old' })
    expect(files.has('/.ai-chat/sessions/old.json')).toBe(false)
    expect(json(NAMES_PATH)).toEqual({})
    expect(await chats.handle('load', { space: SPACE, id: 'old' })).toBe(null)
  })

  it('says which saved chat made an item, only from the user\'s own Spaces (ADR-0047)', async () => {
    const OTHER = 'b'.repeat(64)
    const { chats } = memoryDrive(true, {
      spaces: async () => [{ rootDriveKey: SPACE, name: 'Home' }],
      jobOf: async (id) => (id === 'digest' ? { title: 'Digest' } : null)
    })
    await chats.handle('save', { space: SPACE, id: 'abc', messages: [{ role: 'user', content: 'Plan the garden' }] })
    // In someone else's Space: this drive answers for any key, so only the Space check hides it.
    await chats.handle('save', { space: SPACE, id: 'xyz', messages: [{ role: 'user', content: 'Theirs' }] })
    const shown = await chats.handle('origins', {
      space: SPACE,
      list: [
        { stage: 'phone', chat: 'abc', space: SPACE, at: '2026-11-09T10:00:00.000Z', made: true },
        { stage: 'sidebar', chat: 'xyz', space: OTHER, at: '2026-11-08T10:00:00.000Z' },
        { stage: 'job', job: 'digest', at: '2026-11-07T10:00:00.000Z' }
      ]
    })
    expect(shown.map((o) => [o.kind, o.text])).toEqual([
      ['chat', 'Made in the AI chat “Plan the garden”'],
      ['none', 'Updated with AI'],
      ['job', 'Updated by the AI Job “Digest”']
    ])
  })

  it('opens the Root Drive with the ns the UI sends', async () => {
    const { chats, entry } = memoryDrive()
    await chats.handle('list', { space: SPACE, ns: 'space-ns' })
    expect(entry.opened).toEqual({ space: SPACE, ns: 'space-ns' })
  })

  it('refuses a bad id or Space, and says when the phone can\'t write the Space', async () => {
    const { chats } = memoryDrive(false)
    await expect(chats.handle('load', { space: SPACE, id: '../names' })).rejects.toThrow('Not a chat id')
    expect(() => chats.handle('list', { space: 'nope' })).toThrow('Open a Space first')
    await expect(chats.handle('save', { space: SPACE, id: 'abc', messages: [] })).rejects.toThrow('permission')
  })

  it('keeps only what a saved message holds', () => {
    expect(cleanMessages([{ role: 'system', content: 'x' }, { role: 'user' }, { role: 'user', content: 'hi', now: true }])).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('the panel\'s list', () => {
  const now = new Date(2026, 10, 9, 15, 0)
  const at = (days, hours = 0) => now.getTime() - days * 86400000 - hours * 3600000

  it('groups chats by day like nomad://ai/chats', () => {
    expect(chatGroupOf(at(0, 1), now)).toBe('Today')
    expect(chatGroupOf(at(1), now)).toBe('Yesterday')
    expect(chatGroupOf(at(4), now)).toBe('Previous 7 days')
    expect(chatGroupOf(at(20), now)).toBe('Previous 30 days')
    expect(chatGroupOf(new Date(2026, 4, 2).getTime(), now)).toBe('May 2026')
    const groups = groupChats([{ updatedAt: at(0, 1) }, { updatedAt: at(0, 2) }, { updatedAt: at(1) }], now)
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1]])
  })

  it('says when, briefly', () => {
    expect(chatAgo(now.getTime() - 10000, now)).toBe('just now')
    expect(chatAgo(now.getTime() - 25 * 60000, now)).toBe('25 min ago')
    expect(chatAgo(at(0, 3), now)).toBe('3 h ago')
    expect(chatAgo(at(1), now)).toBe('Yesterday')
    expect(chatAgo(new Date(2026, 9, 4).getTime(), now)).toBe('Oct 4')
    expect(chatAgo(new Date(2025, 9, 4).getTime(), now)).toBe('Oct 4, 2025')
    expect(chatMeta({ messageCount: 1, updatedAt: 0 }, now)).toBe('1 message')
  })

  it('suggests what fits the open tab', () => {
    expect(chatSuggestions('').map((x) => x.label)).toEqual(['What can you do?'])
    expect(chatSuggestions('https://example.com').map((x) => x.label)).toEqual(['Summarize this page', 'What can you do?'])
    expect(chatSuggestions('hyper://abc/').map((x) => x.label)).toContain('Help me edit this drive')
  })

  it('retries from the last thing the person said', () => {
    expect(retryHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'half' }])).toEqual([{ role: 'user', content: 'a' }])
    expect(retryHistory([{ role: 'assistant', content: 'x' }])).toBe(null)
    expect(retryHistory([{ role: 'user', content: ' ' }])).toBe(null)
  })
})
