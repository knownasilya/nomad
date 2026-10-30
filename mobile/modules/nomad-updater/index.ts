import { requireOptionalNativeModule, type NativeModule } from 'expo'

// The Android installer half of the phone's auto-updates (android/…/NomadUpdaterModule.kt).
// null on iOS and in Expo Go, where there is nothing to install.

export type InstallStatus =
  | { status: 'pending'; version: string } // waiting for the user's OK in Android's prompt
  | { status: 'success'; version: string }
  | { status: 'failed'; version: string; error: string }

type Events = {
  onProgress: (e: { progress: number }) => void
  onStatus: (e: InstallStatus) => void
}

declare class NomadUpdaterModule extends NativeModule<Events> {
  currentVersion (): string
  canInstallSilently (): boolean
  canRequestInstalls (): boolean
  openInstallSettings (): void
  confirmInstall (): boolean
  install (url: string, version: string, size: number): Promise<void>
}

export default requireOptionalNativeModule<NomadUpdaterModule>('NomadUpdater')
