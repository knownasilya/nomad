import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Backend } from './useBackend'
import { mergeVaultSpaces, PERSONAL_ID } from './spacesMerge'

// Spaces — a named user context with its own Root Drive, mirroring nomad desktop
// (app/bg/dbs/spaces.js). One space is active at a time. An unpaired phone keeps its own spaces
// here; once it is paired into a Vault, its spaces are the Vault's (see syncFromVault), shared with
// the user's other devices. See nomad/docs/multi-device-protocol.md.

// Desktop's 8-color palette (app/fg/shell-menus/spaces.js).
export const SPACE_COLORS = [
  '#6c6cff', '#e85d4a', '#e8a025', '#3ab36e',
  '#2b9fd4', '#9b59b6', '#e91e8c', '#607d8b'
]

export interface Space {
  id: string // rootDriveKey once it has one, else a local uid; stable per device
  name: string
  icon: string
  color: string
  rootDriveKey?: string
  rootDriveUrl?: string
  ns?: string // namespace if the root drive was created on this device (writable)
  sortOrder: number
  createdAt: number
  source: 'local' | 'vault'
}

const SPACES_KEY = 'hb:spaces'
const ACTIVE_KEY = 'hb:activeSpace'
export { PERSONAL_ID }

function defaultPersonal (now: number): Space {
  return { id: PERSONAL_ID, name: 'Personal', icon: 'home', color: SPACE_COLORS[0], sortOrder: 0, createdAt: now, source: 'local' }
}

export interface Spaces {
  spaces: Space[]
  activeSpaceId: string
  activeSpace: Space
  vaultKeys: string[] // rootDriveKeys present in the Vault (i.e. shared across devices)
  peopleKeys: string[] // rootDriveKeys of the Spaces shared with other people (ADR-0029)
  ready: boolean
  setActive: (id: string) => void
  createSpace: (opts: { name: string; icon?: string; color?: string }) => Promise<Space | null>
  renameSpace: (id: string, name: string) => void
  setSpaceColor: (id: string, color: string) => void
  removeSpace: (id: string) => void
  removeSpaces: (ids: string[]) => void
  // Called after this device leaves the Vault: clears the shared markers, downgrades the
  // Vault-synced spaces to local, and returns them so the caller can offer to remove them.
  leaveVault: () => Space[]
  ensureRootDrive: (id: string) => Promise<Space | null>
  syncFromVault: () => Promise<void>
}

