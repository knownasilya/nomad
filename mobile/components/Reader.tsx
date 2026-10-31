import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Feed, FeedPost, ReaderState, SavedArticle, WebFeed } from '../lib/useBackend'
import ActionSheet from './ActionSheet'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import Canvas, { type CanvasHandle, type CanvasSnapshot } from './Canvas'

const VIEW_KEY = 'nomad-reader-view' // 'list' or 'canvas', the last one used

// One Feed's load state: posts once it loads, or why it didn't.
interface FeedLoad { url: string; title: string; posts: FeedPost[]; loading: boolean; error?: string }

const isWeb = (url: string) => /^(https?|feeds?):\/\//i.test(url)
const MAX_FEED_BYTES = 5 * 1024 * 1024

// The app fetches an RSS or Atom feed (the backend has no web fetch) and the backend parses it
// (shared/web-feeds.mjs). For a web page, the backend answers with the feeds it links to.
async function fetchWebFeed (call: Backend['apps'], url: string): Promise<{ ok: boolean; value?: WebFeed; message?: string }> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    const res = await fetch(url.replace(/^feeds?:\/\//i, 'https://'), {
      signal: ctrl.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5' }
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return { ok: false, message: `The site answered ${res.status}` }
    const text = (await res.text()).slice(0, MAX_FEED_BYTES)
    const parsed = await call<WebFeed>('reader', 'parseFeed', { url, text })
    return { ok: parsed.ok, value: parsed.value, message: parsed.message }
  } catch (err: any) {
    return { ok: false, message: err?.name === 'AbortError' ? 'The site took too long to answer' : 'Can’t reach that site' }
  }
}

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: each Space has its own subscriptions
  onOpenPost: (url: string) => void
  onOpenDevices: () => void
}

