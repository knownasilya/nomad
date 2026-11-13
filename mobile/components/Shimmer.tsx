import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, type StyleProp, type TextStyle } from 'react-native'

// Status text while the AI works ("Thinking…", the step that's running), after Nuxt UI's
// ChatShimmer: it breathes so the panel never looks frozen. With Reduce motion on it stays still.
export default function Shimmer ({ children, style, numberOfLines }: { children: string; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const pulse = useRef(new Animated.Value(1)).current
  const [still, setStill] = useState(false)

  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (live) setStill(!!on) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (on) => setStill(!!on))
    return () => { live = false; sub?.remove?.() }
  }, [])

  useEffect(() => {
    if (still) { pulse.setValue(1); return }
    const ease = Easing.inOut(Easing.ease)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.4, duration: 900, easing: ease, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: ease, useNativeDriver: true })
    ]))
    loop.start()
    return () => loop.stop()
  }, [still, pulse])

  return (
    <Animated.Text style={[style, { opacity: pulse }]} numberOfLines={numberOfLines} accessibilityLiveRegion='polite'>
      {children}
    </Animated.Text>
  )
}
