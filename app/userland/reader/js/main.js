// nomad://reader — a reader for walled.garden/feed drives and RSS / Atom feeds, and a reading log of any
// web page the user saves (ADR-0033), sorted into topics by the AI, with a minimal reading view.
//
// - Saved articles come with the Reader's state (bg/web-apis/bg/reader-articles.ts). A page is
//   saved from its tab (context menu, site menu) or by pasting its link in the box on the left.
//   The AI files each into topics in the background; the user can change them (then the AI won't).
// - RSS and Atom feeds are fetched and parsed in bg (readerWebFeed, shared/web-feeds.mjs). Their read
//   marks are kept per feed (web-read.json). The AI sorts recent feed posts into the same topics.
// - Opening an article shows its readable text in the reading view (?read=<id>): no page scripts,
//   no images, light / sepia / dark, adjustable size. "Open original" opens the page in a tab.
// - Subscriptions and read marks come from nomad.vault (bg/web-apis/bg/vault-apps.ts, ADR-0017).
//   They live in the Vault, per Space, so the user's other Devices (the phone too) share them.
//   Another Device's change arrives on watchAppData().
// - Reads any feed whether it's a plain Hyperdrive or an Autobase Collaborative Drive,
//   via nomad.fs (the unified, backend-agnostic filesystem API).
// - Post discovery by directory enumeration (itemsPath/*/post.json), newest-first.
// - Read marks are saved debounced, merged with other Devices' marks, and pruned to posts that exist.
// - Hybrid rendering: an aggregated post list; opening a post opens its canonical URL in a new tab
//   (rendered in the feed's own origin).
// - The header's List / Canvas switch swaps the post list for a canvas (./graph.js, drawn by
//   app-stdlib's canvas, like nomad://notes): saved articles gathered around their topics, posts
//   around their feed. Picking a topic or feed on the left lights it up there. Clicking an article
//   reads it, a post opens it, a topic or feed shows its list. The last choice is remembered.
// - The search box in the header narrows the list to what has every word typed, in its title,
//   summary, site, feed or topics, and lights it up on the canvas (app-stdlib/js/search-match.js,
//   the same rules as nomad://notes and the phone). Under All posts it looks in saved articles too.
//
// Vanilla JS (served as-is, no bundle), styled with the app-stdlib tokens like nomad://search.

const state = {
  follows: [], // [driveRootUrl]
  feeds: [], // [{ url, title, ok, error, posts:[] }]
  posts: [], // aggregated, sorted desc
  filter: 'all', // 'all' | feedUrl | 'saved' | 'untagged' | 'topic:<name>'
  articles: [], // saved articles, newest first (shared/reader-articles.mjs)
  ai: { autoTopics: true, tagging: [], noRuntime: false },
  editing: null, // the id of the article whose topics are being edited
  reading: null, // { article, text, loading, error } while the reading view is open
  saving: false, // a pasted link is being fetched
  postTopics: new Map(), // post URL -> { topics, topicsBy } (the AI's or the user's)
  feedOffer: null, // { url, site } a page just saved links to this feed
  loading: true,
  addMsg: '',
  addDraft: '', // the feed address being typed; kept across re-renders
  readSet: new Set(),
  writable: true, // false while a Device that just joined waits for the Vault
  linked: false, // another Device shares the Vault
  query: '', // what's typed in the search box
};

let pendingRead = new Set() // marked read here since the last save

const VIEW_KEY = 'nomad-reader-view'
let view = storedView() // 'list' or 'canvas'
let graph = null // the canvas (app-stdlib/js/graph/view.js), made the first time it shows
let graphLib = null // { createGraphView, readerGraph, readerTexts }, imported then
let graphPane = null // kept across renders, so the canvas keeps its place
let graphInfo = null
let graphHint = null
let saveReadTimer = null
let search = null // app-stdlib/js/search-match.js, imported at start
let searchInput = null // made once, so typing in it survives each render

// ── Boot ─────────────────────────────────────────────────────────────────────

init().catch((err) => {
  document.getElementById('app').replaceChildren(
    el('div', { class: 'notice' }, [
      el('div', { class: 'notice-icon' }, [icon('exclamation-triangle')]),
      el('h2', {}, ['Reader failed to start']),
      el('p', {}, [err.message || String(err)]),
    ])
  )
  console.error('[reader] init error:', err)
})

async function init() {
  ;[search] = await Promise.all([import('nomad://app-stdlib/js/search-match.js'), loadState()])

  // Deep-link: nomad://reader/?subscribe=<feed url> (used by the chrome Subscribe action).
  const sub = new URLSearchParams(location.search).get('subscribe')
  if (sub) {
    history.replaceState(null, '', location.pathname) // drop the query
    try {
      applyState(await nomad.vault.readerFollow(sub))
    } catch (e) {
      state.addMsg = 'Could not subscribe: ' + e.message
    }
  }

  const readId = new URLSearchParams(location.search).get('read')
  if (readId) openReading(readId, { push: false })

  render()
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('read')
    if (id) openReading(id, { push: false })
    else closeReading({ pop: true })
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.reading) closeReading()
    // "/" goes to the search box, as on many sites, unless you're typing somewhere.
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !state.reading && !e.target.closest?.('input, textarea, [contenteditable]')) {
      e.preventDefault()
      searchInput?.focus()
      searchInput?.select()
    }
  })
  window.addEventListener('beforeunload', () => { flushReadState() })
  watchOtherDevices()
  await refreshAll()
}

// ── Data: subscriptions and read marks (nomad.vault) ─────────────────────────

async function loadState() {
  applyState(await nomad.vault.readerState())
}

function applyState(s) {
  state.follows = s.follows || []
  state.writable = s.writable !== false
  state.linked = !!s.linked
  // A shared Space's feeds are its members' (ADR-0029); a person who can only view it can't change them.
  state.shared = !!s.shared
  state.canFollow = s.canFollow !== false
  // Keep marks made here that aren't saved yet.
  const webRead = Object.values(s.webRead || {}).flat()
  state.readSet = new Set([...(s.read || []), ...webRead, ...pendingRead])
  state.postTopics = new Map((s.postTopics || []).map((r) => [r.url, r]))
  state.articles = s.articles || []
  state.ai = s.ai || state.ai
  if (/^(hyper|https?):/.test(state.filter) && !state.follows.includes(state.filter)) state.filter = 'all'
  if (state.feedOffer && state.follows.includes(state.feedOffer.url)) state.feedOffer = null
  if (state.filter.startsWith('topic:') && !topics().some((t) => 'topic:' + t.topic === state.filter)) state.filter = 'saved'
  if (state.reading?.article) {
    const now = state.articles.find((a) => a.id === state.reading.article.id)
    if (now) state.reading.article = now
  }
}

