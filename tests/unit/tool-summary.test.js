import { describe, it, expect } from 'vitest'
import { toolSummary } from '../../app/bg/ai/tool-summary.mjs'

describe('toolSummary', () => {
  it('says what search looks for', () => {
    expect(toolSummary('search', { query: 'write a file' })).toBe('Searching for “write a file”')
    expect(toolSummary('search', { query: 'recipes', domain: 'drive' })).toBe('Searching public drives for “recipes”')
    expect(toolSummary('search', { domain: 'name' })).toBe('Listing your names')
    expect(toolSummary('search', {})).toBe('Looking at what the assistant can do')
  })

  it('says what search opens', () => {
    expect(toolSummary('search', { entity: 'capability:writeDriveFile' })).toBe('Looking up how to write a file')
    expect(toolSummary('search', { entity: 'guide:nomad.fs' })).toBe('Reading the guide to nomad.fs')
    expect(toolSummary('search', { entity: ['capability:readNote', 'capability:writeNote'] })).toBe(
      'Looking up readNote and writeNote'
    )
  })

  it('says what an execute module does, from the capabilities it calls', () => {
    const code = `import { nomad } from 'nomad:runtime'
export default async function main(params) {
  const a = await nomad.readDriveFile({ path: params.path })
  const b = await nomad.readDriveFile({ path: '/b' })
  await nomad.writeDriveFile({ path: '/c', content: a + b })
  return nomad.page.add_item({ name: 'x' })
}`
    expect(toolSummary('execute', { code })).toBe(
      "Running code to read a file, write a file and use this page's add_item tool"
    )
    expect(toolSummary('execute', { code: 'export default () => 1' })).toBe('Running code')
  })

  it('reads a CLI tool name the same as the built-in one', () => {
    expect(toolSummary('mcp__nomad__search', { query: 'notes' })).toBe('Searching for “notes”')
    expect(toolSummary('mcp__nomad__execute', { code: 'nomad.listNotes()' })).toBe('Running code to look through your Notes')
  })

  it('names the file, the drive and the Note', () => {
    expect(toolSummary('readDriveFile', { path: '/index.html' })).toBe('Reading /index.html')
    expect(toolSummary('writeDriveFile', { path: '/a.md', drive: 'blog' })).toBe('Writing /a.md in blog')
    expect(toolSummary('listDriveFiles', { drive: 'hyper://' + 'a'.repeat(64) + '/' })).toBe(
      'Listing the files in / in hyper://aaaaaa…'
    )
    expect(toolSummary('writeNote', { body: '# Groceries\n- milk' })).toBe('Saving the Note “Groceries”')
    expect(toolSummary('markPostsRead', { urls: ['a', 'b'] })).toBe('Marking 2 posts as read')
    expect(toolSummary('highlightText', { text: 'the smallest planet' })).toBe('Highlighting “the smallest planet”')
    expect(toolSummary('highlightText', { text: 'x', note: 'Why it matters' })).toBe('Highlighting “x” and adding a Note')
    expect(toolSummary('page_add_item', {})).toBe("Using this page's add_item tool")
  })

  it('shortens a long query', () => {
    const label = toolSummary('listNotes', { query: 'x'.repeat(100) })
    expect(label.length).toBeLessThan(90)
    expect(label.endsWith('…”')).toBe(true)
  })
})
