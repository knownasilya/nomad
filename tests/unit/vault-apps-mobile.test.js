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
    return await fn({ computer, phone: phoneBase })
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
