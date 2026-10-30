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
  it('offers Blank first, then Document', () => {
    expect(DRIVE_TEMPLATES.map((t) => t.id)).toEqual(['blank', 'document'])
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
