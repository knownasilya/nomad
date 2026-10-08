import type { ReactNode } from 'react'
import { Modal, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, radius } from '../lib/theme'

interface Props {
  visible: boolean
  onClose: () => void
  // Look of the sheet itself (background, padding, maxHeight). Its paddingBottom is kept, and the
  // bottom safe-area inset is added on top of it.
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

// A sheet pinned to the bottom of the screen over a dimmed backdrop. Tap outside or press Android
// back to close.
//
// Use this for any bottom-pinned panel instead of building a transparent Modal by hand. On Android
// (Expo 55 is edge-to-edge) a transparent Modal draws behind the navigation bar and gets NO inset,
// so a hand-built sheet ends up under the back/home buttons. This component adds the inset once.
export default function BottomSheet ({ visible, onClose, style, children }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const flat = StyleSheet.flatten(style) || {}
  const basePad = typeof flat.paddingBottom === 'number'
    ? flat.paddingBottom
    : typeof flat.paddingVertical === 'number' ? flat.paddingVertical : 0

  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        {/* Swallow taps so a tap inside the sheet doesn't close it. */}
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={[s.sheet, { backgroundColor: t.surface }, style, { paddingBottom: basePad + insets.bottom }]}
        >
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }
})
