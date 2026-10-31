import { describe, it, expect } from 'vitest'
import { pickToolDrive, remoteStage, sameDrive, stageRules, tabSnapshot } from '../../app/bg/ai/stages.mjs'
import { buildCatalog } from '../../app/bg/ai/search-execute.mjs'
import { openTabGroup, openTabUrl } from '../../app/bg/ai/open-tab.mjs'

const BLOG = 'hyper://' + 'b'.repeat(64) + '/'
const NOTES = 'hyper://' + 'c'.repeat(64) + '/'
const resolve = (drive) => (drive === 'blog' ? BLOG : drive)

describe('stages', () => {
  it('gives only the user\'s own AI personal data, and only the sidebar and the phone a tab', () => {
    expect(stageRules('page')).toEqual({ personal: false, tab: false })
    expect(stageRules('sidebar')).toEqual({ personal: true, tab: true })
    expect(stageRules('phone')).toEqual({ personal: true, tab: true })
    expect(stageRules('outside')).toEqual({ personal: true, tab: false })
    expect(stageRules('job')).toEqual({ personal: true, tab: false })
    expect(stageRules('anything else')).toEqual({ personal: false, tab: false })
  })

  it('lets a remote Device be the phone panel or a page, nothing else', () => {
    expect(remoteStage(true)).toBe('phone')
    expect(remoteStage(false)).toBe('page')
    expect(remoteStage('true')).toBe('page')
    expect(remoteStage(undefined)).toBe('page')
  })

  it('keeps only the url and title of a tab from the Bridge', () => {
    expect(tabSnapshot({ url: BLOG, title: 'Blog', sender: {}, drive: NOTES })).toEqual({ url: BLOG, title: 'Blog' })
    expect(tabSnapshot({ url: BLOG })).toEqual({ url: BLOG, title: '' })
    expect(tabSnapshot({ url: 42 })).toBe(null)
    expect(tabSnapshot(null)).toBe(null)
    expect(tabSnapshot({ url: 'x'.repeat(5000) }).url.length).toBe(2048)
  })
})

describe('pickToolDrive', () => {
  it('keeps a page on its own Drive', () => {
    expect(pickToolDrive({ own: BLOG, resolve })).toEqual({ url: BLOG, current: true })
    expect(pickToolDrive({ own: BLOG, write: true, resolve })).toEqual({ url: BLOG, current: true })
    expect(() => pickToolDrive({ drive: 'blog', own: BLOG, resolve })).toThrow(/Only the current Drive/)
    expect(() => pickToolDrive({ own: 'https://example.com/', resolve })).toThrow(/Not browsing a Drive/)
  })

  it('reads from the drive in the user\'s tab, and makes a write name its drive', () => {
    const tab = { personal: true, hasTab: true, own: BLOG, resolve }
    expect(pickToolDrive(tab)).toEqual({ url: BLOG, current: true })
    expect(() => pickToolDrive({ ...tab, write: true })).toThrow(/Name the drive to write to/)
    expect(pickToolDrive({ ...tab, write: true, drive: 'blog' })).toEqual({ url: BLOG, current: true })
    expect(pickToolDrive({ ...tab, write: true, drive: NOTES })).toEqual({ url: NOTES, current: false })
  })

  it('says so when the user\'s tab has no drive', () => {
    expect(() => pickToolDrive({ personal: true, hasTab: true, own: null, resolve })).toThrow(/No drive is open/)
    expect(pickToolDrive({ personal: true, hasTab: true, own: null, drive: 'blog', resolve }).url).toBe(BLOG)
  })

  it('compares drives by key, not by path', () => {
    expect(sameDrive(BLOG + 'posts/a.md', BLOG)).toBe(true)
    expect(sameDrive(BLOG, NOTES)).toBe(false)
    expect(sameDrive(null, BLOG)).toBe(false)
  })
})

describe('the catalog of a turn with a tab', () => {
  const caps = (opts) => buildCatalog({ allowWrite: true, ...opts }).capabilities
  const find = (list, name) => list.find((c) => c.name === name)

  it('offers currentTab only to the user\'s own AI with a tab', () => {
    expect(find(caps({ personal: true, tab: true }), 'currentTab')).toBeTruthy()
    expect(find(caps({ personal: true }), 'currentTab')).toBeUndefined()
    expect(find(caps({ tab: true }), 'currentTab')).toBeUndefined()
  })

  it('makes writeDriveFile take a drive, and keeps it optional for reads', () => {
    const list = caps({ personal: true, tab: true })
    expect(find(list, 'writeDriveFile').inputSchema.required).toEqual(['path', 'content', 'drive'])
    expect(find(list, 'readDriveFile').inputSchema.required).toEqual(['path'])
    expect(find(list, 'readDriveFile').inputSchema.properties.drive).toBeTruthy()
    // Without a tab (the loopback MCP), a write may still use the current Drive.
    expect(find(caps({ personal: true }), 'writeDriveFile').inputSchema.required).toEqual(['path', 'content'])
  })
})

describe('openTab', () => {
  const caps = (opts) => buildCatalog({ allowWrite: true, ...opts }).capabilities
  const find = (list, name) => list.find((c) => c.name === name)

  it("is offered to the user's own AI on this Device only", () => {
    expect(find(caps({ personal: true, tab: true }), 'openTab')).toBeTruthy()
    expect(find(caps({ personal: true }), 'openTab')).toBeTruthy()
    expect(find(caps({ personal: true, tab: true, remote: true }), 'openTab')).toBeUndefined()
    expect(find(caps({}), 'openTab')).toBeUndefined()
  })

  it('opens web, hyper:// and nomad:// URLs, and a blank tab without one', () => {
    expect(openTabUrl()).toBe(null)
    expect(openTabUrl('')).toBe(null)
    expect(openTabUrl('https://example.com')).toBe('https://example.com/')
    expect(openTabUrl('hyper://blog/')).toBe('hyper://blog/')
    expect(openTabUrl(BLOG + 'posts/')).toBe(BLOG + 'posts/')
    expect(openTabUrl('nomad://reader/')).toBe('nomad://reader/')
  })

  it('refuses other schemes and things that are not URLs', () => {
    expect(() => openTabUrl('javascript:alert(1)')).toThrow(/only/)
    expect(() => openTabUrl('file:///etc/passwd')).toThrow(/only/)
    expect(() => openTabUrl('data:text/html,hi')).toThrow(/only/)
    expect(() => openTabUrl('example.com')).toThrow(/Not a URL/)
    expect(() => openTabUrl(42)).toThrow(/string/)
  })

  it('takes a tab group by name', () => {
    expect(openTabGroup(undefined)).toBe(null)
    expect(openTabGroup('  ')).toBe(null)
    expect(openTabGroup(' Research ')).toBe('Research')
    expect(() => openTabGroup(3)).toThrow(/string/)
    expect(() => openTabGroup('x'.repeat(61))).toThrow(/60/)
  })
})
