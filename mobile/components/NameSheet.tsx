import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import BottomSheet from './BottomSheet'
import LinkPhone from './LinkPhone'
import Icon from './Icon'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { NamesForUrl } from '../lib/useBackend'
import type { Names } from '../lib/useNames'

interface Props {
  visible: boolean
  onClose: () => void
  names: Names
  url: string
  title: string
  onOpenDevices: () => void
}

// Give the page in the active tab a short name (ADR-0018), like desktop's site-info panel: typing
// the name in the address bar, or opening hyper://<name>/, comes here. A name the AI gave shows here
// too; saving it keeps it, and from then on the address bar shows it. Names live in the Vault, so a
// name made here shows on the other Devices.
export default function NameSheet ({ visible, onClose, names, url, title, onOpenDevices }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [info, setInfo] = useState<NamesForUrl | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  // { value, previous } while the name field is open.
  const [editing, setEditing] = useState<{ value: string; previous?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await names.forUrl(url, title)
    setNoVault(!!r.noVault)
    setInfo(r.ok && r.value ? r.value : null)
    if (!r.ok && !r.noVault) setError(r.message || 'Couldn’t load your names')
    return r.ok ? r.value : null
  }, [names.forUrl, url, title])

  useEffect(() => {
    if (!visible) return
    setInfo(null); setError(''); setEditing(null); setNoVault(false)
    load().then((v) => {
      if (v && !v.named.length) setEditing({ value: v.suggested })
    })
  }, [visible, load])

  // Keeping the AI's name saves it unchanged: a name saved by the user drops its `auto` mark.
  const save = async (next = editing) => {
    if (!next || busy) return
    setBusy(true)
    setError('')
    const r = await names.set({ name: next.value, url, title, previous: next.previous })
    setBusy(false)
    if (!r.ok) { setError(r.message || 'Couldn’t save the name'); return }
    setEditing(null)
    await load()
  }

  const remove = async (name: string) => {
    setBusy(true)
    setError('')
    const r = await names.remove(name)
    setBusy(false)
    if (!r.ok) { setError(r.message || 'Couldn’t remove the name'); return }
    const v = await load()
    if (v && !v.named.length) setEditing({ value: v.suggested })
  }

  const named = info?.named[0]

  return (
    <BottomSheet visible={visible} onClose={onClose} style={s.sheet}>
      <Text style={s.title}>Name this site</Text>

      {noVault ? (
        <LinkPhone what='Names' onOpenDevices={onOpenDevices} />
      ) : !info ? (
        error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator style={s.spinner} color={t.accent} />
      ) : editing ? (
        <View style={s.form}>
          <View style={s.inputRow}>
            <Text style={s.affix}>hyper://</Text>
            <TextInput
              style={s.input}
              value={editing.value}
              onChangeText={(value) => setEditing({ ...editing, value })}
              placeholder='name'
              placeholderTextColor={t.textMuted}
              autoFocus
              autoCapitalize='none'
              autoCorrect={false}
              editable={!busy}
              onSubmitEditing={() => save()}
              returnKeyType='done'
            />
            <Text style={s.affix}>/</Text>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Text style={s.hint}>Then type the name in the address bar to come back here.</Text>
          <View style={s.actions}>
            <TouchableOpacity style={s.btnGhost} onPress={() => (named ? setEditing(null) : onClose())} disabled={busy}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, (!editing.value.trim() || busy) && s.btnDisabled]} onPress={() => save()} disabled={!editing.value.trim() || busy}>
              {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.btnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : named ? (
        <View style={s.form}>
          <View style={s.tagRow}>
            <View style={[s.tag, named.auto && s.tagAuto]}>
              {named.auto ? null : <Icon name='check' size={11} color={t.onAccent} />}
              <Text style={[s.tagText, named.auto && s.tagAutoText]}>hyper://{named.name}/</Text>
            </View>
          </View>
          {named.auto ? <Text style={s.hint}>Named by the AI, as you visit often. Keep it to see it in the address bar.</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.actions}>
            <TouchableOpacity style={s.btnGhost} onPress={() => remove(named.name)} disabled={busy}>
              <Text style={[s.btnGhostText, { color: t.danger }]}>Remove</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGhost} onPress={() => setEditing({ value: named.name, previous: named.name })} disabled={busy}>
              <Text style={s.btnGhostText}>Rename</Text>
            </TouchableOpacity>
            {named.auto ? (
              <TouchableOpacity style={s.btn} onPress={() => save({ value: named.name, previous: named.name })} disabled={busy}>
                <Text style={s.btnText}>Keep</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: t.surface,
      paddingHorizontal: space.xl,
      paddingBottom: space.xl
    },
    title: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.sm },
    spinner: { marginVertical: space.lg },
    form: { marginTop: space.xs, gap: space.md },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      minHeight: 48
    },
    affix: { color: t.textMuted, fontSize: 15 },
    input: { flex: 1, paddingVertical: space.sm, paddingHorizontal: 2, fontSize: 15, color: t.text },
    tagRow: { flexDirection: 'row' },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.secure, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
    tagText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    tagAuto: { backgroundColor: t.surfaceAlt },
    tagAutoText: { color: t.textDim },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17 },
    error: { color: t.danger, fontSize: 13 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
    btnGhost: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xl, alignItems: 'center', minWidth: 88 },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
