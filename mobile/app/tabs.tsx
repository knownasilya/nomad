import { useMemo, useRef } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, Image, ActivityIndicator, Animated, PanResponder, LayoutAnimation, Alert,
  StyleSheet, useWindowDimensions
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, router } from 'expo-router'
import { useTheme, radius, type Theme } from '../lib/theme'
import { useTabSnapshot, tabActions, type TabCard } from '../lib/tabSwitcher'
import SiteIcon from '../components/SiteIcon'

const GAP = 12
// Card body shape (width / height), close to a phone page so a thumbnail reads at a glance.
const BODY_ASPECT = 0.8

// Back to the browser screen. A cold start straight onto /tabs has nothing under it, so replace.
function leave () {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

// The tab switcher: every open tab in the active space as a card in a two-column grid, like
// Chrome's tab grid. Tap a card to switch to it, ✕ or swipe it sideways to close it, ＋ for a new
// tab. The tabs themselves stay in the browser screen; see lib/tabSwitcher.ts.
export default function TabGrid () {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { width } = useWindowDimensions()
  const { tabs, activeId, spaceName, spaceColor } = useTabSnapshot()
  const scrollRef = useRef<ScrollView>(null)
  const scrolled = useRef(false)

  if (!tabs.length || !tabActions()) return <Redirect href='/' />

  const cardWidth = Math.floor((width - GAP * 3) / 2)
  const count = `${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}`

  const select = (id: string) => { tabActions()?.select(id); leave() }
  const openNew = () => { tabActions()?.open(); leave() }
  const close = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    tabActions()?.close(id)
  }
  const closeAll = () => {
    Alert.alert('Close all tabs?', `This closes ${count} in ${spaceName || 'this space'}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close all', style: 'destructive', onPress: () => { tabActions()?.closeAll(); leave() } }
    ])
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.header}>
        {!!spaceColor && <View style={[s.spaceDot, { backgroundColor: spaceColor }]} />}
        <Text style={s.headerTitle} numberOfLines={1}>{spaceName || 'Tabs'}</Text>
        <Text style={s.headerCount}>{count}</Text>
      </View>

      <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.grid}>
        {tabs.map((tab) => (
          <Card
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            width={cardWidth}
            swipeDistance={width}
            onSelect={() => select(tab.id)}
            onClose={() => close(tab.id)}
            // Open with the current tab in view, the way Chrome does.
            onActiveLayout={(y) => {
              if (scrolled.current) return
              scrolled.current = true
              scrollRef.current?.scrollTo({ y: Math.max(0, y - GAP), animated: false })
            }}
          />
        ))}
      </ScrollView>

      <View style={s.bottomBar}>
        <TouchableOpacity style={s.barSide} onPress={closeAll} hitSlop={8}>
          <Text style={s.barText}>Close all</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.newBtn} onPress={openNew} accessibilityLabel='New tab'>
          <Text style={s.newBtnText}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.barSide, s.barRight]} onPress={leave} hitSlop={8}>
          <Text style={[s.barText, s.barDone]}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function Card ({ tab, active, width, swipeDistance, onSelect, onClose, onActiveLayout }: {
  tab: TabCard
  active: boolean
  width: number
  swipeDistance: number
  onSelect: () => void
  onClose: () => void
  onActiveLayout: (y: number) => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const dx = useRef(new Animated.Value(0)).current
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Swipe sideways to close. Claims the gesture only once it is clearly horizontal, so the grid
  // still scrolls vertically. Every animation here runs on the JS driver: the pan feeds dx from JS,
  // and one value can't be shared between the two drivers.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: Animated.event([null, { dx }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) > width * 0.45 || Math.abs(g.vx) > 0.9) {
        const dir = Math.sign(g.dx || g.vx) || 1
        Animated.timing(dx, { toValue: dir * swipeDistance, duration: 150, useNativeDriver: false }).start(() => closeRef.current())
      } else {
        Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start()
      }
    },
    onPanResponderTerminate: () => Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start()
  }), [dx, width, swipeDistance])

  const opacity = dx.interpolate({ inputRange: [-width, 0, width], outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' })
  const bodyHeight = Math.round(width / BODY_ASPECT)

  return (
    <Animated.View
      style={[s.card, active && s.cardActive, { width, opacity, transform: [{ translateX: dx }] }]}
      onLayout={active ? (e) => onActiveLayout(e.nativeEvent.layout.y) : undefined}
      {...pan.panHandlers}
    >
      <TouchableOpacity activeOpacity={0.85} onPress={onSelect} accessibilityLabel={`Switch to ${tab.title}`}>
        <View style={s.cardHead}>
          <View style={s.fav}>
            {tab.loading
              ? <ActivityIndicator size='small' color={t.accent} style={s.favSpinner} />
              : tab.icon && tab.url
                ? <SiteIcon url={tab.url} title={tab.title} uri={tab.icon} size={16} />
                : <View style={[s.dot, { backgroundColor: tab.kind === 'hyper' ? t.secure : t.textMuted }]} />}
          </View>
          <Text numberOfLines={1} style={[s.cardTitle, active && s.cardTitleActive]}>{tab.title || 'New tab'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={`Close ${tab.title}`}>
            <Text style={s.cardClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.cardBody, { height: bodyHeight }]}>
          {tab.thumb
            ? <Image source={{ uri: tab.thumb.uri }} style={{ width: '100%', aspectRatio: tab.thumb.aspect }} />
            : <Placeholder tab={tab} />}
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

// Shown until the tab has been on screen once, which is when its thumbnail is taken.
function Placeholder ({ tab }: { tab: TabCard }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  if (tab.kind === 'home') {
    return (
      <View style={s.placeholder}>
        <Image source={require('../assets/images/nomad-logo.png')} style={s.placeholderLogo} />
      </View>
    )
  }
  const host = tab.url.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]
  const letter = (tab.title && tab.title !== 'Loading…' ? tab.title : host).trim().charAt(0).toUpperCase() || '?'
  return (
    <View style={s.placeholder}>
      <View style={s.placeholderMark}><Text style={s.placeholderLetter}>{letter}</Text></View>
      <Text numberOfLines={1} style={s.placeholderHost}>{host}</Text>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 52 },
    spaceDot: { width: 10, height: 10, borderRadius: radius.pill },
    headerTitle: { color: t.text, fontSize: 17, fontWeight: '700', flexShrink: 1 },
    headerCount: { color: t.textMuted, fontSize: 14 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GAP, paddingTop: 4, paddingBottom: GAP * 2 },
    card: {
      borderRadius: radius.lg,
      backgroundColor: t.surface,
      borderWidth: 2,
      borderColor: t.border,
      overflow: 'hidden'
    },
    cardActive: { borderColor: t.accent },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 34 },
    fav: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
    favSpinner: { transform: [{ scale: 0.7 }] },
    dot: { width: 7, height: 7, borderRadius: radius.pill },
    cardTitle: { flex: 1, color: t.textDim, fontSize: 13 },
    cardTitleActive: { color: t.text, fontWeight: '600' },
    cardClose: { color: t.textMuted, fontSize: 13, paddingHorizontal: 2 },
    cardBody: { overflow: 'hidden', backgroundColor: t.bg },
    placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 },
    placeholderLogo: { width: 52, height: 52, borderRadius: radius.pill, opacity: 0.9 },
    placeholderMark: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    placeholderLetter: { color: t.textDim, fontSize: 22, fontWeight: '700' },
    placeholderHost: { color: t.textMuted, fontSize: 12, maxWidth: '100%' },
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 64,
      paddingHorizontal: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      backgroundColor: t.bg
    },
    barSide: { flex: 1 },
    barRight: { alignItems: 'flex-end' },
    barText: { color: t.accent, fontSize: 16 },
    barDone: { fontWeight: '600' },
    newBtn: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    newBtnText: { color: t.onAccent, fontSize: 26, lineHeight: 30 }
  })
}
