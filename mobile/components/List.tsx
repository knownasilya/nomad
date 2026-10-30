import { useMemo, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'
import Icon, { type IconName } from './Icon'

// Native-feeling lists: a titled group on a card (the surface cards with hairline borders the rest
// of the app uses), and rows with Android's ripple, a 48dp minimum height, an optional leading icon
// or element, and a chevron or trailing element.

export function ListSection ({ title, action, footer, children, style }: {
  title?: string
  action?: { label: string; onPress: () => void }
  footer?: string
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={[s.section, style]}>
      {title || action ? (
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle} accessibilityRole='header'>{title}</Text>
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={12} accessibilityRole='button'>
              <Text style={s.sectionAction}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={s.card}>{children}</View>
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  )
}

interface RowProps {
  title: string
  subtitle?: string
  icon?: IconName
  iconColor?: string
  left?: ReactNode // instead of `icon`, e.g. a site icon
  right?: ReactNode
  chevron?: boolean // this row opens another page
  onPress?: () => void
  onLongPress?: () => void
  divider?: boolean // a hairline above this row (every row but the first)
  destructive?: boolean
  accent?: boolean // a row that is an action, e.g. "Check for updates"
  disabled?: boolean
  titleLines?: number
  subtitleLines?: number
  accessibilityLabel?: string
}

export function ListRow ({
  title, subtitle, icon, iconColor, left, right, chevron, onPress, onLongPress, divider, destructive, accent, disabled,
  titleLines = 1, subtitleLines = 1, accessibilityLabel
}: RowProps) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const color = disabled ? t.textMuted : destructive ? t.danger : accent ? t.accent : t.text
  const body = (
    <>
      {left ?? (icon ? <View style={s.lead}><Icon name={icon} size={18} color={disabled ? t.textMuted : iconColor ?? (destructive ? t.danger : t.textDim)} /></View> : null)}
      <View style={s.text}>
        <Text style={[s.title, { color }]} numberOfLines={titleLines}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={subtitleLines}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron ? <Icon name='chevron-right' size={14} color={t.textMuted} /> : null}
    </>
  )
  if (!onPress && !onLongPress) return <View style={[s.row, divider && s.divider]}>{body}</View>
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      android_ripple={{ color: t.ripple }}
      style={({ pressed }) => [s.row, divider && s.divider, pressed && Platform.OS !== 'android' && s.pressed]}
    >
      {body}
    </Pressable>
  )
}

// A row with a switch on the right. Tapping anywhere on the row flips it, as in Android's settings.
export function SwitchRow ({ value, onValueChange, ...row }: Omit<RowProps, 'right' | 'onPress' | 'chevron'> & {
  value: boolean
  onValueChange: (on: boolean) => void
}) {
  const t = useTheme()
  return (
    <ListRow
      {...row}
      subtitleLines={row.subtitleLines ?? 3}
      onPress={() => onValueChange(!value)}
      accessibilityLabel={row.accessibilityLabel ?? row.title}
      right={(
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={row.disabled}
          trackColor={{ false: t.border, true: Platform.OS === 'android' ? t.trustBg : t.accent }}
          thumbColor={Platform.OS === 'android' ? (value ? t.accent : t.surfaceAlt) : undefined}
          ios_backgroundColor={t.border}
          accessibilityLabel={row.accessibilityLabel ?? row.title}
        />
      )}
    />
  )
}

// A muted line inside a card: an empty list, or a note under the rows.
export function ListEmpty ({ text }: { text: string }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return <Text style={s.empty}>{text}</Text>
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    section: { marginBottom: space.xl },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm, paddingHorizontal: space.xs },
    sectionTitle: { color: t.textDim, fontSize: 13, fontWeight: '600' },
    sectionAction: { color: t.accent, fontSize: 13, fontWeight: '600' },
    card: { backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    footer: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: space.sm, paddingHorizontal: space.xs },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: touch + 8, paddingHorizontal: space.lg, gap: space.md },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    pressed: { backgroundColor: t.surfaceAlt },
    lead: { width: 24, alignItems: 'center' },
    text: { flex: 1, paddingVertical: 10 },
    title: { fontSize: 15, fontWeight: '500' },
    subtitle: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 1 },
    empty: { color: t.textMuted, fontSize: 13, lineHeight: 19, padding: space.lg }
  })
}
