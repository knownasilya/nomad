import type { ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme, touch } from '../lib/theme'
import Icon, { type IconName } from './Icon'

interface Props {
  icon?: IconName
  label: string // read out by TalkBack; there is no visible text
  onPress?: () => void
  onLongPress?: () => void
  disabled?: boolean
  active?: boolean // tinted with the accent, e.g. a bookmarked page's star
  regular?: boolean
  size?: number
  color?: string
  style?: StyleProp<ViewStyle>
  children?: ReactNode // drawn instead of `icon`, e.g. the tab count
}

// A round, 48dp icon button with Android's borderless ripple, the size Material asks for so a
// thumb can hit it. iOS dims it while pressed instead.
export default function IconButton ({ icon, label, onPress, onLongPress, disabled, active, regular, size = 20, color, style, children }: Props) {
  const t = useTheme()
  const tint = disabled ? t.border : active ? t.accent : color ?? t.textDim
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      android_ripple={{ color: t.ripple, borderless: true, radius: touch / 2 }}
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
