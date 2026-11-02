import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, ScrollView, Image, Pressable, ActivityIndicator, Alert, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'
import type { Backend } from '../lib/useBackend'
import { pickAvatar } from '../lib/pickImages'
import ScreenHeader from './ScreenHeader'
import ActionSheet from './ActionSheet'
import KeyboardInset from './KeyboardInset'
import Icon from './Icon'

interface Props {
  visible: boolean
  onClose: () => void
  onMade: (label: string) => void
  apps: Backend['apps']
  editId?: string | null // edit this Persona instead of making one
}

interface PersonaDetail {
  id: string
  label: string
  email: string
  title: string
  description: string
  thumb: string | null
  loaded: boolean
  writable: boolean
}

type Field = 'title' | 'label' | 'about' | 'email'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Make or edit a Persona on the phone (ADR-0031 amendment). A new one is a profile drive this phone
// writes, with a name, a picture and a few words, plus a private label and email on the Vault record.
// Editing changes the same fields; the profile's are in its drive, which every one of the user's
// devices writes once the device that made it has added this phone (until then they are locked).
//
// The form is a full-screen Modal, so React Native's Keyboard events never reach it on Android and
// the window isn't resized (edge-to-edge). KeyboardInset reads the keyboard's height in this window;
// the ScrollView gets that much padding at the bottom, and the focused field is scrolled above it.
export default function NewPersona ({ visible, onClose, onMade, apps, editId = null }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [title, setTitle] = useState('')
  const [label, setLabel] = useState('')
  const [about, setAbout] = useState('')
  const [email, setEmail] = useState('')
  const [thumb, setThumb] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [keyboard, setKeyboard] = useState(0)
  const [focus, setFocus] = useState<Field | null>(null)
  const [orig, setOrig] = useState<PersonaDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const fieldY = useRef<Partial<Record<Field, number>>>({})
  const editing = !!editId
  const profileLocked = editing && !!orig && !orig.writable

  const load = async () => {
    if (!editId) return
    setLoading(true)
    const res = await apps<PersonaDetail>('personas', 'get', { id: editId })
    setLoading(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load the Persona'); return }
    const p = res.value
    setOrig(p)
    setTitle(p.title); setLabel(p.label); setAbout(p.description); setEmail(p.email); setThumb(p.thumb)
  }

  useEffect(() => {
    if (!visible) return
    setTitle(''); setLabel(''); setAbout(''); setEmail(''); setThumb(null); setError(''); setBusy(false); setOrig(null)
    if (editId) load()
  }, [visible, editId])

  // Keep the field being typed in above the keyboard.
  useEffect(() => {
    if (!keyboard || !focus) return
    const y = fieldY.current[focus]
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - space.xl), animated: true })
  }, [keyboard, focus])

  const at = (f: Field) => (e: LayoutChangeEvent) => { fieldY.current[f] = e.nativeEvent.layout.y }
  const badEmail = !!email.trim() && !EMAIL.test(email.trim())
  const canMake = editing
    ? !!orig && !!label.trim() && (profileLocked || !!title.trim()) && !badEmail && !busy
    : !!title.trim() && !badEmail && !busy

  const pick = async (source: 'camera' | 'library') => {
    setPicking(false)
    try {
      const url = await pickAvatar(source)
      if (url) setThumb(url)
    } catch (err) {
      Alert.alert('Couldn’t use that picture', err instanceof Error ? err.message : String(err))
    }
  }

  const save = async () => {
    if (!orig) return
    const args: Record<string, unknown> = { id: orig.id, label: label.trim(), email: email.trim() }
    if (!profileLocked) {
      if (title.trim() !== orig.title) args.title = title.trim()
      if (about.trim() !== orig.description) args.description = about.trim()
      if (thumb !== orig.thumb) args.thumb = thumb
    }
    const res = await apps<{ id: string; label: string }>('personas', 'update', args)
    setBusy(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t save the Persona'); return }
    onMade(res.value.label)
  }

  const make = async () => {
    if (!canMake) return
    setBusy(true)
    setError('')
    if (editing) return save()
    const res = await apps<{ id: string; label: string }>('personas', 'create', {
      title: title.trim(),
      label: label.trim() || 'Me',
      description: about.trim(),
      email: email.trim(),
      thumb: thumb || undefined
    })
    setBusy(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t make the Persona'); return }
    onMade(res.value.label)
  }

  const locked = (f: Field) => profileLocked && (f === 'title' || f === 'about')
  const input = (f: Field, props: React.ComponentProps<typeof TextInput>) => (
    <TextInput
      {...props}
      style={[s.input, props.multiline && s.multiline, focus === f && s.inputFocus, f === 'email' && badEmail && s.inputBad, locked(f) && s.inputLocked]}
      placeholderTextColor={t.textMuted}
      editable={!busy && !locked(f) && !loading}
      onFocus={() => setFocus(f)}
      onBlur={() => setFocus((x) => (x === f ? null : x))}
    />
  )

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={busy ? () => {} : onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <KeyboardInset onChange={setKeyboard} />
        <ScreenHeader title={editing ? 'Edit Persona' : 'New Persona'} onBack={busy ? undefined : onClose} />
        <ScrollView
          ref={scroll}
          contentContainerStyle={[s.page, { paddingBottom: space.xl + keyboard }]}
          keyboardShouldPersistTaps='handled'
        >
          {editing ? (
            loading ? <ActivityIndicator color={t.accent} style={s.loading} /> : profileLocked ? (
              <View style={s.notice}>
                <Text style={s.noticeText}>
                  {orig?.loaded
                    ? 'This phone can’t change the name, picture or words yet. Keep the device that made this Persona online for a minute and it adds this phone. You can change the label and email now.'
                    : 'This phone hasn’t got the profile drive yet. Keep the device that made this Persona online. You can change the label and email now.'}
                </Text>
                <Text style={s.noticeLink} onPress={busy ? undefined : load}>Check again</Text>
              </View>
            ) : null
          ) : (
            <Text style={s.intro}>
              A Persona is who you are when a site asks you to log in. This phone makes a profile drive for it: the
              name, picture and words sites see when you let them.
            </Text>
          )}

          <View style={s.pictureRow}>
            <Pressable
              onPress={() => setPicking(true)}
              disabled={busy || profileLocked || loading}
              style={s.avatarBtn}
              android_ripple={{ color: t.ripple, borderless: true }}
              accessibilityLabel={thumb ? 'Change picture' : 'Add a picture'}
            >
              {thumb
                ? <Image source={{ uri: thumb }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarEmpty]}>
                    {title.trim()
                      ? <Text style={s.avatarText}>{title.trim().slice(0, 1).toUpperCase()}</Text>
                      : <Icon name='camera' size={22} color={t.onAccent} />}
                  </View>}
            </Pressable>
            <View style={s.pictureText}>
              <Text style={[s.pictureLink, (profileLocked || loading) && s.off]} onPress={busy || profileLocked || loading ? undefined : () => setPicking(true)}>
                {thumb ? 'Change picture' : 'Add a picture'}
              </Text>
              <Text style={s.hint}>Optional. Sites you let see your profile show it.</Text>
            </View>
          </View>

          <View onLayout={at('title')} style={s.field}>
            <Text style={s.label}>Name <Text style={s.hint}>What sites see</Text></Text>
            {input('title', {
              value: title,
              onChangeText: setTitle,
              placeholder: 'Ada Lovelace',
              maxLength: 280,
              autoCapitalize: 'words',
              returnKeyType: 'next'
            })}
          </View>

          <View onLayout={at('label')} style={s.field}>
            <Text style={s.label}>Label <Text style={s.hint}>Only you see it</Text></Text>
            {input('label', {
              value: label,
              onChangeText: setLabel,
              placeholder: 'Me, Work, Gaming…',
              maxLength: 40,
              returnKeyType: 'next'
            })}
          </View>

          <View onLayout={at('about')} style={s.field}>
            <Text style={s.label}>About <Text style={s.hint}>Optional, also public</Text></Text>
            {input('about', {
              value: about,
              onChangeText: setAbout,
              placeholder: 'A few words about you',
              maxLength: 1000,
              multiline: true,
              textAlignVertical: 'top'
            })}
          </View>

          <View onLayout={at('email')} style={s.field}>
            <Text style={s.label}>Email <Text style={s.hint}>Optional, private</Text></Text>
            {input('email', {
              value: email,
              onChangeText: setEmail,
              placeholder: 'you@example.com',
              maxLength: 254,
              keyboardType: 'email-address',
              autoCapitalize: 'none',
              autoCorrect: false,
              autoComplete: 'email',
              returnKeyType: 'done',
              onSubmitEditing: make
            })}
            <Text style={[s.hint, s.below, badEmail && s.bad]}>
              {badEmail
                ? 'That doesn’t look like an email address.'
                : 'A site gets it only when you say yes. Sites that get the same email can tell it’s you.'}
            </Text>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            onPress={make}
            disabled={!canMake}
            style={[s.primary, !canMake && s.primaryOff]}
            android_ripple={{ color: t.ripple }}
          >
            {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.primaryText}>{editing ? 'Save' : 'Make Persona'}</Text>}
          </Pressable>
          <Text style={[s.hint, s.footer]}>
            {editing
              ? 'Changes reach your other devices and the sites you let see your profile.'
              : 'Keep this phone online for a while after, so your computer can get the new profile drive.'}
          </Text>
        </ScrollView>
        <ActionSheet
          visible={picking}
          onClose={() => setPicking(false)}
          title='Picture'
          groups={[[
            { label: 'Take a photo', icon: 'camera', onPress: () => pick('camera') },
            { label: 'Choose from photos', icon: 'image', onPress: () => pick('library') },
            { label: 'Remove picture', icon: 'trash', destructive: true, hidden: !thumb, onPress: () => { setPicking(false); setThumb(null) } }
          ]]}
        />
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: space.lg },
    intro: { color: t.textDim, fontSize: 14, lineHeight: 20, marginBottom: space.lg },
    pictureRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.lg },
    avatarBtn: { borderRadius: radius.pill },
    avatar: { width: 72, height: 72, borderRadius: 36 },
    avatarEmpty: { backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: t.onAccent, fontSize: 28, fontWeight: '700' },
    pictureText: { flex: 1, gap: 2 },
    pictureLink: { color: t.accent, fontSize: 15, fontWeight: '600', paddingVertical: space.xs },
    field: { marginBottom: space.lg },
    label: { color: t.text, fontSize: 14, fontWeight: '600', marginBottom: space.xs + 2 },
    hint: { color: t.textMuted, fontSize: 12, fontWeight: '400', lineHeight: 17 },
    below: { marginTop: space.xs + 2 },
    bad: { color: t.warn },
    input: {
      minHeight: touch,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: t.border,
      backgroundColor: t.inputBg,
      color: t.text,
      fontSize: 15
    },
    multiline: { minHeight: 88, paddingTop: space.md },
    inputFocus: { borderColor: t.accent },
    inputBad: { borderColor: t.warn },
    inputLocked: { opacity: 0.55 },
    off: { opacity: 0.45 },
    loading: { marginVertical: space.lg },
    notice: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: t.border,
      backgroundColor: t.surface,
      padding: space.md,
      marginBottom: space.lg,
      gap: space.sm
    },
    noticeText: { color: t.textDim, fontSize: 13, lineHeight: 19 },
    noticeLink: { color: t.accent, fontSize: 14, fontWeight: '600' },
    error: { color: t.danger, fontSize: 14, marginBottom: space.md },
    primary: {
      minHeight: touch,
      borderRadius: radius.md,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    },
    primaryOff: { opacity: 0.45 },
    primaryText: { color: t.onAccent, fontSize: 16, fontWeight: '600' },
    footer: { marginTop: space.md, textAlign: 'center' }
  })
}
