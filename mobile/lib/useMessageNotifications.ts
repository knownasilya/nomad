import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, PermissionsAndroid, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import type { Backend, MessageNotifications } from './useBackend'

// Notifications for Messages to the user's Personas (ADR-0036 §9). Whichever Device received a
// Message saved it in the Vault; this phone shows one notification for each new unread Message from
// a contact (never for a Message Request), and a tap opens that Conversation.
//
// Like Job notifications (useJobNotifications), there's no push server: the phone learns about a
// Message while its backend runs (the app open, and BACKGROUND_GRACE_MS after it leaves the screen)
// or the next time it starts. The mark of what's been shown is the newest receivedAt
// (shared/inbox.mjs pendingNotifications). The first time, nothing older shows.
//
// The setting is this phone's own: Settings → Notifications → Messages (MESSAGE_NOTIFY_KEY).

const SINCE_KEY = 'nomad:message-notifications:since'
export const MESSAGE_NOTIFY_KEY = 'nomad:message-notifications:on'
const CHANNEL = 'messages'
const MAX_AT_ONCE = 3

export interface OpenConversation { personaId?: string; with?: string }

export function useMessageNotifications (backend: Pick<Backend, 'apps' | 'onVaultChange'>, onOpen: (c: OpenConversation) => void) {
  const appsRef = useRef(backend.apps)
  appsRef.current = backend.apps
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const mine = (data: any) => data?.kind === 'message'
    const open = (data: any) => onOpenRef.current({ personaId: data?.personaId, with: data?.from })
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data
      if (mine(data)) open(data)
    })
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        if (!res || !mine(res.notification.request.content.data)) return
        open(res.notification.request.content.data)
        Notifications.clearLastNotificationResponseAsync().catch(() => {})
      })
      .catch(() => {})
    return () => sub.remove()
  }, [])

  useEffect(() => {
    let busy = false
    let again = false
    let asked = false
    const check = async () => {
      if (busy) { again = true; return }
      busy = true
      try {
        do {
          again = false
          await checkOnce()
        } while (again)
      } finally {
        busy = false
      }
    }
    const checkOnce = async () => {
      const stored = await AsyncStorage.getItem(SINCE_KEY).catch(() => null)
      const res = await appsRef.current<MessageNotifications>('messages', 'notifications', { since: stored })
      if (!res.ok || !res.value) return
      const { notify, since } = res.value
      const on = (await AsyncStorage.getItem(MESSAGE_NOTIFY_KEY).catch(() => null)) !== '0'
      if (on && notify.length) {
        if (!asked) {
          asked = true
          await ensurePermission()
        }
        if (notify.length > MAX_AT_ONCE) {
          await show(`${notify.length} new messages`, [...new Set(notify.map((n) => n.title))].join(', '), { kind: 'message' })
        } else {
          for (const n of notify) await show(n.title, n.body, { kind: 'message', personaId: n.personaId, from: n.from })
        }
      }
      if (since !== stored) await AsyncStorage.setItem(SINCE_KEY, since).catch(() => {})
    }
    check()
    const stop = backend.onVaultChange(check)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check() })
    return () => { stop(); sub.remove() }
  }, [backend.onVaultChange])
}

async function show (title: string, body: string, data: Record<string, string>) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      trigger: null
    })
  } catch (err) {
    console.warn('[messages] could not show a notification', err)
  }
}

// Asked the first time a Message arrives: the moment the user expects it.
async function ensurePermission () {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Messages',
        description: 'Messages to your Personas',
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

// Settings → Notifications: this phone's switch for Message notifications (on unless turned off).
export function useMessageNotifySetting (): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true)
  useEffect(() => {
    AsyncStorage.getItem(MESSAGE_NOTIFY_KEY).then((v) => setOn(v !== '0')).catch(() => {})
  }, [])
  const set = useCallback((next: boolean) => {
    setOn(next)
    AsyncStorage.setItem(MESSAGE_NOTIFY_KEY, next ? '1' : '0').catch(() => {})
  }, [])
  return [on, set]
}
