// The phone's Reader and Notes (mobile/backend/lib/vault-apps.mjs, ADR-0017) against a REAL Vault:
// two Autobase writers (a computer and a phone) on the shared fs-core reducer, replicating in memory.
// The computer side writes records the way desktop's vault.js does (inline JSON at the paths in
// shared/vault-apps.mjs), so this checks that each Device reads what the other one wrote.
//
// Deps load from app/node_modules (the repo root has none — see fs-core.mjs header).

import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { createFsCore, makeMetadata, AUTOBASE_OPTS } from '../../shared/fs-core.mjs'
import * as apps from '../../shared/vault-apps.mjs'
import * as names from '../../shared/names.mjs'
import * as phone from '../../mobile/backend/lib/vault-apps.mjs'

let Autobase, Hyperbee, Corestore, b4a
let open, apply

async function loadAppDep (name) {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'))
  const m = await import(pathToFileURL(rq.resolve(name)).href)
  return m.default ?? m
}

beforeAll(async () => {
  ;[Autobase, Hyperbee, Corestore, b4a] = await Promise.all(
    ['autobase', 'hyperbee', 'corestore', 'b4a'].map(loadAppDep)
  )
  ;({ open, apply } = createFsCore({ Hyperbee, b4a }))
})

const KEY = 'a'.repeat(64)
const FEED = `hyper://${KEY}/`
const SPACE = 'c'.repeat(64) // a Space's Root Drive key: subscriptions are per Space

// What desktop's vault.js putAppRecord appends: an inline JSON control record.
const putJson = (p, o) => ({
  op: 'put',
  path: p,
  metadata: makeMetadata({ mtime: 1, ctime: 1 }),
  value: Buffer.from(JSON.stringify(o)).toString('base64')
})

async function readJson (base, p) {
  await base.update()
  const node = await base.view.get(p)
  return node ? JSON.parse(Buffer.from(node.value.value, 'base64').toString()) : null
}

