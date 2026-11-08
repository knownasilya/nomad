import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet
} from 'react-native'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import IconButton from './IconButton'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { SPACE_COLORS, SPACE_NAME_MAX, PERSONAL_ID, type Space } from '../lib/useSpaces'

const COLOR_NAMES: Record<string, string> = {
  '#6c6cff': 'Blue',
  '#e85d4a': 'Red',
  '#e8a025': 'Orange',
  '#3ab36e': 'Green',
  '#2b9fd4': 'Sky blue',
  '#9b59b6': 'Purple',
  '#e91e8c': 'Pink',
  '#607d8b': 'Gray'
}

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
  // Rename and recolor a Space; delete it, or leave a shared one. Each resolves to an error, or null.
  onEdit?: (id: string, edit: { name: string; color: string }) => Promise<string | null>
  onRemove?: (id: string, action: 'delete' | 'leave') => Promise<string | null>
  // What an invite link says (ADR-0040), shown before joining. Rejects when it can't be read.
  onReadInvite?: (link: string) => Promise<InvitePreview>
  // An invite link the user opened from outside: the sheet opens on the join form with it filled in.
  initialInvite?: string | null
  // Invite people to a Space shared with other people (InviteSheet).
  onInvite?: (space: { rootDriveKey: string; name: string }) => void
}

export interface InvitePreview {
  title: string
  role: string
  check: 'ok' | 'unknown' | 'unsigned'
  expired: boolean
  from?: { name: string; profileTitle: string; nameDiffers: boolean } | null
}

// An invite link rather than a bare code: nomad-invite:… or the invite page with its # payload.
const isLink = (v: string) => /^nomad-invite:|^https?:\/\/[^/\s]+\/invite\/?#/i.test(v.trim())

function checkText (p: InvitePreview) {
  if (p.check === 'ok') return p.from?.nameDiffers ? `Signed by the Persona whose profile is named ${p.from.profileTitle}.` : 'Signed by their Persona. Nomad checked it.'
  if (p.check === 'unknown') return 'Nomad couldn’t reach their profile to check who sent it. Join only if you know who did.'
  return 'This invite isn’t signed, so nobody can check who sent it. Join only if you know who did.'
}

interface Editing { id: string; name: string; color: string; personal: boolean; shared: boolean; rootDriveKey?: string }

