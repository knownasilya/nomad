import { requireOptionalNativeModule, type NativeModule } from 'expo'

// Keeps the system bars' insets away from the page WebViews (android/…/NomadWebViewInsetsModule.kt).
// null on iOS and in Expo Go.

declare class NomadWebViewInsetsModule extends NativeModule {
  install (): void
}

export default requireOptionalNativeModule<NomadWebViewInsetsModule>('NomadWebViewInsets')
