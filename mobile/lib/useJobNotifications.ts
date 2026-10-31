import { useEffect, useRef } from 'react'
import { AppState, PermissionsAndroid, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import type { Backend, JobNotifications } from './useBackend'

// Notifications from the user's AI Jobs (ADR-0030). A desktop runs a Job and saves its run in the
// Vault with the notification it should send; this phone shows one for each new run that has one,
// and a tap opens that run in the Jobs screen.
//
// There's no push server: the phone learns about a run when its Vault syncs. That is while the app
// is open, or in the background for as long as Android keeps it running; otherwise the notification
// shows the next time the app starts or comes back.
//
// The mark of what's been shown is the newest run's finishedAt (shared/jobs.mjs pendingNotifications),
// a time from the desktop's clock, never the phone's. The first time, nothing older shows.

const SINCE_KEY = 'nomad:job-notifications:since'
const CHANNEL = 'jobs'
const MAX_AT_ONCE = 4 // more than this since the last look become one "N Job results" notification

// Show a Job's notification while the app is open, too: it's what the user asked for.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
})

export interface OpenRun { jobId?: string; runId?: string }

export function useJobNotifications (backend: Pick<Backend, 'apps' | 'onVaultChange'>, onOpen: (run: OpenRun) => void) {
  const appsRef = useRef(backend.apps)
  appsRef.current = backend.apps
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  // A tap on a notification, now or the one that launched the app.
  useEffect(() => {
    const open = (data: any) => onOpenRef.current({ jobId: data?.jobId, runId: data?.runId })
    const sub = Notifications.addNotificationResponseReceivedListener((res) => open(res.notification.request.content.data))
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        if (!res) return
        open(res.notification.request.content.data)
        // Or it opens the same run again on the next launch.
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
      const res = await appsRef.current<JobNotifications>('jobs', 'notifications', { since: stored })
      if (!res.ok || !res.value) return
      const { notify, since, wants } = res.value
      if (wants && !asked) {
        asked = true
        await ensurePermission()
      }
      if (notify.length > MAX_AT_ONCE) {
        await show(`${notify.length} Job results`, notify.map((n) => n.title).join(', '), {})
      } else {
        for (const n of notify) await show(n.title, n.body, { jobId: n.jobId, runId: n.id })
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
    console.warn('[jobs] could not show a notification', err)
  }
}

// Asked once a Job that notifies reaches this phone: the moment the user expects it.
async function ensurePermission () {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'AI Jobs',
        description: 'Results of the AI Jobs your computer runs',
        importance: Notifications.AndroidImportance.DEFAULT
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
