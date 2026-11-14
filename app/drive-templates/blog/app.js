// Blog template — a walled.garden/feed published as an Autobase Collaborative Drive.
// All of your Devices are Writers of one drive under a single stable URL.
// Posts are directory-per-post: /posts/<YYYY-MM-DD-slug>/{post.json, post.md}.
// Individual posts are URL-addressable at hyper://<blog>/posts/<slug>/ — the directory
// has no index file, so that navigation misses and the manifest `fallback` serves this
// shell there (the body stays directly readable at /posts/<slug>/post.md).

// This page's own drive + route, from nomad.page — the host-provided page identity, authoritative
// on desktop AND mobile (never parse `location` yourself; it's unreliable in the mobile WebView).
const BASE = nomad.page.origin
const ROUTE = nomad.page.path
const drive = nomad.fs.drive(BASE)

let state = {
  view: 'list',        // 'list' | 'post' | 'compose' | 'writers'
  slug: null,
  info: null,
  writable: false,
  myProfileUrl: null,
  loading: true,
  requests: [],
}

// ── Boot ─────────────────────────────────────────────────────────────────────

customElements.define('blog-app', class extends HTMLElement {
  async connectedCallback() {
    try { await boot(this) }
    catch (err) {
      this.innerHTML = `<p class="error">Blog error: ${esc(err.message)}</p>`
      console.error('[blog-app] boot error:', err)
    }
  }
})

async function boot(el) {
  state.info = await drive.getInfo()
  state.writable = !!state.info.writable
  state.myProfileUrl = await loadProfileUrl()

  const route = currentRoute()
  state.view = route.view
  state.slug = route.slug
  state.loading = false

  // Live-refresh pending device requests as they arrive (owner only).
  if (state.writable) {
    try {
      drive.watchRequests(async () => {
        state.requests = await drive.listRequests().catch(() => [])
        if (state.view === 'writers') await render(el)
      })
    } catch {}
  }

  await render(el)
}

// Map the current URL to a base view. Post permalinks are the canonical
// /posts/<slug>/ (a directory with no index file — the body is post.md — so the
// navigation misses and the `fallback` serves this shell). /p/<slug> is kept as a
// legacy matcher for links minted by earlier template versions. Compose/writers
// are in-page overlays.
function currentRoute() {
  let p = decodeURIComponent(ROUTE)
  if (p === '/' || p === '/index.html') {
    return { view: 'list' }
  }
  const m = p.match(/^\/posts\/([^/]+)\/?$/) || p.match(/^\/p\/([^/]+)\/?$/)
  if (m) return { view: 'post', slug: m[1] }
  return { view: 'list' }
}

// ── Render ───────────────────────────────────────────────────────────────────

function navigate(view) { state.view = view; render(document.querySelector('blog-app')) }

async function render(el) {
  el.innerHTML = ''
  if (state.loading) { el.append(h('p', { class: 'empty' }, 'Loading…')); return }

  // Tab title tracks the view; renderPost refines it to the post's own title.
  document.title = state.info?.title || 'Blog'

  el.append(renderHeader())
  const main = h('main')
  el.append(main)

  if (state.view === 'post') await renderPost(main)
  else if (state.view === 'compose') renderCompose(main)
  else if (state.view === 'writers') await renderWriters(main)
  else await renderList(main)
}

function renderHeader() {
  const hdr = h('header', { class: 'site' })
  const title = h('h1', {}, h('a', { href: BASE }, state.info?.title || 'Blog'))
  if (state.info?.description) title.append(h('span', { class: 'desc' }, state.info.description))
  hdr.append(title)

  const tools = h('div', { class: 'toolbar' })
  if (state.writable && (state.view === 'list')) {
    tools.append(h('button', { class: 'btn btn-primary', click: () => navigate('compose') }, '✎ New post'))
    tools.append(h('button', { class: 'btn', click: () => openWriters() }, 'Devices'))
  }
  hdr.append(tools)
  return hdr
}

async function renderList(main) {
  let posts
  try { posts = await loadPosts() }
  catch (err) { main.append(h('p', { class: 'error' }, 'Could not load posts: ' + esc(err.message))); return }

  // Non-writers never see drafts.
  if (!state.writable) posts = posts.filter(p => !p.draft)

  if (!posts.length) {
    main.append(h('p', { class: 'empty' }, state.writable ? 'No posts yet — write your first one.' : 'No posts yet.'))
    return
  }

  const ul = h('ul', { class: 'post-list' })
  for (const post of posts) {
    const card = h('a', { class: 'post-card', href: `${BASE}posts/${post._slug}/` })
    card.append(h('h2', {}, post.title || post._slug))
    if (post.summary) card.append(h('p', { class: 'summary' }, post.summary))
    const meta = h('div', { class: 'post-meta' })
    if (post.draft) meta.append(h('span', { class: 'badge-draft' }, 'Draft'))
    meta.append(h('span', {}, formatDate(post.createdAt)))
    for (const t of (post.tags || [])) meta.append(h('span', { class: 'tag' }, t))
    card.append(meta)
    ul.append(card)
  }
  main.append(ul)
}

