import { useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet
} from 'react-native'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { SPACE_COLORS, type Space } from '../lib/useSpaces'

interface Props {
  visible: boolean
  onClose: () => void
  spaces: Space[]
  activeSpaceId: string
  vaultKeys: string[]
  onSwitch: (id: string) => void
  onCreate: (opts: { name: string; color: string }) => Promise<unknown> | unknown
}

// Space switcher — a bottom sheet listing spaces (color dot + name + active check) with a create
// form, mirroring nomad desktop's spaces menu (app/fg/shell-menus/spaces.js).
export default function SpaceSwitcher ({ visible, onClose, spaces, activeSpaceId, vaultKeys, onSwitch, onCreate }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const shared = new Set(vaultKeys)
  const anyShared = spaces.some((sp) => sp.rootDriveKey && shared.has(sp.rootDriveKey))

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SPACE_COLORS[0])
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setCreating(false)
    setName('')
    setColor(SPACE_COLORS[0])
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await onCreate({ name: trimmed, color })
      reset()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={close} style={s.sheet}>
      <Text style={s.title}>Spaces</Text>

      <ScrollView style={s.list} keyboardShouldPersistTaps='handled'>
        {spaces.map((sp) => (
          <Pressable
            key={sp.id}
            style={[s.row, sp.id === activeSpaceId && s.rowActive]}
            onPress={() => { onSwitch(sp.id); close() }}
            android_ripple={{ color: t.ripple }}
            accessibilityRole='button'
            accessibilityState={{ selected: sp.id === activeSpaceId }}
          >
            <View style={[s.dot, { backgroundColor: sp.color }]} />
            <Text style={[s.rowName, sp.id === activeSpaceId && s.rowNameActive]} numberOfLines={1}>{sp.name}</Text>
            {sp.rootDriveKey && shared.has(sp.rootDriveKey)
              ? <Icon name='sync-alt' size={13} color={t.secure} style={s.shared} />
              : null}
            {sp.id === activeSpaceId ? <Icon name='check' size={15} color={t.accent} /> : null}
          </Pressable>
        ))}
      </ScrollView>
      {anyShared ? (
        <View style={s.legendRow}>
          <Icon name='sync-alt' size={11} color={t.secure} />
          <Text style={s.legend}>Shared across your devices</Text>
        </View>
      ) : null}

      {creating ? (
        <View style={s.form}>
          <TextInput
            style={s.input}
            placeholder='Space name'
            placeholderTextColor={t.textMuted}
            value={name}
            onChangeText={setName}
            autoFocus
            editable={!busy}
            onSubmitEditing={submit}
          />
          <View style={s.swatches}>
            {SPACE_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.swatch, { backgroundColor: c }, color === c && s.swatchActive]}
                onPress={() => setColor(c)}
              />
            ))}
          </View>
          <View style={s.formActions}>
            <TouchableOpacity style={s.btnGhost} onPress={reset} disabled={busy}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, (!name.trim() || busy) && s.btnDisabled]} onPress={submit} disabled={!name.trim() || busy}>
              {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.btnText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Pressable style={s.newBtn} onPress={() => setCreating(true)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
          <View style={s.newIcon}><Icon name='plus' size={13} color={t.accent} /></View>
          <Text style={s.newBtnText}>New space</Text>
        </Pressable>
      )}
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: t.surface,
      paddingHorizontal: space.sm,
      paddingBottom: space.lg,
      maxHeight: '80%'
    },
    title: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.sm, paddingHorizontal: space.lg },
    list: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, overflow: 'hidden' },
    rowActive: { backgroundColor: t.surfaceAlt },
    dot: { width: 14, height: 14, borderRadius: radius.pill },
    rowName: { flex: 1, fontSize: 16, color: t.text },
    rowNameActive: { fontWeight: '600' },
    shared: { marginRight: space.sm },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, marginTop: space.sm },
    legend: { color: t.textMuted, fontSize: 12 },
    newBtn: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, marginTop: space.xs, borderRadius: radius.md, overflow: 'hidden' },
    newIcon: { width: 14, alignItems: 'center' },
    newBtnText: { color: t.accent, fontSize: 15, fontWeight: '600' },
    form: { marginTop: space.sm, gap: space.md, paddingHorizontal: space.lg },
    input: {
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      minHeight: 48,
      fontSize: 15,
      color: t.text
    },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    swatch: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 3, borderColor: 'transparent' },
    swatchActive: { borderColor: t.text },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
    btnGhost: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xl, alignItems: 'center', minWidth: 88 },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
