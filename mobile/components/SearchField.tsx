import { useMemo, type Ref } from 'react'
import { View, TextInput, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import { markPieces } from '../lib/search'
import Icon from './Icon'
import IconButton from './IconButton'

interface Props {
  value: string
  onChangeText: (q: string) => void
  placeholder: string
  onSubmit?: () => void
  style?: StyleProp<ViewStyle>
  inputRef?: Ref<TextInput>
}

// The search box of the phone's Notes and Reader: a pill with a magnifier, and a clear button once
// something is typed (Android's TextInput has none of its own). The keyboard's key says Search.
export default function SearchField ({ value, onChangeText, placeholder, onSubmit, style, inputRef }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={[s.field, style]}>
      <Icon name='search' size={14} color={t.textMuted} />
      <TextInput
        ref={inputRef}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        autoCorrect={false}
        autoCapitalize='none'
        returnKeyType='search'
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder}
      />
      {value ? <IconButton icon='times-circle' label='Clear search' onPress={() => onChangeText('')} size={16} color={t.textMuted} style={s.clear} /> : null}
    </View>
  )
}

// text with the searched words marked, as nested Text (so it stays inside the row's own Text).
export function Marked ({ text, words, style }: { text: string; words: string[]; style?: StyleProp<TextStyle> }) {
  const t = useTheme()
  if (!words.length || !text) return <>{text}</>
  return (
    <>
      {markPieces(text, words).map((p, i) =>
        p.match ? <Text key={i} style={[{ backgroundColor: t.mark }, style]}>{p.text}</Text> : p.text
      )}
    </>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      paddingLeft: 14,
      paddingRight: 2,
      borderRadius: radius.pill,
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border
    },
    input: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    clear: { width: 40, height: 40 }
  })
}
