import { useMemo, useState, type Ref } from 'react'
import { View, TextInput, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { DriveType } from '../lib/hyperUrl'
import Icon, { type IconName } from './Icon'
import IconButton from './IconButton'

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
  hasDraft?: boolean // drive has unpublished draft changes (ADR-0012)
  draftPreviewing?: boolean // this tab is rendering the merged draft
  onToggleDraft?: () => void
  siteName?: string // the user's own name for this drive (ADR-0018), shown in a green tag
  inputRef?: Ref<TextInput> // lets the browser focus the field, e.g. on a new tab from the tab grid
  canReload?: boolean // false on a new tab, which has nothing to reload
}

// nomad-style location bar: back/forward, and a rounded field with a leading trust icon (a lock
// for https, the peer-to-peer mark for hyper://, as desktop's location bar), the Draft preview
// toggle, and reload. While the field has focus the trailing button clears it instead; the
// keyboard's Go key opens what was typed.
export default function AddressBar (props: Props) {
  const { value, onChangeText, onSubmit, onReload, loading, isHyper, canBack, canForward, onBack, onForward, onFocus, onBlur, hasDraft, draftPreviewing, onToggleDraft, siteName, inputRef, canReload = true } = props
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [focused, setFocused] = useState(false)
  const secure = /^https:\/\//i.test(value)
  const lead: IconName = focused || !value ? 'search' : isHyper ? 'share-alt' : secure ? 'lock' : 'info-circle'

  return (
    <View style={s.row}>
      <IconButton icon='arrow-left' label='Back' onPress={onBack} disabled={!canBack} color={t.text} style={s.navBtn} />
      <IconButton icon='arrow-right' label='Forward' onPress={onForward} disabled={!canForward} color={t.text} style={s.navBtn} />
      <View style={[s.inputWrap, focused && s.inputFocused, !focused && isHyper && s.inputHyper]}>
        {/* A drive the user named shows its name in a green tag with a check, as on desktop. */}
        {isHyper && siteName && !focused ? (
          <View style={s.nameTag} accessibilityLabel={`Your name for this site: hyper://${siteName}/`}>
            <Icon name='check' size={10} color={t.onAccent} />
            <Text style={s.nameTagText} numberOfLines={1}>{siteName}</Text>
          </View>
        ) : (
          <Icon name={lead} size={14} color={!focused && isHyper ? t.secure : t.textMuted} style={s.lead} />
        )}
        <TextInput
          ref={inputRef}
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={() => { setFocused(true); onFocus?.() }}
          onBlur={() => { setFocused(false); onBlur?.() }}
          placeholder='Search or enter address'
          placeholderTextColor={t.textMuted}
          autoCapitalize='none'
          autoCorrect={false}
          keyboardType='url'
          returnKeyType='go'
          selectTextOnFocus
        />
        {hasDraft && !focused ? (
          <IconButton
            icon='pen-nib'
            label={draftPreviewing ? 'Stop previewing the Draft' : 'Preview the Draft'}
            onPress={onToggleDraft}
            active={draftPreviewing}
            size={15}
            style={[s.inBtn, draftPreviewing && s.draftActive]}
          />
        ) : null}
        {focused && value ? (
          <IconButton icon='times-circle' label='Clear' onPress={() => onChangeText('')} size={16} color={t.textMuted} style={s.inBtn} />
        ) : !focused && canReload ? (
          // While a drive is still connecting, the spinner is the button: tap it to try again.
          loading
            ? <IconButton label='Connecting. Tap to retry' onPress={onReload} style={s.inBtn}><ActivityIndicator size='small' color={t.accent} /></IconButton>
            : <IconButton icon='redo-alt' label='Reload' onPress={onReload} size={15} style={s.inBtn} />
        ) : null}
      </View>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bg,
      paddingLeft: 2,
      paddingRight: 10,
      paddingTop: 4,
      paddingBottom: 6
    },
    navBtn: { width: 42 },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.inputBg,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.border,
      paddingLeft: 14,
      marginLeft: 4,
      height: 44
    },
    inputFocused: { borderColor: t.accent },
    inputHyper: { borderColor: t.scheme === 'dark' ? t.border : t.trustBg },
    lead: { marginRight: 10, width: 16, textAlign: 'center' },
    nameTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.secure, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8, maxWidth: 140 },
    nameTagText: { color: t.onAccent, fontSize: 12, fontWeight: '700' },
    input: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    inBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    draftActive: { backgroundColor: t.trustBg, borderRadius: radius.pill }
  })
}
