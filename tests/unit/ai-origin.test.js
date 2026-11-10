// Which AI chat made an item (ADR-0047): the rules in shared/ai-origin.mjs, and that Notes and
// Assets keep the list through their saves (shared/vault-apps.mjs makeNote, shared/assets.mjs makeAsset).

import { describe, it, expect } from 'vitest'
import * as ao from '../../shared/ai-origin.mjs'
import { makeNote, planNoteSave } from '../../shared/vault-apps.mjs'
import { makeAsset } from '../../shared/assets.mjs'

const SPACE = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const DRIVE = 'c'.repeat(64)
const T1 = '2026-11-01T10:00:00.000Z'
const T2 = '2026-11-02T10:00:00.000Z'
const T3 = '2026-11-03T10:00:00.000Z'
const chat = (id, extra = {}) => ({ stage: 'sidebar', chat: id, space: SPACE, ...extra })

describe('cleanOrigin', () => {
  it('keeps the ids it knows and nothing else', () => {
    expect(ao.cleanOrigin({ ...chat('mabc12'), title: 'secret', at: T1, made: true })).toEqual({ stage: 'sidebar', chat: 'mabc12', space: SPACE, at: T1, made: true })
    expect(ao.cleanOrigin({ stage: 'job', job: 'weekly-digest', at: T1 })).toEqual({ stage: 'job', job: 'weekly-digest', at: T1 })
    expect(ao.cleanOrigin({ stage: 'phone' }, T2)).toEqual({ stage: 'phone', at: T2 })
  })

  it('refuses what isn’t one', () => {
    for (const bad of [null, 'x', {}, { stage: 'page' }, { stage: 'sidebar' }, { stage: 'job' }, { stage: 'sidebar', chat: '../x' }]) {
      expect(ao.cleanOrigin(bad)).toBe(null)
    }
    expect(ao.cleanOrigin({ ...chat('m1'), space: 'nope' }).space).toBeUndefined()
  })
})

describe('addOrigin', () => {
  it('puts the newest chat first, once, and keeps at most five', () => {
    let list = ao.addOrigin([], chat('c1'), { made: true, now: T1 })
    list = ao.addOrigin(list, chat('c2'), { now: T2 })
    expect(list.map((o) => o.chat)).toEqual(['c2', 'c1'])
    list = ao.addOrigin(list, chat('c1'), { now: T3 })
    expect(list.map((o) => o.chat)).toEqual(['c1', 'c2'])
    expect(list[0]).toMatchObject({ made: true, at: T3 }) // it made the item, and still did
    for (let i = 3; i < 10; i++) list = ao.addOrigin(list, chat('c' + i), { now: T3 })
    expect(list).toHaveLength(ao.MAX_ORIGINS)
  })

  it('changes nothing when the same chat writes again', () => {
    const list = ao.addOrigin([], chat('c1'), { made: true, now: T1 })
    const again = ao.addOrigin(list, chat('c1'), { now: T2 })
    expect(ao.sameOrigins(again, list)).toBe(true)
  })

  it('tells a Job’s runs apart from a chat', () => {
    let list = ao.addOrigin([], { stage: 'job', job: 'digest' }, { now: T1 })
    list = ao.addOrigin(list, { stage: 'job', job: 'digest', chat: 'w1' }, { now: T2 })
    expect(list.map(ao.originKey)).toEqual(['chat:w1', 'job:digest'])
  })
})

describe('drives', () => {
  it('keeps the paths each chat wrote, newest first', () => {
    let rec = ao.addDriveOrigin(null, DRIVE, chat('c1'), { made: true, now: T1 })
    rec = ao.addDriveOrigin(rec, DRIVE, chat('c1'), { path: '/index.html', now: T2 })
    rec = ao.addDriveOrigin(rec, DRIVE, chat('c1'), { path: '/app.js', now: T2 })
    rec = ao.addDriveOrigin(rec, DRIVE, chat('c2'), { path: '/about.html', now: T3 })
    const list = ao.driveOriginsOf(rec)
    expect(list.map((o) => [o.chat, o.paths, !!o.made])).toEqual([
      ['c2', ['/about.html'], false],
      ['c1', ['/app.js', '/index.html'], true],
    ])
    expect(ao.originsForPath(list, '/about.html').map((o) => o.chat)).toEqual(['c2'])
    expect(ao.originsForPath(list, '/').map((o) => o.chat)).toEqual(['c1'])
    expect(ao.originsForPath(list, '/nothing').map((o) => o.chat)).toEqual(['c2', 'c1'])
    expect(ao.aiMadePath(DRIVE)).toBe(`/.vault/ai-made/${DRIVE}.json`)
    expect(() => ao.aiMadePath('private')).toThrow()
  })
})

