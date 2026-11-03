import { useRef, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme, touch } from '../lib/theme'
import { showLabel } from '../lib/tooltip'
import { createHold } from '../lib/hold'
import Icon, { type IconName } from './Icon'

interface Props {
  icon?: IconName
  label: string // read out by TalkBack, and shown on touch and hold; there is no visible text
  onPress?: () => void
  onLongPress?: () => void // replaces the label shown on touch and hold; runs when the finger lifts (lib/hold.ts)
  longPressLabel?: string // what TalkBack calls that action, e.g. 'New tab'
  disabled?: boolean
  active?: boolean // tinted with the accent, e.g. a bookmarked page's star
  regular?: boolean
  size?: number
  color?: string
  ripple?: string // the press ripple, for a button on a colored bar
  style?: StyleProp<ViewStyle>
  children?: ReactNode // drawn instead of `icon`, e.g. the tab count
}

// A round, 48dp icon button with Android's borderless ripple, the size Material asks for so a
// thumb can hit it. iOS dims it while pressed instead. Touch and hold shows its label, like a
// tooltip, unless the button has a long-press action of its own. That action runs as the finger
// lifts after the hold, never on a touch the system takes for its back gesture (lib/hold.ts).
export default function IconButton ({ icon, label, onPress, onLongPress, longPressLabel, disabled, active, regular, size = 20, color, ripple, style, children }: Props) {
  const t = useTheme()
  const tint = disabled ? t.border : active ? t.accent : color ?? t.textDim
  const longPress = useRef(onLongPress)
  longPress.current = onLongPress
  const hold = useRef(createHold(() => longPress.current?.())).current
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ? hold.held : () => showLabel(label)}
      onTouchStart={hold.start}
      onTouchEnd={hold.end}
      onTouchCancel={hold.cancel}
      // TalkBack's long press is an action, not a touch: run it straight away.
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: longPressLabel ?? label }] : undefined}
      onAccessibilityAction={onLongPress ? (e) => { if (e.nativeEvent.actionName === 'longpress') onLongPress() } : undefined}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      android_ripple={{ color: ripple ?? t.ripple, borderless: true, radius: touch / 2 }}
      style={({ pressed }) => [s.btn, style, pressed && Platform.OS !== 'android' && s.pressed]}
    >
      {children ?? (icon ? <Icon name={icon} size={size} color={tint} regular={regular} /> : null)}
    </Pressable>
  )
}

const s = StyleSheet.create({
  btn: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  // Android shows the ripple; elsewhere a press just dims the button.
  pressed: { opacity: 0.6 }
})
