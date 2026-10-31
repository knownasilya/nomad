import { useEffect, useRef } from 'react'
import { Keyboard, Platform, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NativeKeyboardInset from '../modules/nomad-keyboard-inset'

interface Props {
  // How far the keyboard reaches up from the bottom edge of the screen, in dp; 0 when it closes.
  onChange: (bottom: number) => void
}

// Reports the keyboard's height, and keeps working inside a Modal. Render it inside the Modal you
// want to move: it takes no space and draws nothing.
//
// On Android, React Native emits keyboardDidShow/Hide only from the activity's root view. A Modal
// is its own Dialog window, so the Keyboard events never arrive for an input inside one, and the
// app is edge-to-edge, so the Dialog isn't resized for the keyboard either. The native view
// (modules/nomad-keyboard-inset) reads the keyboard inset of the window it sits in instead.
// iOS has one keyboard for the whole app, so the Keyboard events are enough there; they are also
// the fallback for a build without the native module (Expo Go).
export default function KeyboardInset ({ onChange }: Props) {
  const insets = useSafeAreaInsets()
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const navRef = useRef(insets.bottom)
  navRef.current = insets.bottom

  useEffect(() => {
    if (NativeKeyboardInset) return
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    // iOS measures the keyboard to the bottom of the screen. Android leaves the navigation bar out
    // (see AiPanel), so add it back.
    const show = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates?.height ?? 0
      changeRef.current(h > 0 ? h + (Platform.OS === 'ios' ? 0 : navRef.current) : 0)
    })
    const hide = Keyboard.addListener(hideEvent, () => changeRef.current(0))
    return () => { show.remove(); hide.remove() }
  }, [])

  // Gone with its Modal: nothing is covered any more.
  useEffect(() => () => changeRef.current(0), [])

  if (!NativeKeyboardInset) return null
  return (
    <NativeKeyboardInset
      style={s.probe}
      pointerEvents='none'
      onInset={(e) => changeRef.current(Math.max(0, e.nativeEvent.bottom || 0))}
    />
  )
}

const s = StyleSheet.create({
  probe: { position: 'absolute', left: 0, bottom: 0, width: 0, height: 0 }
})
