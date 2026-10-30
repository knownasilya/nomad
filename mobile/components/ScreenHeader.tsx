import { useMemo, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTheme, touch, type Theme } from '../lib/theme'
import IconButton from './IconButton'
import type { IconName } from './Icon'

export interface HeaderAction {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean // a spinner in its place, e.g. while Reader refreshes
  color?: string
}

interface Props {
  title: string
  subtitle?: string
  // The back arrow on the left. Full-screen pages close with it, the way Android's top app bar
  // goes up a level; the hardware back button does the same through the Modal's onRequestClose.
  onBack?: () => void
  backLabel?: string
  actions?: HeaderAction[]
  right?: ReactNode // anything else for the right side (e.g. a text button)
}

// The top app bar every full-screen page shares: back arrow, title, and icon actions. 56dp tall,
// like Material's small top app bar, on the page background so it reads as part of the page.
export default function ScreenHeader ({ title, subtitle, onBack, backLabel = 'Back', actions, right }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.bar}>
      {onBack ? <IconButton icon='arrow-left' label={backLabel} onPress={onBack} color={t.text} /> : <View style={s.gap} />}
      <View style={s.titles}>
        <Text style={s.title} numberOfLines={1} accessibilityRole='header'>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {actions?.map((a) => a.busy
        ? <View key={a.label} style={s.busy}><ActivityIndicator color={t.textDim} /></View>
        : <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} disabled={a.disabled} color={a.color ?? t.text} />)}
      {right}
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 4, backgroundColor: t.bg },
    gap: { width: 12 },
    titles: { flex: 1, paddingHorizontal: 8 },
    title: { color: t.text, fontSize: 20, fontWeight: '600' },
    subtitle: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    busy: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' }
  })
}