export function useSpaces (backend: Backend): Spaces {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string>(PERSONAL_ID)
  const [vaultKeys, setVaultKeys] = useState<string[]>([])
  const [peopleKeys, setPeopleKeys] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  const spacesRef = useRef(spaces)
  spacesRef.current = spaces
  const backendRef = useRef(backend)
  backendRef.current = backend
  // Late-bound so syncFromVault (defined first) can call leaveVault (defined later) on remote removal.
  const leaveVaultRef = useRef<() => Space[]>(() => [])

  const persist = useCallback((next: Space[]) => {
    AsyncStorage.setItem(SPACES_KEY, JSON.stringify(next))
  }, [])

  // Once paired, the phone's Spaces are the Vault's (spacesMerge.ts): its Personal is the Vault's
  // Personal, names and colors follow the Vault, and Spaces the phone made before pairing are
  // published into the Vault so the user's other Devices get them.
  const syncFromVault = useCallback(async () => {
    try {
      const v = await backendRef.current.vaultStatus()
      // This device was removed from the Vault on another device: drop the shared markers and
      // downgrade the synced spaces to local-only copies (mirrors a manual unlink, minus the prompt).
      if (v.removed) { leaveVaultRef.current(); return }
      if (!v.hasVault || v.opening || !v.spaces) return
      const keys = v.spaces.filter((sp) => sp.rootDriveKey && !sp.movedTo).map((sp) => sp.rootDriveKey)
      setVaultKeys(keys)
      setPeopleKeys(v.spaces.filter((sp) => sp.rootDriveKey && sp.library && !sp.movedTo && !sp.removed).map((sp) => sp.rootDriveKey))
      if (!keys.length) return
      const vaultSpaces = v.spaces
      const { toPublish, dropped } = mergeVaultSpaces(spacesRef.current, vaultSpaces)
      setSpaces((prev) => {
        const { next, changed } = mergeVaultSpaces(prev, vaultSpaces)
        if (!changed) return prev
        persist(next)
        return next
      })
      if (dropped.length) {
        setActiveSpaceId((cur) => {
          if (!dropped.includes(cur)) return cur
          AsyncStorage.setItem(ACTIVE_KEY, PERSONAL_ID)
          return PERSONAL_ID
        })
      }
      if (!v.writable || !toPublish.length) return
      const published: string[] = []
      for (const sp of toPublish) {
        const res = await backendRef.current.addVaultSpace({ rootDriveKey: sp.rootDriveKey!, name: sp.name, icon: sp.icon, color: sp.color })
        if (!res.message) published.push(sp.rootDriveKey!)
      }
      if (published.length) setVaultKeys((prev) => [...new Set([...prev, ...published])])
    } catch {}
  }, [persist])

  // Load persisted spaces (seed a default Personal on first run), then merge from the Vault.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [rawSpaces, rawActive] = await Promise.all([
        AsyncStorage.getItem(SPACES_KEY),
        AsyncStorage.getItem(ACTIVE_KEY)
      ])
      if (cancelled) return
      let list: Space[] = []
      try { if (rawSpaces) list = JSON.parse(rawSpaces) } catch {}
      if (!list.length) {
        list = [defaultPersonal(Date.now())]
        persist(list)
      }
      setSpaces(list)
      setActiveSpaceId(rawActive && list.some((s) => s.id === rawActive) ? rawActive : list[0].id)
      setReady(true)
      syncFromVault()
    })()
    return () => { cancelled = true }
  }, [persist, syncFromVault])

  // The Vault may finish replicating its space index shortly after launch (or after pairing), so
  // the one-shot merge above can miss spaces. Retry a few times so the dropdown catches up.
  useEffect(() => {
    const timers = [1500, 4000, 9000].map((d) => setTimeout(() => { syncFromVault() }, d))
    return () => timers.forEach(clearTimeout)
  }, [syncFromVault])

  // And again whenever the Vault changes (another Device added a Space, or the phone linked), so a
  // Space made on desktop shows up here without reopening the switcher.
  const onVaultChange = backend.onVaultChange
  useEffect(() => onVaultChange(() => { syncFromVault() }), [onVaultChange, syncFromVault])

  // Keep this phone's own Device record listing its Spaces, so the user's other Devices can show
  // what the phone has. The backend writes only when the list changed, and only once paired.
  const ownSpacesSig = JSON.stringify(spaces.filter((s) => s.rootDriveKey).map((s) => [s.rootDriveKey, s.name]))
  useEffect(() => {
    if (!ready) return
    const own = (JSON.parse(ownSpacesSig) as [string, string][]).map(([rootDriveKey, name]) => ({ rootDriveKey, name }))
    const timer = setTimeout(() => {
      backendRef.current.vaultStatus([], own)
        .then((v) => { if (v.removed) leaveVaultRef.current() })
        .catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [ownSpacesSig, ready])

  const setActive = useCallback((id: string) => {
    setActiveSpaceId(id)
    AsyncStorage.setItem(ACTIVE_KEY, id)
  }, [])

  const createSpace = useCallback(
    async ({ name, icon = 'circle', color = SPACE_COLORS[0] }: { name: string; icon?: string; color?: string }) => {
      // Each space gets its own Collaborative (Autobase) Root Drive so it's multi-device-ready.
      const res = await backendRef.current.create('autobase', name)
      const rootDriveKey = res.ok ? res.key : undefined
      const space: Space = {
        id: rootDriveKey || `local_${Date.now()}`,
        name,
        icon,
        color,
        rootDriveKey,
        rootDriveUrl: rootDriveKey ? `hyper://${rootDriveKey}/` : undefined,
        ns: res.ok ? res.ns : undefined,
        sortOrder: spacesRef.current.length,
        createdAt: Date.now(),
        source: 'local'
      }
      setSpaces((prev) => {
        const next = [...prev, space]
        persist(next)
        return next
      })
      setActive(space.id)
      // Register in the Vault so the space syncs to other devices (backend no-ops if unpaired).
      if (rootDriveKey) {
        backendRef.current.addVaultSpace({ rootDriveKey, name, icon, color }).catch(() => {})
      }
      return space
    },
    [persist, setActive]
  )

  // Lazily give a space (e.g. the default Personal) its own Root Drive the first time it's needed.
  const ensureRootDrive = useCallback(
    async (id: string) => {
      const sp = spacesRef.current.find((s) => s.id === id)
      if (!sp) return null
      if (sp.rootDriveKey) return sp
      const res = await backendRef.current.create('autobase', sp.name)
      if (!res.ok) return sp
      const updated: Space = { ...sp, rootDriveKey: res.key, rootDriveUrl: `hyper://${res.key}/`, ns: res.ns }
      setSpaces((prev) => {
        const next = prev.map((s) => (s.id === id ? updated : s))
        persist(next)
        return next
      })
      return updated
    },
    [persist]
  )

  const renameSpace = useCallback((id: string, name: string) => {
    setSpaces((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name } : s))
      persist(next)
      return next
    })
  }, [persist])

  const setSpaceColor = useCallback((id: string, color: string) => {
    setSpaces((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, color } : s))
      persist(next)
      return next
    })
  }, [persist])

  const removeSpace = useCallback((id: string) => {
    if (id === PERSONAL_ID) return // never delete the default space
    setSpaces((prev) => {
      const next = prev.filter((s) => s.id !== id)
      persist(next)
      return next
    })
    setActiveSpaceId((cur) => {
      if (cur !== id) return cur
      AsyncStorage.setItem(ACTIVE_KEY, PERSONAL_ID)
      return PERSONAL_ID
    })
  }, [persist])

  const removeSpaces = useCallback((ids: string[]) => {
    const drop = new Set(ids.filter((id) => id !== PERSONAL_ID)) // never delete the default space
    if (!drop.size) return
    setSpaces((prev) => {
      const next = prev.filter((s) => !drop.has(s.id))
      persist(next)
      return next
    })
    setActiveSpaceId((cur) => {
      if (!drop.has(cur)) return cur
      AsyncStorage.setItem(ACTIVE_KEY, PERSONAL_ID)
      return PERSONAL_ID
    })
  }, [persist])

  // After this device leaves the Vault (unlink), the spaces it only had via the Vault are no longer
  // shared. Clear the shared markers immediately and downgrade those spaces to local; return them so
  // the caller can ask whether to also remove their local copies from this device.
  const leaveVault = useCallback((): Space[] => {
    setVaultKeys([])
    setPeopleKeys([])
    const fromVault = spacesRef.current.filter((s) => s.source === 'vault')
    if (fromVault.length) {
      setSpaces((prev) => {
        const next = prev.map((s) => (s.source === 'vault' ? { ...s, source: 'local' as const } : s))
        persist(next)
        return next
      })
    }
    return fromVault
  }, [persist])
  leaveVaultRef.current = leaveVault

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) || spaces[0] || defaultPersonal(0)

  return {
    spaces,
    activeSpaceId,
    activeSpace,
    vaultKeys,
    peopleKeys,
    ready,
    setActive,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace,
    removeSpaces,
    leaveVault,
    ensureRootDrive,
    syncFromVault
  }
}
