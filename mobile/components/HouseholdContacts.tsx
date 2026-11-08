import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, TextInput, ScrollView, Pressable, TouchableOpacity, ActivityIndicator, Alert, Linking, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { Backend } from '../lib/useBackend'
import { ListSection, ListRow, ListEmpty } from './List'
import ActionSheet from './ActionSheet'
import BottomSheet from './BottomSheet'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import { showLabel } from '../lib/tooltip'

// The phone's household contacts (ADR-0046): the same records as desktop's My Library → Contacts,
// on the same rules (shared/household-contacts.mjs, backend lib/household-contacts.mjs). People who
// aren't on Nomad, such as the plumber, the school office or the babysitter. In a shared Space
// they're the household's: everyone who can edit adds and changes them, and each says who added it.
// Tap one to call, text, email or copy its number.

export interface HouseholdContact {
  id: string
  name: string
  role?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  by?: string
}
interface ContactList { space: string | null; shared: boolean; canWrite: boolean; contacts: HouseholdContact[] }
type Draft = { id?: string; name: string; role: string; phone: string; email: string; address: string; notes: string }

// shared/household-contacts.mjs ROLE_SUGGESTIONS
const ROLES = ['Family', 'Emergency', 'Doctor', 'Dentist', 'School', 'Babysitter', 'Neighbor', 'Plumber', 'Electrician', 'Vet']
const EMPTY: Draft = { name: '', role: '', phone: '', email: '', address: '', notes: '' }
const fold = (v?: string) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Every word typed, in any order, ignoring case and accents (the rule Notes and Reader use).
const matches = (c: HouseholdContact, q: string) => {
  const hay = fold([c.name, c.role, c.phone, c.email, c.address, c.notes, c.by].filter(Boolean).join(' '))
  return fold(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}
const dial = (phone?: string) => String(phone || '').replace(/[^0-9+*#,;]/g, '')

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string
  spaceName?: string
  onOpenDevices: () => void
}

export default function HouseholdContacts ({ visible, onClose, apps, onVaultChange, space, spaceName, onOpenDevices }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [list, setList] = useState<ContactList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<HouseholdContact | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    const res = await apps<ContactList>('contacts', 'list', { space })
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t read the contacts'); return }
    setError('')
    setList(res.value)
  }, [apps, space])

  useEffect(() => {
    if (!visible) return
    load()
    return onVaultChange(load)
  }, [visible, load, onVaultChange])

  const shown = useMemo(() => (list?.contacts || []).filter((c) => matches(c, query)), [list, query])
  const where = spaceName || 'this Space'

  const edit = (c?: HouseholdContact) => {
    setFormError('')
    setDraft(c ? { id: c.id, name: c.name, role: c.role || '', phone: c.phone || '', email: c.email || '', address: c.address || '', notes: c.notes || '' } : { ...EMPTY })
  }

  const save = async () => {
    if (!draft || !draft.name.trim()) return
    setSaving(true)
    setFormError('')
    const res = await apps<HouseholdContact>('contacts', 'save', { space, contact: draft })
    setSaving(false)
    if (!res.ok) { setFormError(res.message || 'Couldn’t save it'); return }
    setDraft(null)
    load()
  }

  const remove = (c: HouseholdContact) => {
    Alert.alert(`Remove ${c.name}?`, list?.shared ? `It goes for everyone in ${where}.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const res = await apps('contacts', 'delete', { space, id: c.id })
          if (!res.ok) Alert.alert('Couldn’t remove it', res.message || '')
          load()
        }
      }
    ])
  }

  const subtitleOf = (c: HouseholdContact) => [c.role, c.phone || c.email].filter(Boolean).join(' · ') || undefined
  const field = (key: keyof Draft, label: string, opts: { keyboard?: 'phone-pad' | 'email-address'; multiline?: boolean; autoFocus?: boolean } = {}) => (
    <TextInput
      style={[s.input, opts.multiline && s.inputMulti]}
      placeholder={label}
      placeholderTextColor={t.textMuted}
      accessibilityLabel={label}
      value={draft ? draft[key] : ''}
      onChangeText={(v) => { setDraft((d) => (d ? { ...d, [key]: v } : d)); setFormError('') }}
      keyboardType={opts.keyboard}
      autoCapitalize={opts.keyboard === 'email-address' ? 'none' : 'sentences'}
      autoCorrect={!opts.keyboard}
      multiline={opts.multiline}
      autoFocus={opts.autoFocus}
      editable={!saving}
    />
  )

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Contacts'
          subtitle={list ? (list.shared ? `${where}, shared` : where) : undefined}
          onBack={onClose}
          actions={list ? [{ icon: 'plus', label: 'Add a contact', onPress: () => edit(), disabled: !list.canWrite }] : undefined}
        />
        {noVault ? (
          <LinkPhone what='Contacts' onOpenDevices={onOpenDevices} />
        ) : error && !list ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
            {list.contacts.length > 5 ? (
              <TextInput
                style={[s.input, s.search]}
                placeholder='Search contacts'
                placeholderTextColor={t.textMuted}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            ) : null}
            <ListSection
              title={list.shared ? `${where}’s contacts` : `Contacts in ${where}`}
              footer={list.shared ? 'Everyone in this Space sees these.' : 'People who aren’t on Nomad, like the plumber or the school. Share this Space and the household sees them too.'}
            >
              {shown.length ? shown.map((c, i) => (
                <ListRow
                  key={c.id}
                  title={c.name}
                  subtitle={subtitleOf(c)}
                  icon={c.role === 'Emergency' ? 'first-aid' : 'user'}
                  divider={i > 0}
                  onPress={() => setPicked(c)}
                  onLongPress={() => setPicked(c)}
                />
              )) : <ListEmpty text={query ? `No matches for “${query}”` : 'None yet. Add the people your household calls: the doctor, the school, the babysitter.'} />}
            </ListSection>
          </ScrollView>
        )}

        <ActionSheet
          visible={!!picked}
          onClose={() => setPicked(null)}
          title={picked?.name}
          subtitle={[picked?.role, list?.shared && picked?.by ? `Added by ${picked.by}` : ''].filter(Boolean).join(' · ') || undefined}
          header={picked && (picked.address || picked.notes) ? (
            <View style={s.details}>
              {picked.address ? <Text style={s.detailText}>{picked.address}</Text> : null}
              {picked.notes ? <Text style={s.detailMuted}>{picked.notes}</Text> : null}
            </View>
          ) : undefined}
          groups={picked ? [
            [
              { label: `Call ${picked.phone}`, icon: 'phone-alt', hidden: !dial(picked.phone), onPress: () => Linking.openURL('tel:' + dial(picked.phone)).catch(() => {}) },
              { label: 'Send a text', icon: 'comment', hidden: !dial(picked.phone), onPress: () => Linking.openURL('sms:' + dial(picked.phone)).catch(() => {}) },
              { label: `Email ${picked.email}`, icon: 'envelope', hidden: !picked.email, onPress: () => Linking.openURL('mailto:' + picked.email).catch(() => {}) },
              { label: 'Copy number', icon: 'copy', hidden: !picked.phone, onPress: () => { Clipboard.setStringAsync(picked.phone || '').catch(() => {}); showLabel('Number copied') } }
            ],
            [
              { label: 'Edit', icon: 'pen', hidden: !list?.canWrite, onPress: () => edit(picked) },
              { label: 'Remove', icon: 'trash-alt', destructive: true, hidden: !list?.canWrite, onPress: () => remove(picked) }
            ]
          ] : []}
        />

        <BottomSheet visible={!!draft} onClose={() => setDraft(null)} style={s.sheet}>
          <Text style={s.sheetTitle}>{draft?.id ? 'Edit contact' : 'Add a contact'}</Text>
          <ScrollView style={s.sheetScroll} keyboardShouldPersistTaps='handled' contentContainerStyle={s.form}>
            {field('name', 'Name', { autoFocus: !draft?.id })}
            {field('role', 'Who are they? (doctor, school, …)')}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps='handled' contentContainerStyle={s.chips}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[s.chip, draft?.role === r && s.chipOn]}
                  onPress={() => setDraft((d) => (d ? { ...d, role: d.role === r ? '' : r } : d))}
                  accessibilityRole='button'
                  accessibilityState={{ selected: draft?.role === r }}
                >
                  <Text style={[s.chipText, draft?.role === r && s.chipTextOn]}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {field('phone', 'Phone', { keyboard: 'phone-pad' })}
            {field('email', 'Email', { keyboard: 'email-address' })}
            {field('address', 'Address', { multiline: true })}
            {field('notes', 'Notes', { multiline: true })}
            {formError ? <Text style={s.errText}>{formError}</Text> : null}
            <View style={s.formActions}>
              <TouchableOpacity style={s.btnGhost} onPress={() => setDraft(null)} disabled={saving}>
                <Text style={s.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, (!draft?.name.trim() || saving) && s.btnDisabled]} onPress={save} disabled={!draft?.name.trim() || saving}>
                {saving ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.btnText}>{draft?.id ? 'Save' : 'Add'}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: space.lg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    errText: { color: t.danger, fontSize: 14 },
    search: { marginBottom: space.lg },
    details: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.xs },
    detailText: { color: t.text, fontSize: 14 },
    detailMuted: { color: t.textDim, fontSize: 13 },
    sheet: { backgroundColor: t.surface, paddingHorizontal: space.lg, paddingBottom: space.lg, maxHeight: '90%' },
    sheetTitle: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.sm },
    sheetScroll: { flexGrow: 0 },
    form: { gap: space.md, paddingBottom: space.sm },
    input: { backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48, fontSize: 15, color: t.text },
    inputMulti: { minHeight: 72, paddingTop: space.md, textAlignVertical: 'top' },
    chips: { gap: space.sm },
    chip: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, justifyContent: 'center' },
    chipOn: { borderColor: t.accent, backgroundColor: t.trustBg },
    chipText: { color: t.textDim, fontSize: 14 },
    chipTextOn: { color: t.accent, fontWeight: '600' },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
    btnGhost: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xl, alignItems: 'center', minWidth: 88 },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
