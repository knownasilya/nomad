import { requireNativeView, requireOptionalNativeModule } from 'expo'
import type { ComponentType } from 'react'
import type { NativeSyntheticEvent, ViewProps } from 'react-native'

// A view that reports how far the keyboard reaches up from the bottom of its window, in dp, and
// works inside a Modal, where React Native's Keyboard events never arrive on Android
// (android/…/NomadKeyboardInsetView.kt). null on iOS and in Expo Go: use lib/keyboardInset.tsx.

export interface KeyboardInsetEvent { bottom: number }
export interface NomadKeyboardInsetViewProps extends ViewProps {
  onInset?: (e: NativeSyntheticEvent<KeyboardInsetEvent>) => void
}

const available = requireOptionalNativeModule('NomadKeyboardInset') != null

const NomadKeyboardInsetView: ComponentType<NomadKeyboardInsetViewProps> | null = available
  ? requireNativeView<NomadKeyboardInsetViewProps>('NomadKeyboardInset')
  : null

export default NomadKeyboardInsetView
