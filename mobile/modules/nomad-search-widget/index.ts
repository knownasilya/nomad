import { requireOptionalNativeModule, type NativeModule } from 'expo'

// The home screen search widget (android/…/NomadSearchWidgetProvider.kt). null on iOS and in
// Expo Go. The app keeps its Spaces up to date (lib/useSearchWidget.ts) and reads its taps with
// Linking (lib/widgetLinks.ts).

declare class NomadSearchWidgetModule extends NativeModule {
  setSpaces (json: string): boolean
  canPin (): boolean
  requestPin (): boolean
  count (): number
}

export default requireOptionalNativeModule<NomadSearchWidgetModule>('NomadSearchWidget')
