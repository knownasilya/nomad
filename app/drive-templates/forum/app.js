// Forum template — uses nomad.fs for multi-writer collaboration
// Each Writer can create posts and comments.
// The drive owner manages who can write via invite/approve flows.

// The drive this page lives in, from nomad.page — host-provided and authoritative on desktop AND
// mobile (never parse `location` yourself; it's unreliable in the mobile WebView).
const BASE = nomad.page.origin
const drive = nomad.fs.drive(BASE)

// ── State ──────────────────────────────────────────────────────────────────────

let state = {
  view: 'list',         // 'list' | 'thread' | 'new-post' | 'writers'
  posts: [],
  activePost: null,
  comments: [],
  writers: [],
  requests: [],
  info: null,
  isWriter: false,
  myProfileUrl: null,
  myWriterKey: null,
  loading: true,
}

// ── Boot ───────────────────────────────────────────────────────────────────────

customElements.define('forum-app', class extends HTMLElement {
  async connectedCallback() {
    try {
      await boot(this)
    } catch (err) {
      this.innerHTML = `<p style="color:red;padding:20px;font-family:monospace">Forum error: ${err.message}</p>`
      console.error('[forum-app] boot error:', err)
    }
  }
})

async function boot(el) {
  state.info = await drive.getInfo()
  state.isWriter = state.info.writable

  // Load the user's profile from address book
  try {
    const ab = await nomad.fs.readFile('hyper://private/address-book.json').then(JSON.parse)
    console.log('Address book', ab);
    state.myProfileUrl = ab?.profiles?.[0]?.key ? `hyper://${ab.profiles[0].key}/` : null
  } catch(e) {
    console.log('No address book found', e);
  }

  if (state.isWriter) {
    // writerKey is the local autobase writer key — exposed via listWriters
    const writers = await drive.listWriters()
    state.writers = writers
    state.requests = await drive.listRequests()
    // Find our writer key from the list that has no profileUrl but matches our profile
    const myWriter = writers.find(w => w.profileUrl === state.myProfileUrl) || writers[0]
    state.myWriterKey = myWriter?.writerKey

    // Live-refresh pending requests as they arrive over the network (no polling)
    drive.watchRequests(async () => {
      state.requests = await drive.listRequests()
      await render(el)
    })
  }

  state.loading = false
  await render(el)
}

// ── Router ─────────────────────────────────────────────────────────────────────

function navigate(view, extra = {}) {
  Object.assign(state, { view, ...extra })
  render(document.querySelector('forum-app')).catch(err => console.error('[forum-app] render error:', err))
}

// ── Render ─────────────────────────────────────────────────────────────────────

async function render(el) {
  el.innerHTML = ''
  if (state.loading) {
    el.append(h('p', { style: 'padding:40px;text-align:center' }, 'Loading…'))
    return
  }

  const header = renderHeader()
  el.append(header)

  const main = h('main')
  el.append(main)

  if (state.view === 'list') await renderList(main)
  else if (state.view === 'thread') await renderThread(main)
  else if (state.view === 'new-post') renderNewPost(main)
  else if (state.view === 'writers') await renderWriters(main)
}

function renderHeader() {
  const hdr = h('header')
  const title = h('h1', {}, state.info?.title || 'Forum')
  hdr.append(title)

  if (state.view !== 'list') {
    hdr.append(h('a', { class: 'back', click: () => navigate('list') }, '← Back'))
  }

  if (state.isWriter) {
    if (state.view === 'list') {
      hdr.append(h('button', { class: 'btn btn-primary', click: () => navigate('new-post') }, '+ New Post'))
    }
    hdr.append(h('button', { class: 'btn', click: () => openWriters() }, 'Writers' + (state.requests.length ? ` (${state.requests.length})` : '')))
    if (!state.myProfileUrl) {
      hdr.append(h('span', { class: 'no-profile-hint' }, '⚠ ', h('a', { href: '#', click: (e) => { e.preventDefault(); showProfileHelp() } }, 'Set up your profile')))
    }
  }
  return hdr
}

async function renderList(main) {
  let posts = []
  try {
    const entries = await drive.list('/posts/')
    posts = await Promise.all(
      entries.map(async e => {
        const raw = await drive.get(e.key)
        try {
          return { ...JSON.parse(raw), _path: e.key }
        } catch { return null }
      })
    )
    posts = posts.filter(Boolean).sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
  } catch {}

  state.posts = posts

  if (!state.isWriter) {
    main.append(h('div', { class: 'notice' },
      'You are not a writer. ',
      h('button', { class: 'btn', click: requestAccess }, 'Request write access')
    ))
  }

  if (posts.length === 0) {
    main.append(h('p', { class: 'empty' }, 'No posts yet.'))
    return
  }

  const ul = h('ul', { class: 'post-list' })
  for (const post of posts) {
    const li = h('li', { class: 'post-item', click: () => openThread(post) })
    if (post.category) li.append(h('span', { class: 'post-meta' }, h('span', { class: 'category' }, post.category)))
    li.append(h('h2', {}, post.title))
    const meta = h('span', { class: 'post-meta' })
    meta.append(await resolveAuthor(post.author?.writerKey, post.author?.url))
    meta.append(` · ${formatDate(post.createdAt)}`)
    li.append(meta)
    ul.append(li)
  }
  main.append(ul)
}

