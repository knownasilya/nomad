import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Feed, FeedPost, ReaderState } from '../lib/useBackend'
import LinkPhone from './LinkPhone'

// One Feed's load state: posts once it loads, or why it didn't.
interface FeedLoad { url: string; title: string; posts: FeedPost[]; loading: boolean; error?: string }

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  space?: string // the active Space's Root Drive key: each Space has its own subscriptions
  onOpenPost: (url: string) => void
  onOpenDevices: () => void
}

// The phone's Reader (ADR-0017): the Feeds the active Space subscribes to, from any linked Device,
// merged into one list, newest first. Subscriptions and read marks live in the Vault, per Space, so
// they match desktop's nomad://reader. Opening a post closes this and loads the post in the current tab.
export default function Reader ({ visible, onClose, apps, space, onOpenPost, onOpenDevices }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  // backend.apps is a new function on every parent render. Calling through a ref keeps the effects
  // below from re-running (and reloading) on each one.
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args) => appsRef.current(app, action, args)) as Backend['apps'], [])
  const [state, setState] = useState<ReaderState | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [feeds, setFeeds] = useState<Record<string, FeedLoad>>({})
  const [filter, setFilter] = useState<string>('all')
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)
  // Bumped on every refresh, so a slow Feed from an older refresh can't overwrite a newer one.
  const generation = useRef(0)

  const loadFeeds = useCallback((follows: string[]) => {
    const gen = ++generation.current
    setFeeds((prev) => {
      const next: Record<string, FeedLoad> = {}
      for (const url of follows) next[url] = { url, title: prev[url]?.title || url, posts: prev[url]?.posts || [], loading: true }
      return next
    })
    for (const url of follows) {
      call<Feed>('reader', 'feed', { url }).then((res) => {
        if (gen !== generation.current) return
        setFeeds((prev) => ({
          ...prev,
          [url]: res.ok && res.value
            ? { url, title: res.value.title, posts: res.value.posts, loading: false }
            : { url, title: prev[url]?.title || url, posts: [], loading: false, error: res.message || 'Can’t load this feed' }
        }))
      })
    }
  }, [call])

  const refresh = useCallback(async () => {
    setError('')
    if (!space) { setError('This Space isn’t ready yet. Open it once, then try again.'); return }
    const res = await call<ReaderState>('reader', 'state', { space })
    if (res.noVault) { setNoVault(true); setState(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your subscriptions'); return }
    setState(res.value)
    loadFeeds(res.value.follows)
  }, [call, loadFeeds, space])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])

  const read = useMemo(() => new Set(state?.read || []), [state])
  const allPosts = useMemo(() => {
    const posts = Object.values(feeds).flatMap((f) => f.posts)
    return posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }, [feeds])
  const posts = filter === 'all' ? allPosts : allPosts.filter((p) => p.feedUrl === filter)
  const unread = posts.filter((p) => !read.has(p.url)).length
  const loadingAny = Object.values(feeds).some((f) => f.loading)

  // Feeds that loaded hand over their current posts, so marks for deleted posts are dropped.
  const saveRead = useCallback(async (add: string[]) => {
    if (!state) return
    setState({ ...state, read: [...new Set([...state.read, ...add])] })
    const loaded: Record<string, string[]> = {}
    for (const f of Object.values(feeds)) if (!f.loading && !f.error) loaded[f.url] = f.posts.map((p) => p.url)
    const res = await call<ReaderState>('reader', 'saveRead', { space, add, loaded })
    if (res.ok && res.value) setState(res.value)
  }, [call, feeds, state, space])

  const openPost = (p: FeedPost) => {
    if (!read.has(p.url)) saveRead([p.url])
    onOpenPost(p.url)
  }

  const subscribe = async () => {
    const url = addUrl.trim()
    if (!url) return
    setAdding(true)
    const res = await call<ReaderState>('reader', 'follow', { space, url })
    setAdding(false)
    if (!res.ok || !res.value) return Alert.alert('Couldn’t subscribe', res.message || 'Unknown error')
    setAddUrl('')
    setState(res.value)
    loadFeeds(res.value.follows)
  }

  const unsubscribe = (f: FeedLoad) => {
    Alert.alert('Unsubscribe?', `Stop following ${f.title} on all your devices?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsubscribe',
        style: 'destructive',
        onPress: async () => {
          const res = await call<ReaderState>('reader', 'unfollow', { space, url: f.url })
          if (!res.ok || !res.value) return Alert.alert('Couldn’t unsubscribe', res.message || 'Unknown error')
          if (filter === f.url) setFilter('all')
          setState(res.value)
          loadFeeds(res.value.follows)
        }
      }
    ])
  }

  const feedList = (state?.follows || []).map((url) => feeds[url]).filter(Boolean) as FeedLoad[]
  const current = filter === 'all' ? null : feeds[filter]

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Reader</Text>
          <View style={s.headerActions}>
            {state && (
              <TouchableOpacity onPress={refresh} hitSlop={10} style={s.close} disabled={loadingAny}>
                {loadingAny ? <ActivityIndicator color={t.textDim} /> : <Text style={s.closeText}>↻</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}>
              <Text style={s.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {noVault ? (
          <LinkPhone what='Reader' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !state ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <>
            {feedList.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
                <Chip s={s} label='All' active={filter === 'all'} onPress={() => setFilter('all')} />
                {feedList.map((f) => (
                  <Chip
                    key={f.url}
                    s={s}
                    label={f.title}
                    active={filter === f.url}
                    error={!!f.error}
                    onPress={() => setFilter(f.url)}
                    onLongPress={() => unsubscribe(f)}
                  />
                ))}
              </ScrollView>
            )}

            <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
              {!state.writable && (
                <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
              )}

              {posts.length > 0 && (
                <View style={s.countRow}>
                  <Text style={s.countText}>{unread} unread</Text>
                  {unread > 0 && (
                    <TouchableOpacity onPress={() => saveRead(posts.filter((p) => !read.has(p.url)).map((p) => p.url))} hitSlop={8}>
                      <Text style={s.action}>Mark all read</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {posts.length > 0 ? (
                <View style={s.card}>
                  {posts.map((p, i) => (
                    <PostRow key={p.url} p={p} read={read.has(p.url)} divider={i > 0} s={s} onPress={() => openPost(p)} />
                  ))}
                </View>
              ) : feedList.length === 0 ? (
                <Text style={s.empty}>No subscriptions yet. Add a feed’s hyper:// address below, or subscribe from nomad://reader on your computer.</Text>
              ) : current?.error ? (
                <Text style={s.empty}>Can’t load {current.title}. It may be offline.{'\n'}Long-press its name above to unsubscribe.</Text>
              ) : loadingAny ? (
                <View style={s.loadingRow}><ActivityIndicator color={t.accent} /><Text style={s.countText}>Loading feeds…</Text></View>
              ) : (
                <Text style={s.empty}>No posts yet.</Text>
              )}

              <View style={s.addCard}>
                <Text style={s.addLabel}>Add a feed</Text>
                <View style={s.addRow}>
                  <TextInput
                    style={s.addInput}
                    value={addUrl}
                    onChangeText={setAddUrl}
                    placeholder='hyper://…'
                    placeholderTextColor={t.textMuted}
                    autoCapitalize='none'
                    autoCorrect={false}
                    spellCheck={false}
                    onSubmitEditing={subscribe}
                    returnKeyType='done'
                  />
                  <TouchableOpacity style={[s.addBtn, (adding || !addUrl.trim()) && s.addBtnOff]} onPress={subscribe} disabled={adding || !addUrl.trim()}>
                    <Text style={s.addBtnText}>{adding ? '…' : 'Subscribe'}</Text>
                  </TouchableOpacity>
                </View>
                {feedList.length > 0 && <Text style={s.addHint}>Long-press a feed’s name to unsubscribe.</Text>}
              </View>
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function PostRow ({ p, read, divider, s, onPress }: { p: FeedPost; read: boolean; divider: boolean; s: Styles; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.post, divider && s.rowDivider]} activeOpacity={0.7} onPress={onPress}>
      <View style={[s.unreadDot, read && s.dotRead]} />
      <View style={s.postText}>
        <Text numberOfLines={1} style={s.postFeed}>{p.feedTitle}</Text>
        <Text numberOfLines={2} style={[s.postTitle, read && s.postTitleRead]}>{p.title}</Text>
        {!!p.summary && <Text numberOfLines={2} style={s.postSummary}>{p.summary}</Text>}
        {!!p.createdAt && <Text style={s.postDate}>{formatDate(p.createdAt)}</Text>}
      </View>
    </TouchableOpacity>
  )
}

function Chip ({ label, active, error, onPress, onLongPress, s }: { label: string; active: boolean; error?: boolean; onPress: () => void; onLongPress?: () => void; s: Styles }) {
  return (
    <TouchableOpacity style={[s.chip, active && s.chipActive]} onPress={onPress} onLongPress={onLongPress}>
      <Text numberOfLines={1} style={[s.chipText, active && s.chipTextActive, error && s.chipTextErr]}>{label}</Text>
    </TouchableOpacity>
  )
}

function formatDate (iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    title: { color: t.text, fontSize: 20, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    chipsContent: { paddingHorizontal: 10, paddingBottom: 8, gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md, maxWidth: 200 },
    chipActive: { backgroundColor: t.trustBg },
    chipText: { color: t.textDim, fontSize: 13, fontWeight: '500' },
    chipTextActive: { color: t.trustText, fontWeight: '700' },
    chipTextErr: { color: t.danger },
    page: { padding: 16 },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center', marginTop: 30 },
    countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
    countText: { color: t.textMuted, fontSize: 12 },
    action: { color: t.accent, fontSize: 13, fontWeight: '500' },
    loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 30 },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    post: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
    unreadDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: t.accent, marginTop: 5 },
    dotRead: { backgroundColor: 'transparent' },
    postText: { flex: 1 },
    postFeed: { color: t.textMuted, fontSize: 12, fontWeight: '600' },
    postTitle: { color: t.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
    postTitleRead: { color: t.textDim, fontWeight: '500' },
    postSummary: { color: t.textDim, fontSize: 13, lineHeight: 18, marginTop: 2 },
    postDate: { color: t.textMuted, fontSize: 12, marginTop: 4 },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 },
    addCard: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: 12, marginTop: 18 },
    addLabel: { color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addInput: { flex: 1, height: 42, color: t.text, fontSize: 14, backgroundColor: t.inputBg, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: 10 },
    addBtn: { backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10 },
    addBtnOff: { opacity: 0.4 },
    addBtnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    addHint: { color: t.textMuted, fontSize: 12, marginTop: 8 }
  })
}
