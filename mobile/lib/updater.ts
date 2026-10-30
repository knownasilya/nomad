import { useSyncExternalStore } from 'react'
import { Platform, ToastAndroid } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import native from '../modules/nomad-updater'
import { LATEST_RELEASE_URL, isNewer, pickRelease, type Release } from './updateRelease'

// The phone updates itself from GitHub Releases, the way pearbell's Android app does: on launch and
// whenever the app comes back to the front (at most once an hour) it asks GitHub for the latest
// published release, and if that is newer it downloads the APK and installs it over this one
// (modules/nomad-updater). Android asks the user to confirm the first update; from Android 12 on,
// the ones after that install without a prompt. Settings → Updates turns automatic installs off
// and checks by hand. Android only; on iOS this does nothing.

export type { Release }

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; release: Release }
  | { kind: 'downloading'; release: Release; progress: number }
  | { kind: 'installing'; release: Release; needsConfirm: boolean }
  | { kind: 'failed'; release: Release | null; error: string }

const AUTO_KEY = 'hb:updates-auto'
const CHECK_EVERY = 60 * 60 * 1000

const supported = Platform.OS === 'android' && !!native

let state: UpdateState = { kind: 'idle' }
let auto = true
let lastCheck = 0
let checking = false
let dismissed: string | null = null // a version the user closed the banner for, this run
const listeners = new Set<() => void>()

function set (next: UpdateState) {
  state = next
  for (const listener of listeners) listener()
}

const autoLoaded = AsyncStorage.getItem(AUTO_KEY)
  .then((v) => { if (v === 'false') auto = false; for (const l of listeners) l() })
  .catch(() => {})

if (supported && native) {
  native.addListener('onProgress', ({ progress }) => {
    if (state.kind === 'downloading') set({ ...state, progress })
  })
  native.addListener('onStatus', (e) => {
    const release = 'release' in state ? state.release : null
    if (e.status === 'pending') {
      if (release) set({ kind: 'installing', release, needsConfirm: true })
    } else if (e.status === 'success') {
      set({ kind: 'idle' })
    } else {
      set({ kind: 'failed', release, error: e.error })
    }
  })
}

export function currentVersion (): string | null {
  try {
    return native?.currentVersion() ?? null
  } catch {
    return null
  }
}

function toast (text: string) {
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.SHORT)
}

// Rate-limited unless forced. Installs on its own when allowed, else the banner offers it.
// Dev builds (versionName 1.0.0, debug-signed) only check when asked.
export async function checkForUpdate ({ force = false } = {}): Promise<void> {
  if (!supported || !native) return
  if (!force && __DEV__) return
  const now = Date.now()
  if (checking || state.kind === 'downloading' || state.kind === 'installing') return
  if (!force && now - lastCheck < CHECK_EVERY) return
  lastCheck = now
  checking = true
  try {
    const res = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = pickRelease(await res.json())
    const current = currentVersion() ?? '0'
    if (!release || !isNewer(release.version, current)) {
      if (state.kind === 'available' || force) set({ kind: 'idle' })
      if (force) toast(`Nomad ${current} is up to date`)
      return
    }
    if (!force && dismissed === release.version) return
    set({ kind: 'available', release })
    await autoLoaded
    if (auto && native.canInstallSilently()) await installUpdate(release)
  } catch (err) {
    console.warn('update check failed', err)
    if (force) set({ kind: 'failed', release: null, error: (err as Error)?.message || 'Could not reach GitHub' })
  } finally {
    checking = false
  }
}

// Start an install, after making sure Android lets Nomad install APKs.
export async function installUpdate (release: Release): Promise<void> {
  if (!native) return
  if (!native.canRequestInstalls()) {
    if (Platform.OS === 'android') ToastAndroid.show('Allow Nomad to install updates, then tap Update again', ToastAndroid.LONG)
    native.openInstallSettings()
    return
  }
  set({ kind: 'downloading', release, progress: 0 })
  try {
    await native.install(release.apkUrl, release.version, release.size)
    // Handed to Android; onStatus says how it went. Don't overwrite a 'pending' that beat us here.
    if (state.kind === 'downloading') set({ kind: 'installing', release, needsConfirm: false })
  } catch (err) {
    set({ kind: 'failed', release, error: (err as Error)?.message || 'Download failed' })
  }
}

// Reopen Android's install prompt, when it couldn't open while the app was in the background.
export function confirmInstall () {
  if (native && !native.confirmInstall()) set({ kind: 'idle' })
}

export function dismissUpdate () {
  if ('release' in state && state.release) dismissed = state.release.version
  set({ kind: 'idle' })
}

export function setAutoInstall (on: boolean) {
  auto = on
  for (const l of listeners) l()
  AsyncStorage.setItem(AUTO_KEY, on ? 'true' : 'false').catch(() => {})
}

function subscribe (listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useUpdateState (): UpdateState {
  return useSyncExternalStore(subscribe, () => state)
}

export function useAutoInstall (): boolean {
  return useSyncExternalStore(subscribe, () => auto)
}

export const updatesSupported = supported