async function renderThread(main) {
  const post = state.activePost
  if (!post) { navigate('list'); return }

  const hdr = h('div', { class: 'thread-header' })
  if (post.category) hdr.append(h('span', { class: 'post-meta' }, h('span', { class: 'category' }, post.category)))
  hdr.append(h('h2', {}, post.title))
  hdr.append(h('div', { class: 'thread-body' }, post.body))
  const authorEl = h('span', { class: 'post-meta' })
  authorEl.append(await resolveAuthor(post.author?.writerKey, post.author?.url))
  authorEl.append(` · ${formatDate(post.createdAt)}`)
  hdr.append(authorEl)
  main.append(hdr)

  // Comments
  let comments = []
  const postSlug = post._path.replace('/posts/', '').replace('.json', '')
  try {
    const entries = await drive.list(`/comments/${postSlug}/`)
    comments = await Promise.all(
      entries.map(async e => {
        const raw = await drive.get(e.key)
        try { return JSON.parse(raw) } catch { return null }
      })
    )
    comments = comments.filter(Boolean).sort((a, b) => a.createdAt > b.createdAt ? 1 : -1)
  } catch {}

  state.comments = comments

  if (comments.length > 0) {
    const ul = h('ul', { class: 'comment-list' })
    for (const c of comments) {
      const li = h('li', { class: 'comment-item' })
      li.append(h('div', { class: 'comment-body' }, c.body))
      const meta = h('span', { class: 'post-meta' })
      meta.append(await resolveAuthor(c.author?.writerKey, c.author?.url))
      meta.append(` · ${formatDate(c.createdAt)}`)
      li.append(meta)
      ul.append(li)
    }
    main.append(ul)
  } else {
    main.append(h('p', { class: 'empty' }, 'No replies yet.'))
  }

  if (state.isWriter) {
    const form = h('form', { class: 'comment-form', submit: e => submitComment(e, postSlug) })
    form.append(h('strong', {}, 'Add a reply'))
    form.append(h('textarea', { name: 'body', placeholder: 'Write your reply…', required: true }))
    form.append(h('button', { type: 'submit' }, 'Post reply'))
    main.append(form)
  }
}

function renderNewPost(main) {
  const form = h('form', { class: 'post-form', submit: submitPost })
  form.append(h('strong', {}, 'New post'))
  form.append(h('input', { name: 'title', placeholder: 'Title', required: true }))
  form.append(h('input', { name: 'category', placeholder: 'Category (optional)' }))
  form.append(h('textarea', { name: 'body', placeholder: 'Write your post…', required: true }))
  form.append(h('button', { type: 'submit' }, 'Post'))
  main.append(form)
}

