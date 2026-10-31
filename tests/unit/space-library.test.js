// Shared Spaces (ADR-0029): the rules in shared/space-library.mjs that desktop
// (app/bg/hyper/space-library.js) and the phone (mobile/backend/lib/space-library.mjs) both use.

import { describe, it, expect } from 'vitest'
import * as sl from '../../shared/space-library.mjs'

const id = (c) => c.repeat(32)
const key = (c) => c.repeat(64)
const NOW = '2026-10-30T00:00:00.000Z'
const member = (c, role, extra = {}) => sl.makeMember({ memberId: id(c), name: c.toUpperCase(), role, ...extra }, null, NOW)

describe('roles', () => {
  it('owners and editors edit, only owners manage', () => {
    expect(sl.canEdit('owner')).toBe(true)
    expect(sl.canEdit('editor')).toBe(true)
    expect(sl.canEdit('viewer')).toBe(false)
    expect(sl.canManage('owner')).toBe(true)
    expect(sl.canManage('editor')).toBe(false)
  })

  it('a Space record is shared when it names a Library', () => {
    expect(sl.isShared({ rootDriveKey: key('a') })).toBe(false)
    expect(sl.isShared({ rootDriveKey: key('a'), library: key('b') })).toBe(true)
    expect(sl.isShared({ library: 'nope' })).toBe(false)
  })
})

