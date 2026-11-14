// Built-in drive templates (app/lib/drive-templates.ts, app/bg/hyper/drive-templates.js): the
// manifest a template sets and the files it copies into a new Drive.

import { describe, it, expect, beforeAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import {
  DRIVE_TEMPLATES,
  getTemplate,
  templateManifest,
  templateFiles,
  setTemplatesDir,
} from '../../app/bg/hyper/drive-templates.js'

const DIR = path.join(process.cwd(), 'app/drive-templates')

beforeAll(() => setTemplatesDir(DIR))

describe('drive templates', () => {
  it('offers Blank first, then Document, then the gallery apps', () => {
    expect(DRIVE_TEMPLATES.map((t) => t.id)).toEqual(['blank', 'document', 'blog', 'website', 'photo-album', 'forum'])
    expect(getTemplate().id).toBe('blank')
    expect(getTemplate(undefined).id).toBe('blank')
    expect(() => getTemplate('nope')).toThrow(/Unknown drive template/)
  })

  it('every listed file exists, and none of a template\'s src/ ships', () => {
    for (const t of DRIVE_TEMPLATES) {
      for (const f of t.files || []) {
        expect(fs.existsSync(path.join(DIR, t.id, f)), `${t.id}${f}`).toBe(true)
        expect(f.includes('/src/')).toBe(false)
      }
    }
  })

  it('no template ships an index.json: the manifest comes from the list', () => {
    for (const t of DRIVE_TEMPLATES) expect(t.files || []).not.toContain('/index.json')
  })

  it('every template\'s files use absolute paths, so its shell works on any route', () => {
    for (const t of DRIVE_TEMPLATES) {
      for (const f of (t.files || []).filter((x) => x.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(DIR, t.id, f), 'utf8')
        for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
          if (/^[a-z]+:/i.test(ref)) continue
          expect(ref.startsWith('/'), `${t.id}${f}: ${ref}`).toBe(true)
        }
      }
    }
  })

  it('Blog is a feed Reader can follow, and the caller\'s fields win over the template\'s', () => {
    const tpl = getTemplate('blog')
    expect(templateManifest(tpl, { title: 'Notes from home' })).toEqual({
      title: 'Notes from home',
      type: 'walled.garden/feed',
      fallback: '/index.html',
      collaborative: true,
      itemsPath: '/posts/',
      itemType: 'walled.garden/post',
      language: 'en',
    })
    expect(templateManifest(tpl, { language: 'fr' }).language).toBe('fr')
  })

  it('the phone\'s copy (mobile/lib/driveTemplates.json) matches: run npm run build:phone-templates', async () => {
    const phone = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'mobile/lib/driveTemplates.json'), 'utf8'))
    const { PHONE_SKIP } = await import('../../scripts/lib/phone-templates.mjs')
    const want = DRIVE_TEMPLATES.filter((t) => !PHONE_SKIP.includes(t.id))
    expect(phone.map((t) => t.id)).toEqual(want.map((t) => t.id))
    for (const t of want) {
      const p = phone.find((x) => x.id === t.id)
      expect(p.type, t.id).toBe(t.type)
      expect(p.fallback, t.id).toBe(t.fallback)
      expect(!!p.collaborative, t.id).toBe(!!t.collaborative)
      expect(p.manifest, t.id).toEqual(t.manifest)
      expect(p.files.map((f) => f.path)).toEqual(t.files || [])
      for (const f of p.files) {
        expect(f.text, `${t.id}${f.path}`).toBe(fs.readFileSync(path.join(DIR, t.id, f.path), 'utf8'))
      }
    }
  })

  it('Blank leaves the manifest alone and copies nothing', async () => {
    const tpl = getTemplate('blank')
    expect(templateManifest(tpl, { title: 'x' })).toEqual({ title: 'x' })
    expect(await templateFiles(tpl, { title: 'x' })).toEqual([])
  })

  it('Document sets its type and fallback and accepts writers unless told otherwise', () => {
    const tpl = getTemplate('document')
    expect(templateManifest(tpl, { title: 'Plan', type: 'other' })).toEqual({
      title: 'Plan',
      type: 'walled.garden/document',
      fallback: '/index.html',
      collaborative: true,
    })
    expect(templateManifest(tpl, { collaborative: false }).collaborative).toBe(false)
  })

  it('Document copies its app and starts an empty Live Doc at /doc', async () => {
    const files = await templateFiles(getTemplate('document'), { title: 'Plan', now: new Date(0) })
    expect(files.map((f) => f.path)).toEqual(['/index.html', '/app.js', '/doc/doc.json'])
    expect(String(files[0].data)).toContain('<script src="/app.js">')
    const doc = JSON.parse(String(files[2].data))
    expect(doc).toMatchObject({
      type: 'walled.garden/live-doc',
      format: 'yjs/1',
      schema: 'text',
      title: 'Plan',
      createdAt: '1970-01-01T00:00:00.000Z',
    })
    expect(doc.id).toMatch(/^[0-9a-f]{16}$/)
    expect(files[2].inline).toBe(true)
  })
})
