import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Open tabs on the user's other Devices (shared/open-tabs.mjs). The phone publishes its own tabs,
// per Space, through the backend (RPC_APPS 'tabs'), and the tab grid lists the other Devices'.

export interface SyncedTab { url: string; title: string; pinned?: boolean; active?: boolean }
export interface SyncedSpace { rootDriveKey: string; name: string; tabs: SyncedTab[] }
export interface DeviceTabs {
  deviceKey: string
  name: string
  platform: string
  connected: boolean
  updatedAt: string | null
  spaces: SyncedSpace[]
}
export interface DeviceTabsList { devices: DeviceTabs[]; linked: boolean; currentSpace: string | null }

const SHARE_KEY = 'hb:shareOpenTabs'

// Whether this phone shares its open tabs (Settings). On unless the user turned it off.
export function useShareOpenTabs (): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true)
  useEffect(() => {
    AsyncStorage.getItem(SHARE_KEY).then((v) => { if (v === '0') setOn(false) }).catch(() => {})
  }, [])
  const set = useCallback((next: boolean) => {
    setOn(next)
    AsyncStorage.setItem(SHARE_KEY, next ? '1' : '0').catch(() => {})
  }, [])
  return [on, set]
}

// "5 min ago", for when a Device last changed its tabs.
export function ago (iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s)) return ''
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
