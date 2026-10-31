// nomad://reader — an RSS-like reader for walled.garden/feed drives, and a reading log of any
// web page the user saves (ADR-0033), sorted into topics by the AI, with a minimal reading view.
//
// - Saved articles come with the Reader's state (bg/web-apis/bg/reader-articles.ts). A page is
//   saved from its tab (context menu, site menu) or by pasting its link in the box on the left.
//   The AI files each into topics in the background; the user can change them (then the AI won't).
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
  loading: true,
  addMsg: '',
  addDraft: '', // the feed address being typed; kept across re-renders
  readSet: new Set(),
  writable: true, // false while a Device that just joined waits for the Vault
  linked: false, // another Device shares the Vault
};

let pendingRead = new Set() // marked read here since the last save
let saveReadTimer = null

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
  await loadState()

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
  state.readSet = new Set([...(s.read || []), ...pendingRead])
  state.articles = s.articles || []
  state.ai = s.ai || state.ai
  if (state.filter.startsWith('hyper:') && !state.follows.includes(state.filter)) state.filter = 'all'
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
// any other address is a page to save.
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
  return 'article'
}

async function addFromBox(raw) {
  if (addKind(raw) === 'feed') return addFeed(raw)
  return saveArticle(raw)
}

async function saveArticle(rawUrl) {
  state.saving = true
  state.addMsg = ''
  render()
  try {
    const { article, state: s } = await nomad.vault.readerSaveArticle(rawUrl)
    applyState(s)
    state.filter = 'saved'
    state.flash = article.id
  } catch (e) {
    state.addMsg = e.message
    state.addDraft = rawUrl
  }
  state.saving = false
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
    const unread = visibleArticles().filter((a) => !a.readAt)
    articleAction(async () => {
      let s
      for (const a of unread) s = await nomad.vault.readerUpdateArticle(a.id, { read: true })
      return s || nomad.vault.readerState()
    })
    return
  }
  for (const p of visiblePosts()) markRead(p.url)
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

async function refreshAll() {
  state.loading = true
  render()
  const follows = state.follows.slice()
  const results = await Promise.allSettled(follows.map(loadFeed))
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
}

