// Renaming, recoloring and deleting a Space (shared/space-records.mjs): the rules desktop's Spaces
// menu and the phone's Space switcher share, and the tombstone a deleted Space leaves in the Vault.
import { describe, it, expect } from 'vitest'
import {
  SPACE_COLORS,
  SPACE_NAME_MAX,
  cleanSpaceName,
  spaceEditError,
  editSpaceRecord,
  deletedSpace,
  isDeletedSpace,
  isLiveSpace,
  removeKind,
} from '../../shared/space-records.mjs'
import { SPACE_COLORS as PHONE_COLORS, SPACE_NAME_MAX as PHONE_MAX, cleanSpaceName as phoneClean } from '../../mobile/lib/spaceRules.ts'

const K = 'a'.repeat(64)

describe('space names and colors', () => {
  it('tidies a name and caps its length', () => {
    expect(cleanSpaceName('  Work   stuff ')).toBe('Work stuff')
    expect(cleanSpaceName('x'.repeat(100))).toHaveLength(SPACE_NAME_MAX)
    expect(cleanSpaceName('   ')).toBe('')
    expect(cleanSpaceName(undefined)).toBe('')
  })

  it('refuses an empty name or a color that is not a hex color', () => {
    expect(spaceEditError({ name: ' ' })).toMatch(/name/)
    expect(spaceEditError({ color: 'red' })).toMatch(/color/)
    expect(spaceEditError({ name: 'Home', color: '#3AB36E' })).toBe(null)
    expect(spaceEditError({})).toBe(null)
  })

  it('applies only the fields given and keeps the rest of the record', () => {
    const rec = { rootDriveKey: K, name: 'Work', icon: 'circle', color: '#6c6cff', library: 'b'.repeat(64) }
    expect(editSpaceRecord(rec, { name: ' Jobs ' })).toEqual({ ...rec, name: 'Jobs' })
    expect(editSpaceRecord(rec, { color: '#E85D4A' })).toEqual({ ...rec, color: '#e85d4a' })
  })

  it('keeps the phone in step with desktop', () => {
    expect(PHONE_COLORS).toEqual(SPACE_COLORS)
    expect(PHONE_MAX).toBe(SPACE_NAME_MAX)
    for (const name of ['  Work   stuff ', 'x'.repeat(100), '', 'Café  ☕ ']) expect(phoneClean(name)).toBe(cleanSpaceName(name))
  })
})

describe('deleting a Space', () => {
  it('leaves a tombstone with nothing but its key', () => {
    const t = deletedSpace(K, new Date('2026-11-06T12:00:00Z'))
    expect(t).toEqual({ rootDriveKey: K, deleted: true, deletedAt: '2026-11-06T12:00:00.000Z' })
    expect(isDeletedSpace(t)).toBe(true)
    expect(isLiveSpace(t)).toBe(false)
  })

  it('tells live Spaces from move pointers and tombstones', () => {
    expect(isLiveSpace({ rootDriveKey: K, name: 'Work' })).toBe(true)
    expect(isLiveSpace({ rootDriveKey: K, movedTo: 'b'.repeat(64) })).toBe(false)
    expect(isLiveSpace(null)).toBe(false)
    expect(isDeletedSpace({ rootDriveKey: K, deleted: 'yes' })).toBe(false)
  })

  it('leaves a shared Space and deletes the rest, never the Personal one', () => {
    expect(removeKind({ rootDriveKey: K, library: 'b'.repeat(64), role: 'viewer' })).toBe('leave')
    expect(removeKind({ rootDriveKey: K })).toBe('delete')
    expect(removeKind(null)).toBe('delete')
    expect(removeKind({ rootDriveKey: K }, { personal: true })).toBe(null)
  })
})