async function until (check, ms = 10000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

// A computer that owns the Vault, and a phone it added as a writer.
async function withDevices (fn) {
  const dirs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-apps-')))
  const [storeA, storeB] = dirs.map((d) => new Corestore(d))
  await storeA.ready(); await storeB.ready()
  const sa = storeA.replicate(true)
  const sb = storeB.replicate(false)
  sa.pipe(sb).pipe(sa)

  const computer = new Autobase(storeA.namespace('vault'), null, { open, apply, ...AUTOBASE_OPTS })
  await computer.ready()
  const phoneBase = new Autobase(storeB.namespace('vault'), computer.key, { open, apply, ...AUTOBASE_OPTS })
  await phoneBase.ready()
  await computer.append({ addWriter: b4a.toString(phoneBase.local.key, 'hex') })
  await computer.update()
  await until(async () => { await phoneBase.update(); return phoneBase.writable })

  try {
    return await fn({ computer, phone: phoneBase, storeA, storeB })
  } finally {
    await phoneBase.close(); await computer.close()
    sa.destroy(); sb.destroy()
    await storeA.close(); await storeB.close()
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
}

describe('phone Reader and Notes over a shared Vault (ADR-0017)', () => {
  it('reads the subscriptions and notes the computer wrote', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      await computer.append(putJson(apps.followPath(SPACE, FEED), apps.followRecord(FEED)))
      const note = apps.makeNote({ id: apps.newNoteId(), body: 'Groceries\nmilk, eggs' })
      await computer.append(putJson(apps.notePath(note.id), note))
      await computer.update()

      await until(async () => (await phone.readerState(base, SPACE)).follows.length === 1)
      expect((await phone.readerState(base, SPACE)).follows).toEqual([FEED])
      expect((await phone.readerState(base, 'd'.repeat(64))).follows).toEqual([]) // another Space
      await until(async () => (await phone.listNotes(base)).notes.length === 1)
      const [seen] = (await phone.listNotes(base)).notes
      expect(seen).toMatchObject({ id: note.id, body: note.body, title: 'Groceries', snippet: 'milk, eggs' })
    })
  }, 30000)

  it('writes notes and read marks the computer can read', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      await phone.follow(base, SPACE, FEED)
      const saved = await phone.saveNote(base, { body: 'From my phone' })
      await phone.saveRead(base, SPACE, [FEED + 'posts/1/'])

      await until(async () => !!(await readJson(computer, apps.notePath(saved.id))))
      const stored = await readJson(computer, apps.notePath(saved.id))
      expect(apps.isNote(stored)).toBe(true)
      expect(stored).not.toHaveProperty('title') // previews are for the UI, never stored
      expect(await readJson(computer, apps.followPath(SPACE, FEED))).toMatchObject({ url: FEED })
      await until(async () => !!(await readJson(computer, apps.readPath(SPACE))))
      expect((await readJson(computer, apps.readPath(SPACE))).read).toEqual([FEED + 'posts/1/'])
    })
  }, 30000)

  it('updates and deletes a note, and unsubscribes', async () => {
    await withDevices(async ({ phone: base }) => {
      const first = await phone.saveNote(base, { body: 'v1' })
      const second = await phone.saveNote(base, { id: first.id, body: 'v2' })
      expect(second.createdAt).toBe(first.createdAt)
      expect((await phone.listNotes(base)).notes.map((n) => n.body)).toEqual(['v2'])

      await phone.deleteNote(base, first.id)
      expect((await phone.listNotes(base)).notes).toEqual([])

      await phone.follow(base, SPACE, FEED)
      expect((await phone.unfollow(base, SPACE, FEED)).follows).toEqual([])
    })
  }, 30000)

  it('keeps both edits when two devices change the same note at once', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      const first = await phone.saveNote(base, { body: 'Plan\nv1' })
      await until(async () => !!(await readJson(computer, apps.notePath(first.id))))

      // The computer saves its edit, made from v1, the way desktop's saveNote does.
      const theirs = apps.planNoteSave({ id: first.id, body: 'Plan\nfrom the computer', baseUpdatedAt: first.updatedAt }, await readJson(computer, apps.notePath(first.id)), '2099-01-01T00:00:00.000Z')
      await computer.append(putJson(apps.notePath(first.id), theirs.note))
      await computer.update()
      await until(async () => (await phone.listNotes(base)).notes.some((n) => n.body === 'Plan\nfrom the computer'))

      // The phone's edit, also made from v1, arrives later: it becomes a copy, not an overwrite.
      const mine = await phone.saveNote(base, { id: first.id, body: 'Plan\nfrom the phone', baseUpdatedAt: first.updatedAt })
      expect(mine.id).not.toBe(first.id)
      expect(mine).toMatchObject({ conflictOf: first.id, title: 'Plan (conflict copy)' })
      const bodies = (await phone.listNotes(base)).notes.map((n) => n.body).sort()
      expect(bodies).toEqual(['Plan\nfrom the computer', 'Plan (conflict copy)\nfrom the phone'])
    })
  }, 30000)

  it('points links at a note’s new title', async () => {
    await withDevices(async ({ phone: base }) => {
      const seeds = await phone.saveNote(base, { body: '# Seed order' })
      await phone.saveNote(base, { body: 'Plan\nSee [[Seed order]]' })
      const renamed = await phone.saveNote(base, { id: seeds.id, body: '# Seeds 2027', baseUpdatedAt: seeds.updatedAt })
      expect(await phone.renameNoteLinks(base, { id: renamed.id, from: 'Seed order', to: 'Seeds 2027' })).toBe(1)
      const plan = (await phone.listNotes(base)).notes.find((n) => n.title === 'Plan')
      expect(plan.body).toBe('Plan\nSee [[Seeds 2027]]')
    })
  }, 30000)
})

