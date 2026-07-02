import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Backend } from './useBackend'

// Spaces — a named user context with its own Root Drive, mirroring nomad desktop
// (app/bg/dbs/spaces.js). One space is active at a time. Spaces are stored locally; when this
// device is paired into a Vault, the Vault's spaces are merged in (keyed by rootDriveKey) so
// spaces created on other devices appear here. See nomad/docs/multi-device-protocol.md.

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
export const PERSONAL_ID = 'personal'

function defaultPersonal (now: number): Space {
  return { id: PERSONAL_ID, name: 'Personal', icon: 'home', color: SPACE_COLORS[0], sortOrder: 0, createdAt: now, source: 'local' }
}

export interface Spaces {
  spaces: Space[]
  activeSpaceId: string
  activeSpace: Space
  vaultKeys: string[] // rootDriveKeys present in the Vault (i.e. shared across devices)
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

  // Merge the Vault's spaces (if paired) into the local list, by rootDriveKey.
  const syncFromVault = useCallback(async () => {
    try {
      const v = await backendRef.current.vaultStatus()
      // This device was removed from the Vault on another device: drop the shared markers and
      // downgrade the synced spaces to local-only copies (mirrors a manual unlink, minus the prompt).
      if (v.removed) { leaveVaultRef.current(); return }
      const keys = v.hasVault && v.spaces ? v.spaces.map((sp) => sp.rootDriveKey).filter(Boolean) : []
      setVaultKeys(keys)
      if (!keys.length) return
      setSpaces((prev) => {
        const have = new Set(prev.map((s) => s.rootDriveKey).filter(Boolean) as string[])
        const additions: Space[] = []
        v.spaces!.forEach((vs, i) => {
          if (!vs.rootDriveKey || have.has(vs.rootDriveKey)) return
          additions.push({
            id: vs.rootDriveKey,
            name: vs.name || 'Space',
            icon: vs.icon || 'circle',
            color: vs.color || SPACE_COLORS[0],
            rootDriveKey: vs.rootDriveKey,
            rootDriveUrl: `hyper://${vs.rootDriveKey}/`,
            sortOrder: prev.length + i,
            createdAt: Date.now(),
            source: 'vault'
          })
        })
        if (!additions.length) return prev
        const next = [...prev, ...additions]
        persist(next)
        return next
      })
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
