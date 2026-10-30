import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, radius } from '../lib/theme'

interface Props {
  visible: boolean
  onClose: () => void
  // Look of the sheet itself (background, padding, maxHeight). Its paddingBottom is kept, and the
  // bottom safe-area inset is added on top of it.
  style?: StyleProp<ViewStyle>
  // The grab handle at the top. Drag it (or the strip around it) down to close the sheet.
  handle?: boolean
  children: ReactNode
}

const OPEN_MS = 240
const CLOSE_MS = 180

// A sheet pinned to the bottom of the screen over a dimmed backdrop. It slides up from the bottom
// edge, as Android's sheets do; tap outside, press Android back, or drag the handle down to close.
//
// Use this for any bottom-pinned panel instead of building a transparent Modal by hand. On Android
// (Expo 55 is edge-to-edge) a transparent Modal draws behind the navigation bar and gets NO inset,
// so a hand-built sheet ends up under the back/home buttons. This component adds the inset once.
//
// The Modal stays up until the slide-out finishes, so `visible` going false animates the sheet away
// rather than cutting it. Every animation runs on the JS driver: the drag feeds the same value from
// JS, and one value can't be shared between the two drivers.
export default function BottomSheet ({ visible, onClose, style, handle = true, children }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const flat = StyleSheet.flatten(style) || {}
  const basePad = typeof flat.paddingBottom === 'number'
    ? flat.paddingBottom
    : typeof flat.paddingVertical === 'number' ? flat.paddingVertical : 0

  const [mounted, setMounted] = useState(visible)
  const progress = useRef(new Animated.Value(0)).current // 0 = hidden, 1 = open
  const drag = useRef(new Animated.Value(0)).current // px dragged down
  const sheetH = useRef(screenH)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (visible) {
      setMounted(true)
      drag.setValue(0)
      Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: false })
        .start(({ finished }) => { if (finished) setMounted(false) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > Math.min(120, sheetH.current * 0.3) || g.vy > 0.8) closeRef.current()
      else Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start()
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start()
  }), [drag])

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [screenH, 0] })

  return (
    <Modal visible={mounted} transparent animationType='none' onRequestClose={onClose}>
      <View style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop, opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel='Close' />
        </Animated.View>
        <Animated.View
          onLayout={(e) => { sheetH.current = e.nativeEvent.layout.height }}
          style={[
            s.sheet,
            { backgroundColor: t.surface },
            style,
            { paddingBottom: basePad + insets.bottom, transform: [{ translateY: Animated.add(slide, drag) }] }
          ]}
        >
          {handle ? (
            <View style={s.grabZone} {...pan.panHandlers} accessibilityLabel='Drag down to close'>
              <View style={[s.handle, { backgroundColor: t.border }]} />
            </View>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg + 6, borderTopRightRadius: radius.lg + 6, overflow: 'hidden' },
  // A taller strip than the handle itself, so the drag is easy to start.
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: radius.pill }
})
