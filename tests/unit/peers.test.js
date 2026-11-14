// Always-on Peers' rules (shared/peers.mjs, ADR-0038): records, what a Peer holds, its status.
import { describe, it, expect } from 'vitest'
import * as pe from '../../shared/peers.mjs'

const K = (c) => c.repeat(64)
const T0 = '2026-11-06T10:00:00.000Z'

describe('Peer records', () => {
  it('keeps an Own Peer that holds everything by default', () => {
    const p = pe.makePeer({ key: K('a'), name: '  NAS  ', addedBy: K('d') }, null, T0)
    expect(p).toMatchObject({ type: pe.PEER_TYPE, key: K('a'), name: 'NAS', kind: 'own', addedBy: K('d'), addedAt: T0 })
    expect(p.hold).toEqual({ vault: true, spaces: 'all', drives: 'all', profiles: true, extra: [] })
    expect(pe.isPeer(p)).toBe(true)
    expect(pe.peerPath(K('a'))).toBe(`/.vault/peers/${K('a')}.json`)
    expect(() => pe.makePeer({ key: 'nope' })).toThrow()
    // An edit keeps who added it and when.
    const renamed = pe.makePeer({ key: K('a'), name: 'Loft NAS', addedBy: K('e') }, p, '2026-11-07T00:00:00.000Z')
    expect(renamed).toMatchObject({ name: 'Loft NAS', addedBy: K('d'), addedAt: T0 })
  })

  it('never lets a Blind Peer hold the Vault or a Space', () => {
    const b = pe.makePeer({ key: K('b'), kind: 'blind', hold: { vault: true, spaces: 'all', drives: 'all' } }, null, T0)
    expect(b.hold).toEqual({ vault: false, spaces: [], drives: 'public', profiles: true, extra: [] })
  })

  it('turns one Space on and off', () => {
    const p = pe.makePeer({ key: K('a') }, null, T0)
    const off = pe.withSpace(p, K('1'), false, [K('1'), K('2')])
    expect(off.spaces).toEqual([K('2')])
    expect(pe.holdsSpace({ ...p, hold: off }, K('1'))).toBe(false)
    expect(pe.withSpace({ ...p, hold: off }, K('1'), true, [K('1'), K('2')]).spaces).toBe('all')
  })
})

describe('Holdings', () => {
  const world = {
    vaultKey: K('f'),
    spaces: [
      { rootDriveKey: K('1'), library: K('5') },
      { rootDriveKey: K('2') },
      { rootDriveKey: K('3'), removed: true },
    ],
    registries: {
      [K('1')]: [{ key: K('6'), type: 'autobase' }, { key: K('7'), public: true }],
      [K('2')]: [{ key: K('8'), type: 'autobase' }],
    },
    personas: [{ profileUrl: `hyper://${K('9')}/` }, { profileUrl: 'nonsense' }],
  }

  it('an Own Peer mirrors the Vault, each Space, its Library and drives, and Profile Drives', () => {
    const p = pe.makePeer({ key: K('a') }, null, T0)
    expect(pe.holdingsOf(p, world)).toEqual([
      { key: K('f'), type: 'autobase', what: 'vault' },
      { key: K('1'), type: 'autobase', what: 'space', space: K('1') },
      { key: K('5'), type: 'autobase', what: 'library', space: K('1') },
      { key: K('6'), type: 'autobase', what: 'drive', space: K('1') },
      { key: K('7'), type: 'hyperdrive', what: 'drive', space: K('1') },
      { key: K('2'), type: 'autobase', what: 'space', space: K('2') },
      { key: K('8'), type: 'autobase', what: 'drive', space: K('2') },
      { key: K('9'), type: 'autobase', what: 'profile' },
    ])
  })

  it('keeps only the Spaces it was given', () => {
    const p = pe.makePeer({ key: K('a'), hold: { spaces: [K('1')] } }, null, T0)
    expect(pe.holdingsOf(p, world).map((h) => h.key)).toEqual([K('f'), K('1'), K('5'), K('6'), K('7'), K('9')])
  })

  it('a Blind Peer gets only public drives and profiles', () => {
    const b = pe.makePeer({ key: K('b'), kind: 'blind' }, null, T0)
    expect(pe.holdingsOf(b, world).map((h) => [h.key, h.what])).toEqual([[K('7'), 'drive'], [K('9'), 'profile']])
  })
})

describe('single drives kept online (extra)', () => {
  const world = {
    vaultKey: K('f'),
    spaces: [{ rootDriveKey: K('1') }, { rootDriveKey: K('2') }],
    registries: {
      [K('1')]: [{ key: K('6'), type: 'autobase' }],
      [K('2')]: [{ key: K('8'), type: 'autobase' }, { key: K('7'), public: true }],
    },
  }

  it('keeps a drive given on its own, in a Space it doesn\'t keep', () => {
    let p = pe.makePeer({ key: K('a'), hold: { spaces: [K('1')] } }, null, T0)
    expect(pe.keepsDrive(p, { key: K('6') }, K('1'))).toBe('space')
    expect(pe.keepsDrive(p, { key: K('8') }, K('2'))).toBe(false)
    p = { ...p, hold: pe.withDrive(p, K('8'), true) }
    expect(p.hold.extra).toEqual([K('8')])
    expect(pe.keepsDrive(p, { key: K('8') }, K('2'))).toBe('drive')
    expect(pe.holdingsOf(p, world).map((h) => h.key)).toContain(K('8'))
    p = { ...p, hold: pe.withDrive(p, K('8'), false) }
    expect(pe.keepsDrive(p, { key: K('8') }, K('2'))).toBe(false)
    expect(() => pe.withDrive(p, 'nope', true)).toThrow()
  })

  it('a Blind Peer keeps a single drive only when it is public', () => {
    const b = pe.makePeer({ key: K('b'), kind: 'blind', hold: { drives: [], extra: [K('8'), K('7')] } }, null, T0)
    expect(pe.keepsDrive(b, { key: K('8') }, K('2'))).toBe(false)
    expect(pe.keepsDrive(b, { key: K('7'), public: true }, K('2'))).toBe('drive')
    expect(pe.holdingsOf(b, world).map((h) => h.key)).toEqual([K('7')])
  })
})

describe('Peer status', () => {
  it('reads what a Peer sends, and drops junk', () => {
    const st = pe.makeStatus({ version: '1.44.0', startedAt: Date.parse(T0), holding: 8, synced: 7, bytes: 3.2 * 1024 ** 3, now: Date.parse(T0) + 90000 })
    expect(st).toMatchObject({ kind: 'peer', uptime: 90, holding: 8, synced: 7 })
    expect(pe.readStatus(JSON.parse(JSON.stringify(st)))).toEqual(st)
    expect(pe.readStatus({ kind: 'desktop' })).toBe(null)
    expect(pe.readStatus({ kind: 'peer', holding: -3, bytes: 'lots' })).toMatchObject({ holding: 0, bytes: 0 })
    expect(pe.describePeer({}, st, { online: true })).toBe('Online · 7 of 8 synced · 3.2 GB')
    expect(pe.describePeer({}, { ...st, synced: 8 }, { online: true })).toBe('Online · 8 kept in sync · 3.2 GB')
    expect(pe.describePeer({}, null)).toBe('Offline')
  })
})