describe('phone Names over a shared Vault (ADR-0018)', () => {
  const DRIVE = `hyper://${'b'.repeat(64)}/`

  it('reads, resolves and shows the names the computer kept', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      await computer.append(putJson(names.namePath('blog'), names.makeNameRecord({ name: 'blog', url: DRIVE, title: 'My blog' })))
      await computer.append(putJson(names.namePath('bg'), names.makeNameRecord({ name: 'bg', url: DRIVE, title: 'My blog', auto: true })))
      await computer.append(putJson(names.namePath('news'), names.makeNameRecord({ name: 'news', url: 'https://news.example.com/', title: 'News' })))
      await computer.update()
      await until(async () => (await phone.listNames(base)).names.length === 3)

      expect((await phone.listNames(base)).names.map((r) => r.name)).toEqual(['bg', 'blog', 'news'])
      expect(await phone.resolveName(base, 'blog')).toBe(DRIVE)
      expect(await phone.resolveName(base, 'Blog/')).toBe(DRIVE)
      expect(await phone.resolveName(base, 'hyper://blog/posts/1/?x=1#top')).toBe(DRIVE + 'posts/1/?x=1#top')
      expect(await phone.resolveName(base, 'news')).toBe('https://news.example.com/')
      expect(await phone.resolveName(base, 'weather')).toBe(null)
      expect(await phone.resolveName(base, DRIVE)).toBe(null)
      expect(await phone.resolveName(base, 'hyper://private/')).toBe(null)

      // The AI's name works when typed, but the address bar shows only the user's own.
      expect(await phone.resolveName(base, 'bg')).toBe(DRIVE)
      expect((await phone.namesForUrl(base, DRIVE + 'posts/1/')).approved).toMatchObject({ name: 'blog' })
      expect((await phone.namesForUrl(base, DRIVE + 'posts/1/')).named).toEqual([]) // names the drive, not this folder
      const info = await phone.namesForUrl(base, DRIVE + 'index.html', 'My blog')
      expect(info.approved).toMatchObject({ name: 'blog' })
      expect(info.named.map((r) => r.name)).toEqual(['bg', 'blog'])
      expect(info.suggested).toBe('my-blog')
      expect((await phone.matchNames(base, 'b')).map((r) => r.name)).toEqual(['bg', 'blog'])
    })
  }, 30000)

  it('names, keeps, renames and removes from the phone, and the computer sees it', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      await computer.append(putJson(names.namePath('bg'), names.makeNameRecord({ name: 'bg', url: DRIVE, title: 'My blog', auto: true })))
      await computer.update()
      await until(async () => (await phone.listNames(base)).names.length === 1)
      expect((await phone.namesForUrl(base, DRIVE)).approved).toBe(null)

      // Saving the AI's name keeps it.
      const kept = await phone.setName(base, { name: 'bg', url: DRIVE + 'index.html', title: 'My blog', previous: 'bg' })
      expect(kept).not.toHaveProperty('auto')
      expect(kept.url).toBe(DRIVE)
      expect((await phone.namesForUrl(base, DRIVE)).approved).toMatchObject({ name: 'bg' })

      await phone.setName(base, { name: 'My Blog', url: DRIVE, title: 'My blog', previous: 'bg' })
      await until(async () => !(await readJson(computer, names.namePath('bg'))))
      expect(await readJson(computer, names.namePath('my-blog'))).toMatchObject({ name: 'my-blog', url: DRIVE })

      await expect(phone.setName(base, { name: 'my-blog', url: 'https://other.example/' })).rejects.toThrow(/already names/)
      await expect(phone.setName(base, { name: 'private', url: DRIVE })).rejects.toThrow(/reserved/)

      await phone.removeName(base, 'my-blog')
      await until(async () => !(await readJson(computer, names.namePath('my-blog'))))
      expect((await phone.listNames(base)).names).toEqual([])
    })
  }, 30000)
})

