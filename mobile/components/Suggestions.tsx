import { useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { SavedSite } from '../lib/usePersistence'

// URL-bar autocomplete dropdown: recently-visited sites + known drives for the active space,
// filtered by what's typed. Floats over the top of the page (anchored just below the address bar)
// so it never shifts content down. elevation (Android) + zIndex (iOS) + a shadow lift it above page
// content, including WebViews. Capped by the caller; we scroll if the keyboard squeezes it.
export default function Suggestions ({ items, onSelect }: { items: SavedSite[]; onSelect: (url: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  if (!items.length) return null
  return (
    <View style={s.wrap}>
      <ScrollView style={s.scroll} keyboardShouldPersistTaps='handled' keyboardDismissMode='none'>
        {items.map((it, i) => (
          <TouchableOpacity
            key={it.url}
            style={[s.row, i > 0 && s.divider]}
            activeOpacity={0.7}
            onPress={() => onSelect(it.url)}
          >
            <View style={[s.dot, { backgroundColor: it.url.startsWith('hyper://') ? t.secure : t.textMuted }]} />
            <View style={s.text}>
              <Text numberOfLines={1} style={s.title}>{it.title}</Text>
              <Text numberOfLines={1} style={s.url}>{it.url}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: t.surface,
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
      // Float above page content: zIndex for iOS, elevation for Android (which ignores zIndex),
      // plus a drop shadow so it reads as a floating layer.
      zIndex: 1000,
      elevation: 12,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 }
    },
    scroll: { maxHeight: 312 },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, gap: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    text: { flex: 1, paddingVertical: 8 },
    title: { color: t.text, fontSize: 14, fontWeight: '500' },
    url: { color: t.textMuted, fontSize: 12, marginTop: 1 }
  })
}
