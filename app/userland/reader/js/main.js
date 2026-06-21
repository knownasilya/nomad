// beaker://reader — an RSS-like reader for walled.garden/feed drives.
//
// - Subscriptions: walled.garden/follows at hyper://private/.data/walled.garden/follows.json
//   (per-Space, multi-device via the Root Drive).
// - Reads any feed whether it's a plain Hyperdrive or an Autobase Collaborative Drive,
//   via a local bridge (try Hyperdrive, fall back to Autobase; cache the result).
// - Post discovery by directory enumeration (itemsPath/*/post.json), newest-first.
// - Read-state synced to hyper://private/.data/reader/read-state.json (debounced, pruned).
// - Hybrid rendering: an aggregated card stream; opening a post navigates to its
//   canonical URL in a new tab (rendered in the feed's own origin).

const FOLLOWS_PATH = 'hyper://private/.data/walled.garden/follows.json'
const READSTATE_PATH = 'hyper://private/.data/reader/read-state.json'

const state = {
  follows: [],        // [driveRootUrl]
  feeds: [],          // [{ url, title, ok, error, posts:[] }]
  posts: [],          // aggregated, sorted desc
  filter: 'all',      // 'all' | feedUrl
  loading: true,
  addMsg: '',
  readSet: new Set(),
}

const backendCache = {}   // driveRootUrl -> 'hyperdrive' | 'autobase'
let saveReadTimer = null

// ── Boot ─────────────────────────────────────────────────────────────────────

init().catch((err) => {
  document.getElementById('app').innerHTML =
    `<p class="empty">Reader failed to start: ${esc(err.message)}</p>`
  console.error('[reader] init error:', err)
})

async function init() {
  state.readSet = await loadReadState()
  state.follows = await loadFollows()

  // Deep-link: beaker://reader/?subscribe=<feed url> (used by the chrome Subscribe action).
  const sub = new URLSearchParams(location.search).get('subscribe')
  if (sub) {
    const root = driveRoot(sub)
    if (root && !state.follows.includes(root)) {
      state.follows.push(root)
      await saveFollows(state.follows).catch((e) => console.warn('[reader] save follows', e))
    }
    history.replaceState(null, '', location.pathname)   // drop the query
  }

  render()
  await refreshAll()
  window.addEventListener('beforeunload', () => { flushReadState() })
}

// ── Data: subscriptions ───────────────────────────────────────────────────────

async function loadFollows() {
  try {
    const j = JSON.parse(await beaker.hyperdrive.readFile(FOLLOWS_PATH))
    return (j.urls || []).map(driveRoot).filter(Boolean)
  } catch { return [] }
}

async function saveFollows(urls) {
  const rec = { type: 'walled.garden/follows', urls }
  const valid = beaker.schemas.validate('walled.garden/follows', rec)
  if (!valid.success) throw new Error(valid.error)
  await beaker.hyperdrive.writeFile(FOLLOWS_PATH, JSON.stringify(valid.data, null, 2))
}

async function addFeed(rawUrl) {
  const root = driveRoot(rawUrl)
  if (!root) { state.addMsg = 'Enter a hyper:// URL.'; render(); return }
  if (state.follows.includes(root)) { state.addMsg = 'Already subscribed.'; render(); return }
  state.follows.push(root)
  state.addMsg = ''
  try { await saveFollows(state.follows) } catch (e) { state.addMsg = 'Could not save: ' + e.message }
  render()
  await refreshAll()
}

async function removeFeed(root) {
  state.follows = state.follows.filter((u) => u !== root)
  if (state.filter === root) state.filter = 'all'
  try { await saveFollows(state.follows) } catch (e) { console.warn('[reader] save follows', e) }
  await refreshAll()
}

// ── Data: read-state (synced, debounced, pruned) ──────────────────────────────

async function loadReadState() {
  try {
    const j = JSON.parse(await beaker.hyperdrive.readFile(READSTATE_PATH))
    return new Set(j.read || [])
  } catch { return new Set() }
}

function markRead(postUrl) {
  if (!postUrl || state.readSet.has(postUrl)) return
  state.readSet.add(postUrl)
  scheduleReadStateSave()
}

