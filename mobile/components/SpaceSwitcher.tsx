import { useMemo, useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet
} from 'react-native'
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
    <Modal visible={visible} transparent animationType='fade' onRequestClose={close}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={s.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={s.handle} />
          <Text style={s.title}>Spaces</Text>

          <ScrollView style={s.list} keyboardShouldPersistTaps='handled'>
            {spaces.map((sp) => (
              <TouchableOpacity
                key={sp.id}
                style={s.row}
                onPress={() => { onSwitch(sp.id); close() }}
              >
                <View style={[s.dot, { backgroundColor: sp.color }]} />
                <Text style={s.rowName} numberOfLines={1}>{sp.name}</Text>
                {sp.rootDriveKey && shared.has(sp.rootDriveKey)
                  ? <Text style={s.shared} accessibilityLabel='Shared across your devices'>⇆</Text>
                  : null}
                {sp.id === activeSpaceId ? <Text style={s.check}>✓</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          {anyShared ? <Text style={s.legend}>⇆ shared across your devices</Text> : null}

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
            <TouchableOpacity style={s.newBtn} onPress={() => setCreating(true)}>
              <Text style={s.newBtnText}>+ New space</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.xl,
      maxHeight: '80%'
    },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, backgroundColor: t.border, marginBottom: space.md },
    title: { fontSize: 13, fontWeight: '600', color: t.textDim, marginBottom: space.sm },
    list: { flexGrow: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
    dot: { width: 14, height: 14, borderRadius: radius.pill },
    rowName: { flex: 1, fontSize: 16, color: t.text },
    shared: { color: t.secure, fontSize: 15, marginRight: space.sm },
    check: { color: t.accent, fontSize: 16, fontWeight: '700' },
    legend: { color: t.textMuted, fontSize: 12, marginTop: space.xs },
    newBtn: { paddingVertical: space.md, marginTop: space.xs },
    newBtnText: { color: t.accent, fontSize: 15, fontWeight: '600' },
    form: { marginTop: space.sm, gap: space.md },
    input: {
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: 15,
      color: t.text
    },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    swatch: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 2, borderColor: 'transparent' },
    swatchActive: { borderColor: t.text },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
    btnGhost: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { backgroundColor: t.accent, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.lg, alignItems: 'center', minWidth: 88 },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
