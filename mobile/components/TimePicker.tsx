import { useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { durationLabel, formatTime, minutesOf, timeFrom } from '../lib/timeOfDay'
import Icon from './Icon'

// The calendar editor's times (Calendar.tsx), on a 12-hour clock. A TimeField shows a time and opens
// a TimePicker under it: the hours 1 to 12 with AM and PM, and the minutes in fives, one tap each, so
// nobody types a time. An end time's picker also offers lengths ("1 h") counted from the start, and
// "No end time". Times are still kept as "HH:MM" (24-hour).

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const LENGTHS = [30, 60, 90, 120]
const pad = (n: number) => String(n).padStart(2, '0')

export function TimeField ({ label, value, open, onPress, placeholder = 'No end time' }: {
  label: string // "Starts at", read by TalkBack with the time
  value: string // HH:MM, or '' for none
  open: boolean
  onPress: () => void
  placeholder?: string
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <Pressable
      style={[s.field, open && s.fieldOpen]}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={`${label}, ${value ? formatTime(value) : placeholder}`}
      accessibilityHint={open ? 'Closes the time picker' : 'Opens the time picker'}
      accessibilityState={{ expanded: open }}
    >
      <Text style={[s.fieldText, !value && s.fieldEmpty]}>{value ? formatTime(value) : placeholder}</Text>
      <Icon name='clock' size={16} color={open ? t.accent : t.textMuted} regular />
    </Pressable>
  )
}

export function TimePicker ({ label, value, onChange, start, onLength, onClear, onDone }: {
  label: string // "Start time", "End time"
  value: string // HH:MM, or '' for none
  onChange: (time: string) => void
  start?: string // an end time's start: offers lengths from it
  onLength?: (minutes: number) => void
  onClear?: () => void // offers "No end time"
  onDone: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  // With no time yet, an hour or a minute is set on the start plus an hour (or 09:00).
  const base = value || (start ? timeFrom(minutesOf(start) + 60) : '09:00')
  const h24 = Number(base.slice(0, 2))
  const pm = h24 >= 12
  const hour = value ? h24 % 12 || 12 : -1 // the hour on a 12-hour clock
  const minute = value ? Number(value.slice(3, 5)) : -1
  const setHour = (h12: number, toPm = pm) => onChange(`${pad((h12 % 12) + (toPm ? 12 : 0))}:${base.slice(3, 5)}`)
  const length = start && value ? minutesOf(value) - minutesOf(start) : NaN

  const chip = (key: string | number, text: string, on: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      key={key}
      style={[s.chip, on && s.chipOn]}
      onPress={onPress}
      android_ripple={{ color: t.ripple }}
      accessibilityRole='button'
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{text}</Text>
    </Pressable>
  )

  return (
    <View style={s.panel}>
      <View style={s.head}>
        <Text style={s.title}>{label}</Text>
        <Pressable onPress={onDone} hitSlop={8} accessibilityRole='button' accessibilityLabel={`Done picking the ${label.toLowerCase()}`}>
          <Text style={s.done}>Done</Text>
        </Pressable>
      </View>
      {start && onLength && (
        <>
          <Text style={s.label}>How long</Text>
          <View style={s.lengths}>
            {LENGTHS.map((m) => chip(`l${m}`, durationLabel(m), length === m, () => onLength(m), `${durationLabel(m)}, until ${formatTime(timeFrom(minutesOf(start) + m))}`))}
          </View>
        </>
      )}
      <Text style={s.label}>Hour</Text>
      <View style={s.grid}>
        {HOURS.map((h) => chip(`h${h}`, String(h), h === hour, () => setHour(h), `${h} o’clock`))}
      </View>
      <View style={[s.lengths, s.ampm]}>
        {chip('am', 'AM', !!value && !pm, () => setHour(h24 % 12 || 12, false), 'AM, morning')}
        {chip('pm', 'PM', !!value && pm, () => setHour(h24 % 12 || 12, true), 'PM, afternoon and evening')}
      </View>
      <Text style={s.label}>Minute</Text>
      <View style={s.grid}>
        {MINUTES.map((m) => chip(`m${m}`, `:${pad(m)}`, m === minute, () => onChange(`${base.slice(0, 2)}:${pad(m)}`), `${pad(m)} minutes`))}
      </View>
      {onClear && !!value && (
        <Pressable style={s.clear} onPress={onClear} accessibilityRole='button'>
          <Text style={s.clearText}>No end time</Text>
        </Pressable>
      )}
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.inputBg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: space.md, minHeight: 44, marginBottom: space.md },
    fieldOpen: { borderColor: t.accent, borderWidth: 1.5 },
    fieldText: { color: t.text, fontSize: 15, fontVariant: ['tabular-nums'] },
    fieldEmpty: { color: t.textMuted },
    panel: { backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: space.md, marginBottom: space.md },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
    title: { color: t.text, fontSize: 15, fontWeight: '700' },
    done: { color: t.accent, fontSize: 14, fontWeight: '600', paddingVertical: space.xs },
    label: { color: t.textDim, fontSize: 12, fontWeight: '600', marginTop: space.sm, marginBottom: space.xs },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    lengths: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    ampm: { marginTop: 6 },
    chip: { flexGrow: 1, flexBasis: '14%', minHeight: 40, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    chipOn: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.text, fontSize: 14, fontVariant: ['tabular-nums'] },
    chipTextOn: { color: t.onAccent, fontWeight: '700' },
    clear: { alignSelf: 'flex-start', marginTop: space.md, paddingVertical: space.xs },
    clearText: { color: t.danger, fontSize: 14, fontWeight: '600' }
  })
}
