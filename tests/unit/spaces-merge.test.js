// A paired phone's Space list follows the Vault (mobile/lib/spacesMerge.ts, run by useSpaces.ts).
import { describe, it, expect } from 'vitest'
import { mergeVaultSpaces, pickVaultPersonal, PERSONAL_ID } from '../../mobile/lib/spacesMerge.ts'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const P = 'f'.repeat(64)

const personal = (extra = {}) => ({ id: PERSONAL_ID, name: 'Personal', icon: 'home', color: '#6c6cff', sortOrder: 0, createdAt: 1, source: 'local', ...extra })
const local = (key, name, extra = {}) => ({ id: key, name, icon: 'circle', color: '#e85d4a', rootDriveKey: key, rootDriveUrl: `hyper://${key}/`, ns: 'ns-' + name, sortOrder: 1, createdAt: 1, source: 'local', ...extra })
const rec = (key, name, extra = {}) => ({ rootDriveKey: key, name, icon: 'circle', color: '#3ab36e', createdAt: '2026-01-01T00:00:00Z', ...extra })

describe('pickVaultPersonal', () => {
  it('prefers the personal flag, then originId 1, then the name', () => {
    expect(pickVaultPersonal([rec(A, 'Personal'), rec(B, 'Home', { originId: 1 }), rec(C, 'Mine', { personal: true })]).rootDriveKey).toBe(C)
    expect(pickVaultPersonal([rec(A, 'Personal'), rec(B, 'Home', { originId: 1 })]).rootDriveKey).toBe(B)
    expect(pickVaultPersonal([rec(A, 'Work'), rec(B, 'personal')]).rootDriveKey).toBe(B)
    expect(pickVaultPersonal([rec(A, 'Work')])).toBe(null)
  })

  it('takes the oldest when several Devices published one', () => {
    const list = [rec(A, 'Personal', { originId: 1, createdAt: '2026-05-01T00:00:00Z' }), rec(B, 'Personal', { originId: 1, createdAt: '2026-02-01T00:00:00Z' })]
    expect(pickVaultPersonal(list).rootDriveKey).toBe(B)
  })
})

describe('mergeVaultSpaces', () => {
  it('changes nothing while the index is empty', () => {
    const prev = [personal(), local(A, 'Trips')]
    const res = mergeVaultSpaces(prev, [])
    expect(res.changed).toBe(false)
    expect(res.next).toBe(prev)
    expect(res.toPublish).toEqual([])
  })

  it('gives the phone Personal the Vault Personal Root Drive and keeps its id', () => {
    const res = mergeVaultSpaces([personal()], [rec(P, 'Personal', { originId: 1, icon: 'home', color: '#6c6cff' })])
    expect(res.changed).toBe(true)
    expect(res.next).toHaveLength(1)
    expect(res.next[0]).toMatchObject({ id: PERSONAL_ID, rootDriveKey: P, rootDriveUrl: `hyper://${P}/`, ns: undefined })
  })

  it('replaces a Root Drive the phone made for its Personal before pairing', () => {
    const res = mergeVaultSpaces([personal({ rootDriveKey: A, rootDriveUrl: `hyper://${A}/`, ns: 'mine' })], [rec(P, 'Personal', { personal: true })])
    expect(res.next[0]).toMatchObject({ id: PERSONAL_ID, rootDriveKey: P, ns: undefined })
    expect(res.toPublish).toEqual([])
  })

  it('folds an earlier second copy of the Vault Personal into the phone Personal', () => {
    const dup = { ...local(P, 'Personal'), id: P, ns: undefined, source: 'vault' }
    const res = mergeVaultSpaces([personal(), dup], [rec(P, 'Personal', { originId: 1 })])
    expect(res.next.map((s) => s.id)).toEqual([PERSONAL_ID])
    expect(res.next[0].rootDriveKey).toBe(P)
    expect(res.dropped).toEqual([P])
  })

  it('adds the Vault Spaces the phone lacks and skips movedTo pointers', () => {
    const res = mergeVaultSpaces([personal()], [rec(P, 'Personal', { originId: 1 }), rec(B, 'Work'), { rootDriveKey: C, movedTo: B }])
    expect(res.next.map((s) => [s.id, s.name, s.source])).toEqual([[PERSONAL_ID, 'Personal', 'local'], [B, 'Work', 'vault']])
  })

  it('takes names, icons and colors from the Vault', () => {
    const res = mergeVaultSpaces([personal({ rootDriveKey: P }), local(A, 'Trips')], [rec(P, 'Personal', { originId: 1 }), rec(A, 'Travel', { color: '#2b9fd4' })])
    expect(res.next[1]).toMatchObject({ name: 'Travel', color: '#2b9fd4', ns: 'ns-Trips' })
  })

  it('publishes the Spaces the phone made before pairing, never its Personal', () => {
    const res = mergeVaultSpaces([personal({ rootDriveKey: A, ns: 'mine' }), local(B, 'Trips'), { ...local(C, 'Old'), source: 'vault' }], [rec(B.replace(/b/g, 'd'), 'Work')])
    expect(res.toPublish.map((s) => s.rootDriveKey)).toEqual([B])
  })

  it('repoints a Space whose Root Drive moved', () => {
    const res = mergeVaultSpaces([personal({ rootDriveKey: P }), { ...local(A, 'Trips'), source: 'vault' }], [rec(P, 'Personal', { originId: 1 }), { rootDriveKey: A, movedTo: B }, rec(B, 'Trips')])
    expect(res.next[1]).toMatchObject({ id: A, rootDriveKey: B, rootDriveUrl: `hyper://${B}/` })
    expect(res.next).toHaveLength(2)
  })

  it('is stable once in step', () => {
    const vault = [rec(P, 'Personal', { originId: 1 }), rec(B, 'Work')]
    const first = mergeVaultSpaces([personal()], vault, 5)
    const second = mergeVaultSpaces(first.next, vault, 6)
    expect(second.changed).toBe(false)
    expect(second.next).toBe(first.next)
  })
})
