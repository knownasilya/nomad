import { requireOptionalNativeModule, type NativeModule } from 'expo'

// Keeps a web page's new windows, downloaded feeds and app links inside Nomad
// (android/…/NomadWebViewWindowsModule.kt, with mobile/patches/react-native-webview+*.patch).
// null on iOS and in Expo Go.

type Events = {
  // A target="_blank" link, or a download a popup started: open it in a new tab.
  onOpenTab: (e: { url: string }) => void
  // An RSS or Atom feed the page tried to download: offer it to Reader.
  onFeed: (e: { url: string }) => void
}

declare class NomadWebViewWindowsModule extends NativeModule<Events> {
  // The WebView's user agent, made Chrome's: no "; wv", no "Version/4.0", no build id.
  browserUserAgent (): string
  // Hands a link to the app that handles it (mailto:, tel:, market:, an intent:// link). Never a web
  // page. false when no app took it.
  openExternal (url: string): Promise<boolean>
}

export default requireOptionalNativeModule<NomadWebViewWindowsModule>('NomadWebViewWindows')