async function loadFeed(root) {
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

function visiblePosts() {
  return state.filter === 'all' ? state.posts : state.posts.filter((p) => p.feedUrl === state.filter)
}

// The saved-articles views: the reading log, one topic, or the articles with no topic yet.
function isArticleView() {
  return state.filter === 'saved' || state.filter === 'untagged' || state.filter.startsWith('topic:')
}

function visibleArticles() {
  if (state.filter === 'saved') return state.articles
  if (state.filter === 'untagged') return state.articles.filter((a) => !(a.topics || []).length)
  if (state.filter.startsWith('topic:')) {
    const k = state.filter.slice(6).toLowerCase()
    return state.articles.filter((a) => (a.topics || []).some((t) => t.toLowerCase() === k))
  }
  return []
}

// Every topic in use, most used first: [{ topic, count }] (shared/reader-articles.mjs topicCounts).
function topics() {
  const counts = new Map()
  for (const a of state.articles) {
    for (const t of a.topics || []) {
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

function render() {
  const app = document.getElementById('app')
  if (state.reading) {
    const scroller = app.querySelector('.reading')
    const top = scroller?.dataset.id === state.reading.article?.id ? scroller.scrollTop : 0
    app.replaceChildren(renderReading())
    app.querySelector('.reading').scrollTop = top
    return
  }
  const scroll = app.querySelector('main')?.scrollTop || 0
  const active = document.activeElement
  const typing = active?.matches('.add-feed input') ? '.add-feed input' : active?.matches('.topic-edit input') ? '.topic-edit input' : null
  app.replaceChildren(renderHeader(), el('div', { class: 'layout' }, [renderSidebar(), renderMain()]))
  app.querySelector('main').scrollTop = scroll
  if (typing) app.querySelector(typing)?.focus() // feeds finishing loading mustn't steal it
  if (state.flash) {
    app.querySelector(`[data-id="${state.flash}"]`)?.scrollIntoView({ block: 'nearest' })
    state.flash = null
  }
}

function renderHeader() {
  const articles = isArticleView()
  const unread = articles ? unreadArticles(visibleArticles()) : unreadCount(visiblePosts())
  return el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://reader/', alt: '' }), 'Reader']),
    el('div', { class: 'status' }, [!articles && state.loading ? 'Refreshing…' : `${unread} unread`]),
    el('div', { class: 'header-actions' }, [
      unread > 0
        ? el('button', { class: 'btn', onclick: markAllRead }, [icon('check-double'), ' Mark all read'])
        : null,
      el(
        'button',
        { class: 'icon-btn', title: 'Refresh', 'aria-label': 'Refresh', disabled: state.loading, onclick: async () => { await loadState().catch(() => {}); refreshAll() } },
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
        icon: feedIcon(f.url),
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
}

// One box for both: a feed's hyper:// address subscribes, any other link is saved as an article.
function renderAddFeed() {
  const canFeed = state.canFollow
  const input = el('input', {
    type: 'text',
    placeholder: canFeed ? 'Paste a link or hyper:// feed' : 'Paste a link to save',
    'aria-label': 'Link to save, or feed to subscribe to',
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
  const submitBtn = () => {
    const feed = addKind(state.addDraft) === 'feed'
    return el('button', { class: 'btn primary', onclick: submit, disabled: state.saving }, [
      state.saving ? icon('circle-notch', 'fa-spin') : icon(feed ? 'plus' : 'bookmark'),
      state.saving ? ' Saving…' : feed ? ' Subscribe' : ' Save to Reader',
    ])
  }
  return el('div', { class: 'add-feed' }, [
    input,
    submitBtn(),
    state.addMsg ? el('div', { class: 'msg' }, [state.addMsg]) : null,
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

  if (state.loading && !state.posts.length && state.follows.length) {
    wrap.append(el('div', { class: 'status-msg' }, ['Loading feeds…']))
  } else if (!state.follows.length) {
    wrap.append(
      notice('rss', 'No subscriptions yet', [
        'Add a feed’s hyper:// address on the left, or find feeds in ',
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

// ── Saved articles ───────────────────────────────────────────────────────────

function renderArticles(wrap) {
  const list = visibleArticles()
  if (!state.articles.length) {
    wrap.append(
      notice('bookmark', 'Nothing saved yet', [
        'Keep track of what you read: right-click a page and choose Save Page to Reader, use Save to Reader in the site menu, or paste a link on the left. ',
        state.ai.autoTopics ? 'The AI sorts each one into topics.' : '',
      ])
    )
    return
  }
  const untagged = state.articles.filter((a) => !a.topicsBy && !isTagging(a))
  const heading = state.filter.startsWith('topic:') ? state.filter.slice(6) : state.filter === 'untagged' ? 'No topic yet' : 'Reading log'
  wrap.append(
    el('div', { class: 'list-head' }, [
      el('h1', {}, [heading]),
      el('span', { class: 'result-count' }, [plural(list.length, 'article')]),
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
        el('span', {}, ['No AI is set up on this device, so articles aren’t sorted into topics. Choose one in ', tabLink({}, 'nomad://settings/?view=ai', ['Settings → AI']), '.']),
      ])
    )
  }
  if (!list.length) {
    wrap.append(notice('inbox', 'No articles here', ['Articles you save appear here.']))
    return
  }
  wrap.append(el('div', { class: 'posts' }, list.map(renderArticle)))
}

function renderArticle(a) {
  const read = !!a.readAt
  const editing = state.editing === a.id
  return el('div', { class: 'post article' + (read ? ' read' : ''), 'data-id': a.id, onclick: (e) => { if (!e.target.closest('button, input, .tag, a')) openReading(a.id) } }, [
    el('span', { class: 'dot', 'aria-label': read ? null : 'Unread' }),
    el('div', { class: 'feed-name' }, [
      siteIcon(a.url),
      el('span', {}, [a.site || a.url]),
      el('span', { class: 'sep' }, ['·']),
      el('span', { title: 'Saved ' + new Date(a.savedAt).toLocaleString() }, [formatDate(a.savedAt)]),
      a.words ? el('span', { class: 'sep' }, ['·']) : null,
      a.words ? el('span', {}, [`${minutes(a.words)} min read`]) : null,
    ]),
    el('a', { class: 'title', href: a.url, onclick: (e) => { e.preventDefault(); openReading(a.id) } }, [a.title]),
    a.excerpt ? el('div', { class: 'summary' }, [a.excerpt]) : null,
    editing ? renderTopicEditor(a) : renderTopics(a),
    el('div', { class: 'row-actions' }, [
      actionBtn(read ? 'envelope' : 'check', read ? 'Mark unread' : 'Mark read', () => setArticleRead(a, !read)),
      actionBtn('external-link-alt', 'Open the original page', () => { setArticleRead(a, true); openInTab(a.url) }),
      actionBtn('trash', 'Remove from Reader', () => deleteArticle(a)),
    ]),
  ])
}

function renderTopics(a) {
  const chips = (a.topics || []).map((t) =>
    el('span', { class: 'tag', title: `Show ${t}`, onclick: () => setFilter('topic:' + t) }, [t])
  )
  if (isTagging(a)) chips.push(el('span', { class: 'tag pending' }, [icon('circle-notch', 'fa-spin'), ' Finding topics…']))
  return el('div', { class: 'meta topics' }, [
    ...chips,
    a.topicsBy === 'ai' && (a.topics || []).length ? el('span', { class: 'by-ai', title: 'Picked by the AI' }, [icon('magic')]) : null,
    el(
      'button',
      {
        class: 'topic-btn' + (chips.length ? '' : ' add'),
        title: a.topicsBy === 'ai' ? 'Topics picked by the AI. Edit them' : 'Edit topics',
        onclick: () => { state.editing = a.id; render(); document.querySelector('.topic-edit input')?.focus() },
      },
      [icon(chips.length ? 'pen' : 'plus'), chips.length ? '' : ' Add topics']
    ),
  ])
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
    setArticleTopics(a, input.value.split(',').map((t) => t.trim()).filter(Boolean))
  }
  return el('div', { class: 'topic-edit' }, [
    input,
    el('datalist', { id: listId }, topics().map((t) => el('option', { value: t.topic }))),
    el('button', { class: 'btn primary', onclick: save }, ['Save']),
    el('button', { class: 'btn', title: 'Ask the AI again', onclick: () => { state.editing = null; suggestTopics([a.id]) } }, [icon('magic'), ' Suggest']),
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
  return el('a', {
    class: 'post' + (read ? ' read' : ''),
    href: p.url,
    onclick: (e) => { e.preventDefault(); openPost(p) },
  }, [
    el('span', { class: 'dot', 'aria-label': read ? null : 'Unread' }),
    el('div', { class: 'feed-name' }, [p.feedTitle]),
    el('div', { class: 'title' }, [p.title]),
    p.summary ? el('div', { class: 'summary' }, [p.summary]) : null,
    el('div', { class: 'meta' }, [
      p.createdAt ? el('span', {}, [formatDate(p.createdAt)]) : null,
      ...p.tags.map((t) => el('span', { class: 'tag' }, [t])),
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
