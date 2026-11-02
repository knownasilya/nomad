import { Platform, ToastAndroid } from 'react-native'

// A button that shows only an icon says what it does when you touch and hold it, the way
// Android's own icon buttons do. IconButton does this for you; a hand-built icon-only Pressable
// passes `onLongPress={() => showLabel(label)}` next to its `accessibilityLabel`.
// (scripts/check-icon-buttons.mjs fails the tests when one doesn't.)
export function showLabel (label: string) {
  if (!label) return
  if (Platform.OS === 'android') ToastAndroid.show(label, ToastAndroid.SHORT)
}
