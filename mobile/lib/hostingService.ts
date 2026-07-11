import { NativeModules, PermissionsAndroid, Platform } from 'react-native'

// Android foreground service that keeps the Bare backend (and its swarm announces for hosted
// drives) alive while the app is backgrounded — Android otherwise kills the process within
// minutes and seeding stops. No-op on iOS: there is no equivalent long-running primitive there,
// so hosting on iOS is only active while the app is open (the backend re-announces on launch).
//
// Call syncHostingService(count) whenever the hosted-drive count may have changed: it starts /
// retitles the service when count > 0 and stops it at 0.

const native: { start(text: string): void; stop(): void } | undefined =
  Platform.OS === 'android' ? NativeModules.HostingService : undefined

let askedForNotifications = false

export async function syncHostingService (count: number): Promise<void> {
  if (!native) return
  if (count > 0) {
    // Android 13+ gates the notification (not the service) behind a runtime permission. Ask once,
    // best-effort — if denied, the service still runs; the user just sees no notification.
    if (!askedForNotifications && Number(Platform.Version) >= 33) {
      askedForNotifications = true
      try { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) } catch {}
    }
    native.start(count === 1 ? 'Hosting 1 drive for peers' : `Hosting ${count} drives for peers`)
  } else {
    native.stop()
  }
}
