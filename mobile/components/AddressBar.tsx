import { useMemo } from 'react'
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { DriveType } from '../lib/hyperUrl'

interface Props {
  value: string
  onChangeText: (t: string) => void
  onSubmit: () => void
  onReload: () => void
  loading: boolean
  isHyper: boolean
  driveType: DriveType
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onFocus?: () => void
  onBlur?: () => void
}

// nomad-style location bar: back/forward nav, a rounded input with a leading
// trust indicator and drive-type chip, and a reload/go button on the right.
export default function AddressBar (props: Props) {
  const { value, onChangeText, onSubmit, onReload, loading, isHyper, driveType, canBack, canForward, onBack, onForward, onFocus, onBlur } = props
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])

  return (
    <View style={s.row}>
      <TouchableOpacity style={s.navBtn} onPress={onBack} disabled={!canBack} hitSlop={6}>
        <Text style={[s.navBtnText, !canBack && s.navBtnDisabled]}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.navBtn} onPress={onForward} disabled={!canForward} hitSlop={6}>
        <Text style={[s.navBtnText, !canForward && s.navBtnDisabled]}>›</Text>
      </TouchableOpacity>
      <View style={[s.inputWrap, isHyper && { borderColor: t.trustText }]}>
        <Text style={[s.trust, { color: isHyper ? t.secure : t.textMuted }]}>{isHyper ? '⬡' : '◯'}</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder='Search or enter address'
          placeholderTextColor={t.textMuted}
          autoCapitalize='none'
          autoCorrect={false}
          keyboardType='url'
          returnKeyType='go'
          selectTextOnFocus
        />
        {isHyper && (
          <View style={s.drivePill}>
            <Text style={s.drivePillText}>{driveType === 'autobase' ? 'AB' : 'HD'}</Text>
          </View>
        )}
      </View>
      <TouchableOpacity style={s.go} onPress={loading ? onReload : onSubmit} activeOpacity={0.85}>
        <Text style={s.goText}>{loading ? '↻' : '→'}</Text>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bg,
      paddingHorizontal: 10,
      paddingTop: 4,
      paddingBottom: 8,
      gap: 6
    },
    navBtn: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
    navBtnText: { color: t.textDim, fontSize: 24, fontWeight: '400' },
    navBtnDisabled: { color: t.border },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.inputBg,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      paddingHorizontal: 10,
      height: 44
    },
    trust: { fontSize: 13, marginRight: 8 },
    input: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    drivePill: {
      backgroundColor: t.trustBg,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginLeft: 6
    },
    drivePillText: { color: t.trustText, fontSize: 12, fontWeight: '700' },
    go: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center'
    },
    goText: { color: t.onAccent, fontSize: 20, fontWeight: '600' }
  })
}