// The phone's Reader (ADR-0017): the Feeds the active Space subscribes to, from any linked Device,
// merged into one list, newest first. Subscriptions and read marks live in the Vault, per Space, so
// they match desktop's nomad://reader. Another Device's change shows while this is open. Opening a
// post closes this and loads the post in the current tab. Pages saved to Reader on a computer
// (ADR-0033) show under Saved, by topic; opening one marks it read and loads it in the tab.
// The header's Canvas button swaps the list for desktop's Reader canvas (Canvas.tsx): saved
// articles gathered around their topics, posts around their feed. A chip lights up its topic or
// feed there. Tap a dot to see it below; tap it again, or Open, to read it.
export default function Reader ({ visible, onClose, apps, onVaultChange, space, onOpenPost, onOpenDevices }: Props) {
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
  // 'all' | a feed's URL | 'saved' | 'topic:<name>'
  const [filter, setFilter] = useState<string>('all')
  const [menuFor, setMenuFor] = useState<SavedArticle | null>(null)
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)
  // The list, or the canvas. The last one used comes back next time.
  const [view, setView] = useState<'list' | 'canvas'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const canvasRef = useRef<CanvasHandle>(null)
  const snapshot = useRef<CanvasSnapshot | null>(null)
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY).then((v) => { if (v === 'canvas') setView('canvas') }).catch(() => {})
  }, [])
  const showView = (next: 'list' | 'canvas') => {
    setView(next)
    setSelectedId(null)
    AsyncStorage.setItem(VIEW_KEY, next).catch(() => {})
  }
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
      const load: Promise<{ ok: boolean; value?: Feed; message?: string }> = isWeb(url)
        ? fetchWebFeed(call, url).then((r) => (r.ok && r.value && !r.value.posts ? { ok: false, message: 'That address isn’t a feed' } : r))
        : call<Feed>('reader', 'feed', { url })
      load.then((res) => {
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

  // Another Device subscribed, unsubscribed or read something (our own writes land here too). Only a
  // change to the subscriptions reloads the Feeds; new read marks just update the list.
  const stateRef = useRef(state)
  stateRef.current = state
  // Marks still being saved, so a reload from the Vault in the meantime doesn't drop them.
  const pendingRead = useRef(new Set<string>())
  useEffect(() => {
    if (!visible) return
    return onVaultChange(async () => {
      if (!space) return
      const before = stateRef.current
      if (!before) return refresh() // linked while open, or the first load failed
      const res = await call<ReaderState>('reader', 'state', { space })
      if (!res.ok || !res.value) return
      setState({ ...res.value, read: [...new Set([...res.value.read, ...pendingRead.current])] })
      if (res.value.follows.join(' ') !== before.follows.join(' ')) {
        setFilter((f) => (f === 'all' || f === 'saved' || f.startsWith('topic:') || res.value!.follows.includes(f) ? f : 'all'))
        loadFeeds(res.value.follows)
      }
    })
  }, [visible, onVaultChange, call, refresh, loadFeeds, space])

  // hyper:// posts read, plus RSS and Atom items read (kept per feed in web-read.json).
  const read = useMemo(() => new Set([...(state?.read || []), ...Object.values(state?.webRead || {}).flat()]), [state])
  // Feed posts' topics, from a computer's AI or the user (shared/reader-articles.mjs post-topics).
  const postTopics = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of state?.postTopics || []) if (r.topics?.length) m.set(r.url, r.topics)
    return m
  }, [state])
  const allPosts = useMemo(() => {
    const posts = Object.values(feeds).flatMap((f) => f.posts)
    return posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }, [feeds])
  const savedView = filter === 'saved' || filter.startsWith('topic:')
  const articles = state?.articles || []
  // Topics count saved articles and the posts in the feeds that loaded.
  const topicList = useMemo(
    () => topicCounts([...articles.map((a) => a.topics || []), ...allPosts.map((p) => postTopics.get(p.url) || [])]),
    [articles, allPosts, postTopics]
  )
  const topicName = filter.startsWith('topic:') ? filter.slice(6).toLowerCase() : ''
  const hasTopic = (topics: string[] | undefined) => (topics || []).some((t) => t.toLowerCase() === topicName)
  const shownArticles = filter === 'saved' ? articles : topicName ? articles.filter((a) => hasTopic(a.topics)) : []
  // A topic shows feed posts too, under the articles.
  const topicPosts = topicName ? allPosts.filter((p) => hasTopic(postTopics.get(p.url))) : []
  const posts = savedView ? [] : filter === 'all' ? allPosts : allPosts.filter((p) => p.feedUrl === filter)
  const unread = savedView
    ? shownArticles.filter((a) => !a.readAt).length + topicPosts.filter((p) => !read.has(p.url)).length
    : posts.filter((p) => !read.has(p.url)).length
  const loadingAny = Object.values(feeds).some((f) => f.loading)

  // Feeds that loaded hand over their current posts, so marks for deleted posts are dropped.
  const saveRead = useCallback(async (add: string[]) => {
    if (!state) return
    setState({ ...state, read: [...new Set([...state.read, ...add])] })
    for (const u of add) pendingRead.current.add(u)
    const loaded: Record<string, string[]> = {}
    for (const f of Object.values(feeds)) if (!f.loading && !f.error) loaded[f.url] = f.posts.map((p) => p.url)
    const res = await call<ReaderState>('reader', 'saveRead', { space, add, loaded })
    for (const u of add) pendingRead.current.delete(u)
    if (res.ok && res.value) setState(res.value)
  }, [call, feeds, state, space])

  const markArticle = useCallback(async (a: SavedArticle, isRead: boolean) => {
    if (!state) return
    setState({ ...state, articles: articles.map((x) => (x.id === a.id ? { ...x, readAt: isRead ? new Date().toISOString() : null } : x)) })
    const res = await call<ReaderState>('reader', 'markArticle', { space, id: a.id, read: isRead })
    if (res.ok && res.value) setState(res.value)
  }, [call, state, articles, space])

  const openArticle = (a: SavedArticle) => {
    if (!a.readAt) markArticle(a, true)
    onOpenPost(a.url)
  }

  const markAllArticles = async () => {
    const posts = topicPosts.filter((p) => !read.has(p.url)).map((p) => p.url)
    if (posts.length) saveRead(posts)
    for (const a of shownArticles.filter((x) => !x.readAt)) await markArticle(a, true)
  }

  const openPost = (p: FeedPost) => {
    if (!read.has(p.url)) saveRead([p.url])
    onOpenPost(p.url)
  }

  // A hyper:// drive is followed as it is. A web address must be an RSS or Atom feed, or a page that
  // links one (a blog's home page): then its first feed is followed.
  const subscribe = async () => {
    let url = addUrl.trim()
    if (!url) return
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) url = 'https://' + url
    setAdding(true)
    if (isWeb(url)) {
      const found = await fetchWebFeed(call, url)
      if (!found.ok || !found.value) { setAdding(false); return Alert.alert('Couldn’t subscribe', found.message || 'No RSS or Atom feed at that address') }
      if (found.value.feeds?.length) url = found.value.feeds[0].url
    }
    const res = await call<ReaderState>('reader', 'follow', { space, url })
    setAdding(false)
    if (!res.ok || !res.value) return Alert.alert('Couldn’t subscribe', res.message || 'Unknown error')
    setAddUrl('')
    setState(res.value)
    loadFeeds(res.value.follows)
  }

  const unsubscribe = (f: FeedLoad) => {
    Alert.alert('Unsubscribe?', state?.shared ? `Stop following ${f.title} for everyone in this Space?` : `Stop following ${f.title} on all your devices?`, [
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

  // ── Canvas ──
  const canvasData = useMemo(() => ({ articles, posts: allPosts, read: [...read] }), [articles, allPosts, read])
  // A chip picked while the canvas shows lights up its topic or feed there.
  const pick = (f: string) => {
    setFilter(f)
    if (view !== 'canvas') return
    const id = f.startsWith('topic:') ? 'topic:' + f.slice(6).toLowerCase() : feeds[f] ? 'feed:' + f : null
    setSelectedId(id)
    canvasRef.current?.select(id, true)
  }
  // What a canvas dot is: an article, a post, a topic or a feed.
  const nodeOf = (id: string | null) => {
    if (!id) return null
    if (id.startsWith('article:')) { const a = articles.find((x) => x.id === id.slice(8)); return a ? { kind: 'article' as const, a } : null }
    if (id.startsWith('post:')) { const p = allPosts.find((x) => x.url === id.slice(5)); return p ? { kind: 'post' as const, p } : null }
    if (id.startsWith('topic:')) { const tp = topicList.find((x) => x.topic.toLowerCase() === id.slice(6)); return tp ? { kind: 'topic' as const, topic: tp.topic, count: tp.count } : null }
    if (id.startsWith('feed:')) { const f = feeds[id.slice(5)]; return f ? { kind: 'feed' as const, f } : null }
    return null
  }
  const openNode = (id: string) => {
    const n = nodeOf(id)
    if (!n) return
    setSelectedId(null)
    if (n.kind === 'article') openArticle(n.a)
    else if (n.kind === 'post') openPost(n.p)
    else {
      // A topic or a feed: its list.
      showView('list')
      setFilter(n.kind === 'topic' ? 'topic:' + n.topic : n.f.url)
    }
  }
  const selected = view === 'canvas' ? nodeOf(selectedId) : null

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Reader'
          onBack={onClose}
          actions={state ? [
            view === 'list' ? { icon: 'project-diagram', label: 'Canvas', onPress: () => showView('canvas') } : { icon: 'list-ul', label: 'List', onPress: () => showView('list') },
            { icon: 'redo-alt', label: 'Refresh', onPress: refresh, busy: loadingAny }
          ] : undefined}
        />

        {noVault ? (
          <LinkPhone what='Reader' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !state ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <>
            {feedList.length === 0 && articles.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
                <Chip s={s} label='Feeds' active={!savedView} onPress={() => pick('all')} />
                <Chip s={s} label={`Saved · ${articles.length}`} active={savedView} onPress={() => pick('saved')} />
              </ScrollView>
            )}
            {(savedView || view === 'canvas') && topicList.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
                <Chip s={s} label='Everything' active={filter === 'saved'} onPress={() => pick('saved')} />
                {topicList.map((t) => (
                  <Chip key={t.topic} s={s} label={`${t.topic} · ${t.count}`} active={filter.toLowerCase() === 'topic:' + t.topic.toLowerCase()} onPress={() => pick('topic:' + t.topic)} />
                ))}
              </ScrollView>
            )}
            {feedList.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
                <Chip s={s} label='All' active={filter === 'all'} onPress={() => pick('all')} />
                {(articles.length > 0 || topicList.length > 0) && <Chip s={s} label={articles.length ? `Saved · ${articles.length}` : 'Topics'} active={savedView} onPress={() => pick(articles.length ? 'saved' : 'topic:' + topicList[0].topic)} />}
                {feedList.map((f) => (
                  <Chip
                    key={f.url}
                    s={s}
                    label={f.title}
                    active={filter === f.url}
                    error={!!f.error}
                    onPress={() => pick(f.url)}
                    onLongPress={state.canFollow === false ? undefined : () => unsubscribe(f)}
                  />
                ))}
              </ScrollView>
            )}

            {view === 'canvas' ? (
              <View style={s.root}>
                {articles.length === 0 && allPosts.length === 0 ? (
                  loadingAny
                    ? <View style={s.loadingRow}><ActivityIndicator color={t.accent} /><Text style={s.countText}>Loading feeds…</Text></View>
                    : <Text style={[s.empty, s.page]}>Nothing here yet. Pages you save on your computer gather around their topics here, and posts around their feeds.</Text>
                ) : (
                  <Canvas
                    ref={canvasRef}
                    kind='reader'
                    data={canvasData}
                    info={() => [`${articles.length} saved`, `${topicList.length} ${topicList.length === 1 ? 'topic' : 'topics'}`, feedList.length ? `${feedList.length} ${feedList.length === 1 ? 'feed' : 'feeds'}` : ''].filter(Boolean).join(' · ')}
                    snapshot={snapshot.current}
                    onSnapshot={(snap) => { snapshot.current = snap }}
                    onSelect={setSelectedId}
                    onOpen={openNode}
                  />
                )}
                {selected ? (
                  <View style={s.picked}>
                    <Pressable style={s.pickedText} onPress={() => selectedId && openNode(selectedId)} android_ripple={{ color: t.ripple }}>
                      {selected.kind === 'article' ? (
                        <>
                          <Text numberOfLines={1} style={s.postFeed}>{[selected.a.site, selected.a.readAt ? 'Read' : 'Unread'].filter(Boolean).join(' · ')}</Text>
                          <Text numberOfLines={2} style={s.postTitle}>{selected.a.title}</Text>
                          {(selected.a.topics || []).length > 0 && <Text numberOfLines={1} style={s.pickedTopics}>{selected.a.topics.join(' · ')}</Text>}
                        </>
                      ) : selected.kind === 'post' ? (
                        <>
                          <Text numberOfLines={1} style={s.postFeed}>{[selected.p.feedTitle, formatDate(selected.p.createdAt)].filter(Boolean).join(' · ')}</Text>
                          <Text numberOfLines={2} style={s.postTitle}>{selected.p.title}</Text>
                        </>
                      ) : (
                        <>
                          <Text numberOfLines={1} style={s.postFeed}>{selected.kind === 'topic' ? 'Topic' : 'Feed'}</Text>
                          <Text numberOfLines={1} style={s.postTitle}>{selected.kind === 'topic' ? selected.topic : selected.f.title}</Text>
                          <Text style={s.pickedTopics}>
                            {selected.kind === 'topic' ? `${selected.count} saved ${selected.count === 1 ? 'article' : 'articles'}` : `${selected.f.posts.length} ${selected.f.posts.length === 1 ? 'post' : 'posts'}`}
                          </Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable style={s.openBtn} onPress={() => selectedId && openNode(selectedId)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
                      <Text style={s.openBtnText}>{selected.kind === 'topic' || selected.kind === 'feed' ? 'List' : 'Open'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
            <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
              {!state.writable && (
                <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
              )}

              {savedView && (
                <>
                  <View style={s.countRow}>
                    <Text style={s.countText}>{topicName ? `${shownArticles.length + topicPosts.length} items` : `${shownArticles.length} saved`} · {unread} unread</Text>
                    {unread > 0 && (
                      <TouchableOpacity onPress={markAllArticles} hitSlop={8}>
                        <Text style={s.action}>Mark all read</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {shownArticles.length > 0 && (
                    <View style={s.card}>
                      {shownArticles.map((a, i) => (
                        <ArticleRow key={a.id} a={a} divider={i > 0} s={s} onPress={() => openArticle(a)} onLongPress={() => setMenuFor(a)} onTopic={(t) => setFilter('topic:' + t)} />
                      ))}
                    </View>
                  )}
                  {topicPosts.length > 0 && (
                    <>
                      <Text style={s.sectionLabel}>From your feeds</Text>
                      <View style={s.card}>
                        {topicPosts.map((p, i) => (
                          <PostRow key={p.url} p={p} topics={postTopics.get(p.url)} read={read.has(p.url)} divider={i > 0} s={s} onPress={() => openPost(p)} onTopic={(t) => setFilter('topic:' + t)} />
                        ))}
                      </View>
                    </>
                  )}
                  <Text style={s.addHint}>Save pages from Reader on your computer: right-click a page, Save Page to Reader. Long-press an article for more.</Text>
                </>
              )}

              {!savedView && posts.length > 0 && (
                <View style={s.countRow}>
                  <Text style={s.countText}>{unread} unread</Text>
                  {unread > 0 && (
                    <TouchableOpacity onPress={() => saveRead(posts.filter((p) => !read.has(p.url)).map((p) => p.url))} hitSlop={8}>
                      <Text style={s.action}>Mark all read</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {savedView ? null : posts.length > 0 ? (
                <View style={s.card}>
                  {posts.map((p, i) => (
                    <PostRow key={p.url} p={p} topics={postTopics.get(p.url)} read={read.has(p.url)} divider={i > 0} s={s} onPress={() => openPost(p)} onTopic={(t) => setFilter('topic:' + t)} />
                  ))}
                </View>
              ) : feedList.length === 0 ? (
                <Text style={s.empty}>No subscriptions yet. Add a hyper:// feed or a site’s RSS link below, or subscribe from nomad://reader on your computer.</Text>
              ) : current?.error ? (
                <Text style={s.empty}>Can’t load {current.title}. It may be offline.{'\n'}Long-press its name above to unsubscribe.</Text>
              ) : loadingAny ? (
                <View style={s.loadingRow}><ActivityIndicator color={t.accent} /><Text style={s.countText}>Loading feeds…</Text></View>
              ) : (
                <Text style={s.empty}>No posts yet.</Text>
              )}

              {savedView ? null : state.canFollow === false ? (
                <Text style={s.hint}>This Space is shared, and you can view it. People who can edit it choose its feeds.</Text>
              ) : (
              <View style={s.addCard}>
                <Text style={s.addLabel}>Add a feed</Text>
                <View style={s.addRow}>
                  <TextInput
                    style={s.addInput}
                    value={addUrl}
                    onChangeText={setAddUrl}
                    placeholder='hyper://… or a site’s RSS link'
                    placeholderTextColor={t.textMuted}
                    autoCapitalize='none'
                    autoCorrect={false}
                    spellCheck={false}
                    keyboardType='url'
                    onSubmitEditing={subscribe}
                    returnKeyType='done'
                  />
                  <TouchableOpacity style={[s.addBtn, (adding || !addUrl.trim()) && s.addBtnOff]} onPress={subscribe} disabled={adding || !addUrl.trim()}>
                    <Text style={s.addBtnText}>{adding ? '…' : 'Subscribe'}</Text>
                  </TouchableOpacity>
                </View>
                {feedList.length > 0 && <Text style={s.addHint}>Long-press a feed’s name to unsubscribe.</Text>}
              </View>
              )}
            </ScrollView>
            )}
          </>
        )}
        <ActionSheet
          visible={!!menuFor}
          onClose={() => setMenuFor(null)}
          title={menuFor?.title}
          subtitle={menuFor?.site}
          groups={[[
            { label: 'Open', icon: 'external-link-alt', onPress: () => menuFor && openArticle(menuFor) },
            { label: menuFor?.readAt ? 'Mark unread' : 'Mark read', icon: menuFor?.readAt ? 'envelope' : 'check', onPress: () => menuFor && markArticle(menuFor, !menuFor.readAt) }
          ]]}
        />
      </SafeAreaView>
    </Modal>
  )
}

function PostRow ({ p, topics, read, divider, s, onPress, onTopic }: { p: FeedPost; topics?: string[]; read: boolean; divider: boolean; s: Styles; onPress: () => void; onTopic: (t: string) => void }) {
  const t = useTheme()
  return (
    <Pressable style={[s.post, divider && s.rowDivider]} android_ripple={{ color: t.ripple }} onPress={onPress}>
      <View style={[s.unreadDot, read && s.dotRead]} />
      <View style={s.postText}>
        <Text numberOfLines={1} style={s.postFeed}>{p.feedTitle}</Text>
        <Text numberOfLines={2} style={[s.postTitle, read && s.postTitleRead]}>{p.title}</Text>
        {!!p.summary && <Text numberOfLines={2} style={s.postSummary}>{p.summary}</Text>}
        {!!p.createdAt && <Text style={s.postDate}>{formatDate(p.createdAt)}</Text>}
        {!!topics?.length && (
          <View style={s.topicRow}>
            {topics.map((topic) => (
              <TouchableOpacity key={topic} onPress={() => onTopic(topic)} hitSlop={4} style={s.topic}>
                <Text style={s.topicText}>{topic}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  )
}

function ArticleRow ({ a, divider, s, onPress, onLongPress, onTopic }: { a: SavedArticle; divider: boolean; s: Styles; onPress: () => void; onLongPress: () => void; onTopic: (t: string) => void }) {
  const t = useTheme()
  const isRead = !!a.readAt
  const minutes = a.words ? Math.max(1, Math.round(a.words / 230)) : 0
  return (
    <Pressable style={[s.post, divider && s.rowDivider]} android_ripple={{ color: t.ripple }} onPress={onPress} onLongPress={onLongPress}>
      <View style={[s.unreadDot, isRead && s.dotRead]} />
      <View style={s.postText}>
        <Text numberOfLines={1} style={s.postFeed}>{[a.site, formatDate(a.savedAt), minutes ? `${minutes} min read` : ''].filter(Boolean).join(' · ')}</Text>
        <Text numberOfLines={2} style={[s.postTitle, isRead && s.postTitleRead]}>{a.title}</Text>
        {!!a.excerpt && <Text numberOfLines={2} style={s.postSummary}>{a.excerpt}</Text>}
        {(a.topics || []).length > 0 && (
          <View style={s.topicRow}>
            {a.topics.map((topic) => (
              <TouchableOpacity key={topic} onPress={() => onTopic(topic)} hitSlop={4} style={s.topic}>
                <Text style={s.topicText}>{topic}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  )
}

// Every topic in use, most used first (shared/reader-articles.mjs topicCounts; mobile/ keeps its
// React Native bundle to itself). One list of topics per article or post.
function topicCounts (lists: string[][]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, { topic: string; count: number }>()
  for (const topics of lists) {
    for (const t of topics) {
      const c = counts.get(t.toLowerCase()) || { topic: t, count: 0 }
      c.count++
      counts.set(t.toLowerCase(), c)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    chipsContent: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
    chip: { height: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, maxWidth: 200 },
    chipActive: { backgroundColor: t.trustBg, borderColor: t.trustBg },
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
    card: { backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    post: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
    unreadDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: t.accent, marginTop: 5 },
    dotRead: { backgroundColor: 'transparent' },
    postText: { flex: 1 },
    postFeed: { color: t.textMuted, fontSize: 12, fontWeight: '600' },
    postTitle: { color: t.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
    postTitleRead: { color: t.textDim, fontWeight: '500' },
    postSummary: { color: t.textDim, fontSize: 13, lineHeight: 18, marginTop: 2 },
    postDate: { color: t.textMuted, fontSize: 12, marginTop: 4 },
    topicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    topic: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: t.trustBg },
    topicText: { color: t.trustText, fontSize: 11, fontWeight: '600' },
    sectionLabel: { color: t.textMuted, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8, paddingHorizontal: 2 },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 },
    addCard: { backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: 16, marginTop: 24 },
    addLabel: { color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addInput: { flex: 1, height: 44, color: t.text, fontSize: 14, backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: 12 },
    addBtn: { backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: 18, height: 40, justifyContent: 'center' },
    addBtnOff: { opacity: 0.4 },
    addBtnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    addHint: { color: t.textMuted, fontSize: 12, marginTop: 8 },
    // The dot picked on the canvas, over its bottom edge.
    picked: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 12,
      marginVertical: 10,
      paddingRight: 10,
      borderRadius: radius.lg,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      overflow: 'hidden',
      elevation: 3,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 }
    },
    pickedText: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, justifyContent: 'center' },
    pickedTopics: { color: t.trustText, fontSize: 12, fontWeight: '600', marginTop: 4 },
    openBtn: { height: 40, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: t.accent, justifyContent: 'center', overflow: 'hidden' },
    openBtnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' }
  })
}