// Space switcher — a bottom sheet listing spaces (color dot + name + active check) with a create
// form, mirroring nomad desktop's spaces menu (app/fg/shell-menus/spaces.js).
export default function SpaceSwitcher ({ visible, onClose, spaces, activeSpaceId, vaultKeys, peopleKeys = [], onSwitch, onCreate, onJoin, onEdit, onRemove, onReadInvite, initialInvite, onInvite }: Props) {
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
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [reading, setReading] = useState(false)

  // A link opened from outside Nomad lands here, ready to join.
  useEffect(() => {
    if (!visible || !initialInvite) return
    setEditing(null)
    setCreating(false)
    setJoining(true)
    setCode(initialInvite)
    setJoinError('')
  }, [visible, initialInvite])

  // Read a pasted invite link so the user sees who it's from before joining.
  useEffect(() => {
    setPreview(null)
    if (!joining || !onReadInvite || !isLink(code)) return
    let live = true
    setReading(true)
    const timer = setTimeout(() => {
      onReadInvite(code.trim())
        .then((p) => { if (live) setPreview(p) })
        .catch((err) => { if (live) setJoinError((err as Error)?.message || String(err)) })
        .finally(() => { if (live) setReading(false) })
    }, 300)
    return () => { live = false; clearTimeout(timer); setReading(false) }
  }, [code, joining, onReadInvite])

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SPACE_COLORS[0])
  const [busy, setBusy] = useState(false)

  // Editing one Space: its name and color, and Delete (Leave, for a Space shared with other people).
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editError, setEditError] = useState('')

  const reset = () => {
    setEditing(null)
    setEditError('')
    setJoining(false)
    setCode('')
    setWaiting(false)
    setJoinError('')
    setPreview(null)
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

  const startEdit = (sp: Space) => {
    setCreating(false)
    setJoining(false)
    setEditError('')
    setEditing({
      id: sp.id,
      name: sp.name,
      color: sp.color,
      personal: sp.id === PERSONAL_ID,
      shared: !!sp.rootDriveKey && withPeople.has(sp.rootDriveKey),
      rootDriveKey: sp.rootDriveKey || undefined
    })
  }

  const save = async () => {
    if (!editing || !onEdit || !editing.name.trim()) return
    setBusy(true)
    setEditError('')
    const err = await onEdit(editing.id, { name: editing.name, color: editing.color })
    setBusy(false)
    if (err) setEditError(err)
    else setEditing(null)
  }

  const remove = () => {
    if (!editing || !onRemove) return
    const ed = editing
    const leave = ed.shared
    Alert.alert(
      leave ? `Leave ${ed.name}?` : `Delete ${ed.name}?`,
      leave
        ? 'It goes from all your devices. The others keep it, and you need a new invite to come back.'
        : 'Its tabs close and it goes from all your devices. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: leave ? 'Leave' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true)
            setEditError('')
            const err = await onRemove(ed.id, leave ? 'leave' : 'delete')
            setBusy(false)
            if (err) setEditError(err)
            else setEditing(null)
          }
        }
      ]
    )
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
      {editing ? (
        <View>
          <View style={s.editHeader}>
            <IconButton icon='arrow-left' label='Back to spaces' size={16} onPress={() => { setEditing(null); setEditError('') }} disabled={busy} />
            <Text style={s.editTitle}>Edit space</Text>
          </View>
          <View style={s.form}>
            <TextInput
              style={s.input}
              placeholder='Space name'
              placeholderTextColor={t.textMuted}
              accessibilityLabel='Space name'
              value={editing.name}
              maxLength={SPACE_NAME_MAX}
              onChangeText={(v) => { setEditing({ ...editing, name: v }); setEditError('') }}
              editable={!busy}
              onSubmitEditing={save}
            />
            <View style={s.swatches}>
              {SPACE_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.swatch, { backgroundColor: c }, editing.color === c && s.swatchActive]}
                  onPress={() => setEditing({ ...editing, color: c })}
                  accessibilityRole='button'
                  accessibilityLabel={COLOR_NAMES[c] || c}
                  accessibilityState={{ selected: editing.color === c }}
                />
              ))}
            </View>
            {editError ? <Text style={s.error}>{editError}</Text> : null}
            <View style={s.formActions}>
              <TouchableOpacity style={s.btnGhost} onPress={() => { setEditing(null); setEditError('') }} disabled={busy}>
                <Text style={s.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, (!editing.name.trim() || busy) && s.btnDisabled]} onPress={save} disabled={!editing.name.trim() || busy}>
                {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.btnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
          {editing.shared && editing.rootDriveKey && onInvite ? (
            <Pressable
              style={s.newBtn}
              onPress={() => { const ed = editing; reset(); onInvite({ rootDriveKey: ed.rootDriveKey!, name: ed.name }) }}
              disabled={busy}
              android_ripple={{ color: t.ripple }}
              accessibilityRole='button'
            >
              <View style={s.newIcon}><Icon name='user-plus' size={13} color={t.accent} /></View>
              <Text style={s.newBtnText}>Invite people</Text>
            </Pressable>
          ) : null}
          {editing.personal ? (
            <Text style={s.note}>Your Personal space can be renamed but not deleted.</Text>
          ) : onRemove ? (
            <Pressable style={s.newBtn} onPress={remove} disabled={busy} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
              <View style={s.newIcon}><Icon name={editing.shared ? 'sign-out-alt' : 'trash-alt'} size={13} color={t.danger} /></View>
              <Text style={s.dangerText}>{editing.shared ? 'Leave space' : 'Delete space'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
      <>
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
            {onEdit ? <IconButton icon='pen' label={`Edit ${sp.name}`} size={14} onPress={() => startEdit(sp)} style={s.editBtn} /> : null}
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
                placeholder='Invite link or code'
                placeholderTextColor={t.textMuted}
                value={code}
                onChangeText={(v) => { setCode(v); setJoinError('') }}
                autoCapitalize='none'
                autoCorrect={false}
                spellCheck={false}
                autoFocus={!initialInvite}
              />
              {reading ? <ActivityIndicator color={t.accent} /> : null}
              {preview ? (
                <View style={s.preview}>
                  <Text style={s.previewTitle}>{preview.title}.</Text>
                  {preview.role ? <Text style={s.previewText}>{preview.role}</Text> : null}
                  <Text style={[s.previewCheck, preview.check !== 'ok' && { color: t.warn }]}>{checkText(preview)}</Text>
                  {preview.expired ? <Text style={s.error}>This invite has run out. Ask for a new one.</Text> : null}
                </View>
              ) : null}
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
              <TouchableOpacity style={[s.btn, (!code.trim() || preview?.expired) && s.btnDisabled]} onPress={join} disabled={!code.trim() || !!preview?.expired}>
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
      </>
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
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingLeft: space.lg, paddingRight: space.xs, borderRadius: radius.md, overflow: 'hidden' },
    editBtn: { marginLeft: -space.xs },
    editHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: -space.sm },
    editTitle: { fontSize: 16, fontWeight: '600', color: t.text },
    note: { color: t.textMuted, fontSize: 13, paddingHorizontal: space.lg, marginTop: space.md },
    dangerText: { color: t.danger, fontSize: 15, fontWeight: '600' },
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
    error: { color: t.danger, fontSize: 13 },
    preview: { gap: 2, padding: space.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt },
    previewTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    previewText: { color: t.textDim, fontSize: 14 },
    previewCheck: { color: t.textMuted, fontSize: 13, marginTop: space.xs }
  })
}