// Another Device subscribed, unsubscribed, or read something.
function watchOtherDevices() {
  let events
  try {
    events = nomad.vault.watchAppData()
  } catch {
    return
  }
  events.addEventListener('changed', async () => {
    const before = state.follows.join(' ')
    try {
      await loadState()
    } catch {
      return
    }
    if (state.follows.join(' ') !== before) refreshAll()
    else render()
  })
}

// What the box on the left does with what was typed: a drive's root (or key) is a feed to follow;
// a hyper:// page is saved; a web address is looked at first: an RSS or Atom feed is followed, a page
// is saved (readerAddLink).
function addKind(raw) {
  const v = String(raw || '').trim()
  if (!v) return null
  if (/^[0-9a-f]{64}$/i.test(v)) return 'feed'
  if (/^hyper:\/\//i.test(v)) {
    try {
      const u = new URL(v)
      return u.pathname === '/' || u.pathname === '' ? 'feed' : 'article'
    } catch {
      return 'feed'
    }
  }
  return 'link'
}

async function addFromBox(raw) {
  if (addKind(raw) === 'feed') return addFeed(raw)
  return addLink(raw)
}

async function addLink(rawUrl) {
  state.saving = true
  state.addMsg = ''
  state.feedOffer = null
  render()
  try {
    const res = await nomad.vault.readerAddLink(rawUrl)
    applyState(res.state)
    if (res.followed) {
      state.filter = res.followed
      state.saving = false
      await refreshAll()
      return
    }
    state.filter = 'saved'
    state.flash = res.article.id
    const feed = res.feeds?.[0]
    if (feed && !state.follows.includes(feed.url)) state.feedOffer = { url: feed.url, site: res.article.site || feed.title }
  } catch (e) {
    state.addMsg = e.message
    state.addDraft = rawUrl
  }
  state.saving = false
  render()
}

// Follow the RSS or Atom feed a saved page links to.
async function followSiteFeed(url) {
  state.feedOffer = null
  await addFeed(url)
  state.filter = url
  render()
}

async function articleAction(fn) {
  try {
    applyState(await fn())
  } catch (e) {
    console.warn('[reader]', e)
    alert(e.message || String(e))
  }
  render()
}

const setArticleRead = (a, read) => articleAction(() => nomad.vault.readerUpdateArticle(a.id, { read }))
const setArticleTopics = (a, topics) => articleAction(() => nomad.vault.readerUpdateArticle(a.id, { topics }))
const suggestTopics = (ids) => articleAction(() => nomad.vault.readerSuggestTopics(ids || null))

function deleteArticle(a) {
  if (!confirm(`Remove “${a.title}” from Reader?`)) return
  if (state.reading?.article?.id === a.id) closeReading()
  articleAction(() => nomad.vault.readerDeleteArticle(a.id))
}

async function addFeed(rawUrl) {
  if (!rawUrl) return
  try {
    applyState(await nomad.vault.readerFollow(rawUrl))
    state.addMsg = ''
  } catch (e) {
    state.addMsg = e.message
    render()
    return
  }
  await refreshAll()
}

async function removeFeed(root) {
  try {
    applyState(await nomad.vault.readerUnfollow(root))
  } catch (e) {
    console.warn('[reader] unsubscribe', e)
    return
  }
  await refreshAll()
}

function markRead(postUrl) {
  if (!postUrl || state.readSet.has(postUrl)) return
  state.readSet.add(postUrl)
  pendingRead.add(postUrl)
  scheduleReadStateSave()
}

function markAllRead() {
  if (isArticleView()) {
    for (const p of visibleTopicPosts()) markRead(p.url)
    const unread = visibleArticles().filter((a) => !a.readAt)
    articleAction(async () => {
      let s
      for (const a of unread) s = await nomad.vault.readerUpdateArticle(a.id, { read: true })
      return s || nomad.vault.readerState()
    })
    return
  }
  for (const p of visiblePosts()) markRead(p.url)
  const articles = searchedArticles().filter((a) => !a.readAt)
  if (articles.length) {
    articleAction(async () => {
      let s
      for (const a of articles) s = await nomad.vault.readerUpdateArticle(a.id, { read: true })
      return s || nomad.vault.readerState()
    })
  }
  render()
}

function scheduleReadStateSave() {
  clearTimeout(saveReadTimer)
  saveReadTimer = setTimeout(flushReadState, 1500)
}

async function flushReadState() {
  clearTimeout(saveReadTimer)
  // Feeds that loaded give their current posts, so marks for deleted posts are pruned. A feed that
  // didn't load keeps its marks.
  const loaded = {}
  for (const f of state.feeds) if (f.ok) loaded[f.url] = f.posts.map((p) => p.url)
  const add = [...pendingRead]
  pendingRead = new Set()
  try {
    await nomad.vault.readerSaveRead(add, loaded)
  } catch (e) {
    for (const u of add) pendingRead.add(u) // try again with the next mark
    console.warn('[reader] read-state save failed', e)
  }
}

// ── Data: feeds (via nomad.fs, the backend-agnostic bridge) ──────────────────

async function refreshAll({ fresh = false } = {}) {
  state.loading = true
  render()
  const follows = state.follows.slice()
  const results = await Promise.allSettled(follows.map((f) => loadFeed(f, { fresh })))
  state.feeds = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { url: follows[i], title: follows[i], ok: false, error: String(r.reason && r.reason.message || r.reason), posts: [] }
  )
  state.posts = state.feeds.flatMap((f) => f.posts)
  state.posts.sort((a, b) => cmpDesc(a, b))
  state.loading = false
  render()
  if (state.readSet.size) scheduleReadStateSave() // prune marks for posts that are gone
  tagNewPosts()
}

// Hand the recent posts the AI hasn't sorted yet to bg, which picks topics for a batch of them.
function tagNewPosts() {
  if (!state.ai.autoTopics) return
  const since = Date.now() - 30 * 86400e3
  const posts = state.posts
    .filter((p) => !state.postTopics.has(p.url) && (!p.createdAt || Date.parse(p.createdAt) >= since))
    .slice(0, 100)
    .map(({ url, title, summary, feedTitle, createdAt }) => ({ url, title, summary, feedTitle, createdAt }))
  if (!posts.length) return
  nomad.vault.readerTagPosts(posts).then(applyState).then(render, (e) => console.warn('[reader] topics', e))
}