async function renderPost(main) {
  main.append(h('a', { class: 'back', href: BASE }, '← Back to blog'))

  let post
  try { post = await loadPost(state.slug) }
  catch { main.append(h('p', { class: 'empty' }, 'Post not found.')); return }

  const blogTitle = state.info?.title
  const postTitle = post.meta.title || state.slug
  document.title = blogTitle ? `${postTitle} — ${blogTitle}` : postTitle

  const article = h('article', { class: 'post' })
  if (post.meta.draft) article.append(h('div', { class: 'post-meta' }, h('span', { class: 'badge-draft' }, 'Draft')))
  article.append(h('h1', { class: 'post-title' }, post.meta.title || state.slug))

  const meta = h('div', { class: 'post-meta' })
  meta.append(h('span', {}, formatDate(post.meta.createdAt)))
  if (post.meta.updatedAt && post.meta.updatedAt !== post.meta.createdAt) {
    meta.append(h('span', {}, '· updated ' + formatDate(post.meta.updatedAt)))
  }
  for (const t of (post.meta.tags || [])) meta.append(h('span', { class: 'tag' }, t))
  article.append(meta)

  article.append(await renderBody(post.body, post.kind))
  main.append(article)
}

function renderCompose(main) {
  const form = h('form', { class: 'compose', submit: onPublish })
  form.append(h('a', { class: 'back', href: '#', click: (e) => { e.preventDefault(); navigate('list') } }, '← Cancel'))
  form.append(h('label', {}, 'Title'))
  form.append(h('input', { name: 'title', placeholder: 'Post title', required: true }))
  form.append(h('label', {}, 'Summary (shown in feeds & readers)'))
  form.append(h('input', { name: 'summary', placeholder: 'A short teaser', maxlength: '560' }))
  form.append(h('label', {}, 'Tags (comma-separated)'))
  form.append(h('input', { name: 'tags', placeholder: 'p2p, hypercore' }))
  form.append(h('label', {}, 'Body (Markdown)'))
  form.append(h('textarea', { name: 'body', placeholder: '# Hello\n\nWrite your post in **Markdown**…', required: true }))
  const row = h('div', { class: 'row' })
  row.append(h('button', { type: 'submit', class: 'btn btn-primary' }, 'Publish'))
  row.append(h('label', { class: 'inline' }, h('input', { type: 'checkbox', name: 'draft' }), 'Save as draft'))
  form.append(row)
  main.append(form)
}

async function renderWriters(main) {
  main.append(h('a', { class: 'back', href: '#', click: (e) => { e.preventDefault(); navigate('list') } }, '← Back'))

  const writers = await drive.listWriters().catch(() => [])
  const requests = await drive.listRequests().catch(() => [])
  state.requests = requests
  const myWriterKey = (writers.find(w => w.profileUrl && w.profileUrl === state.myProfileUrl) || writers[0])?.writerKey

  const panel = h('div', { class: 'panel' })
  panel.append(h('h3', {}, 'Add a device'))
  panel.append(h('p', { class: 'muted' }, 'Create an invite, open it on your other device, then approve the request here. Each device becomes a writer of this blog.'))
  panel.append(h('button', { class: 'btn btn-primary', click: createInvite }, 'Create invite link'))

  panel.append(h('h3', { style: 'margin-top:18px' }, `Pending requests (${requests.length})`))
  if (!requests.length) panel.append(h('p', { class: 'muted' }, 'None.'))
  for (const req of requests) {
    const row = h('div', { class: 'row-item' })
    row.append(h('code', { class: 'inline' }, (req.writerKey || '').slice(0, 16) + '…'))
    row.append(h('span', { class: 'spacer' }))
    row.append(h('button', { class: 'btn btn-primary', click: () => approve(req.writerKey, req.profileUrl) }, 'Approve'))
    row.append(h('button', { class: 'btn btn-danger', click: () => deny(req.writerKey) }, 'Deny'))
    panel.append(row)
  }

  panel.append(h('h3', { style: 'margin-top:18px' }, `Devices / writers (${writers.length})`))
  for (const w of writers) {
    const row = h('div', { class: 'row-item' })
    row.append(h('code', { class: 'inline' }, (w.writerKey || '').slice(0, 16) + '…'))
    if (w.writerKey === myWriterKey) row.append(h('span', { class: 'muted' }, ' (this device)'))
    row.append(h('span', { class: 'spacer' }))
    if (w.writerKey !== myWriterKey) {
      row.append(h('button', { class: 'btn btn-danger', click: () => removeWriter(w.writerKey) }, 'Remove'))
    }
    panel.append(row)
  }
  main.append(panel)
}