describe('members', () => {
  it('makes a member and keeps when they were added', () => {
    const m = member('a', 'viewer', { addedBy: id('b') })
    expect(sl.isMember(m)).toBe(true)
    const later = sl.makeMember({ memberId: id('a'), role: 'editor' }, m, '2026-11-01T00:00:00.000Z')
    expect(later).toMatchObject({ name: 'A', role: 'editor', addedBy: id('b'), addedAt: NOW })
  })

  it('refuses a bad id or role', () => {
    expect(() => sl.makeMember({ memberId: 'x', role: 'viewer' })).toThrow()
    expect(() => sl.makeMember({ memberId: id('a'), role: 'boss' })).toThrow()
  })

  it('makes random 32-hex member ids', () => {
    const a = sl.newMemberId()
    expect(sl.isMemberId(a)).toBe(true)
    expect(sl.newMemberId()).not.toBe(a)
  })

  it('sorts owners first, then by name', () => {
    const list = sl.sortMembers([member('c', 'viewer'), member('b', 'owner'), member('a', 'editor'), member('d', 'viewer')])
    expect(list.map((m) => m.name)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('only an owner changes roles, and never leaves the Space without one', () => {
    const list = [member('a', 'owner'), member('b', 'editor'), member('c', 'viewer')]
    expect(sl.roleChangeError(list, { by: id('b'), target: id('c'), role: 'editor' })).toMatch(/owner/)
    expect(sl.roleChangeError(list, { by: id('a'), target: id('c'), role: 'editor' })).toBe(null)
    expect(sl.roleChangeError(list, { by: id('a'), target: id('a'), role: 'viewer' })).toMatch(/needs an owner/)
    expect(sl.roleChangeError(list, { by: id('a'), target: id('a') })).toMatch(/needs an owner/)
    expect(sl.roleChangeError(list, { by: id('a'), target: id('e'), role: 'viewer' })).toMatch(/isn’t in/)
    const two = [...list, member('d', 'owner')]
    expect(sl.roleChangeError(two, { by: id('a'), target: id('a'), role: 'viewer' })).toBe(null)
  })

  it('the last owner can’t leave while others are in the Space', () => {
    const list = [member('a', 'owner'), member('b', 'viewer')]
    expect(sl.leaveError(list, id('a'))).toMatch(/owner/)
    expect(sl.leaveError(list, id('b'))).toBe(null)
    expect(sl.leaveError([member('a', 'owner')], id('a'))).toBe(null)
  })
})

describe('Space Writer grants', () => {
  const DRIVE = key('d')
  const members = [member('a', 'owner'), member('b', 'editor'), member('c', 'viewer')]
  const grant = (memberChar, writerChar, kind, extra = {}) => ({
    ...sl.makeSpaceWriter({ drive: DRIVE, writerKey: key(writerChar), memberId: id(memberChar), kind }, NOW),
    ...extra
  })
  const canWrite = (d) => d === DRIVE

  it('builds the record at its path', () => {
    const g = grant('c', 'e', 'request')
    expect(sl.isSpaceWriter(g)).toBe(true)
    expect(sl.writerGrantPath(DRIVE, key('e'))).toBe(`/.space/writers/${DRIVE}/${key('e')}.json`)
    expect(sl.makeSpaceWriter({ drive: DRIVE, writerKey: key('e'), memberId: id('c'), kind: 'request', note: 'please' }).note).toBe('please')
    expect(() => sl.makeSpaceWriter({ drive: DRIVE, writerKey: key('e'), memberId: id('c'), kind: 'any' })).toThrow()
  })

  it('grants an editor’s key with no prompt, only on a Drive this Device writes', () => {
    const records = [grant('b', 'e', 'editor'), grant('c', 'f', 'request'), grant('b', '1', 'editor', { grantedBy: id('a') })]
    expect(sl.writersToGrant(records, members, canWrite).map((r) => r.writerKey)).toEqual([key('e')])
    expect(sl.writersToGrant(records, members, () => false)).toEqual([])
  })

  it('never grants an editor-kind ask from someone who can only view', () => {
    expect(sl.writersToGrant([grant('c', 'e', 'editor')], members, canWrite)).toEqual([])
  })

  it('lists a viewer’s ask until someone answers it', () => {
    const records = [grant('c', 'f', 'request'), grant('c', '2', 'request', { grantedBy: id('a') }), grant('9', '3', 'request')]
    expect(sl.pendingRequests(records, members).map((r) => r.writerKey)).toEqual([key('f')])
  })

  it('takes keys off for someone removed, and an editor’s once they can only view', () => {
    const records = [
      grant('b', 'e', 'editor', { grantedBy: id('a') }),
      grant('c', 'f', 'request', { grantedBy: id('a') }),
      grant('9', '1', 'editor', { grantedBy: id('a') })
    ]
    expect(sl.writersToRevoke(records, members, canWrite).map((r) => r.writerKey)).toEqual([key('1')])
    const demoted = [member('a', 'owner'), member('b', 'viewer'), member('c', 'viewer')]
    expect(sl.writersToRevoke(records, demoted, canWrite).map((r) => r.writerKey)).toEqual([key('e'), key('1')])
    expect(sl.writersToRevoke(records, [], () => false)).toEqual([])
  })

  it('tells a Device where its ask is', () => {
    const records = [grant('c', 'f', 'request'), grant('b', 'e', 'editor', { grantedBy: id('a') })]
    expect(sl.writerState(records, { drive: DRIVE, writerKey: key('f') })).toMatchObject({ pending: true, granted: false, kind: 'request' })
    expect(sl.writerState(records, { drive: DRIVE, writerKey: key('e') })).toMatchObject({ pending: false, granted: true })
    expect(sl.writerState(records, { drive: DRIVE, writerKey: key('9') })).toBe(null)
  })
})

describe('sharing a Space', () => {
  it('moves the Space’s library into the Space Library', () => {
    const plan = sl.planShare({
      space: { name: 'Team', color: '#e85d4a' },
      owner: { memberId: id('a'), name: 'Ana' },
      items: {
        drives: [{ key: key('1') }, { key: key('2'), tags: ['contact'] }],
        bookmarks: [{ name: 'docs.json', value: { href: 'https://example.com', title: 'Docs' } }, { name: '../x', value: { href: 'x' } }],
        follows: [{ url: `hyper://${key('3')}/` }],
        notes: [{ id: 'n1', body: 'hi' }],
        names: [{ name: 'blog', url: `hyper://${key('3')}/` }, { name: 'Bad Name' }]
      }
    }, NOW)
    const paths = plan.map((p) => p.path)
    expect(paths).toEqual([
      '/index.json',
      `/.space/members/${id('a')}.json`,
      '/drives.json',
      '/bookmarks/docs.json',
      `/reader/follows/${key('3')}.json`,
      '/notes/n1.json',
      '/names/blog.json'
    ])
    expect(plan[0].value).toMatchObject({ type: 'nomad/space', name: 'Team', color: '#e85d4a' })
    expect(plan[1].value).toMatchObject({ role: 'owner', name: 'Ana', addedBy: id('a') })
    expect(plan[2].value.drives).toHaveLength(2)
  })

  it('says what will be shared', () => {
    expect(sl.shareSummary({ drives: [{ key: key('1') }, { key: key('2'), tags: ['contact'] }], notes: [{}, {}] })).toBe('1 drive, 1 contact, 2 notes')
    expect(sl.shareSummary({})).toBe('Nothing yet')
  })

  it('files a follow under its host, like the Vault does', () => {
    expect(sl.followHost(`hyper://${key('3')}/posts/`)).toBe(key('3'))
    expect(sl.followHost('https://example.com/feed.xml')).toMatch(/^web-[0-9a-f]{16}$/) // an RSS feed
    expect(sl.followHost('nomad://reader/')).toBe(null)
  })
})

describe('joining', () => {
  it('sends a member id, a name and a writer key, and reads only a well-formed ask', () => {
    const req = sl.makeJoinRequest({ memberId: id('a'), name: 'Ana', writerKey: key('e') })
    expect(sl.parseJoinRequest(JSON.stringify(req))).toEqual(req)
    expect(sl.parseJoinRequest('{"memberId":"x"}')).toBe(null)
    expect(sl.parseJoinRequest('not json')).toBe(null)
    expect(() => sl.makeJoinRequest({ memberId: id('a'), writerKey: 'nope' })).toThrow()
  })
})
