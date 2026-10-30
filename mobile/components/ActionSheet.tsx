import { Fragment, useMemo, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import BottomSheet from './BottomSheet'
import Icon, { type IconName } from './Icon'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'

export interface SheetAction {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
  active?: boolean // tinted, e.g. "Bookmarked"
  regular?: boolean
  hidden?: boolean // left out, for an action that doesn't apply here
}

interface Props {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  // A row of large icon buttons above the list, like the top row of Chrome's menu.
  quick?: SheetAction[]
  // Groups of rows, with a divider between groups.
  groups: SheetAction[][]
  header?: ReactNode
}

// A list of actions in a bottom sheet: the phone's menu, and what a long-press on a row opens.
// The sheet closes first, then the action runs, so an action that opens another page or sheet
// doesn't open under this one.
export default function ActionSheet ({ visible, onClose, title, subtitle, quick, groups, header }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const run = (a: SheetAction) => { onClose(); a.onPress() }
  const shownGroups = groups.map((g) => g.filter((a) => !a.hidden)).filter((g) => g.length)
  const shownQuick = (quick || []).filter((a) => !a.hidden)

  return (
    <BottomSheet visible={visible} onClose={onClose} style={s.sheet}>
      {title ? (
        <View style={s.head}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {header}
      {shownQuick.length ? (
        <View style={s.quick}>
          {shownQuick.map((a) => (
            <Pressable
              key={a.label}
              style={s.quickBtn}
              onPress={() => run(a)}
              disabled={a.disabled}
              accessibilityRole='button'
              accessibilityLabel={a.label}
              accessibilityState={{ disabled: !!a.disabled, selected: !!a.active }}
              android_ripple={{ color: t.ripple, borderless: true, radius: 36 }}
            >
              <View style={[s.quickIcon, a.active && s.quickIconActive]}>
                <Icon name={a.icon} size={18} regular={a.regular} color={a.disabled ? t.border : a.active ? t.accent : t.text} />
              </View>
              <Text style={[s.quickLabel, a.disabled && s.disabled]} numberOfLines={1}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView style={s.list} bounces={false}>
        {shownGroups.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 || shownQuick.length ? <View style={s.divider} /> : null}
            {group.map((a) => (
              <Pressable
                key={a.label}
                onPress={() => run(a)}
                disabled={a.disabled}
                accessibilityRole='button'
                accessibilityState={{ disabled: !!a.disabled }}
                android_ripple={{ color: t.ripple }}
                style={({ pressed }) => [s.row, pressed && Platform.OS !== 'android' && s.pressed]}
              >
                <View style={s.lead}>
                  <Icon
                    name={a.icon}
                    size={18}
                    regular={a.regular}
                    color={a.disabled ? t.border : a.destructive ? t.danger : a.active ? t.accent : t.textDim}
                  />
                </View>
                <Text style={[s.label, a.destructive && s.danger, a.disabled && s.disabled]} numberOfLines={1}>{a.label}</Text>
              </Pressable>
            ))}
          </Fragment>
        ))}
      </ScrollView>
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingBottom: space.sm, maxHeight: '88%' },
    head: { paddingHorizontal: space.xl, paddingBottom: space.md },
    title: { color: t.text, fontSize: 16, fontWeight: '600' },
    subtitle: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    quick: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: space.sm, paddingBottom: space.md },
    quickBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: space.xs },
    quickIcon: { width: touch, height: touch, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    quickIconActive: { backgroundColor: t.trustBg },
    quickLabel: { color: t.textDim, fontSize: 12 },
    list: { flexGrow: 0 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: space.xs },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.xl, gap: space.lg },
    pressed: { backgroundColor: t.surfaceAlt },
    lead: { width: 24, alignItems: 'center' },
    label: { flex: 1, color: t.text, fontSize: 16 },
    danger: { color: t.danger },
    disabled: { color: t.textMuted }
  })
}
