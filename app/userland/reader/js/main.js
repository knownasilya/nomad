// nomad://reader — an RSS-like reader for walled.garden/feed drives.
//
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
  filter: 'all', // 'all' | feedUrl
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

  render()
  await refreshAll()
  window.addEventListener('beforeunload', () => { flushReadState() })
  watchOtherDevices()
}

// ── Data: subscriptions and read marks (nomad.vault) ─────────────────────────

async function loadState() {
  applyState(await nomad.vault.readerState())
}

function applyState(s) {
  state.follows = s.follows || []
  state.writable = s.writable !== false
  state.linked = !!s.linked
  // Keep marks made here that aren't saved yet.
  state.readSet = new Set([...(s.read || []), ...pendingRead])
  if (state.filter !== 'all' && !state.follows.includes(state.filter)) state.filter = 'all'
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

function unreadCount(posts) {
  return posts.filter((p) => !state.readSet.has(p.url)).length
}

function render() {
  const app = document.getElementById('app')
  const scroll = app.querySelector('main')?.scrollTop || 0
  const typing = document.activeElement?.matches('.add-feed input')
  app.replaceChildren(renderHeader(), el('div', { class: 'layout' }, [renderSidebar(), renderMain()]))
  app.querySelector('main').scrollTop = scroll
  if (typing) app.querySelector('.add-feed input').focus() // feeds finishing loading mustn't steal it
}

function renderHeader() {
  const unread = unreadCount(visiblePosts())
  return el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://reader/', alt: '' }), 'Reader']),
    el('div', { class: 'status' }, [state.loading ? 'Refreshing…' : `${unread} unread`]),
    el('div', { class: 'header-actions' }, [
      unread > 0
        ? el('button', { class: 'btn', onclick: markAllRead }, [icon('check-double'), ' Mark all read'])
        : null,
      el(
        'button',
        { class: 'icon-btn', title: 'Refresh', 'aria-label': 'Refresh', disabled: state.loading, onclick: () => refreshAll() },
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
        onremove: () => removeFeed(f.url),
      })
    )
  }
  // feeds that are still loading (no result yet)
  if (state.loading) {
    for (const u of state.follows.filter((u) => !state.feeds.some((f) => f.url === u))) {
      list.append(feedRow({ name: u, icon: feedIcon(u), current: false }))
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
  render()
}

function renderAddFeed() {
  const input = el('input', {
    type: 'text',
    placeholder: 'hyper://… add a feed',
    'aria-label': 'Feed address',
    value: state.addDraft,
    oninput: (e) => { state.addDraft = e.target.value },
    onkeydown: (e) => {
      if (e.key === 'Enter') submit()
    },
  })
  const submit = () => {
    const v = state.addDraft.trim()
    state.addDraft = ''
    input.value = ''
    addFeed(v)
  }
  return el('div', { class: 'add-feed' }, [
    input,
    el('button', { class: 'btn primary', onclick: submit }, [icon('plus'), ' Subscribe']),
    state.addMsg ? el('div', { class: 'msg' }, [state.addMsg]) : null,
    syncNote(),
  ])
}

// Whether the subscriptions reach the user's other Devices.
function syncNote() {
  if (!state.writable) {
    return el('p', { class: 'sync-note' }, [icon('clock'), 'Waiting for your other device. Changes save once this device can write to your Vault.'])
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
  const posts = visiblePosts()

  if (state.loading && !state.posts.length && state.follows.length) {
    wrap.append(el('div', { class: 'status-msg' }, ['Loading feeds…']))
  } else if (!state.follows.length) {
    wrap.append(
      notice('rss', 'No subscriptions yet', [
        'Add a feed’s hyper:// address on the left, or find feeds in ',
        tabLink({}, 'nomad://search/', ['Search']),
        '.',
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