function markAllRead() {
  for (const p of visiblePosts()) state.readSet.add(p.url)
  scheduleReadStateSave()
  render()
}

function scheduleReadStateSave() {
  clearTimeout(saveReadTimer)
  saveReadTimer = setTimeout(flushReadState, 1500)
}

async function flushReadState() {
  clearTimeout(saveReadTimer)
  // Prune to URLs we currently know about, so the record can't grow forever.
  const known = new Set(state.posts.map((p) => p.url))
  const pruned = [...state.readSet].filter((u) => known.has(u))
  state.readSet = new Set(pruned)
  try {
    await beaker.hyperdrive.writeFile(READSTATE_PATH, JSON.stringify({ read: pruned }, null, 2))
  } catch (e) { console.warn('[reader] read-state save failed', e) }
}

// ── Data: feeds (the Hyperdrive/Autobase bridge) ──────────────────────────────

async function refreshAll() {
  state.loading = true
  render()
  const results = await Promise.allSettled(state.follows.map(loadFeed))
  state.feeds = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { url: state.follows[i], title: state.follows[i], ok: false, error: String(r.reason && r.reason.message || r.reason), posts: [] }
  )
  state.posts = state.feeds.flatMap((f) => f.posts)
  state.posts.sort((a, b) => cmpDesc(a, b))
  state.loading = false
  render()
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
// detecting the backend by attempting a read and caching the result.
async function openFeed(root) {
  if (backendCache[root] === 'autobase') return autobaseAdapter(root)
  if (backendCache[root] === 'hyperdrive') return hyperdriveAdapter(root)

  // Fast path: a drive we already know is collaborative.
  try {
    if (await beaker.autobase.isCollaborativeDrive(root)) {
      backendCache[root] = 'autobase'
      return autobaseAdapter(root)
    }
  } catch {}

  // Try Hyperdrive (its open fails fast on an Autobase core).
  try {
    const h = hyperdriveAdapter(root)
    await h.readText('/index.json')
    backendCache[root] = 'hyperdrive'
    return h
  } catch {}

  // Fall back to Autobase (throws if genuinely unreachable — surfaced per-feed).
  const a = autobaseAdapter(root)
  await a.readText('/index.json')
  backendCache[root] = 'autobase'
  return a
}

function hyperdriveAdapter(root) {
  const d = beaker.hyperdrive.drive(root)
  return {
    async readText(path) { return d.readFile(path) },          // rejects if missing
    async listPostMetaPaths(itemsPath) {
      const res = await beaker.hyperdrive.query({ drive: root, path: itemsPath + '*/post.json' })
      return res.map((r) => r.path)
    },
  }
}

