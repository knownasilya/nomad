import { NativeModules, PermissionsAndroid, Platform } from 'react-native'

// Android foreground service that keeps the app PROCESS alive while the app is backgrounded —
// Android otherwise freezes or kills it within minutes, which stops seeding and drops an in-flight
// AI turn's swarm connection to the Provider. No-op on iOS: there is no equivalent long-running
// primitive there, so hosting and backgrounded AI turns are only reliable while the app is open.
//
// The process surviving is necessary but NOT sufficient: react-native-bare-kit separately suspends
// the Bare worklet on every background transition, so whoever needs work to continue must also
// take a keep-awake hold in useBackend (AI turns do; hosting does not yet, so seeding still stops
// when the app is backgrounded even though this notification stays up).
//
// Two independent reasons keep it running, and the service stays up while EITHER holds:
//   • hosted drives  — syncHostingService(count), whenever the hosted-drive count may have changed
//   • an AI turn     — holdForAiTurn(), released by the function it returns
// Keeping both here (rather than one caller each racing start/stop) is what stops a finished AI
// turn from tearing down the notification a hosting session still needs.

const native: { start(text: string): void; stop(): void } | undefined =
  Platform.OS === 'android' ? NativeModules.HostingService : undefined

let askedForNotifications = false
let hostedDrives = 0
let aiTurns = 0

export async function syncHostingService (count: number): Promise<void> {
  hostedDrives = count
  return apply()
}

// Hold the service up for one AI turn. Returns the release — call it exactly once, on done/error/
// cancel alike, or the notification outlives the turn.
export function holdForAiTurn (): () => void {
  aiTurns++
  void apply()
  let released = false
  return () => {
    if (released) return
    released = true
    aiTurns = Math.max(0, aiTurns - 1)
    void apply()
  }
}

async function apply (): Promise<void> {
  if (!native) return
  if (hostedDrives <= 0 && aiTurns <= 0) {
    native.stop()
    return
  }
  // Android 13+ gates the notification (not the service) behind a runtime permission. Ask once,
  // best-effort — if denied, the service still runs; the user just sees no notification. Only ask
  // for hosting: that is a deliberate, long-lived choice, whereas popping a system dialog over a
  // chat the moment someone sends their first AI message would be an ambush for a notification
  // that is gone again in seconds.
  if (!askedForNotifications && hostedDrives > 0 && Number(Platform.Version) >= 33) {
    askedForNotifications = true
    try { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) } catch {}
  }
  native.start(label())
}

function label (): string {
  const hosting = hostedDrives === 1 ? 'hosting 1 drive' : `hosting ${hostedDrives} drives`
  if (aiTurns > 0) return hostedDrives > 0 ? `Answering with AI · ${hosting}` : 'Answering with AI'
  return hostedDrives === 1 ? 'Hosting 1 drive for peers' : `Hosting ${hostedDrives} drives for peers`
}
