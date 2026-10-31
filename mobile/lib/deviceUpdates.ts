import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Backend } from './useBackend'
import { currentVersion, useBetaUpdates } from './updater'
import { isNewer } from './updateRelease'

// Updating the user's computers from the phone (shared/device-updates.mjs). The phone writes a
// request into the Vault for a computer; the computer downloads the newest release, restarts into
// it, and writes how it went, which this hook reads back. Used by the Devices screen, Settings →
// Updates, and the banner the phone shows right after it updated itself (DesktopUpdateBanner).

export interface DesktopUpdate {
  key: string
  name: string
  version: string | null
  behind: boolean // runs an older Nomad than this phone
  busy: boolean // a request is waiting, or the computer is checking, downloading or restarting
  state: string | null
  message: string // the update status in words, or ''
}

interface DeviceUpdatesList { desktops: DesktopUpdate[]; writable: boolean }

const FAST_MS = 3000 // while a computer is busy updating
const SLOW_MS = 20000

// The user's computers and their updates, polled while `active`. `request(key)` asks one to update.
export function useDesktopUpdates (apps: Backend['apps'], active: boolean) {
  const [desktops, setDesktops] = useState<DesktopUpdate[]>([])
  const [error, setError] = useState('')
  const beta = useBetaUpdates()
  const appsRef = useRef(apps)
  appsRef.current = apps
  const version = currentVersion()

  const refresh = useCallback(async () => {
    const res = await appsRef.current<DeviceUpdatesList>('updates', 'list', { version })
    if (res.ok && res.value) setDesktops(res.value.desktops)
    else if (!res.noVault) setError(res.message || '')
    return res.ok ? res.value?.desktops ?? [] : []
  }, [version])

  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const loop = async () => {
      const list = await refresh().catch(() => [])
      if (stopped) return
      timer = setTimeout(loop, list.some((d) => d.busy) ? FAST_MS : SLOW_MS)
    }
    loop()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [active, refresh])

  const request = useCallback(async (key: string) => {
    setError('')
    const res = await appsRef.current('updates', 'request', { device: key, version, prerelease: beta })
    if (!res.ok) setError(res.message || 'Could not ask that computer to update')
    await refresh().catch(() => {})
    return res.ok
  }, [version, beta, refresh])

  return { desktops, request, refresh, error }
}

// Whether the phone updated itself since it last ran: the version it updated to, or null. Read once
// per launch; dismissJustUpdated() hides it for this run.
const LAST_VERSION_KEY = 'hb:last-run-version'
let justUpdated: string | null = null
const listeners = new Set<() => void>()

AsyncStorage.getItem(LAST_VERSION_KEY)
  .then((prev) => {
    const now = currentVersion()
    if (!now) return
    if (prev && prev !== now && isNewer(now, prev)) {
      justUpdated = now
      for (const l of listeners) l()
    }
    if (prev !== now) AsyncStorage.setItem(LAST_VERSION_KEY, now).catch(() => {})
  })
  .catch(() => {})

export function dismissJustUpdated () {
  justUpdated = null
  for (const l of listeners) l()
}

export function useJustUpdated (): string | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => justUpdated
  )
}