describe('phone Space-only Notes and Names over a shared Vault (ADR-0029)', () => {
  const DRIVE = `hyper://${'b'.repeat(64)}/`
  const OTHER = 'd'.repeat(64) // another Space

  it('reads the Space’s notes the computer kept, and only in that Space', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      const own = apps.makeNote({ id: apps.newNoteId(), body: 'Mine' })
      const theirs = apps.makeNote({ id: apps.newNoteId(), body: 'Team plan' })
      await computer.append(putJson(apps.notePath(own.id), own))
      await computer.append(putJson(apps.notePath(theirs.id, SPACE), theirs))
      await computer.update()

      await until(async () => (await phone.listNotes(base, SPACE)).notes.length === 2)
      const list = await phone.listNotes(base, SPACE)
      expect(list.space).toBe(SPACE)
      expect(list.notes.find((n) => n.id === theirs.id).space).toBe(SPACE)
      expect(list.notes.find((n) => n.id === own.id).space).toBe(null)
      expect((await phone.listNotes(base, OTHER)).notes.map((n) => n.id)).toEqual([own.id])
      expect((await phone.listNotes(base)).notes.map((n) => n.id)).toEqual([own.id])
    })
  }, 30000)

  it('writes, moves and deletes a Space note the computer can read', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      const saved = await phone.saveNote(base, { body: 'Only here', inSpace: true, space: SPACE })
      expect(saved.space).toBe(SPACE)
      await until(async () => !!(await readJson(computer, apps.notePath(saved.id, SPACE))))
      expect(await readJson(computer, apps.notePath(saved.id))).toBe(null)

      // An edit stays where the note is, even without inSpace.
      const edited = await phone.saveNote(base, { id: saved.id, body: 'Only here, edited', baseUpdatedAt: saved.updatedAt, space: SPACE })
      expect(edited.space).toBe(SPACE)

      const out = await phone.moveNote(base, { id: saved.id, inSpace: false, space: SPACE })
      expect(out.space).toBe(null)
      await until(async () => !!(await readJson(computer, apps.notePath(saved.id))))
      await until(async () => !(await readJson(computer, apps.notePath(saved.id, SPACE))))

      await phone.moveNote(base, { id: saved.id, inSpace: true, space: SPACE })
      await phone.deleteNote(base, saved.id, SPACE)
      await until(async () => !(await readJson(computer, apps.notePath(saved.id, SPACE))))
      expect((await phone.listNotes(base, SPACE)).notes).toEqual([])
      await expect(phone.moveNote(base, { id: saved.id, inSpace: true, space: SPACE })).rejects.toThrow(/No note/)
    })
  }, 30000)

  it('renames links across the user’s and the Space’s notes', async () => {
    await withDevices(async ({ phone: base }) => {
      const seeds = await phone.saveNote(base, { body: '# Seed order' })
      await phone.saveNote(base, { body: 'Team\nSee [[Seed order]]', inSpace: true, space: SPACE })
      const renamed = await phone.saveNote(base, { id: seeds.id, body: '# Seeds 2027', baseUpdatedAt: seeds.updatedAt })
      expect(await phone.renameNoteLinks(base, { id: renamed.id, from: 'Seed order', to: 'Seeds 2027', space: SPACE })).toBe(1)
      const team = (await phone.listNotes(base, SPACE)).notes.find((n) => n.title === 'Team')
      expect(team).toMatchObject({ body: 'Team\nSee [[Seeds 2027]]', space: SPACE })
    })
  }, 30000)

  it('resolves a Space’s names in that Space only, the user’s own first', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      await computer.append(putJson(names.namePath('wiki', SPACE), names.makeNameRecord({ name: 'wiki', url: DRIVE, title: 'Team wiki' })))
      await computer.append(putJson(names.namePath('home', SPACE), names.makeNameRecord({ name: 'home', url: 'https://team.example/', title: 'Team' })))
      await computer.append(putJson(names.namePath('home'), names.makeNameRecord({ name: 'home', url: 'https://me.example/', title: 'Me' })))
      await computer.update()
      await until(async () => (await phone.listNames(base, SPACE)).names.length === 3)

      expect(await phone.resolveName(base, 'wiki', SPACE)).toBe(DRIVE)
      expect(await phone.resolveName(base, 'wiki', OTHER)).toBe(null)
      expect(await phone.resolveName(base, 'wiki')).toBe(null)
      expect(await phone.resolveName(base, 'home', SPACE)).toBe('https://me.example/')

      const listed = (await phone.listNames(base, SPACE)).names
      expect(listed.find((r) => r.name === 'home' && r.space === SPACE).hidden).toBe(true)
      expect((await phone.matchNames(base, 'home', 5, SPACE)).map((r) => r.url)).toEqual(['https://me.example/'])
      expect((await phone.namesForUrl(base, DRIVE, '', SPACE)).approved).toMatchObject({ name: 'wiki', space: SPACE })
      expect((await phone.namesForUrl(base, DRIVE, '', OTHER)).approved).toBe(null)
    })
  }, 30000)

  it('names in the Space, moves a name out, and removes it', async () => {
    await withDevices(async ({ computer, phone: base }) => {
      const rec = await phone.setName(base, { name: 'Wiki', url: DRIVE, title: 'Team wiki', inSpace: true, space: SPACE })
      expect(rec).toMatchObject({ name: 'wiki', space: SPACE })
      await until(async () => !!(await readJson(computer, names.namePath('wiki', SPACE))))
      expect(await readJson(computer, names.namePath('wiki'))).toBe(null)

      // Out to the user's own names, keeping the word.
      await phone.setName(base, { name: 'wiki', url: DRIVE, title: 'Team wiki', previous: 'wiki', previousInSpace: true, space: SPACE })
      await until(async () => !(await readJson(computer, names.namePath('wiki', SPACE))))
      expect(await readJson(computer, names.namePath('wiki'))).toMatchObject({ url: DRIVE })

      await phone.setName(base, { name: 'docs', url: DRIVE, inSpace: true, space: SPACE })
      await phone.removeName(base, 'docs', { inSpace: true, space: SPACE })
      await until(async () => !(await readJson(computer, names.namePath('docs', SPACE))))
      await expect(phone.setName(base, { name: 'x', url: DRIVE, inSpace: true })).rejects.toThrow(/isn’t ready/)
    })
  }, 30000)
})

