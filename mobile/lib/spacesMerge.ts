// Pure rules for how a paired phone's Space list follows the Vault (useSpaces.ts runs them). Once the
// phone is in a Vault it has no Spaces of its own: it shows the Vault's, and the Spaces it made before
// pairing are published into the Vault so the user's other Devices get them too.

export interface MergeSpace {
  id: string
  name: string
  icon: string
  color: string
  rootDriveKey?: string
  rootDriveUrl?: string
  ns?: string
  sortOrder: number
  createdAt: number
  source: 'local' | 'vault'
}

export interface MergeVaultSpace {
  rootDriveKey: string
  name?: string
  icon?: string
  color?: string
  movedTo?: string
  personal?: boolean // set by desktop on its default Personal Space
  originId?: number | string // desktop's local Space id (1 is its Personal), a hint only
  createdAt?: string
}

export const PERSONAL_ID = 'personal'
const FALLBACK_COLOR = '#6c6cff'

const time = (s?: string) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : Infinity
}

// The Vault's Personal Space: the one desktop marks `personal` (or, from a desktop before that
// flag, originId 1), else one named Personal. The oldest wins when several Devices published one.
export function pickVaultPersonal<T extends MergeVaultSpace> (live: T[]): T | null {
  const oldest = (list: T[]) => list.slice().sort((a, b) => time(a.createdAt) - time(b.createdAt))[0] || null
  return oldest(live.filter((vs) => vs.personal === true)) ||
    oldest(live.filter((vs) => Number(vs.originId) === 1)) ||
    oldest(live.filter((vs) => (vs.name || '').trim().toLowerCase() === 'personal'))
}

export interface MergeResult<S extends MergeSpace> {
  next: S[]
  changed: boolean
  // The phone's own Spaces that the Vault doesn't list yet. The caller publishes them when the
  // Vault is writable here.
  toPublish: S[]
  // Ids that left the list (a second copy of the Vault's Personal). The caller moves off them.
  dropped: string[]
}

// Bring `prev` (the phone's list) in line with the Vault's Space index. `vaultSpaces` is every
// record, `movedTo` pointers included. An empty index (not replicated yet) changes nothing.
export function mergeVaultSpaces<S extends MergeSpace> (prev: S[], vaultSpaces: MergeVaultSpace[], now = Date.now()): MergeResult<S> {
  const live = vaultSpaces.filter((vs) => vs.rootDriveKey && !vs.movedTo)
  if (!live.length) return { next: prev, changed: false, toPublish: [], dropped: [] }
  const byKey = new Map(live.map((vs) => [vs.rootDriveKey, vs]))
  // A Space whose Root Drive got a new key on another device: old key -> new key.
  const moves = new Map(vaultSpaces.filter((vs) => vs.movedTo).map((vs) => [vs.rootDriveKey, vs.movedTo!]))
  let changed = false
  const dropped: string[] = []

  // Repoint local copies in place. The id stays, so the Space keeps its tabs and history.
  let list = prev.map((s) => {
    const to = s.rootDriveKey && moves.get(s.rootDriveKey)
    if (!to || prev.some((o) => o.rootDriveKey === to)) return s
    changed = true
    return { ...s, rootDriveKey: to, rootDriveUrl: `hyper://${to}/`, ns: undefined }
  })

  // The phone's Personal is the Vault's Personal. It keeps its id (and so its tabs and history);
  // an earlier sync's second copy of the Vault's Personal goes.
  const vp = pickVaultPersonal(live)
  if (vp) {
    const personal = list.find((s) => s.id === PERSONAL_ID)
    if (personal && personal.rootDriveKey !== vp.rootDriveKey) {
      list = list.flatMap((s) => {
        if (s.id === PERSONAL_ID) return [{ ...s, rootDriveKey: vp.rootDriveKey, rootDriveUrl: `hyper://${vp.rootDriveKey}/`, ns: undefined }]
        if (s.rootDriveKey === vp.rootDriveKey) { dropped.push(s.id); return [] }
        return [s]
      })
      changed = true
    }
  }

  // Names, icons and colors follow the Vault.
  list = list.map((s) => {
    const vs = s.rootDriveKey ? byKey.get(s.rootDriveKey) : undefined
    if (!vs) return s
    const name = vs.name || s.name
    const icon = vs.icon || s.icon
    const color = vs.color || s.color
    if (name === s.name && icon === s.icon && color === s.color) return s
    changed = true
    return { ...s, name, icon, color }
  })

  // The Vault's Spaces this phone doesn't have yet.
  const have = new Set(list.map((s) => s.rootDriveKey).filter(Boolean) as string[])
  live.forEach((vs, i) => {
    if (have.has(vs.rootDriveKey)) return
    have.add(vs.rootDriveKey)
    list.push({
      id: vs.rootDriveKey,
      name: vs.name || 'Space',
      icon: vs.icon || 'circle',
      color: vs.color || FALLBACK_COLOR,
      rootDriveKey: vs.rootDriveKey,
      rootDriveUrl: `hyper://${vs.rootDriveKey}/`,
      sortOrder: prev.length + i,
      createdAt: now,
      source: 'vault'
    } as S)
    changed = true
  })

  // Spaces made on this phone before it paired (or while the Vault was still opening) go into the
  // Vault. Never the phone's Personal: that one is the Vault's.
  const toPublish = list.filter((s) => s.id !== PERSONAL_ID && s.source === 'local' && s.rootDriveKey && !byKey.has(s.rootDriveKey))

  return { next: changed ? list : prev, changed, toPublish, dropped }
}
