import { useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

interface Props {
  visible: boolean
  onClose: () => void
  topics: string[] // the note's
  byAi: boolean // a computer's AI picked them
  known: string[] // every topic the notes use, most used first
  editable: boolean
  onChange: (topics: string[]) => void
}

// A note's topics (ADR-0035), from the topic row in the phone's Notes editor: take one off, type
// one, or pick one the other notes use. Each change saves at once. The AI on a computer sorts notes
// into topics by itself; it leaves alone the ones set here.
export default function NoteTopicsSheet ({ visible, onClose, topics, byAi, known, editable, onChange }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [text, setText] = useState('')
  const has = (topic: string) => topics.some((x) => x.toLowerCase() === topic.toLowerCase())
  const q = text.trim().toLowerCase()
  const offered = known.filter((k) => !has(k) && (!q || k.toLowerCase().includes(q))).slice(0, 20)

  const add = (raw: string) => {
    const list = raw.split(',').map((x) => x.trim()).filter((x) => x && !has(x))
    setText('')
    if (list.length) onChange([...topics, ...list])
  }

  return (
    <BottomSheet visible={visible} onClose={() => { setText(''); onClose() }} style={s.sheet}>
      <Text style={s.title}>Topics</Text>
      <View style={s.chips}>
        {topics.length ? topics.map((topic) => (
          <View key={topic} style={s.topic}>
            <Text style={s.topicText} numberOfLines={1}>{topic}</Text>
            {editable ? (
              <TouchableOpacity onPress={() => onChange(topics.filter((x) => x !== topic))} hitSlop={10} accessibilityLabel={`Remove ${topic}`}>
                <Icon name='times' size={11} color={t.trustText} />
              </TouchableOpacity>
            ) : null}
          </View>
        )) : <Text style={s.hint}>No topics yet.</Text>}
        {byAi && topics.length ? <Icon name='magic' size={11} color={t.textMuted} style={s.byAi} /> : null}
      </View>
      {byAi && topics.length ? <Text style={s.hint}>Picked by the AI on your computer. Change them as you like.</Text> : null}
      {editable ? (
        <>
          <View style={s.inputRow}>
            <Icon name='tag' size={13} color={t.textMuted} />
            <TextInput
              style={s.input}
              value={text}
              onChangeText={(v) => (v.endsWith(',') ? add(v) : setText(v))}
              placeholder='Add a topic, like Garden or Work'
              placeholderTextColor={t.textMuted}
              autoCapitalize='words'
              autoCorrect={false}
              returnKeyType='done'
              blurOnSubmit={false}
              onSubmitEditing={() => add(text)}
            />
            {text.trim() ? (
              <TouchableOpacity onPress={() => add(text)} hitSlop={8} accessibilityLabel='Add'>
                <Text style={s.addText}>Add</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {offered.length ? (
            <>
              <Text style={s.label}>Your topics</Text>
              <ScrollView style={s.offered} contentContainerStyle={s.chips} keyboardShouldPersistTaps='always'>
                {offered.map((k) => (
                  <TouchableOpacity key={k} style={s.offer} onPress={() => add(k)}>
                    <Icon name='plus' size={10} color={t.textDim} />
                    <Text style={s.offerText} numberOfLines={1}>{k}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          ) : null}
        </>
      ) : null}
      <View style={s.actions}>
        <TouchableOpacity style={s.btn} onPress={() => { setText(''); onClose() }}>
          <Text style={s.btnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingHorizontal: space.xl, paddingBottom: space.xl },
    title: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
    topic: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220, paddingLeft: 12, paddingRight: 10, height: 32, borderRadius: radius.pill, backgroundColor: t.trustBg },
    topicText: { color: t.trustText, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    byAi: { marginLeft: 2 },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: space.lg,
      minHeight: 48,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.bg
    },
    input: { flex: 1, paddingVertical: space.sm, fontSize: 15, color: t.text },
    addText: { color: t.accent, fontSize: 15, fontWeight: '600' },
    label: { color: t.textMuted, fontSize: 12, fontWeight: '600', marginTop: space.lg, marginBottom: space.sm },
    offered: { maxHeight: 132 },
    offer: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border },
    offerText: { color: t.textDim, fontSize: 14, flexShrink: 1 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: space.lg },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xl, alignItems: 'center', minWidth: 88 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