async function renderWriters(main) {
  const writers = await drive.listWriters()
  const requests = await drive.listRequests()
  state.writers = writers
  state.requests = requests

  const panel = h('div', { class: 'writers-panel' })

  // Invite section
  panel.append(h('h3', {}, 'Invite a writer'))
  const inviteBtn = h('button', { class: 'btn btn-primary', click: createInvite }, 'Create invite link')
  panel.append(inviteBtn)
  panel.append(h('p', { style: 'font-size:12px;color:#666;margin:6px 0 16px' },
    'Anyone with the invite link can request write access. You will need to approve them.'
  ))

  // Pending requests
  panel.append(h('h3', {}, `Pending requests (${requests.length})`))
  if (requests.length === 0) {
    panel.append(h('p', { class: 'empty', style: 'padding:8px 0' }, 'No pending requests.'))
  } else {
    for (const req of requests) {
      const row = h('div', { class: 'request-row' })
      const profileEl = await resolveAuthor(req.writerKey, req.profileUrl)
      row.append(profileEl)
      row.append(h('span', { class: 'spacer' }))
      row.append(h('button', { class: 'btn btn-primary', click: () => approveRequest(req.writerKey, req.profileUrl) }, 'Approve'))
      row.append(h('button', { class: 'btn btn-danger', click: () => denyRequest(req.writerKey) }, 'Deny'))
      panel.append(row)
    }
  }

  // Current writers
  panel.append(h('h3', { style: 'margin-top:16px' }, `Writers (${writers.length})`))
  if (writers.length === 0) {
    panel.append(h('p', { class: 'empty', style: 'padding:8px 0' }, 'No writers yet.'))
  } else {
    for (const w of writers) {
      const row = h('div', { class: 'writer-row' })
      const profileEl = await resolveAuthor(w.writerKey, w.profileUrl)
      row.append(profileEl)
      if (w.writerKey !== state.myWriterKey) {
        row.append(h('button', { class: 'btn btn-danger', style: 'margin-left:auto', click: () => removeWriter(w.writerKey) }, 'Remove'))
      }
      panel.append(row)
    }
  }

  main.append(panel)
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function openThread(post) {
  state.activePost = post
  navigate('thread')
}

async function openWriters() {
  Object.assign(state, { view: 'writers' })
  await render(document.querySelector('forum-app'))
}

async function submitPost(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const now = new Date().toISOString()
  const post = {
    type: 'walled.garden/post',
    title: fd.get('title').trim(),
    body: fd.get('body').trim(),
    category: fd.get('category').trim() || undefined,
    createdAt: now,
    author: { url: state.myProfileUrl, writerKey: state.myWriterKey }
  }

  const valid = nomad.schemas.validate('walled.garden/post', post)
  if (!valid.success) { alert('Validation error: ' + valid.error); return }

  const slug = `${Date.now()}-${post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`
  await drive.put(`/posts/${slug}.json`, JSON.stringify(post, null, 2))
  Object.assign(state, { view: 'list' })
  await render(document.querySelector('forum-app'))
}

async function submitComment(e, postSlug) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const now = new Date().toISOString()
  const comment = {
    type: 'walled.garden/comment',
    topic: `${BASE}posts/${postSlug}.json`,
    body: fd.get('body').trim(),
    createdAt: now,
    author: { url: state.myProfileUrl, writerKey: state.myWriterKey }
  }
  const slug = Date.now().toString()
  await drive.put(`/comments/${postSlug}/${slug}.json`, JSON.stringify(comment, null, 2))
  Object.assign(state, { view: 'thread', activePost: state.activePost })
  await render(document.querySelector('forum-app'))
}

function showProfileHelp() {
  alert(
    'To set up your profile:\n\n' +
    '1. Open the Nomad explorer and create a new drive.\n' +
    '2. Set the drive title to your name.\n' +
    '3. Edit /index.json and add:  "type": "walled.garden/person"\n' +
    '4. Open hyper://private/address-book.json and add:\n' +
    '   { "profiles": [{ "key": "<your-drive-key>" }] }\n\n' +
    'After that, reload this page — your name will appear on your posts.'
  )
}

async function requestAccess() {
  const profileUrl = state.myProfileUrl
  const result = await nomad.fs.requestAccess(BASE, { profileUrl })
  alert(`Access requested. Your writer key: ${result.writerKey}\n\nThe forum owner must approve your request.`)
}

async function createInvite() {
  const inviteUrl = await drive.createInvite({ multiUse: true })
  await navigator.clipboard.writeText(inviteUrl)
  alert('Invite link copied to clipboard!\n\n' + inviteUrl)
}

async function approveRequest(writerKey, profileUrl) {
  await drive.approveRequest(writerKey, { profileUrl })
  alert('Writer approved.')
  await openWriters()
}

async function denyRequest(writerKey) {
  if (!confirm('Deny this request?')) return
  await drive.denyRequest(writerKey)
  await openWriters()
}

async function removeWriter(writerKey) {
  if (!confirm('Remove this writer?')) return
  await drive.removeWriter(writerKey)
  await openWriters()
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const profileCache = {}

async function resolveAuthor(writerKey, profileUrl) {
  const cacheKey = writerKey || profileUrl || 'unknown'
  if (!profileCache[cacheKey]) {
    profileCache[cacheKey] = _fetchProfile(profileUrl)
  }
  const profile = await profileCache[cacheKey]

  const chip = profileUrl
    ? h('a', { class: 'profile-chip', href: profileUrl, click: (e) => { e.stopPropagation(); window.open(profileUrl) } })
    : h('span', { class: 'profile-chip' })

  if (profile?.thumb) {
    const thumbSrc = profile.thumb.startsWith('/')
      ? profileUrl.replace(/\/$/, '') + profile.thumb
      : profileUrl + profile.thumb
    chip.append(h('img', { src: thumbSrc, alt: '' }))
  }
  const label = profile?.title || (writerKey ? writerKey.slice(0, 8) + '…' : 'Unknown')
  chip.append(label)
  return chip
}

async function _fetchProfile(profileUrl) {
  if (!profileUrl) return null
  try {
    return await nomad.fs.drive(profileUrl).getInfo()
  } catch { return null }
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

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
