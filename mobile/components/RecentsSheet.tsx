import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Keyboard, Platform, StyleSheet, useWindowDimensions } from 'react-native'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import IconButton from './IconButton'
import SiteIcon from './SiteIcon'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { SavedSite } from '../lib/usePersistence'
import { useNameMatches, type Names } from '../lib/useNames'

interface Props {
  visible: boolean
  onClose: () => void
  // What the address bar holds when the card opens: the filter starts with it.
  initialQuery: string
  names: Names
  suggest: (query: string, limit?: number, opts?: { keepExact?: boolean }) => SavedSite[]
  iconFor: (url: string) => string | undefined
  onOpen: (url: string) => void
}

// The address bar's recent sites, in a card instead of a dropdown under the field. The bar's clock
// button opens it, with the filter already holding what was typed there. The user's names that
// match come first, as on desktop, then the sites and drives visited in this Space, newest first.
export default function RecentsSheet ({ visible, onClose, initialQuery, names, suggest, iconFor, onOpen }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { height: screenH } = useWindowDimensions()
  const [query, setQuery] = useState(initialQuery)
  // Each opening starts from what the address bar holds now.
  useEffect(() => { if (visible) setQuery(initialQuery) }, [visible, initialQuery])

  const nameMatches = useNameMatches(names, query)
  const items = useMemo((): Array<SavedSite & { name?: string }> => {
    const named = nameMatches.map((r) => ({ url: `hyper://${r.name}/`, title: r.title || r.url, ts: 0, name: r.name }))
    const seen = new Set(named.map((n) => n.url.toLowerCase()))
    const recent = suggest(query, 50, { keepExact: true }).filter((r) => !seen.has(r.url.toLowerCase()))
    return [...named, ...recent]
  }, [suggest, query, nameMatches])

  const open = (url: string) => { Keyboard.dismiss(); onClose(); onOpen(url) }
  const q = query.trim()

  return (
    <BottomSheet visible={visible} onClose={onClose} style={[s.sheet, { maxHeight: screenH * 0.85 }]}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole='header'>Recent sites</Text>
      </View>
      <View style={s.searchWrap}>
        <Icon name='search' size={14} color={t.textMuted} />
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder='Filter recent sites'
          placeholderTextColor={t.textMuted}
          autoCapitalize='none'
          autoCorrect={false}
          keyboardType='url'
          returnKeyType='search'
          accessibilityLabel='Filter recent sites'
        />
        {query ? (
          <IconButton icon='times-circle' label='Clear the filter' onPress={() => setQuery('')} size={16} color={t.textMuted} ripple={t.ripple} style={s.clear} />
        ) : null}
      </View>
      <ScrollView style={s.list} keyboardShouldPersistTaps='handled' bounces={false}>
        {items.length === 0 ? (
          <Text style={s.empty}>{q ? `No recent sites match “${q}”.` : 'Pages you visit appear here.'}</Text>
        ) : items.map((it, i) => (
          <Pressable
            key={it.url}
            style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && Platform.OS !== 'android' && s.pressed]}
            android_ripple={{ color: t.ripple }}
            onPress={() => open(it.url)}
            accessibilityRole='button'
            accessibilityLabel={it.name ? `${it.title}, your name ${it.name}` : `${it.title}, ${it.url}`}
          >
            <SiteIcon url={it.url} title={it.title} uri={iconFor(it.url)} size={28} />
            <View style={s.text}>
              <Text numberOfLines={1} style={s.rowTitle}>{it.title}</Text>
              {it.name ? (
                <View style={s.nameRow}>
                  <View style={s.nameTag}>
                    <Icon name='check' size={9} color={t.onAccent} />
                    <Text numberOfLines={1} style={s.nameTagText}>{it.name}</Text>
                  </View>
                </View>
              ) : (
                <Text numberOfLines={1} style={s.rowUrl}>{it.url}</Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingBottom: space.sm },
    head: { paddingHorizontal: space.xl, paddingBottom: space.md },
    title: { color: t.text, fontSize: 16, fontWeight: '600' },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      marginHorizontal: space.lg,
      marginBottom: space.sm,
      paddingLeft: 14,
      borderRadius: radius.pill,
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border
    },
    search: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    clear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    list: { flexGrow: 0, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.xl - 4 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    pressed: { backgroundColor: t.surfaceAlt },
    text: { flex: 1, paddingVertical: space.sm },
    rowTitle: { color: t.text, fontSize: 15, fontWeight: '500' },
    rowUrl: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    nameRow: { flexDirection: 'row', marginTop: 3 },
    nameTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.secure, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, maxWidth: 200 },
    nameTagText: { color: t.onAccent, fontSize: 11, fontWeight: '700' },
    empty: { color: t.textMuted, fontSize: 13, paddingHorizontal: space.xl, paddingVertical: space.lg, lineHeight: 19 }
  })
}
