import { useMemo, useRef, useEffect } from 'react'
import { ScrollView, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'

export interface TabSummary {
  id: string
  title: string
  isHyper: boolean
  loading: boolean
}

interface Props {
  tabs: TabSummary[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

// Horizontal tab strip in nomad's chrome language: the current tab sits on the
// surface color with a blue highlight bar; others recede into the chrome bg.
export default function TabStrip ({ tabs, activeId, onSelect, onClose, onNew }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const scrollRef = useRef<ScrollView>(null)
  const tabX = useRef<Record<string, number>>({})

  useEffect(() => {
    const x = tabX.current[activeId]
    if (x !== undefined) {
      scrollRef.current?.scrollTo({ x: Math.max(0, x - 6), animated: true })
    } else {
      scrollRef.current?.scrollToEnd({ animated: true })
    }
  }, [activeId])

  return (
    <View style={s.bar}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll} style={s.scrollView}>
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <TouchableOpacity
              key={tab.id}
              activeOpacity={0.8}
              style={[s.tab, active && s.tabActive]}
              onPress={() => onSelect(tab.id)}
              onLayout={(e) => { tabX.current[tab.id] = e.nativeEvent.layout.x }}
            >
              {active && <View style={s.activeBar} />}
              <View style={s.fav}>
                {tab.loading
                  ? <ActivityIndicator size='small' color={t.accent} style={s.favSpinner} />
                  : <View style={[s.dot, { backgroundColor: tab.isHyper ? t.secure : t.textMuted }]} />}
              </View>
              <Text numberOfLines={1} style={[s.title, active && s.titleActive]}>
                {tab.title || 'New tab'}
              </Text>
              <TouchableOpacity hitSlop={10} onPress={() => onClose(tab.id)}>
                <Text style={s.close}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      <TouchableOpacity style={s.newTab} onPress={onNew} hitSlop={6}>
        <Text style={s.newTabText}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border
    },
    scroll: { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
    scrollView: { flex: 1 },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 168,
      height: 38,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      gap: 8,
      overflow: 'hidden',
      backgroundColor: t.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border
    },
    tabActive: { backgroundColor: t.surface },
    activeBar: { position: 'absolute', left: 8, right: 8, top: 0, height: 2, borderRadius: 2, backgroundColor: t.accentBar },
    fav: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
    favSpinner: { transform: [{ scale: 0.7 }] },
    dot: { width: 7, height: 7, borderRadius: radius.pill },
    title: { color: t.textDim, fontSize: 13, flexShrink: 1 },
    titleActive: { color: t.text, fontWeight: '600' },
    close: { color: t.textMuted, fontSize: 12, paddingLeft: 2 },
    newTab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    newTabText: { color: t.accent, fontSize: 24, fontWeight: '500' }
  })
}
