import { useMemo, useState, type Ref } from 'react'
import { View, TextInput, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import { tintTheme } from '../lib/siteTheme'
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
  onFocus?: () => void
  onBlur?: () => void
  hasDraft?: boolean // drive has unpublished draft changes (ADR-0012)
  draftPreviewing?: boolean // this tab is rendering the merged draft
  onToggleDraft?: () => void
  siteName?: string // the user's own name for this drive (ADR-0018), shown in a green tag
  inputRef?: Ref<TextInput> // lets the browser focus the field, e.g. on a new tab from the tab grid
  canReload?: boolean // false on a new tab, which has nothing to reload or connect to
  tint?: string // the site's theme color (lib/siteTheme.ts); the app's own colors without one
  topInset?: number // the status bar's height: the bar paints behind it, in its own color
  space: { name: string; color: string; onPress: () => void }
  aiOpen?: boolean
  onAi: () => void
  tabCount: number
  onTabs: () => void
  onMenu: () => void
}

// The browser's one bar, at the top as in Chrome: the Space, the address field (a leading trust icon,
// a lock for https or the peer-to-peer mark for hyper:// as on desktop, and the Draft preview
// toggle), the AI, the tab grid and the menu. Back is the system back; forward, reload and the rest
// are in the menu, as in Chrome, which leaves the address room. While the field has focus it takes the whole row and its trailing button clears it; the
// keyboard's Go key opens what was typed. The bar takes on the site's theme color when it has one.
export default function AddressBar (props: Props) {
  const { value, onChangeText, onSubmit, onReload, loading, isHyper, onFocus, onBlur, hasDraft, draftPreviewing, onToggleDraft, siteName, inputRef, canReload = true, tint, topInset = 0, space, aiOpen, onAi, tabCount, onTabs, onMenu } = props
  const base = useTheme()
  const t = useMemo(() => tintTheme(base, tint), [base, tint])
  const s = useMemo(() => makeStyles(t, !!tint), [t, tint])
  const [focused, setFocused] = useState(false)
  const secure = /^https:\/\//i.test(value)
  const lead: IconName = focused || !value ? 'search' : isHyper ? 'share-alt' : secure ? 'lock' : 'info-circle'
  // On a site's color, the green and blue marks could vanish; the bar's own text color can't.
  const trustColor = tint ? t.textDim : t.secure

  return (
    <View style={[s.bar, { paddingTop: topInset }]}>
      <View style={s.row}>
        {focused ? null : (
          <Pressable
            style={s.spaceBtn}
            onPress={space.onPress}
            android_ripple={{ color: t.ripple, borderless: true, radius: 22 }}
            accessibilityRole='button'
            accessibilityLabel={`Space: ${space.name}. Switch space`}
          >
            <View style={s.spaceRing}>
              <View style={[s.spaceDot, { backgroundColor: space.color }]} />
            </View>
          </Pressable>
        )}
        <View style={[s.inputWrap, focused && s.inputFocused, !focused && isHyper && !tint && s.inputHyper]}>
          {/* A drive the user named shows its name in a green tag with a check, as on desktop. */}
          {isHyper && siteName && !focused ? (
            <View style={s.nameTag} accessibilityLabel={`Your name for this site: hyper://${siteName}/`}>
              <Icon name='check' size={10} color={base.onAccent} />
              <Text style={s.nameTagText} numberOfLines={1}>{siteName}</Text>
            </View>
          ) : (
            <Icon name={lead} size={14} color={!focused && isHyper ? trustColor : t.textMuted} style={s.lead} />
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
            selectionColor={tint ? t.text : undefined}
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
              color={draftPreviewing ? t.accent : t.textDim}
              ripple={t.ripple}
              size={15}
              style={[s.inBtn, draftPreviewing && s.draftActive]}
            />
          ) : null}
          {focused && value ? (
            <IconButton icon='times-circle' label='Clear' onPress={() => onChangeText('')} size={16} color={t.textMuted} ripple={t.ripple} style={s.inBtn} />
          ) : !focused && canReload && loading ? (
            // While a drive is still connecting, a spinner is the button: tap it to try again.
            <IconButton label='Connecting. Tap to retry' onPress={onReload} ripple={t.ripple} style={s.inBtn}><ActivityIndicator size='small' color={t.accent} /></IconButton>
          ) : null}
        </View>
        {focused ? null : (
          <>
            <IconButton icon='robot' label='AI assistant' onPress={onAi} color={aiOpen ? t.accent : t.textDim} ripple={t.ripple} style={s.btn} />
            {/* Chrome's tab switcher button: the open-tab count in a rounded square. Past 99 it gives
                up and grins, as Chrome does. */}
            <IconButton onPress={onTabs} label={`${tabCount} open ${tabCount === 1 ? 'tab' : 'tabs'}`} ripple={t.ripple} style={s.btn}>
              <View style={s.tabCount}>
                <Text style={s.tabCountText}>{tabCount > 99 ? ':D' : tabCount}</Text>
              </View>
            </IconButton>
            <IconButton icon='ellipsis-v' label='Menu' onPress={onMenu} color={t.textDim} ripple={t.ripple} style={s.menuBtn} />
          </>
        )}
      </View>
    </View>
  )
}

function makeStyles (t: Theme, tinted: boolean) {
  return StyleSheet.create({
    bar: { backgroundColor: t.bg },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 4,
      paddingRight: 0,
      paddingTop: 4,
      paddingBottom: 6,
      minHeight: 54
    },
    spaceBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
    spaceRing: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.inputBg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
    spaceDot: { width: 12, height: 12, borderRadius: radius.pill },
    btn: { width: 42 },
    menuBtn: { width: 38 },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.inputBg,
      borderRadius: radius.pill,
      borderWidth: tinted ? 0 : 1,
      borderColor: t.border,
      paddingLeft: 14,
      marginLeft: 2,
      marginRight: 2,
      height: 44
    },
    inputFocused: { borderWidth: 1, borderColor: t.accent, marginLeft: 8, marginRight: 8 },
    inputHyper: { borderColor: t.scheme === 'dark' ? t.border : t.trustBg },
    lead: { marginRight: 10, width: 16, textAlign: 'center' },
    nameTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.secure, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8, maxWidth: 140 },
    nameTagText: { color: t.onAccent, fontSize: 12, fontWeight: '700' },
    input: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    inBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    draftActive: { backgroundColor: t.trustBg, borderRadius: radius.pill },
    tabCount: { minWidth: 22, height: 22, paddingHorizontal: 3, borderRadius: 6, borderWidth: 2, borderColor: t.textDim, alignItems: 'center', justifyContent: 'center' },
    tabCountText: { color: t.textDim, fontSize: 11, fontWeight: '700' }
  })
}