// A shared Space (ADR-0029): its feeds, Notes and Names are in its Space Library, another Autobase
// the computer owns. The phone opens it by key and reaches it through useSpaceLibraries, as
// backend.mjs does with lib/space-library.mjs libraryFor.
describe('phone in a shared Space (ADR-0029)', () => {
  const SPACE = 'e'.repeat(64)

  async function withLibrary ({ storeA, storeB }, { editor }, fn) {
    const owner = new Autobase(storeA.namespace('library'), null, { open, apply, ...AUTOBASE_OPTS })
    await owner.ready()
    const lib = new Autobase(storeB.namespace('library'), owner.key, { open, apply, ...AUTOBASE_OPTS })
    await lib.ready()
    if (editor) {
      await owner.append({ addWriter: b4a.toString(lib.local.key, 'hex') })
      await owner.update()
      await until(async () => { await lib.update(); return lib.writable })
    }
    phone.useSpaceLibraries(async (space) => (space === SPACE ? { base: lib } : null))
    try {
      return await fn({ owner, lib })
    } finally {
      phone.useSpaceLibraries(null)
      await lib.close(); await owner.close()
    }
  }

  it('reads the Space’s feeds, notes and names from its Library, not the Vault', async () => {
    await withDevices(async (devices) => {
      const base = devices.phone
      await withLibrary(devices, { editor: false }, async ({ owner, lib }) => {
        const note = apps.makeNote({ id: apps.newNoteId(), body: 'Team plan' })
        await owner.append(putJson('/notes/' + note.id + '.json', note))
        await owner.append(putJson('/reader/follows/' + KEY + '.json', apps.followRecord(FEED)))
        await owner.append(putJson('/names/wiki.json', names.makeNameRecord({ name: 'wiki', url: FEED, title: 'Wiki' })))
        await owner.update()
        await until(async () => (await phone.listNotes(base, SPACE)).notes.length === 1)

        const listed = await phone.listNotes(base, SPACE)
        expect(listed).toMatchObject({ shared: true, canWriteSpace: false })
        expect(listed.notes[0]).toMatchObject({ id: note.id, space: SPACE })
        expect(await phone.readerState(base, SPACE)).toMatchObject({ follows: [FEED], shared: true, canFollow: false })
        expect(await phone.resolveName(base, 'wiki', SPACE)).toBe(FEED)

        // Someone who can only view the Space can't change it, but keeps their own notes.
        await expect(phone.saveNote(base, { body: 'mine', inSpace: true, space: SPACE })).rejects.toThrow(/can view this Space/)
        await expect(phone.follow(base, SPACE, `hyper://${'b'.repeat(64)}/`)).rejects.toThrow(/can view this Space/)
        const own = await phone.saveNote(base, { body: 'Just mine', space: SPACE })
        expect(own.space).toBe(null)
        expect(await readJson(lib, '/notes/' + own.id + '.json')).toBe(null)
      })
    })
  }, 30000)

  it('writes a Space note, feed and name into the Library when this person can edit', async () => {
    await withDevices(async (devices) => {
      const base = devices.phone
      await withLibrary(devices, { editor: true }, async ({ owner }) => {
        const note = await phone.saveNote(base, { body: 'Agenda', inSpace: true, space: SPACE })
        expect(note.space).toBe(SPACE)
        await phone.follow(base, SPACE, FEED)
        await phone.setName(base, { name: 'agenda', url: FEED, inSpace: true, space: SPACE })

        await until(async () => !!(await readJson(owner, '/notes/' + note.id + '.json')))
        await until(async () => !!(await readJson(owner, '/names/agenda.json')))
        expect(await readJson(owner, '/reader/follows/' + KEY + '.json')).toMatchObject({ url: FEED })
        // Nothing of the Space's went to the Vault.
        expect(await readJson(devices.computer, apps.notePath(note.id, SPACE))).toBe(null)
        expect(await readJson(devices.computer, apps.followPath(SPACE, FEED))).toBe(null)

        // Moving it out makes it the user's own again, in the Vault.
        await phone.moveNote(base, { id: note.id, inSpace: false, space: SPACE })
        await until(async () => !(await readJson(owner, '/notes/' + note.id + '.json')))
        await until(async () => !!(await readJson(devices.computer, apps.notePath(note.id))))
      })
    })
  }, 30000)
})
