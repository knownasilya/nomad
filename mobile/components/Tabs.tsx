import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme, space, type Theme } from '../lib/theme'

// Material's fixed tabs under a page's top bar: equal-width labels with an accent underline on the
// selected one. Used where a page has a few views of the same thing (My Library, Logs, DevTools).
export default function Tabs<K extends string> ({ tabs, value, onChange }: {
  tabs: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.bar} accessibilityRole='tablist'>
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <Pressable
            key={tab.key}
            style={s.tab}
            onPress={() => onChange(tab.key)}
            android_ripple={{ color: t.ripple }}
            accessibilityRole='tab'
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{tab.label}</Text>
            <View style={[s.indicator, active && s.indicatorActive]} />
          </Pressable>
        )
      })}
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    bar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, paddingHorizontal: space.sm },
    tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
    label: { color: t.textDim, fontSize: 14, fontWeight: '500', paddingHorizontal: space.xs },
    labelActive: { color: t.accent, fontWeight: '700' },
    indicator: { position: 'absolute', bottom: 0, left: space.md, right: space.md, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    indicatorActive: { backgroundColor: t.accent }
  })
}