async function loadFeed(root, { fresh = false } = {}) {
  if (/^https?:/i.test(root)) {
    // An RSS or Atom feed: bg fetches and parses it.
    const f = await nomad.vault.readerWebFeed(root, { fresh })
    return { url: root, title: f.title || root, siteUrl: f.siteUrl, ok: true, error: null, posts: f.posts.map((p) => ({ ...p, web: true })) }
  }
  const a = await openFeed(root)
  const feed = JSON.parse(await a.readText('/index.json'))
  const itemsPath = ensureDir(feed.itemsPath || '/posts/')
  const metaPaths = await a.listPostMetaPaths(itemsPath)
  const posts = []
  for (const p of metaPaths) {
    try {
      const meta = JSON.parse(await a.readText(p))
      if (meta.draft) continue
      const slug = p.slice(itemsPath.length).replace(/\/post\.json$/, '')
      posts.push({
        title: meta.title || slug,
        summary: meta.summary || '',
        tags: meta.tags || [],
        createdAt: meta.createdAt || '',
        slug,
        url: root + itemsPath.slice(1) + slug + '/',
        feedUrl: root,
        feedTitle: feed.title || root,
      })
    } catch {}
  }
  return { url: root, title: feed.title || root, ok: true, error: null, posts }
}

// Return an adapter { readText(path), listPostMetaPaths(itemsPath) } for the feed,
// backed by nomad.fs (which auto-detects the backend — Hyperdrive or Autobase — so
// no more try-then-fall-back-and-cache dance is needed).
async function openFeed(root) {
  const d = nomad.fs.drive(root)
  return {
    async readText(path) { return d.readFile(path) }, // rejects if missing
    async listPostMetaPaths(itemsPath) {
      const entries = await d.list(itemsPath, { recursive: true })
      return entries.map((e) => e.key).filter((k) => k.endsWith('/post.json'))
    },
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

// ── Search ───────────────────────────────────────────────────────────────────

// The words searched for, folded (search-match.js); [] when the box is empty.
function searchWords() {
  return search && state.query.trim() ? search.queryWords(state.query) : []
}

const postText = (p) => [p.title, p.summary, p.feedTitle, ...(p.tags || []), ...postTopicsOf(p)].join('\n')
const articleText = (a) => [a.title, a.site, a.url, a.excerpt, ...(a.topics || [])].join('\n')

function searched(list, text) {
  const words = searchWords()
  return words.length ? list.filter((x) => search.matchesWords(text(x), words)) : list
}

// Under All posts a search looks in saved articles too.
function searchedArticles() {
  return state.filter === 'all' && searchWords().length ? searched(state.articles, articleText) : []
}

// text with the searched words marked.
function marked(text, words = searchWords()) {
  if (!words.length || !text) return [text]
  return search.markPieces(text, words).map((p) => (p.match ? el('mark', {}, [p.text]) : p.text))
}

function setQuery(q) {
  state.query = q
  state.editing = null
  render()
  graph?.setQuery(q)
}

function renderSearch() {
  if (!searchInput) {
    searchInput = el('input', {
      type: 'search',
      placeholder: 'Search Reader',
      title: 'Search Reader (/)',
      'aria-label': 'Search Reader',
      oninput: (e) => setQuery(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Escape') {
          searchInput.value = ''
          setQuery('')
        } else if (e.key === 'Enter' && view === 'canvas') {
          graph?.fit() // to what matches
        }
      },
    })
  }
  return el('div', { class: 'search-ctrl' }, [icon('search'), searchInput])
}

// ── Lists ────────────────────────────────────────────────────────────────────

function visiblePosts() {
  return searched(state.filter === 'all' ? state.posts : state.posts.filter((p) => p.feedUrl === state.filter), postText)
}

// The saved-articles views: the reading log, one topic, or the articles with no topic yet.
function isArticleView() {
  return state.filter === 'saved' || state.filter === 'untagged' || state.filter.startsWith('topic:')
}

function visibleArticles() {
  return searched(filteredArticles(), articleText)
}

function filteredArticles() {
  if (state.filter === 'saved') return state.articles
  if (state.filter === 'untagged') return state.articles.filter((a) => !(a.topics || []).length)
  if (state.filter.startsWith('topic:')) {
    const k = state.filter.slice(6).toLowerCase()
    return state.articles.filter((a) => (a.topics || []).some((t) => t.toLowerCase() === k))
  }
  return []
}

// Feed posts in the current topic.
function visibleTopicPosts() {
  if (!state.filter.startsWith('topic:')) return []
  const k = state.filter.slice(6).toLowerCase()
  return searched(state.posts.filter((p) => postTopicsOf(p).some((t) => t.toLowerCase() === k)), postText)
}

const postTopicsOf = (p) => state.postTopics.get(p.url)?.topics || []

// Every topic in use, saved articles' and feed posts', most used first: [{ topic, count }]
// (shared/reader-articles.mjs topicCounts).
function topics() {
  const counts = new Map()
  const lists = [...state.articles.map((a) => a.topics || []), ...state.posts.map(postTopicsOf)]
  for (const list of lists) {
    for (const t of list) {
      const c = counts.get(t.toLowerCase()) || { topic: t, count: 0 }
      c.count++
      counts.set(t.toLowerCase(), c)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
}

function unreadCount(posts) {
  return posts.filter((p) => !state.readSet.has(p.url)).length
}

const unreadArticles = (list) => list.filter((a) => !a.readAt).length
const isTagging = (a) => state.ai.tagging.includes(a.id)

// What the topic chips and editor work on: a saved article, or a feed post.
function articleSubject(a) {
  return {
    key: 'a:' + a.id,
    topics: a.topics || [],
    topicsBy: a.topicsBy,
    tagging: isTagging(a),
    showAdd: true, // "Add topics" stays visible on a saved article; a post shows it on hover
    save: (topics) => setArticleTopics(a, topics),
    suggest: () => suggestTopics([a.id]),
  }
}

function postSubject(p) {
  const rec = state.postTopics.get(p.url)
  const brief = { url: p.url, title: p.title, summary: p.summary, feedTitle: p.feedTitle, createdAt: p.createdAt }
  return {
    key: 'p:' + p.url,
    topics: rec?.topics || [],
    topicsBy: rec?.topicsBy || null,
    tagging: (state.ai.taggingPosts || []).includes(p.url),
    save: (topics) => articleAction(() => nomad.vault.readerSetPostTopics(p.url, topics)),
    suggest: () => articleAction(() => nomad.vault.readerTagPosts([brief], [p.url])),
  }
}

function render() {
  const app = document.getElementById('app')
  if (state.reading) {
    showCanvas(false)
    const scroller = app.querySelector('.reading')
    const top = scroller?.dataset.id === state.reading.article?.id ? scroller.scrollTop : 0
    app.replaceChildren(renderReading())
    app.querySelector('.reading').scrollTop = top
    return
  }
  const scroll = app.querySelector('main')?.scrollTop || 0
  const active = document.activeElement
  const typing = active?.matches('.add-feed input') ? '.add-feed input' : active?.matches('.topic-edit input') ? '.topic-edit input' : null
  // The search box is the same element each time; moving it drops focus, so give it back.
  const inSearch = active && active === searchInput ? [searchInput.selectionStart, searchInput.selectionEnd] : null
  const canvas = view === 'canvas'
  app.replaceChildren(renderHeader(), el('div', { class: 'layout' }, [renderSidebar(), canvas ? renderCanvasPane() : renderMain()]))
  if (!canvas) app.querySelector('main').scrollTop = scroll
  showCanvas(canvas)
  if (typing) app.querySelector(typing)?.focus() // feeds finishing loading mustn't steal it
  if (inSearch) {
    searchInput.focus()
    searchInput.setSelectionRange(inSearch[0], inSearch[1])
  }
  if (state.flash) {
    app.querySelector(`[data-id="${state.flash}"]`)?.scrollIntoView({ block: 'nearest' })
    state.flash = null
  }
}

function renderHeader() {
  const articles = isArticleView()
  // A topic lists feed posts too, under its saved articles.
  const unread = articles
    ? unreadArticles(visibleArticles()) + unreadCount(visibleTopicPosts())
    : unreadCount(visiblePosts()) + unreadArticles(searchedArticles())
  return el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://reader/', alt: '' }), 'Reader']),
    renderSearch(),
    el('div', { class: 'status' }, [!articles && state.loading ? 'Refreshing…' : `${unread} unread`]),
    el('div', { class: 'header-actions' }, [
      el('div', { class: 'view-switch', role: 'group', 'aria-label': 'View' }, [
        viewButton('list', 'list-ul', 'List'),
        viewButton('canvas', 'project-diagram', 'Canvas'),
      ]),
      unread > 0
        ? el('button', { class: 'btn', onclick: markAllRead }, [icon('check-double'), ' Mark all read'])
        : null,
      el(
        'button',
        { class: 'icon-btn', title: 'Refresh', 'aria-label': 'Refresh', disabled: state.loading, onclick: async () => { await loadState().catch(() => {}); refreshAll({ fresh: true }) } },
        [icon('sync-alt')]
      ),
    ]),
  ])
}

function renderSidebar() {
  const list = el('div', { class: 'feeds' }, [
    el('div', { class: 'label' }, ['Feeds']),
    feedRow({ name: 'All posts', icon: icon('stream', 'icon'), count: unreadCount(state.posts), current: state.filter === 'all', onclick: () => setFilter('all') }),
  ])

  for (const f of state.feeds) {
    list.append(
      feedRow({
        name: f.title || f.url,
        title: f.error || f.url,
        icon: feedIcon(f.siteUrl || f.url),
        count: f.ok ? unreadCount(f.posts) : null,
        current: state.filter === f.url,
        err: !f.ok,
        onclick: () => setFilter(f.url),
        onremove: state.canFollow ? () => removeFeed(f.url) : null,
      })
    )
  }
  // feeds that are still loading (no result yet)
  if (state.loading) {
    for (const u of state.follows.filter((u) => !state.feeds.some((f) => f.url === u))) {
      list.append(feedRow({ name: u, icon: feedIcon(u), current: false }))
    }
  }

  // The reading log and its topics.
  list.append(
    el('div', { class: 'label' }, ['Saved']),
    feedRow({
      name: 'Reading log',
      icon: icon('bookmark', 'icon'),
      count: state.articles.length,
      current: state.filter === 'saved',
      onclick: () => setFilter('saved'),
    })
  )
  const all = topics()
  if (all.length) {
    list.append(el('div', { class: 'label' }, ['Topics']))
    for (const t of all) {
      list.append(
        feedRow({
          name: t.topic,
          icon: icon('hashtag', 'icon'),
          count: t.count,
          current: state.filter === 'topic:' + t.topic,
          onclick: () => setFilter('topic:' + t.topic),
        })
      )
    }
    const untagged = state.articles.filter((a) => !(a.topics || []).length).length
    if (untagged) {
      list.append(
        feedRow({ name: 'No topic yet', icon: icon('question', 'icon'), count: untagged, current: state.filter === 'untagged', onclick: () => setFilter('untagged') })
      )
    }
  }

  return el('nav', {}, [list, renderAddFeed()])
}

function feedRow({ name, title, icon: ic, count, current, err, onclick, onremove }) {
  return el('div', { class: 'feed' + (current ? ' current' : '') + (err ? ' err' : ''), title: title || name, onclick }, [
    ic,
    el('span', { class: 'name' }, [name]),
    count != null ? el('span', { class: 'count' }, [String(count)]) : null,
    onremove
      ? el(
          'button',
          {
            class: 'remove',
            title: 'Unsubscribe',
            'aria-label': 'Unsubscribe from ' + name,
            onclick: (e) => { e.stopPropagation(); onremove() },
          },
          [icon('times')]
        )
      : null,
  ])
}

function feedIcon(url) {
  return el('img', {
    class: 'icon',
    src: 'asset:favicon:' + url,
    alt: '',
    // No icon for this drive: show the feed glyph instead of a broken image.
    onerror: (e) => e.target.replaceWith(icon('rss', 'icon')),
  })
}

function setFilter(f) {
  state.filter = f
  state.editing = null
  render()
  if (view === 'canvas') graph?.select(canvasIdFor(f), { center: true })
}

// ── Canvas ───────────────────────────────────────────────────────────────────

function storedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'canvas' ? 'canvas' : 'list'
  } catch {
    return 'list'
  }
}

