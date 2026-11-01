// Links to the user's things in an AI answer (shared/item-links.mjs, and the phone's copy in
// mobile/lib/itemLinks.ts): which links open, and the URL each opens as.

import { describe, it, expect } from 'vitest'
import * as shared from '../../shared/item-links.mjs'
import * as phone from '../../mobile/lib/itemLinks.ts'
import { findNotes, noteForModel, modForModel, jobForModel } from '../../app/bg/ai/vault-tools.mjs'

const CASES = [
  'nomad://notes/0abc123de-x1y2z3',
  'nomad://notes/0abc123de-x1y2z3?write',
  'nomad://notes/',
  'nomad://notes/Not An Id',
  'nomad://notes/a/b',
  'nomad://notes/%2e%2e',
  'nomad://library/jobs?id=job-abc123-xyz',
  'nomad://library/jobs?other=1&id=job-abc123-xyz',
  'nomad://library/jobs?id=../../x',
  'nomad://library/jobs',
  'nomad://library/mods?id=0abc-def&new=1',
  'nomad://library/secrets',
  'nomad://library/../settings',
  'nomad://ai/memory',
  'nomad://ai/',
  'nomad://ai/skills/x',
  'nomad://reader/',
  'nomad://reader/?subscribe=https://evil.example/feed',
  'nomad://reader/feed',
  'nomad://settings',
  'nomad://library/drives?delete=1',
  'hyper://abc123/notes/todo.md',
  'hyper://blog/posts/2026-01-01-hi/',
  'https://example.com/a?b=1&c=2#:~:text=hello%20world',
  'http://example.com',
  'https://user:pw@example.com/',
  'javascript:alert(1)',
  'data:text/html,<b>x</b>',
  'file:///etc/passwd',
  'mailto:a@b.c',
  'not a link',
  '',
]

describe('parseItemLink', () => {
  it('opens a Note, a Job or a Mod as the URL Nomad builds', () => {
    expect(shared.parseItemLink('nomad://notes/0abc123de-x1y2z3?write')).toEqual({
      kind: 'note',
      id: '0abc123de-x1y2z3',
      url: 'nomad://notes/0abc123de-x1y2z3',
      place: 'Notes',
    })
    expect(shared.parseItemLink('nomad://library/jobs?other=1&id=job-abc123-xyz')).toEqual({
      kind: 'job',
      id: 'job-abc123-xyz',
      url: 'nomad://library/jobs?id=job-abc123-xyz',
      place: 'My Library → Jobs',
    })
    expect(shared.parseItemLink('nomad://library/mods?id=0abc-def&new=1')).toMatchObject({
      kind: 'mod',
      url: 'nomad://library/mods?id=0abc-def',
    })
    expect(shared.parseItemLink('nomad://ai/memory')).toMatchObject({ kind: 'ai', url: 'nomad://ai/memory' })
  })

  it('drops a query that would change something when the page loads', () => {
    expect(shared.parseItemLink('nomad://reader/?subscribe=https://evil.example/feed')).toEqual({
      kind: 'reader',
      url: 'nomad://reader/',
      place: 'Reader',
    })
    expect(shared.parseItemLink('nomad://library/drives?delete=1').url).toBe('nomad://library/drives')
  })

  it('opens web and hyper:// pages as written', () => {
    const url = 'https://example.com/a?b=1&c=2#:~:text=hello%20world'
    expect(shared.parseItemLink(url)).toEqual({ kind: 'page', url })
    expect(shared.parseItemLink('hyper://blog/posts/2026-01-01-hi/')).toEqual({
      kind: 'page',
      url: 'hyper://blog/posts/2026-01-01-hi/',
    })
  })

  it('opens nothing else', () => {
    for (const href of [
      'nomad://settings',
      'nomad://notes/Not An Id',
      'nomad://notes/%2e%2e',
      'nomad://library/../settings',
      'nomad://library/jobs?id=../../x',
      'nomad://reader/feed',
      'https://user:pw@example.com/',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
      'mailto:a@b.c',
      'not a link',
      '',
    ]) {
      const link = shared.parseItemLink(href)
      // A Job link with a bad id still opens My Library → Jobs, without the id.
      if (href.includes('jobs?id=')) expect(link).toEqual({ kind: 'job', url: 'nomad://library/jobs', place: 'My Library → Jobs' })
      else expect(link, href).toBe(null)
    }
  })

  it('reads the same on the phone', () => {
    for (const href of CASES) expect(phone.parseItemLink(href), href).toEqual(shared.parseItemLink(href))
    expect([phone.noteLink('x'), phone.jobLink('x'), phone.modLink('x'), phone.MEMORY_LINK, phone.READER_LINK]).toEqual([
      shared.noteLink('x'),
      shared.jobLink('x'),
      shared.modLink('x'),
      shared.MEMORY_LINK,
      shared.READER_LINK,
    ])
  })
})

describe('the AI tools give links', () => {
  const note = { id: '0abc123de-x1y2z3', body: '# Groceries\n\nmilk', createdAt: '2026-01-01', updatedAt: '2026-01-02' }

  it('on Notes, Mods and Jobs', () => {
    expect(findNotes([note])[0].url).toBe('nomad://notes/0abc123de-x1y2z3')
    expect(noteForModel(note).url).toBe('nomad://notes/0abc123de-x1y2z3')
    const mod = { id: '0abc-def', name: 'Calm', site: 'example.com', enabled: true, presets: [], hide: [], css: '', js: '' }
    expect(modForModel(mod).url).toBe('nomad://library/mods?id=0abc-def')
    expect(jobForModel({ id: 'job-abc123-xyz', title: 'Digest', prompt: 'p', schedule: null }).url).toBe(
      'nomad://library/jobs?id=job-abc123-xyz'
    )
  })

  it('that open as they are', () => {
    for (const url of ['nomad://notes/0abc123de-x1y2z3', 'nomad://library/mods?id=0abc-def', 'nomad://library/jobs?id=job-abc123-xyz']) {
      expect(shared.parseItemLink(url).url).toBe(url)
    }
  })
})
