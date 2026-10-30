import { useMemo } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { SavedSite } from '../lib/usePersistence'
import Icon from './Icon'

// URL-bar autocomplete dropdown: recently-visited sites + known drives for the active space,
// filtered by what's typed. Floats over the top of the page (anchored just below the address bar)
// so it never shifts content down. elevation (Android) + zIndex (iOS) + a shadow lift it above page
// content, including WebViews. Capped by the caller; we scroll if the keyboard squeezes it.
// An item with `name` is one of the user's names (ADR-0018): it shows hyper://<name>/ in a green tag.
export default function Suggestions ({ items, onSelect }: { items: Array<SavedSite & { name?: string }>; onSelect: (url: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  if (!items.length) return null
  return (
    <View style={s.wrap}>
      <ScrollView style={s.scroll} keyboardShouldPersistTaps='handled' keyboardDismissMode='none'>
        {items.map((it, i) => (
          <Pressable
            key={it.url}
            style={[s.row, i > 0 && s.divider]}
            android_ripple={{ color: t.ripple }}
            onPress={() => onSelect(it.url)}
          >
            <View style={s.lead}>
              {it.name
                ? <Icon name='tag' size={14} color={t.secure} />
                : it.url.startsWith('hyper://')
                  ? <Icon name='share-alt' size={14} color={t.secure} />
                  : <Icon name='history' size={14} color={t.textMuted} />}
            </View>
            <View style={s.text}>
              <Text numberOfLines={1} style={s.title}>{it.title}</Text>
              {it.name
                ? <View style={s.nameRow}><Text numberOfLines={1} style={s.nameTag}>✓ {it.name}</Text></View>
                : <Text numberOfLines={1} style={s.url}>{it.url}</Text>}
            </View>
          </Pressable>
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
    lead: { width: 20, alignItems: 'center' },
    text: { flex: 1, paddingVertical: 8 },
    title: { color: t.text, fontSize: 14, fontWeight: '500' },
    url: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    nameRow: { flexDirection: 'row', marginTop: 2 },
    nameTag: { backgroundColor: t.secure, color: t.onAccent, fontSize: 11, fontWeight: '700', borderRadius: 5, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 1 }
  })
}