function setView(v) {
  if (v === view) return
  view = v
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {}
  render()
  if (v === 'canvas') graph?.select(canvasIdFor(state.filter))
}

function viewButton(v, ic, label) {
  return el('button', { class: 'view-btn' + (view === v ? ' active' : ''), title: label, 'aria-pressed': String(view === v), onclick: () => setView(v) }, [icon(ic), el('span', {}, [label])])
}

// The canvas node a sidebar filter lights up: a topic or a feed. Null for the rest.
function canvasIdFor(f) {
  if (f.startsWith('topic:')) return 'topic:' + f.slice(6).toLowerCase()
  if (f.startsWith('hyper:')) return 'feed:' + f
  return null
}

function renderCanvasPane() {
  if (!graphPane) {
    graphInfo = el('span', { class: 'graph-info' })
    graphHint = el('div', { class: 'graph-hint' })
    graphPane = el('section', { class: 'graph-pane graph-surface', 'aria-label': 'Canvas' }, [
      el('div', { class: 'graph-overlay top' }, [
        graphInfo,
        el('span', { class: 'graph-legend' }, [
          el('span', { class: 'key key-topic' }, ['Topic']),
          el('span', { class: 'key key-feed' }, ['Feed']),
          el('span', { class: 'key key-item' }, ['Article or post']),
        ]),
      ]),
      graphHint,
      el('div', { class: 'graph-overlay bottom' }, [
        el('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => graph?.zoomIn() }, [icon('plus')]),
        el('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => graph?.zoomOut() }, [icon('minus')]),
        el('button', { class: 'icon-btn', title: 'Fit everything', 'aria-label': 'Fit everything', onclick: () => graph?.fit() }, [icon('compress-arrows-alt')]),
      ]),
    ])
  }
  return graphPane
}

// Show or hide the canvas, loading it the first time. It only animates while it shows.
async function showCanvas(on) {
  if (!on) return graph?.setVisible(false)
  if (!graph) {
    if (!graphLib) {
      const [viewMod, graphMod] = await Promise.all([import('nomad://app-stdlib/js/graph/view.js'), import('/js/graph.js')])
      graphLib = { createGraphView: viewMod.createGraphView, readerGraph: graphMod.readerGraph, readerTexts: graphMod.readerTexts }
    }
    if (graph || view !== 'canvas' || state.reading) return renderGraph()
    graph = graphLib.createGraphView({ parent: graphPane, onOpen: openFromCanvas, onMatches: renderGraphInfo, label: 'Articles by topic, and feeds' })
    renderGraph()
    graph.select(canvasIdFor(state.filter))
  }
  graph.setVisible(true)
  renderGraph()
}

function renderGraph() {
  if (!graph || view !== 'canvas') return
  const data = { articles: state.articles, posts: state.posts, read: state.readSet }
  graph.update(graphLib.readerGraph(data), { texts: graphLib.readerTexts(data), query: state.query })
  const topicCount = topics().length
  const parts = [plural(state.articles.length, 'article'), plural(topicCount, 'topic')]
  if (state.feeds.length) parts.push(plural(state.feeds.length, 'feed'))
  graphCounts = parts.join(' · ')
  renderGraphInfo()
  if (!state.articles.length && !state.posts.length) {
    graphHint.replaceChildren(
      notice('project-diagram', state.loading ? 'Loading…' : 'Nothing here yet', [
        'Pages you save gather around their topics here, and posts around their feeds. Right-click a page and choose Save Page to Reader, or paste a link on the left.',
      ])
    )
  } else if (state.articles.length && !topicCount) {
    graphHint.replaceChildren(el('p', { class: 'graph-tip' }, [icon('magic'), 'No topics yet. The AI sorts saved pages into topics, or add them from the list.']))
  } else graphHint.replaceChildren()
}

// The line over the canvas: what it shows, or while searching, how much matches.
let graphCounts = ''
function renderGraphInfo() {
  if (!graphInfo) return
  const n = graph?.matchCount
  graphInfo.textContent = n == null || !state.query.trim() ? graphCounts : n ? `${n} ${n === 1 ? 'match' : 'matches'} · Enter to fit them` : 'Nothing matches'
}

// A click on the canvas: read an article, open a post, or list a topic's articles or a feed's posts.
function openFromCanvas(id) {
  if (id.startsWith('article:')) return openReading(id.slice(8))
  if (id.startsWith('post:')) {
    const p = state.posts.find((x) => x.url === id.slice(5))
    if (p) openPost(p)
    return
  }
  let f = null
  if (id.startsWith('topic:')) {
    const t = topics().find((x) => x.topic.toLowerCase() === id.slice(6))
    if (t) f = 'topic:' + t.topic
  } else if (id.startsWith('feed:')) f = id.slice(5)
  if (!f) return
  view = 'list'
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {}
  setFilter(f)
}

// One box for all: a feed (hyper://, RSS or Atom) subscribes, any other link is saved as an article.
function renderAddFeed() {
  const canFeed = state.canFollow
  const input = el('input', {
    type: 'text',
    placeholder: canFeed ? 'Paste a link, RSS or hyper:// feed' : 'Paste a link to save',
    'aria-label': 'A page to save, or a feed to follow (RSS, Atom or hyper://)',
    value: state.addDraft,
    disabled: state.saving,
    oninput: (e) => {
      const before = addKind(state.addDraft)
      state.addDraft = e.target.value
      if (addKind(state.addDraft) !== before) {
        const btn = e.target.parentNode.querySelector('.btn.primary')
        btn.replaceWith(submitBtn())
      }
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') submit()
    },
  })
  const submit = () => {
    const v = state.addDraft.trim()
    if (!v || state.saving) return
    if (addKind(v) === 'feed' && !canFeed) {
      state.addMsg = 'This Space is shared, and you can view it. People who can edit it choose its feeds.'
      render()
      return
    }
    state.addDraft = ''
    input.value = ''
    addFromBox(v)
  }
  // A drive subscribes; a web link is looked at first (a feed is followed, a page saved).
  const submitBtn = () => {
    const kind = addKind(state.addDraft)
    return el('button', { class: 'btn primary', onclick: submit, disabled: state.saving }, [
      state.saving ? icon('circle-notch', 'fa-spin') : icon(kind === 'feed' ? 'plus' : kind === 'article' ? 'bookmark' : 'plus'),
      state.saving ? ' Adding…' : kind === 'feed' ? ' Subscribe' : kind === 'article' ? ' Save to Reader' : ' Add',
    ])
  }
  return el('div', { class: 'add-feed' }, [
    input,
    submitBtn(),
    state.addMsg ? el('div', { class: 'msg' }, [state.addMsg]) : null,
    state.feedOffer && state.canFollow
      ? el('div', { class: 'feed-offer' }, [
          icon('rss'),
          el('span', {}, [`${state.feedOffer.site} has a feed. `]),
          el('button', { class: 'link-btn', onclick: () => followSiteFeed(state.feedOffer.url) }, ['Subscribe']),
        ])
      : null,
    syncNote(),
  ])
}

// Whether the subscriptions reach the user's other Devices.
function syncNote() {
  if (!state.writable) {
    return el('p', { class: 'sync-note' }, [icon('clock'), 'Waiting for your other device. Changes save once this device can write to your Vault.'])
  }
  if (state.shared) {
    return el('p', { class: 'sync-note' }, [icon('user-friends'), state.canFollow ? 'This Space is shared. Its members see the same feeds. What you save is yours.' : 'This Space is shared, and you can view it. What you save is yours.'])
  }
  if (state.linked) {
    return el('p', { class: 'sync-note' }, [icon('sync-alt'), 'Synced with your linked devices.'])
  }
  return el('p', { class: 'sync-note' }, [
    icon('laptop'),
    el('span', {}, ['On this device only. ', tabLink({}, 'nomad://settings/?view=devices', ['Link a device']), ' to sync.']),
  ])
}

function renderMain() {
  const main = el('main', {})
  const wrap = el('div', { class: 'wrap' })
  main.append(wrap)
  if (isArticleView()) {
    renderArticles(wrap)
    return main
  }
  const posts = visiblePosts()
  const words = searchWords()

  if (words.length) {
    renderResults(wrap, posts, searchedArticles())
    return main
  }
  if (state.loading && !state.posts.length && state.follows.length) {
    wrap.append(el('div', { class: 'status-msg' }, ['Loading feeds…']))
  } else if (!state.follows.length) {
    wrap.append(
      notice('rss', 'No subscriptions yet', [
        'Paste a hyper:// feed, or an RSS or Atom feed’s link (or the site’s own), on the left, or find feeds in ',
        tabLink({}, 'nomad://search/', ['Search']),
        '. To keep any page you read, right-click it and choose Save Page to Reader.',
      ])
    )
  } else if (!posts.length) {
    const feed = state.feeds.find((f) => f.url === state.filter)
    wrap.append(
      feed && !feed.ok
        ? notice('plug', 'Can’t load this feed', [feed.error || 'It may be offline.'])
        : notice('inbox', 'No posts', ['Posts appear here when your feeds publish them.'])
    )
  } else {
    wrap.append(
      el('div', { class: 'result-count' }, [plural(posts.length, 'post')]),
      el('div', { class: 'posts' }, posts.map(renderPost))
    )
  }
  return main
}

// A search in a feed, or under All posts (with the saved articles that match), newest first.
function renderResults(wrap, posts, articles) {
  const feed = state.filter === 'all' ? null : state.feeds.find((f) => f.url === state.filter)
  const where = feed ? ` in ${feed.title}` : ''
  if (!posts.length && !articles.length) {
    wrap.append(
      notice('search', `Nothing matches “${state.query.trim()}”${where}`, [
        state.loading ? 'Some feeds are still loading. ' : '',
        'Search looks for every word in titles, summaries, sites, feeds and topics.',
      ])
    )
    return
  }
  const counts = [articles.length ? plural(articles.length, 'saved article') : '', posts.length ? plural(posts.length, 'post') : '']
  wrap.append(el('div', { class: 'result-count' }, ['Found ' + counts.filter(Boolean).join(' and ') + where]))
  const items = [
    ...articles.map((a) => ({ at: a.savedAt || '', node: () => renderArticle(a) })),
    ...posts.map((p) => ({ at: p.createdAt || '', node: () => renderPost(p) })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  wrap.append(el('div', { class: 'posts' }, items.map((i) => i.node())))
}

// ── Saved articles ───────────────────────────────────────────────────────────

function renderArticles(wrap) {
  const list = visibleArticles()
  const posts = visibleTopicPosts()
  if (!state.articles.length && !posts.length) {
    wrap.append(
      notice('bookmark', 'Nothing saved yet', [
        'Keep track of what you read: right-click a page and choose Save Page to Reader, use Save to Reader in the site menu, or paste a link on the left. ',
        state.ai.autoTopics ? 'The AI sorts each one into topics.' : '',
      ])
    )
    return
  }
  // Offered on the reading log and "No topic yet", not inside a topic.
  const untagged = state.filter.startsWith('topic:') ? [] : state.articles.filter((a) => !a.topicsBy && !isTagging(a))
  const heading = state.filter.startsWith('topic:') ? state.filter.slice(6) : state.filter === 'untagged' ? 'No topic yet' : 'Reading log'
  wrap.append(
    el('div', { class: 'list-head' }, [
      el('h1', {}, [heading]),
      el('span', { class: 'result-count' }, [
        [list.length || !posts.length ? plural(list.length, 'saved article') : '', posts.length ? plural(posts.length, 'feed post') : ''].filter(Boolean).join(', '),
      ]),
      untagged.length
        ? el('button', { class: 'btn', title: 'Ask this device’s AI to sort them into topics', onclick: () => suggestTopics() }, [
            icon('magic'),
            ` Suggest topics for ${untagged.length}`,
          ])
        : null,
    ])
  )
  if (state.ai.noRuntime) {
    wrap.append(
      el('p', { class: 'ai-note' }, [
        icon('info-circle'),
        el('span', {}, ['No AI is set up on this device, so articles aren’t sorted into topics. Choose one in ', tabLink({}, 'nomad://ai/setup', ['the AI page’s setup']), '.']),
      ])
    )
  }
  if (!list.length && !posts.length) {
    wrap.append(
      searchWords().length
        ? notice('search', `Nothing matches “${state.query.trim()}” in ${heading}`, ['Search looks for every word in titles, summaries, sites and topics.'])
        : notice('inbox', 'No articles here', ['Articles you save appear here.'])
    )
    return
  }
  // A topic shows saved articles and feed posts together, newest first.
  const items = [
    ...list.map((a) => ({ at: a.savedAt || '', node: () => renderArticle(a) })),
    ...posts.map((p) => ({ at: p.createdAt || '', node: () => renderPost(p) })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  wrap.append(el('div', { class: 'posts' }, items.map((i) => i.node())))
}

function renderArticle(a) {
  const read = !!a.readAt
  const subject = articleSubject(a)
  const editing = state.editing === subject.key
  return el('div', { class: 'post article' + (read ? ' read' : ''), 'data-id': a.id, onclick: (e) => { if (!e.target.closest('button, input, .tag, a')) openReading(a.id) } }, [
    el('span', { class: 'dot', 'aria-label': read ? null : 'Unread' }),
    el('div', { class: 'feed-name' }, [
      siteIcon(a.url),
      el('span', {}, marked(a.site || a.url)),
      el('span', { class: 'sep' }, ['·']),
      el('span', { title: 'Saved ' + new Date(a.savedAt).toLocaleString() }, [formatDate(a.savedAt)]),
      a.words ? el('span', { class: 'sep' }, ['·']) : null,
      a.words ? el('span', {}, [`${minutes(a.words)} min read`]) : null,
    ]),
    el('a', { class: 'title', href: a.url, onclick: (e) => { e.preventDefault(); openReading(a.id) } }, marked(a.title)),
    a.excerpt ? el('div', { class: 'summary' }, marked(a.excerpt)) : null,
    editing ? renderTopicEditor(subject) : renderTopics(subject),
    el('div', { class: 'row-actions' }, [
      a.feed && !state.follows.includes(a.feed) && state.canFollow
        ? actionBtn('rss', `Follow ${a.site || 'this site'}’s feed`, () => followSiteFeed(a.feed))
        : null,
      actionBtn(read ? 'envelope' : 'check', read ? 'Mark unread' : 'Mark read', () => setArticleRead(a, !read)),
      actionBtn('external-link-alt', 'Open the original page', () => { setArticleRead(a, true); openInTab(a.url) }),
      actionBtn('trash', 'Remove from Reader', () => deleteArticle(a)),
    ]),
  ])
}

function renderTopics(a) {
  const chips = (a.topics || []).map((t) =>
    el('span', { class: 'tag', title: `Show ${t}`, onclick: (e) => { e.stopPropagation(); setFilter('topic:' + t) } }, marked(t))
  )
  if (a.tagging) chips.push(el('span', { class: 'tag pending' }, [icon('circle-notch', 'fa-spin'), ' Finding topics…']))
  return el('div', { class: 'meta topics' }, [
    ...chips,
    a.topicsBy === 'ai' && (a.topics || []).length ? el('span', { class: 'by-ai', title: 'Picked by the AI' }, [icon('magic')]) : null,
    el(
      'button',
      {
        class: 'topic-btn' + (chips.length || !a.showAdd ? '' : ' add'),
        title: a.topicsBy === 'ai' ? 'Topics picked by the AI. Edit them' : 'Edit topics',
        onclick: (e) => { e.stopPropagation(); editTopics(a) },
      },
      [icon(chips.length ? 'pen' : 'plus'), chips.length ? '' : ' Add topics']
    ),
  ])
}

function editTopics(subject) {
  state.editing = subject.key
  render()
  document.querySelector('.topic-edit input')?.focus()
}

function renderTopicEditor(a) {
  const listId = 'known-topics'
  const input = el('input', {
    type: 'text',
    value: (a.topics || []).join(', '),
    placeholder: 'Topics, separated by commas',
    'aria-label': 'Topics, separated by commas',
    list: listId,
    onkeydown: (e) => {
      if (e.key === 'Enter') save()
      if (e.key === 'Escape') { state.editing = null; render() }
    },
  })
  const save = () => {
    state.editing = null
    a.save(input.value.split(',').map((t) => t.trim()).filter(Boolean))
  }
  return el('div', { class: 'topic-edit', onclick: (e) => e.stopPropagation() }, [
    input,
    el('datalist', { id: listId }, topics().map((t) => el('option', { value: t.topic }))),
    el('button', { class: 'btn primary', onclick: save }, ['Save']),
    el('button', { class: 'btn', title: 'Ask the AI again', onclick: () => { state.editing = null; a.suggest() } }, [icon('magic'), ' Suggest']),
    el('button', { class: 'btn', onclick: () => { state.editing = null; render() } }, ['Cancel']),
  ])
}

function actionBtn(name, label, onclick) {
  return el('button', { class: 'icon-btn small', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); onclick() } }, [icon(name)])
}

function siteIcon(url) {
  return el('img', {
    class: 'site-icon',
    src: 'asset:favicon:' + url,
    alt: '',
    onerror: (e) => e.target.replaceWith(icon('globe', 'site-icon')),
  })
}

// ── Reading view ─────────────────────────────────────────────────────────────
// The article's readable text, kept when it was saved, drawn as plain text: nothing from the page
// runs or loads. Its look (light / sepia / dark, size, font) is this device's, in localStorage.

const READ_PREFS_KEY = 'reader-view'
const readPrefs = loadReadPrefs()

function loadReadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(READ_PREFS_KEY) || '{}')
    return { theme: p.theme || 'auto', size: Number(p.size) || 19, font: p.font === 'sans' ? 'sans' : 'serif' }
  } catch {
    return { theme: 'auto', size: 19, font: 'serif' }
  }
}

function saveReadPrefs() {
  try {
    localStorage.setItem(READ_PREFS_KEY, JSON.stringify(readPrefs))
  } catch {}
  render()
}

async function openReading(id, { push = true } = {}) {
  const known = state.articles.find((a) => a.id === id)
  state.reading = { article: known || null, text: '', loading: true, error: '' }
  if (push) history.pushState(null, '', '?read=' + id)
  render()
  try {
    const { article, text } = await nomad.vault.readerArticle(id)
    if (state.reading?.article && state.reading.article.id !== id) return
    state.reading = { article, text, loading: false, error: '' }
    if (!article.readAt) setArticleRead(article, true)
  } catch (e) {
    state.reading = { article: known || null, text: '', loading: false, error: e.message || String(e) }
  }
  render()
}

function closeReading({ pop = false } = {}) {
  if (!state.reading) return
  state.reading = null
  if (!pop) history.pushState(null, '', location.pathname)
  render()
}

async function refetchReading() {
  const id = state.reading?.article?.id
  if (!id) return
  state.reading.loading = true
  render()
  try {
    const { article, text } = await nomad.vault.readerRefetchArticle(id)
    state.reading = { article, text, loading: false, error: '' }
  } catch (e) {
    state.reading = { ...state.reading, loading: false, error: e.message || String(e) }
  }
  render()
}

function renderReading() {
  const { article: a, text, loading, error } = state.reading
  const p = readPrefs
  const themeBtn = (theme, label) =>
    el('button', { class: 'theme-btn t-' + theme + (p.theme === theme ? ' on' : ''), title: label, 'aria-label': label, 'aria-pressed': p.theme === theme ? 'true' : 'false', onclick: () => { p.theme = theme; saveReadPrefs() } }, [theme === 'auto' ? icon('adjust') : 'Aa'])
  const toolbar = el('div', { class: 'reading-bar' }, [
    el('button', { class: 'icon-btn', title: 'Back to Reader', 'aria-label': 'Back to Reader', onclick: () => closeReading() }, [icon('arrow-left')]),
    el('div', { class: 'reading-site' }, a ? [siteIcon(a.url), a.site || ''] : []),
    el('div', { class: 'reading-tools' }, [
      themeBtn('auto', 'Match the system'),
      themeBtn('light', 'Light'),
      themeBtn('sepia', 'Sepia'),
      themeBtn('dark', 'Dark'),
      el('span', { class: 'tool-sep' }),
      el('button', { class: 'icon-btn', title: 'Smaller text', 'aria-label': 'Smaller text', disabled: p.size <= 14, onclick: () => { p.size = Math.max(14, p.size - 1); saveReadPrefs() } }, [el('span', { class: 'a-small' }, ['A'])]),
      el('button', { class: 'icon-btn', title: 'Larger text', 'aria-label': 'Larger text', disabled: p.size >= 28, onclick: () => { p.size = Math.min(28, p.size + 1); saveReadPrefs() } }, [el('span', { class: 'a-large' }, ['A'])]),
      el('button', { class: 'icon-btn', title: p.font === 'serif' ? 'Sans-serif text' : 'Serif text', 'aria-label': 'Switch font', onclick: () => { p.font = p.font === 'serif' ? 'sans' : 'serif'; saveReadPrefs() } }, [icon('font')]),
      el('span', { class: 'tool-sep' }),
      a?.feed && state.canFollow && !state.follows.includes(a.feed)
        ? el('button', { class: 'btn', title: `Follow ${a.site || 'this site'}’s feed in Reader`, onclick: () => { closeReading(); followSiteFeed(a.feed) } }, [icon('rss'), ' Follow site'])
        : null,
      a ? el('button', { class: 'btn', onclick: () => openInTab(a.url) }, [icon('external-link-alt'), ' Original']) : null,
    ]),
  ])

  const body = el('article', { class: 'reading-body' })
  if (a) {
    body.append(
      el('div', { class: 'reading-meta' }, [
        a.site || '',
        a.byline ? ' · ' + a.byline : '',
        a.publishedAt ? ' · ' + formatDate(a.publishedAt) : '',
        a.words ? ` · ${minutes(a.words)} min read` : '',
      ]),
      el('h1', {}, [a.title]),
      (a.topics || []).length ? el('div', { class: 'meta topics' }, a.topics.map((t) => el('span', { class: 'tag', onclick: () => { closeReading(); setFilter('topic:' + t) } }, [t]))) : null
    )
  }
  if (loading) body.append(el('p', { class: 'reading-status' }, [icon('circle-notch', 'fa-spin'), ' Loading…']))
  else if (error) body.append(el('p', { class: 'reading-status err' }, [error]))
  else if (!text.trim()) {
    body.append(
      el('div', { class: 'reading-empty' }, [
        el('p', {}, ['Reader didn’t find the article’s text on this page. It may need you to sign in, or be mostly pictures.']),
        el('div', { class: 'reading-empty-actions' }, [
          el('button', { class: 'btn', onclick: refetchReading }, [icon('redo-alt'), ' Load it again']),
          a ? el('button', { class: 'btn primary', onclick: () => openInTab(a.url) }, [icon('external-link-alt'), ' Open the original']) : null,
        ]),
      ])
    )
  } else body.append(...renderText(text))

  const root = el('div', {
    class: `reading theme-${p.theme} font-${p.font}`,
    'data-id': a?.id || '',
    style: `--read-size: ${p.size}px`,
  }, [toolbar, body])
  return root
}

// The Markdown subset bg/lib/extract-article.mjs writes: blank-line paragraphs, "## " headings,
// "- " items, "> " quotes, ``` blocks. Drawn as text nodes only.
function renderText(text) {
  const out = []
  let list = null
  for (const block of text.split(/\n{2,}/)) {
    if (block.startsWith('```')) {
      list = null
      out.push(el('pre', {}, [block.replace(/^```\n?/, '').replace(/\n?```$/, '')]))
      continue
    }
    const quote = block.startsWith('> ')
    const line = quote ? block.slice(2) : block
    const h = /^(#{2,6}) (.*)$/s.exec(line)
    let node
    if (line.startsWith('- ')) {
      const li = el('li', {}, [line.slice(2)])
      if (!list || list.quote !== quote) {
        list = el('ul')
        list.quote = quote
        out.push(quote ? el('blockquote', {}, [list]) : list)
      }
      list.append(li)
      continue
    }
    list = null
    if (h) node = el(h[1].length <= 2 ? 'h2' : 'h3', {}, [h[2]])
    else node = el('p', {}, [line])
    const prev = out[out.length - 1]
    if (quote && prev?.tagName === 'BLOCKQUOTE' && !prev.querySelector('ul')) prev.append(node)
    else out.push(quote ? el('blockquote', {}, [node]) : node)
  }
  return out
}

function minutes(words) {
  return Math.max(1, Math.round(words / 230))
}

function renderPost(p) {
  const read = state.readSet.has(p.url)
  const subject = postSubject(p)
  const editing = state.editing === subject.key
  return el('div', {
    class: 'post' + (read ? ' read' : ''),
    'data-url': p.url,
    onclick: (e) => { if (!e.target.closest('button, input, .tag, a')) openPost(p) },
  }, [
    el('span', { class: 'dot', 'aria-label': read ? null : 'Unread' }),
    el('div', { class: 'feed-name' }, [
      p.web ? icon('rss', 'site-icon') : null,
      el('span', {}, marked(p.feedTitle)),
      p.createdAt ? el('span', { class: 'sep' }, ['·']) : null,
      p.createdAt ? el('span', {}, [formatDate(p.createdAt)]) : null,
    ]),
    el('a', { class: 'title', href: p.url, onclick: (e) => { e.preventDefault(); openPost(p) } }, marked(p.title)),
    p.summary ? el('div', { class: 'summary' }, marked(p.summary)) : null,
    // The author's own tags, then the topics.
    p.tags.length ? el('div', { class: 'meta' }, p.tags.map((t) => el('span', { class: 'author-tag' }, ['#' + t]))) : null,
    // A post with no topics yet gets "Add topics" with its other actions, on hover.
    editing ? renderTopicEditor(subject) : subject.topics.length || subject.tagging ? renderTopics(subject) : null,
    el('div', { class: 'row-actions' }, [
      editing || subject.topics.length || subject.tagging ? null : actionBtn('tag', 'Add topics', () => editTopics(subject)),
      read ? null : actionBtn('check', 'Mark read', () => { markRead(p.url); render() }),
    ]),
  ])
}

function notice(iconName, heading, body) {
  return el('div', { class: 'notice' }, [
    el('div', { class: 'notice-icon' }, [icon(iconName)]),
    el('h2', {}, [heading]),
    el('p', {}, body),
  ])
}

function openPost(p) {
  markRead(p.url)
  render()
  openInTab(p.url) // full post renders in the feed's own origin
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Opens `url` in a new tab in this Space (see nomad://search for why not window.open).
function openInTab(url) {
  if (window.nomad?.browser?.openUrl) nomad.browser.openUrl(url, { setActive: true })
  else window.open(url)
}

function tabLink(attrs, url, children) {
  return el('a', { ...attrs, href: url, onclick: (e) => { e.preventDefault(); openInTab(url) } }, children)
}

function cmpDesc(a, b) {
  const ka = a.createdAt || a.slug || ''
  const kb = b.createdAt || b.slug || ''
  return kb < ka ? -1 : kb > ka ? 1 : 0
}

function ensureDir(p) {
  if (!p.startsWith('/')) p = '/' + p
  if (!p.endsWith('/')) p = p + '/'
  return p
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function icon(name, cls = '') {
  return el('span', { class: `fas fa-fw fa-${name}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' })
}

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  for (const k in attrs || {}) {
    const v = attrs[k]
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v === true) node.setAttribute(k, '')
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c)
  return node
}
