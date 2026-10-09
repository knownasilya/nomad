import { useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import { hyperKeyOf, isHyperUrl, normalizeUrl, resolveAddress, shortKey } from '../lib/hyperUrl'
import type { SavedSite } from '../lib/usePersistence'
import SiteIcon from './SiteIcon'

const ICON = 30

interface Props {
  pins: SavedSite[]
  iconFor: (url: string) => string | undefined
  suggest: (query: string, limit?: number) => SavedSite[]
  onOpen: (url: string) => void
  onAdd: (url: string, title: string) => void
  onRemove: (url: string) => void
}

// Pinned shortcuts on the home page, like desktop's new tab page — the same pins, synced through
// the space's Root Drive. Tap to open, long-press to remove, ＋ to add one.
export default function Shortcuts ({ pins, iconFor, suggest, onOpen, onAdd, onRemove }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [adding, setAdding] = useState(false)

  const confirmRemove = (pin: SavedSite) => {
    Alert.alert(pin.title, 'Remove this shortcut from the home page?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onRemove(pin.url) }
    ])
  }

  return (
    <View style={s.grid}>
      {pins.map((pin) => (
        <TouchableOpacity
          key={pin.url}
          style={s.tile}
          activeOpacity={0.7}
          onPress={() => onOpen(pin.url)}
          onLongPress={() => confirmRemove(pin)}
          accessibilityLabel={pin.title}
          accessibilityHint='Long-press to remove'
        >
          <View style={s.iconBox}>
            <SiteIcon url={pin.url} title={pin.title} uri={iconFor(pin.url)} size={ICON} />
          </View>
          <Text numberOfLines={2} style={s.label}>{pin.title}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={s.tile} activeOpacity={0.7} onPress={() => setAdding(true)} accessibilityLabel='Add shortcut'>
        <View style={[s.iconBox, s.addBox]}>
          <Text style={s.addText}>＋</Text>
        </View>
        <Text numberOfLines={2} style={[s.label, s.addLabel]}>Add</Text>
      </TouchableOpacity>

      <AddShortcut
        visible={adding}
        pins={pins}
        iconFor={iconFor}
        suggest={suggest}
        onClose={() => setAdding(false)}
        onPick={(url, title) => { setAdding(false); onAdd(url, title) }}
      />
    </View>
  )
}

// Desktop's "Create shortcut": search what you've visited, or type an address.
function AddShortcut ({ visible, pins, iconFor, suggest, onClose, onPick }: {
  visible: boolean
  pins: SavedSite[]
  iconFor: (url: string) => string | undefined
  suggest: (query: string, limit?: number) => SavedSite[]
  onClose: () => void
  onPick: (url: string, title: string) => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [query, setQuery] = useState('')
  const pinned = useMemo(() => new Set(pins.map((p) => normalizeUrl(p.url))), [pins])
  const results = useMemo(() => suggest(query, 40), [suggest, query])
  // A typed address that isn't already a result gets its own row at the top.
  const typed = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    const url = resolveAddress(q).url
    return results.some((r) => normalizeUrl(r.url) === normalizeUrl(url)) ? null : url
  }, [query, results])

  const close = () => { setQuery(''); onClose() }
  // A typed address has no title yet: name it after its site (example.com, or a short drive key).
  const typedName = (url: string) =>
    isHyperUrl(url) ? shortKey(hyperKeyOf(url)) : url.replace(/^[a-z]+:\/\/(www\.)?/i, '').replace(/\/$/, '')
  const pick = (url: string, title: string) => { setQuery(''); onPick(url, title) }

  const row = (url: string, title: string, key: string) => {
    const already = pinned.has(normalizeUrl(url))
    return (
      <TouchableOpacity key={key} style={s.row} disabled={already} activeOpacity={0.7} onPress={() => pick(url, title)}>
        <SiteIcon url={url} title={title} uri={iconFor(url)} size={28} />
        <View style={s.rowText}>
          <Text numberOfLines={1} style={s.rowTitle}>{title}</Text>
          <Text numberOfLines={1} style={s.rowUrl}>{url}</Text>
        </View>
        {already && <Text style={s.rowPinned}>Added</Text>}
      </TouchableOpacity>
    )
  }

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={close} presentationStyle='fullScreen'>
      <SafeAreaView style={s.sheet} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Add shortcut</Text>
          <TouchableOpacity onPress={close} hitSlop={10} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder='Search your history or enter an address'
          placeholderTextColor={t.textMuted}
          autoCapitalize='none'
          autoCorrect={false}
          keyboardType='url'
          returnKeyType='done'
          autoFocus
          onSubmitEditing={() => { if (typed) pick(typed, typedName(typed)) }}
        />
        {/* A Modal on Android never hears the keyboard (see AiPanel), so the list keeps room at the
            bottom for its last rows to scroll up above it. */}
        <ScrollView style={s.list} contentContainerStyle={s.listPad} keyboardShouldPersistTaps='handled'>
          {typed && row(typed, typedName(typed), 'typed')}
          {results.map((r) => row(r.url, r.title, r.url))}
          {!typed && results.length === 0 && (
            <Text style={s.empty}>Pages you visit show up here. You can also type an address.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18, marginHorizontal: -4 },
    tile: { width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 },
    iconBox: {
      width: 52,
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center'
    },
    addBox: { backgroundColor: 'transparent', borderStyle: 'dashed', borderWidth: 1.5 },
    addText: { color: t.accent, fontSize: 24, lineHeight: 28 },
    label: { color: t.text, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 15 },
    addLabel: { color: t.textMuted },
    sheet: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
    title: { color: t.text, fontSize: 20, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    search: {
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.md,
      backgroundColor: t.inputBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      color: t.text,
      fontSize: 15
    },
    list: { flex: 1 },
    listPad: { paddingBottom: 360 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    rowText: { flex: 1 },
    rowTitle: { color: t.text, fontSize: 15, fontWeight: '500' },
    rowUrl: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    rowPinned: { color: t.textMuted, fontSize: 12 },
    empty: { color: t.textMuted, fontSize: 13, padding: 16, lineHeight: 19 }
  })
}
