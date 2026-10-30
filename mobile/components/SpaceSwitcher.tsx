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
  peopleKeys?: string[] // Spaces shared with other people (ADR-0029)
  onSwitch: (id: string) => void
  onCreate: (opts: { name: string; color: string }) => Promise<unknown> | unknown
  // Join a shared Space with a code from its owner. Resolves once they approve; rejects with why not.
  onJoin?: (opts: { code: string; name: string }) => Promise<unknown>
}

// Space switcher — a bottom sheet listing spaces (color dot + name + active check) with a create
// form, mirroring nomad desktop's spaces menu (app/fg/shell-menus/spaces.js).
export default function SpaceSwitcher ({ visible, onClose, spaces, activeSpaceId, vaultKeys, peopleKeys = [], onSwitch, onCreate, onJoin }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const shared = new Set(vaultKeys)
  const withPeople = new Set(peopleKeys)
  const anyShared = spaces.some((sp) => sp.rootDriveKey && shared.has(sp.rootDriveKey) && !withPeople.has(sp.rootDriveKey))
  const anyPeople = spaces.some((sp) => sp.rootDriveKey && withPeople.has(sp.rootDriveKey))

  // Joining a shared Space: a code, the name the others see, then a wait for an owner to approve.
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  const [ownName, setOwnName] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [joinError, setJoinError] = useState('')

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SPACE_COLORS[0])
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setJoining(false)
    setCode('')
    setWaiting(false)
    setJoinError('')
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

  const join = async () => {
    if (!onJoin || !code.trim()) return
    setWaiting(true)
    setJoinError('')
    try {
      await onJoin({ code: code.trim(), name: ownName.trim() })
      reset()
      onClose()
    } catch (err) {
      setJoinError((err as Error)?.message || String(err))
      setWaiting(false)
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
            {sp.rootDriveKey && withPeople.has(sp.rootDriveKey)
              ? <Icon name='user-friends' size={13} color={t.accent} style={s.shared} />
              : sp.rootDriveKey && shared.has(sp.rootDriveKey)
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
      {anyPeople ? (
        <View style={s.legendRow}>
          <Icon name='user-friends' size={11} color={t.accent} />
          <Text style={s.legend}>Shared with other people</Text>
        </View>
      ) : null}

      {joining ? (
        <View style={s.form}>
          {waiting ? (
            <View style={s.waitRow}>
              <ActivityIndicator color={t.accent} />
              <Text style={s.waitText}>Waiting for an owner to approve you…</Text>
            </View>
          ) : (
            <>
              <TextInput
                style={s.input}
                placeholder='Code'
                placeholderTextColor={t.textMuted}
                value={code}
                onChangeText={(v) => { setCode(v); setJoinError('') }}
                autoCapitalize='none'
                autoCorrect={false}
                spellCheck={false}
                autoFocus
              />
              <TextInput
                style={s.input}
                placeholder='Your name, as the others see it'
                placeholderTextColor={t.textMuted}
                value={ownName}
                onChangeText={setOwnName}
                onSubmitEditing={join}
              />
            </>
          )}
          {joinError ? <Text style={s.error}>{joinError}</Text> : null}
          <View style={s.formActions}>
            <TouchableOpacity style={s.btnGhost} onPress={reset}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            {waiting ? null : (
              <TouchableOpacity style={[s.btn, !code.trim() && s.btnDisabled]} onPress={join} disabled={!code.trim()}>
                <Text style={s.btnText}>Join</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : creating ? (
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
      {onJoin && !creating && !joining ? (
        <Pressable style={s.newBtn} onPress={() => setJoining(true)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
          <View style={s.newIcon}><Icon name='sign-in-alt' size={13} color={t.accent} /></View>
          <Text style={s.newBtnText}>Join a shared space</Text>
        </Pressable>
      ) : null}
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
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' },
    waitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
    waitText: { color: t.textDim, fontSize: 14 },
    error: { color: t.danger, fontSize: 13 }
  })
}