describe('resolveOrigins', () => {
  const lookups = {
    chat: async (id, space) => (id === 'live' && space === SPACE ? { title: 'Plan the garden' } : id === 'far' && space === OTHER ? { title: 'Trip' } : null),
    job: async (id) => (id === 'digest' ? { title: 'Weekly digest' } : null),
    currentSpace: SPACE,
    spaceName: (k) => (k === OTHER ? 'Work' : ''),
  }

  it('links a chat that is still there, and says which Space one is in', async () => {
    const [here, far] = await ao.resolveOrigins(
      [chat('live', { at: T2, made: true }), chat('far', { space: OTHER, at: T1 })],
      lookups
    )
    expect(here).toMatchObject({ kind: 'chat', id: 'live', here: true, text: 'Made in the AI chat “Plan the garden”' })
    expect(far).toMatchObject({ kind: 'chat', id: 'far', here: false, space: OTHER, text: 'Updated in the AI chat “Trip”' })
    expect(far.tip).toContain('“Work”')
  })

  it('falls back to the Job, then to plain words', async () => {
    const out = await ao.resolveOrigins(
      [
        { stage: 'job', job: 'digest', chat: 'gone', at: T3, made: true },
        chat('gone2', { at: T2 }),
        { stage: 'job', job: 'deleted', at: T1 },
        { stage: 'phone', at: T1 },
      ],
      lookups
    )
    expect(out.map((o) => [o.kind, o.text])).toEqual([
      ['job', 'Made by the AI Job “Weekly digest”'],
      ['none', 'Updated with AI'],
      ['none', 'Updated with AI'],
      ['none', 'Updated with AI'],
    ])
    expect(out[1].tip).toMatch(/deleted/)
    expect(out[3].tip).toMatch(/phone/)
  })

  it('links a phone panel’s saved chat like a sidebar one', async () => {
    const [saved, gone] = await ao.resolveOrigins(
      [
        { stage: 'phone', chat: 'live', space: SPACE, at: T2, made: true },
        { stage: 'phone', chat: 'nope', space: SPACE, at: T1 },
      ],
      lookups
    )
    expect(saved).toMatchObject({ kind: 'chat', id: 'live', here: true, text: 'Made in the AI chat “Plan the garden”' })
    expect(gone).toMatchObject({ kind: 'none', text: 'Updated with AI' })
    expect(gone.tip).toMatch(/deleted/)
  })
})

describe('Notes and Assets keep it', () => {
  const ai = ao.addOrigin([], chat('c1'), { made: true, now: T1 })

  it('a Note keeps its chats through an edit, a conflict copy doesn’t', () => {
    const note = { ...makeNote({ id: 'n1', body: '# A' }, null, T1), ai }
    const edited = makeNote({ id: 'n1', body: '# A\nmore' }, note, T2)
    expect(edited.ai).toEqual(ai)
    const { note: copy } = planNoteSave({ id: 'n1', body: '# B', baseUpdatedAt: 'old' }, edited, T3)
    expect(copy.conflictOf).toBe('n1')
    expect(copy.ai).toBeUndefined()
  })

  it('an Asset keeps them through a rename, cleaned', () => {
    const rec = makeAsset({ id: 'a12345678-abcd', name: 'x.png', bytes: 3, ai: [...ai, { stage: 'nope' }] }, null, T1)
    expect(rec.ai).toEqual(ai)
    expect(makeAsset({ id: rec.id, name: 'y.png' }, rec, T2).ai).toEqual(ai)
    expect(makeAsset({ id: 'a12345678-abce', name: 'z.png', bytes: 3 }, null, T1).ai).toBeUndefined()
  })
})
