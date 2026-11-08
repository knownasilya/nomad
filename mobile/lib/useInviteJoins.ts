import { useEffect, useRef } from 'react'
import { AppState, PermissionsAndroid, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import type { Backend } from './useBackend'

// A notification when someone asks to join a shared Space this phone can let them into (ADR-0040),
// as desktop's "X asks to join Home". The asks are held by the backend while it runs
// (backend/lib/invites.mjs `pending`), so this looks while the app is open and when it comes back.
// A tap opens the Space's invite sheet, where the user approves or denies them.

const CHANNEL = 'spaces'
const POLL_MS = 5000

export interface PendingJoin { key: string; library: string; memberId: string; name: string; role: string; spaceName: string; space: string | null }

export function useInviteJoins (backend: Pick<Backend, 'apps'>, onOpen: (space: string, spaceName: string) => void) {
  const appsRef = useRef(backend.apps)
  appsRef.current = backend.apps
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const mine = (data: any) => data?.kind === 'join' && typeof data.space === 'string'
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data
      if (data && mine(data)) onOpenRef.current(data.space as string, String(data.spaceName || ''))
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const seen = new Set<string>()
    let asked = false
    let stopped = false
    const check = async () => {
      if (stopped || AppState.currentState !== 'active') return
      const res = await appsRef.current<PendingJoin[]>('invites', 'pending').catch(() => null)
      if (!res?.ok || !Array.isArray(res.value)) return
      for (const j of res.value) {
        if (seen.has(j.key) || !j.space) continue
        seen.add(j.key)
        if (!asked) {
          asked = true
          await ensurePermission()
        }
        await show(`${j.name || 'Someone'} asks to join ${j.spaceName || 'your Space'}`, j.role === 'editor' ? 'As someone who can edit. Tap to answer.' : 'As someone who can view. Tap to answer.', { kind: 'join', space: j.space, spaceName: j.spaceName || '' })
      }
    }
    check()
    const timer = setInterval(check, POLL_MS)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check() })
    return () => { stopped = true; clearInterval(timer); sub.remove() }
  }, [])
}

async function show (title: string, body: string, data: Record<string, string>) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      trigger: null
    })
  } catch (err) {
    console.warn('[invites] could not show a notification', err)
  }
}

async function ensurePermission () {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Shared Spaces',
        description: 'People asking to join your shared Spaces',
        importance: Notifications.AndroidImportance.HIGH
      })
      if (Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
      }
      return
    }
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') await Notifications.requestPermissionsAsync()
  } catch {}
}