// ── Data ─────────────────────────────────────────────────────────────────────

// Enumerate posts: list /posts/ (flat, recursive), keep the post.json keys, read
// each. Sort newest-first by the date-prefixed slug (no ctime in autobase list).
async function loadPosts() {
  const entries = await drive.list('/posts/').catch(() => [])
  const keys = entries.map(e => e.key).filter(k => k.endsWith('/post.json'))
  const posts = []
  for (const key of keys) {
    try {
      const meta = JSON.parse(await drive.get(key))
      meta._slug = key.replace(/^\/posts\//, '').replace(/\/post\.json$/, '')
      posts.push(meta)
    } catch {}
  }
  posts.sort((a, b) => b._slug.localeCompare(a._slug))
  return posts
}

async function loadPost(slug) {
  const meta = JSON.parse(await drive.get(`/posts/${slug}/post.json`))
  let body = null, kind = null
  // post.* is the current body convention; index.* is read for posts written by
  // earlier template versions (pre-ADR-0009-amendment).
  for (const [name, k] of [
    ['post.md', 'md'], ['post.html', 'html'], ['post.txt', 'txt'],
    ['index.md', 'md'], ['index.html', 'html'], ['index.txt', 'txt'],
  ]) {
    const c = await drive.get(`/posts/${slug}/${name}`).catch(() => null)
    if (c != null) { body = c; kind = k; break }
  }
  if (body == null && meta.body != null) { body = meta.body; kind = 'md' }
  return { meta, body: body || '', kind: kind || 'txt', slug }
}

async function loadProfileUrl() {
  try {
    const ab = await nomad.fs.readFile('hyper://private/address-book.json').then(JSON.parse)
    return ab?.profiles?.[0]?.key ? `hyper://${ab.profiles[0].key}/` : null
  } catch { return null }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function onPublish(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const title = (fd.get('title') || '').trim()
  const bodyMd = fd.get('body') || ''
  const summary = (fd.get('summary') || '').trim()
  const tagsRaw = (fd.get('tags') || '').trim()
  const draft = fd.get('draft') === 'on'
  const now = new Date().toISOString()

  const post = { type: 'walled.garden/post', title, createdAt: now }
  if (summary) post.summary = summary
  if (tagsRaw) post.tags = tagsRaw.split(',').map(sanitizeTag).filter(Boolean)
  if (draft) post.draft = true
  if (state.myProfileUrl) post.author = { url: state.myProfileUrl }

  const valid = await nomad.schemas.validate('walled.garden/post', post)
  if (!valid.success) { alert('Could not publish — invalid post:\n' + valid.error); return }

  const slug = `${now.slice(0, 10)}-${slugify(title)}`
  try {
    await drive.put(`/posts/${slug}/post.json`, JSON.stringify(valid.data, null, 2))
    await drive.put(`/posts/${slug}/post.md`, bodyMd)
  } catch (err) {
    alert('Publish failed: ' + err.message); return
  }
  window.location.href = `${BASE}posts/${slug}/`
}

function openWriters() { state.view = 'writers'; render(document.querySelector('blog-app')) }

async function createInvite() {
  try {
    const url = await drive.createInvite({ multiUse: true })
    await navigator.clipboard.writeText(url).catch(() => {})
    alert('Invite link copied to clipboard. Open it on your other device:\n\n' + url)
  } catch (err) { alert('Could not create invite: ' + err.message) }
}

async function approve(writerKey, profileUrl) {
  await drive.approveRequest(writerKey, { profileUrl })
  await render(document.querySelector('blog-app'))
}
async function deny(writerKey) {
  if (!confirm('Deny this request?')) return
  await drive.denyRequest(writerKey)
  await render(document.querySelector('blog-app'))
}
async function removeWriter(writerKey) {
  if (!confirm('Remove this writer? Its posts stay until it stops syncing.')) return
  await drive.removeWriter(writerKey)
  await render(document.querySelector('blog-app'))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderBody(body, kind) {
  const el = h('div', { class: 'body' })
  if (kind === 'md' && nomad.markdown && typeof nomad.markdown.toHTML === 'function') {
    try { el.innerHTML = await nomad.markdown.toHTML(body); return el } catch {}
  }
  if (kind === 'html') { el.innerHTML = body; return el }
  el.classList.add('plain')
  el.textContent = body
  return el
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'post'
}

// walled.garden/post tags must match /^[A-Za-z][A-Za-z0-9-_?]*$/
function sanitizeTag(t) {
  return t.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9\-_?]/g, '').replace(/^[^A-Za-z]+/, '').slice(0, 100)
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

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
