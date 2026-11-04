import { useMemo } from 'react'
import { View, Text, Pressable, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

interface Props {
  visible: boolean
  onClose: () => void
  topics: Array<{ topic: string; count: number }> // every topic the notes use, most used first
  total: number // how many notes there are
  selected: string[] // the ticked topics; none is All
  onChange: (selected: string[]) => void
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// The Topics dropdown above the phone's Notes list (ADR-0035): All, or any number of topics ticked.
// The list then shows the notes with any of them. Each tick applies at once and the sheet stays
// open, so several can be ticked; Done or a tap outside closes it. Desktop's nomad://notes has the
// same dropdown (app/userland/notes/js/topic-filter.js).
export default function TopicFilterSheet ({ visible, onClose, topics, total, selected, onChange }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const isOn = (topic: string) => selected.some((x) => same(x, topic))
  const toggle = (topic: string) => onChange(isOn(topic) ? selected.filter((x) => !same(x, topic)) : [...selected, topic])

  const row = (label: string, count: number, on: boolean, onPress: () => void, first = false) => (
    <Pressable
      key={label}
      style={[s.row, !first && s.divider]}
      onPress={onPress}
      android_ripple={{ color: t.ripple }}
      accessibilityRole='checkbox'
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'note' : 'notes'}`}
    >
      <Icon name={on ? 'check-square' : 'square'} regular={!on} size={20} color={on ? t.accent : t.textMuted} />
      <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>{label}</Text>
      <Text style={s.count}>{count}</Text>
    </Pressable>
  )

  return (
    <BottomSheet visible={visible} onClose={onClose} style={s.sheet}>
      <Text style={s.title}>Show notes about</Text>
      <View style={s.card}>
        {row('All topics', total, !selected.length, () => onChange([]), true)}
        <ScrollView style={s.list}>
          {topics.map((x) => row(x.topic, x.count, isOn(x.topic), () => toggle(x.topic)))}
        </ScrollView>
      </View>
      <View style={s.actions}>
        <TouchableOpacity style={s.btn} onPress={onClose}>
          <Text style={s.btnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingHorizontal: space.lg, paddingBottom: space.xl, maxHeight: '80%' },
    title: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.md, paddingHorizontal: space.sm },
    card: { flexShrink: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, backgroundColor: t.bg, overflow: 'hidden' },
    list: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: touch + 4, paddingHorizontal: space.lg },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    name: { flex: 1, color: t.text, fontSize: 15 },
    nameOn: { fontWeight: '600' },
    count: { color: t.textMuted, fontSize: 13 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: space.lg },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xl, alignItems: 'center', minWidth: 88 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