function autobaseAdapter(root) {
  const d = beaker.autobase.collaborativeDrive(root)
  return {
    async readText(path) {
      const s = await d.get(path)
      if (s == null) throw new Error('not found: ' + path)
      return s
    },
    async listPostMetaPaths(itemsPath) {
      const entries = await d.list(itemsPath)
      return entries.map((e) => e.key).filter((k) => k.endsWith('/post.json'))
    },
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

function visiblePosts() {
  return state.filter === 'all' ? state.posts : state.posts.filter((p) => p.feedUrl === state.filter)
}

function render() {
  const app = document.getElementById('app')
  app.innerHTML = ''
  app.append(renderBar())
  const layout = h('div', { class: 'layout' })
  layout.append(renderSidebar())
  layout.append(renderStream())
  app.append(layout)
}

function renderBar() {
  const bar = h('header', { class: 'bar' })
  bar.append(h('h1', {}, 'Reader'))
  const unread = visiblePosts().filter((p) => !state.readSet.has(p.url)).length
  bar.append(h('span', { class: 'status' }, state.loading ? 'Refreshing…' : `${unread} unread`))
  bar.append(h('button', { class: 'btn', click: () => refreshAll() }, '↻ Refresh'))
  if (unread > 0) bar.append(h('button', { class: 'btn', click: markAllRead }, 'Mark all read'))
  return bar
}

function renderSidebar() {
  const aside = h('aside', { class: 'feeds' })
  aside.append(h('h2', {}, 'Feeds'))

  const all = h('div', { class: 'feed-item' + (state.filter === 'all' ? ' active' : ''), click: () => { state.filter = 'all'; render() } })
  all.append(h('span', { class: 'name' }, 'All'))
  all.append(h('span', { class: 'count' }, String(state.posts.filter((p) => !state.readSet.has(p.url)).length)))
  aside.append(all)

  for (const f of state.feeds) {
    const cls = 'feed-item' + (state.filter === f.url ? ' active' : '') + (f.ok ? '' : ' err')
    const item = h('div', { class: cls, title: f.error || f.url, click: () => { state.filter = f.url; render() } })
    item.append(h('span', { class: 'name' }, f.title || f.url))
    if (f.ok) {
      const n = f.posts.filter((p) => !state.readSet.has(p.url)).length
      item.append(h('span', { class: 'count' }, String(n)))
    }
    item.append(h('button', { class: 'x', title: 'Unsubscribe', click: (e) => { e.stopPropagation(); removeFeed(f.url) } }, '✕'))
    aside.append(item)
  }
  // feeds that are still loading (no result yet)
  if (state.loading) {
    for (const u of state.follows.filter((u) => !state.feeds.some((f) => f.url === u))) {
      const item = h('div', { class: 'feed-item' })
      item.append(h('span', { class: 'name' }, u))
      aside.append(item)
    }
  }

  aside.append(renderAddFeed())
  return aside
}

function renderAddFeed() {
  const box = h('div', { class: 'add-feed' })
  const input = h('input', {
    placeholder: 'hyper://… add a feed',
    keydown: (e) => { if (e.key === 'Enter') { addFeed(input.value.trim()); input.value = '' } },
  })
  box.append(input)
  box.append(h('button', { class: 'btn btn-primary', click: () => { addFeed(input.value.trim()); input.value = '' } }, 'Subscribe'))
  if (state.addMsg) box.append(h('div', { class: 'msg' }, state.addMsg))
  return box
}

function renderStream() {
  const main = h('main', { class: 'stream' })
  const posts = visiblePosts()

  if (state.loading && !state.posts.length) { main.append(h('div', { class: 'spin' }, 'Loading feeds…')); return main }
  if (!state.follows.length) { main.append(h('div', { class: 'empty' }, 'No subscriptions yet. Add a feed’s hyper:// URL on the left.')); return main }
  if (!posts.length) { main.append(h('div', { class: 'empty' }, 'No posts.')); return main }

  const wrap = h('div', { class: 'posts' })
  for (const p of posts) wrap.append(renderCard(p))
  main.append(wrap)
  return main
}

function renderCard(p) {
  const read = state.readSet.has(p.url)
  const card = h('div', {
    class: 'post-card' + (read ? ' read' : ''),
    click: () => openPost(p),
  })
  const top = h('div', { class: 'top' })
  top.append(h('span', { class: 'unread-dot' }))
  top.append(h('span', { class: 'feed-chip' }, p.feedTitle))
  card.append(top)
  card.append(h('h3', {}, p.title))
  if (p.summary) card.append(h('p', { class: 'summary' }, p.summary))
  const meta = h('div', { class: 'meta' })
  meta.append(h('span', {}, formatDate(p.createdAt)))
  for (const t of p.tags) meta.append(h('span', { class: 'tag' }, t))
  card.append(meta)
  return card
}

function openPost(p) {
  markRead(p.url)
  render()
  window.open(p.url)   // full post renders in the feed's own origin
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cmpDesc(a, b) {
  const ka = a.createdAt || a.slug || ''
  const kb = b.createdAt || b.slug || ''
  return kb < ka ? -1 : kb > ka ? 1 : 0
}

function driveRoot(url) {
  if (!url) return null
  url = String(url).trim()
  if (!/^hyper:\/\//i.test(url)) {
    // accept a bare key
    if (/^[0-9a-f]{64}$/i.test(url)) url = 'hyper://' + url
    else return null
  }
  try {
    const u = new URL(url)
    return u.protocol + '//' + u.host + '/'
  } catch { return null }
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

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k, v)
    else el.setAttribute(k, v)
  }
  for (const child of children) {
    if (child instanceof Node) el.append(child)
    else if (child != null) el.append(String(child))
  }
  return el
}
