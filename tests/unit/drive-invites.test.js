// Invite links to edit one drive (shared/drive-invites.mjs).

import { describe, it, expect } from 'vitest'
import {
  INVITES_PREFIX,
  invitePath,
  inviteIdOf,
  makeInvite,
  inviteUsable,
  inviteUrl,
  parseInviteUrl,
  openInvites,
  editorRows,
  isInviteToken,
} from '../../shared/drive-invites.mjs'

const KEY = 'a'.repeat(64)
const TOKEN = '0123456789abcdef0123456789abcdef'
const ID = 'b'.repeat(64)
const NOW = Date.parse('2026-11-14T00:00:00Z')
const DAY = 86400000

describe('drive invites', () => {
  it('makes and reads a link', () => {
    const link = inviteUrl(`hyper://${KEY.toUpperCase()}/some/page`, TOKEN)
    expect(link).toBe(`hyper://${KEY}/?invite=${TOKEN}`)
    expect(parseInviteUrl(link)).toEqual({ key: KEY, token: TOKEN })
    expect(parseInviteUrl(`hyper://${KEY}/posts/x/?a=1&invite=${TOKEN}`)).toEqual({ key: KEY, token: TOKEN })
  })

  it('refuses anything that is not a link to a drive with a token', () => {
    expect(parseInviteUrl(`hyper://${KEY}/`)).toBe(null)
    expect(parseInviteUrl(`hyper://${KEY}/?invite=nope`)).toBe(null)
    expect(parseInviteUrl(`https://example.com/?invite=${TOKEN}`)).toBe(null)
    expect(parseInviteUrl(`hyper://notes/?invite=${TOKEN}`)).toBe(null)
    expect(parseInviteUrl('not a url')).toBe(null)
    expect(() => inviteUrl('https://x', TOKEN)).toThrow()
    expect(() => inviteUrl(`hyper://${KEY}/`, 'short')).toThrow()
    expect(isInviteToken(TOKEN)).toBe(true)
    expect(isInviteToken(TOKEN.toUpperCase())).toBe(false)
  })

  it('keeps each link as a record named by the token hash', () => {
    expect(invitePath(ID)).toBe(`${INVITES_PREFIX}${ID}.json`)
    expect(inviteIdOf(invitePath(ID))).toBe(ID)
    expect(inviteIdOf(`/elsewhere/${ID}.json`)).toBe(null)
    expect(() => invitePath('../x')).toThrow()
  })

  it('a link works once for 7 days by default, up to 30', () => {
    const rec = makeInvite({ now: NOW, by: KEY, note: '  for   Sam ' })
    expect(rec).toEqual({
      type: 'nomad/drive-invite',
      createdAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 7 * DAY).toISOString(),
      multiUse: false,
      by: KEY,
      note: 'for Sam',
    })
    expect(inviteUsable(rec, NOW + 6 * DAY)).toBe(true)
    expect(inviteUsable(rec, NOW + 7 * DAY)).toBe(false)
    expect(makeInvite({ now: NOW, days: 90 }).expiresAt).toBe(new Date(NOW + 30 * DAY).toISOString())
    expect(makeInvite({ now: NOW, by: 'nope' }).by).toBeUndefined()
    expect(inviteUsable({ ...rec, type: 'other' }, NOW)).toBe(false)
    expect(inviteUsable(null, NOW)).toBe(false)
  })

  it('lists the open links, newest first', () => {
    const older = makeInvite({ now: NOW - DAY })
    const newer = makeInvite({ now: NOW, multiUse: true })
    const gone = makeInvite({ now: NOW - 10 * DAY })
    const out = openInvites(
      [
        { path: invitePath('1'.repeat(64)), value: older },
        { path: invitePath('2'.repeat(64)), value: newer },
        { path: invitePath('3'.repeat(64)), value: gone },
        { path: '/other.json', value: newer },
      ],
      NOW
    )
    expect(out.map((i) => i.id)).toEqual(['2'.repeat(64), '1'.repeat(64)])
    expect(out[0].multiUse).toBe(true)
  })

  it('lists editors with this device first, then the user\'s devices by name', () => {
    const me = '1'.repeat(64)
    const laptop = '2'.repeat(64)
    const friend = '3'.repeat(64)
    const rows = editorRows(
      [
        { writerKey: friend, profileUrl: 'hyper://' + 'f'.repeat(64) + '/' },
        { writerKey: laptop },
        { writerKey: me },
        { writerKey: me },
        { writerKey: 'bad' },
      ],
      { self: me, grants: [{ writerKey: laptop, name: 'Laptop' }] }
    )
    expect(rows).toEqual([
      { writerKey: me, profileUrl: null, you: true },
      { writerKey: laptop, profileUrl: null, you: false, device: 'Laptop' },
      { writerKey: friend, profileUrl: 'hyper://' + 'f'.repeat(64) + '/', you: false },
    ])
  })
})
