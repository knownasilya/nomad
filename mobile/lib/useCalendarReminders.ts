import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, PermissionsAndroid, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import type { Backend } from './useBackend'

// Calendar reminders on the phone (shared/calendar.mjs, ADR-0042 amendment). An event with a
// reminder reminds everyone who sees it, so a shared Space's remind the whole household. There's
// no push server: the phone asks its backend for the next week's reminders, across every Space
// (calendar/reminders), and schedules each as a local notification at its time, so it shows even
// when Nomad isn't running. It does it again when the Vault changes and when the app comes back.
// A tap opens the calendar on the event's day.
//
// The setting is this phone's own: Settings → Notifications → Calendar reminders.

export const CALENDAR_REMIND_KEY = 'nomad:calendar-reminders:on'
const CHANNEL = 'calendar'
const PREFIX = 'cal:'
const AHEAD_DAYS = 7
const MAX_SCHEDULED = 60

interface Reminder { key: string; at: string; start: string; title: string; body: string; spaceName?: string }

const pad = (n: number) => String(n).padStart(2, '0')
const wall = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
// A wall time ('YYYY-MM-DDTHH:MM') on this phone's clock.
const dateOf = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16))

export function useCalendarReminders (backend: Pick<Backend, 'apps' | 'onVaultChange'>, onOpen: (day: string) => void) {
  const appsRef = useRef(backend.apps)
  appsRef.current = backend.apps
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const mine = (data: any) => data?.kind === 'calendar' && typeof data.day === 'string'
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data
      if (data && mine(data)) onOpenRef.current(data.day as string)
    })
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        const data = res?.notification.request.content.data
        if (!data || !mine(data)) return
        onOpenRef.current(data.day as string)
        Notifications.clearLastNotificationResponseAsync().catch(() => {})
      })
      .catch(() => {})
    return () => sub.remove()
  }, [])

  useEffect(() => {
    let last = ''
    let asked = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const sync = async () => {
      const on = (await AsyncStorage.getItem(CALENDAR_REMIND_KEY).catch(() => null)) !== '0'
      const now = new Date()
      const until = new Date(now.getTime() + AHEAD_DAYS * 86400e3)
      let due: Reminder[] = []
      if (on) {
        const res = await appsRef.current<Reminder[]>('calendar', 'reminders', { from: wall(now), to: wall(until) }).catch(() => null)
        if (!res?.ok || !Array.isArray(res.value)) return // not linked yet, or the Vault isn't open: keep what's scheduled
        due = res.value.filter((r) => dateOf(r.at).getTime() > now.getTime() + 5000).slice(0, MAX_SCHEDULED)
      }
      const signature = JSON.stringify(due.map((r) => [r.key, r.at, r.title, r.body, r.spaceName || '']))
      if (signature === last) return
      if (due.length && !asked) {
        asked = true
        await ensurePermission()
      }
      const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
      for (const n of scheduled) {
        if (n.identifier.startsWith(PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})
      }
      for (const r of due) {
        try {
          await Notifications.scheduleNotificationAsync({
            identifier: PREFIX + r.key,
            content: {
              title: r.title,
              body: r.spaceName ? `${r.body} · ${r.spaceName}` : r.body,
              data: { kind: 'calendar', day: r.start.slice(0, 10) },
              ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {})
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: dateOf(r.at), ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) }
          })
        } catch (err) {
          console.warn('[calendar] could not schedule a reminder', err)
        }
      }
      last = signature
    }
    const soon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { sync().catch(() => {}) }, 1500)
    }
    soon()
    const stop = backend.onVaultChange(soon)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') soon() })
    // The week ahead moves on: look again every few hours while open.
    const every = setInterval(soon, 3 * 3600e3)
    const onSetting = () => { last = '~'; soon() }
    settingListeners.add(onSetting)
    return () => { stop(); sub.remove(); clearInterval(every); if (timer) clearTimeout(timer); settingListeners.delete(onSetting) }
  }, [backend.onVaultChange])
}

const settingListeners = new Set<() => void>()

async function ensurePermission () {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Calendar reminders',
        description: 'Reminders for events on your calendar',
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

// Settings → Notifications: this phone's switch for calendar reminders (on unless turned off).
export function useCalendarRemindSetting (): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true)
  useEffect(() => {
    AsyncStorage.getItem(CALENDAR_REMIND_KEY).then((v) => setOn(v !== '0')).catch(() => {})
  }, [])
  const set = useCallback((next: boolean) => {
    setOn(next)
    AsyncStorage.setItem(CALENDAR_REMIND_KEY, next ? '1' : '0').then(() => settingListeners.forEach((fn) => fn())).catch(() => {})
  }, [])
  return [on, set]
}
