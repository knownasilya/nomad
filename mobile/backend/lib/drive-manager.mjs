import Hyperdrive from 'hyperdrive'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Hyperblobs from 'hyperblobs'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import mime from 'mime'
import { marked } from 'marked'
import { renderMarkdownDoc } from './markdown.mjs'
import { DRIVE_HYPERDRIVE, DRIVE_AUTOBASE } from '../../rpc-commands.mjs'
import { manifestFallback } from '../../../shared/frontend-routing.mjs'
import {
  createFsCore, createBlobStore, createContentReader,
  makeMetadata, AUTOBASE_OPTS, BLOBS_CORE_NAME
} from '../../../shared/fs-core.mjs'

// The canonical view-open + pure reducer + blob helpers, shared byte-for-byte with the desktop
// app (see nomad/shared/fs-core.mjs). Deps are injected because that module has no bare P2P
// imports — bare-pack would otherwise fail to resolve them from nomad/node_modules.
const { open: _fsOpen, apply: _fsApply } = createFsCore({ Hyperbee, b4a })
const _blobStore = createBlobStore({ Hyperblobs, b4a })
const _content = createContentReader({ Hyperblobs, b4a })

// v1 op builder for a small INLINE control record (index.json/index.html/bookmarks/drives.json).
function _inlineOp (path, data) {
  const bytes = b4a.isBuffer(data) ? data : b4a.from(typeof data === 'string' ? data : JSON.stringify(data))
  return { op: 'put', path, metadata: makeMetadata({ mtime: Date.now(), ctime: Date.now() }), value: b4a.toString(bytes, 'base64') }
}

// Files we try, in order, when a hyper:// path points at a directory:
// a rendered page first (html, then markdown, then plain text), else listing.
const INDEX_FILES = ['index.html', 'index.htm', 'index.md', 'index.txt']

// How long to wait for a remote Autobase's bootstrap to replicate before serving.
const AUTOBASE_LOAD_TIMEOUT = 15000

// How long to wait for a remote Hyperdrive's content to replicate before serving.
const HYPERDRIVE_LOAD_TIMEOUT = 15000

// DriveManager owns the swarm + a cache of opened drives. The UI navigates by
// (driveType, key); we open the right read-only structure, replicate it over
// Hyperswarm, and read files/dirs out of it through a unified reader.
export default class DriveManager {
  constructor (store, draftOverlay = null) {
    this.store = store
    // Draft Mode (ADR-0012): when a Drive is being previewed, the serve path resolves reads through
    // this overlay first so a navigated page shows the merged (unpublished) Draft, not just the
    // in-page nomad.fs bridge. `read(keyHex, path)` → { override, buf } (buf=null = tombstone).
    this.draftOverlay = draftOverlay
    this.swarm = new Hyperswarm()
    // Replicate every connection into the shared corestore. All drives —
    // Hyperdrives and Autobase views alike — live in this store, so a single
    // handler feeds them all.
    this.swarm.on('connection', (conn) => this.store.replicate(conn))
    this.drives = new Map() // cacheKey -> { drive, discovery, reader, close, refs }
  }

  get peers () {
    return this.swarm.connections.size
  }

  cacheKey (driveType, keyHex) {
    return `${driveType}:${keyHex}`
  }

  // Open (or reuse) a drive, join its swarm topic, and warm it up.
  // `ns` (a namespace name) reopens a drive WE created, with write access.
  async open (driveType, key, onStatus = () => {}, ns = null) {
    const keyHex = b4a.toString(key, 'hex')
    const ck = this.cacheKey(driveType, keyHex)

    // Already open: reuse without re-joining the swarm. We don't ref-count
    // re-opens — a drive stays cached until the tab leaves it (release) — so
    // navigating between files in one drive never rejoins or reconnects.
    const cached = this.drives.get(ck)
    if (cached) return cached

    onStatus('opening', `Opening ${driveType}…`)
    const entry = driveType === DRIVE_AUTOBASE
      ? await this._openAutobase(key, ck, onStatus, ns)
      : await this._openHyperdrive(key, ck, onStatus, ns)

    entry.refs = 1
    this.drives.set(ck, entry)
    return entry
  }

  // Create a brand-new writable drive (mirrors nomad's createNewDrive:
  // generate a keypair, get a hyper:// URL, optionally seed metadata). Returns
  // { key, ns, type } — store `ns` to reopen it writable later.
  async createDrive (driveType, meta = {}) {
    const ns = b4a.toString(crypto.randomBytes(16), 'hex')
    const title = meta.title || 'Untitled drive'
    const description = (meta.description || '').trim()
    // A schema-valid drive manifest (see nomad.dev /index.json schema). Mirrors
    // nomad's create-drive fields: title + optional description. We do NOT record
    // the storage kind here — the manifest `type` is a *semantic* content type
    // (e.g. 'unwalled.garden/website'), not hyperdrive-vs-autobase, which the app
    // and nomad both detect structurally.
    const indexJson = JSON.stringify(description ? { title, description } : { title }, null, 2)
    const indexHtml = welcomeHtml(title)

    let drive, reader
    if (driveType === DRIVE_AUTOBASE) {
      drive = openAutobaseDrive(this.store.namespace(ns), null)
      await drive.ready()
      // Seed files are small control records — stored inline in the v1 view.
      await drive.append(_inlineOp('/index.json', indexJson))
      await drive.append(_inlineOp('/index.html', indexHtml))
      await drive.update()
      reader = beeReader(drive.view, this.store)
    } else {
      drive = new Hyperdrive(this.store.namespace(ns))
      await drive.ready()
      await drive.put('/index.json', b4a.from(indexJson))
      await drive.put('/index.html', b4a.from(indexHtml))
      reader = hyperdriveReader(drive)
    }

    const keyHex = b4a.toString(drive.key, 'hex')
    const discovery = this.swarm.join(drive.discoveryKey) // announce + lookup
    await discovery.flushed()

    this.drives.set(this.cacheKey(driveType, keyHex), {
      drive, discovery, reader, close: () => drive.close(), refs: 1
    })
    return { key: keyHex, ns, type: driveType, title }
  }

  async _openHyperdrive (key, ck, onStatus, ns) {
    // ns => reopen a drive we own (writable); otherwise read-only by key.
    const drive = ns ? new Hyperdrive(this.store.namespace(ns)) : new Hyperdrive(this.store.namespace(ck), key)
    await drive.ready()

    const mk = (cached, discovery, sync) => ({
      drive, discovery, reader: hyperdriveReader(drive), close: () => drive.close(), cached, _sync: sync
    })

    // Cache hit: previously replicated content is on disk (drive.version > 1). Serve INSTANTLY and
    // replicate the latest in the BACKGROUND.
    if (!hyperdriveEmpty(drive)) {
      onStatus('cached', 'Loaded from cache', this.peers)
      const discovery = this.swarm.join(drive.discoveryKey, { server: false, client: true })
      const sync = (async () => {
        try { await discovery.flushed(); await this.swarm.flush(); await drive.update({ wait: true }) } catch {}
      })()
      return mk(true, discovery, sync)
    }

    // Cold: a freshly-created/never-fetched remote drive hasn't replicated yet. Join, then poll for
    // content bounded by a timeout so a genuinely unreachable drive still resolves instead of hanging.
    onStatus('joining', 'Joining swarm…')
    const discovery = this.swarm.join(drive.discoveryKey, { server: false, client: true })
    await discovery.flushed()
    onStatus('connecting', 'Finding peers…', this.peers)
    await this.swarm.flush()
    onStatus('updating', 'Syncing latest…', this.peers)
    const deadline = Date.now() + HYPERDRIVE_LOAD_TIMEOUT
    try { await drive.update({ wait: true }) } catch {}
    while (hyperdriveEmpty(drive) && Date.now() < deadline) {
      await sleep(250)
      try { await drive.update({ wait: true }) } catch {}
    }
    return mk(false, discovery, null)
  }

  async _openAutobase (key, ck, onStatus, ns) {
    // ns => reopen a drive we own (writable); otherwise read-only by key.
    const base = ns ? openAutobaseDrive(this.store.namespace(ns), null) : openAutobaseDrive(this.store.namespace(ck), key)
    await base.ready()
    // Linearise whatever is already in the LOCAL corestore — fast, no network.
    try { await base.update() } catch {}

    const mk = (cached, discovery, sync) => ({
      drive: base, discovery, reader: beeReader(base.view, this.store), close: () => base.close(), cached, _sync: sync
    })

    // Cache hit: a previously-accessed Drive already has content on disk. Serve it INSTANTLY and
    // replicate the latest in the BACKGROUND (handleOpen re-serves if the sync brings newer content).
    if (!viewEmpty(base)) {
      onStatus('cached', 'Loaded from cache', this.peers)
      const discovery = this.swarm.join(base.discoveryKey, { server: false, client: true })
      const sync = (async () => {
        try { await discovery.flushed(); await this.swarm.flush(); await base.update() } catch {}
      })()
      return mk(true, discovery, sync)
    }

    // Cold: nothing local — join the swarm BEFORE updating (a remote Drive must replicate its
    // bootstrap from a peer first) and poll until the linearised view has content or we time out.
    onStatus('joining', 'Joining swarm…')
    const discovery = this.swarm.join(base.discoveryKey, { server: false, client: true })
    await discovery.flushed()
    onStatus('connecting', 'Finding peers…', this.peers)
    await this.swarm.flush()
    onStatus('updating', 'Syncing latest…', this.peers)
    const deadline = Date.now() + AUTOBASE_LOAD_TIMEOUT
    await base.update()
    while (viewEmpty(base) && Date.now() < deadline) {
      await sleep(250)
      await base.update()
    }
    return mk(false, discovery, null)
  }

  // This device's writable blobs core for an autobase drive, namespaced by its local writer
  // key so it reopens to the same core key (blob pointers stay resolvable across restarts).
  _blobsForBase (base) {
    if (!base._nomadBlobs) {
      base._nomadBlobs = new Hyperblobs(this.store.namespace(b4a.toString(base.local.key, 'hex')).get({ name: BLOBS_CORE_NAME }))
    }
    return base._nomadBlobs
  }

  // Resolve a parsed hyper URL to renderable content.
  // Returns { kind: 'file', mime, buffer } or { kind: 'dir', entries }.
  // opts.wantsHTML mirrors desktop's Accept-header check: only an HTML navigation is served the
  // /.ui SPA — a fetch()/sub-resource request resolves actual files (the http gateway passes the
  // real Accept header; RPC opens default to true, being navigations by definition).
  // opts.navigation is the stricter page-navigation signal used by `fallback` routing (the http
  // gateway derives it from Sec-Fetch-Dest when present); it defaults to wantsHTML.
  async resolve (driveType, key, path, onStatus = () => {}, ns = null, { wantsHTML = true, navigation = wantsHTML } = {}) {
    const { reader } = await this.open(driveType, key, onStatus, ns)
    const keyHex = b4a.toString(key, 'hex')

    onStatus('reading', `Reading ${path}`, this.peers)

    // Draft-preview overlay: while this Drive is previewed, a staged file shadows the published one,
    // and a tombstone (buf=null) reads as absent. Otherwise fall through to the base reader.
    const readMaybe = async (p) => {
      if (this.draftOverlay) {
        const ov = await this.draftOverlay.read(keyHex, p)
        if (ov && ov.override) return ov.buf
      }
      return reader.read(p)
    }

    // Manifest `fallback` (ADR-0015): a declared miss-only SPA shell. Real files always win —
    // the shell is only served further down, when a page navigation resolves to nothing. Takes
    // precedence over the legacy /.ui takeover; a malformed index.json reads as "not declared".
    let fallbackPath = null
    let manifestTitle = null
    const manifestBuf = await readMaybe('/index.json')
    if (manifestBuf) {
      try {
        const manifest = JSON.parse(b4a.toString(manifestBuf))
        fallbackPath = manifestFallback(manifest)
        if (typeof manifest.title === 'string' && manifest.title.trim()) manifestTitle = manifest.title.trim()
      } catch {}
    }

    // Legacy custom frontend (the ".ui" convention), consulted only without a manifest
    // `fallback`: a drive with /.ui/ui.html is an SPA — serve it for any HTML navigation (the
    // drive root, a directory-like trailing-slash path, or an extensionless path) so client-side
    // routes like /posts/<slug>/ render through the app instead of dead-ending on the
    // directory's raw index.md. This mirrors the desktop protocol handler's condition
    // (bg/protocols/hyper.js: filepath === '/' || hasTrailingSlash || !filepath.includes('.')).
    // Sub-resources (/.ui/app.js, *.json, images) carry an extension and fall through to the exact-
    // file read below, so the SPA still loads its own assets. The SPA reads its route from
    // location.pathname — HyperView gives the WebView the served URL as its baseUrl, so location
    // reflects the real drive URL just like desktop's native hyper:// origin.
    const lastSeg = path.slice(path.lastIndexOf('/') + 1)
    const isNavigation = wantsHTML && (path === '/' || path === '' || path.endsWith('/') || !lastSeg.includes('.'))
    if (isNavigation && !fallbackPath) {
      const ui = await readMaybe('/.ui/ui.html')
      if (ui) return this.serveFile(reader, '/.ui/ui.html', ui, keyHex)
    }

    // Exact file hit?
    const buf = await readMaybe(path)
    if (buf) return this.serveFile(reader, path, buf, keyHex, manifestTitle)

    // Directory: try index files, otherwise list it.
    const folder = path.endsWith('/') ? path : path + '/'
    for (const idx of INDEX_FILES) {
      const idxBuf = await readMaybe(folder + idx)
      if (idxBuf) return this.serveFile(reader, folder + idx, idxBuf, keyHex, manifestTitle)
    }

    // Nothing resolved — a page navigation on a `fallback` drive gets the shell (200 rewrite,
    // URL unchanged). Sub-resource misses fall through to the listing/404 below.
    if (fallbackPath && navigation) {
      const fallbackBuf = await readMaybe(fallbackPath)
      if (fallbackBuf) return this.serveFile(reader, fallbackPath, fallbackBuf, keyHex)
    }

    const entries = await reader.list(folder)
    if (entries.length === 0 && path !== '/') {
      throw new Error(`Not found: ${path}`)
    }
    return { kind: 'dir', entries }
  }

  // A hyper:// key doesn't say whether it's a Hyperdrive or an Autobase, so try
  // both (hinted type first) and use whichever yields real content. Opening the
  // wrong structure either throws (its blocks fail to decode) or yields an empty
  // root, so a file / non-empty dir is the reliable signal. Returns the result
  // and the detected type. `ns` (an owned drive) skips detection — type is known.
  async resolveAuto (key, path, hint, onStatus = () => {}, ns = null, detect = true) {
    const keyHex = b4a.toString(key, 'hex')
    // Known type (a drive we own, or one already in the library): resolve it
    // directly. Skipping the try-both probe avoids re-joining the swarm just
    // because, say, an empty subdirectory looks ambiguous.
    if (ns || !detect) {
      const result = await this.resolve(hint || DRIVE_HYPERDRIVE, key, path, onStatus, ns)
      return this._withTitle(result, hint || DRIVE_HYPERDRIVE, keyHex)
    }

    const order = hint === DRIVE_AUTOBASE
      ? [DRIVE_AUTOBASE, DRIVE_HYPERDRIVE]
      : [DRIVE_HYPERDRIVE, DRIVE_AUTOBASE]

    let fallback = null
    let lastErr = null
    for (const type of order) {
      try {
        const result = await this.resolve(type, key, path, onStatus)
        if (result.kind === 'file' || (result.entries && result.entries.length)) {
          return this._withTitle(result, type, keyHex)
        }
        // Empty root: keep as a fallback, but prefer content from the other type.
        if (!fallback) fallback = { result, driveType: type }
        else this.release(type, keyHex)
      } catch (err) {
        lastErr = err
        this.release(type, keyHex) // free the wrong-type structure
      }
    }
    if (fallback) return this._withTitle(fallback.result, fallback.driveType, keyHex)
    throw lastErr || new Error(`Not found: ${path}`)
  }

  // Attach a human title for the tab label: the served page's own title when it has one (a
  // rendered Markdown page's first `#` heading, falling back to the manifest title — see
  // serveFile), else the drive-level title from its index files. `cached` reports whether the
  // Drive was served from the local corestore (so the caller can background-refresh).
  async _withTitle (result, driveType, keyHex) {
    if (result && result.pageTitle) {
      const entry = this.drives.get(this.cacheKey(driveType, keyHex))
      return { result, driveType, title: result.pageTitle, cached: !!(entry && entry.cached) }
    }
    const entry = this.drives.get(this.cacheKey(driveType, keyHex))
    const title = entry ? await readDriveTitle(entry.reader).catch(() => null) : null
    return { result, driveType, title, cached: !!(entry && entry.cached) }
  }

  // Await the background replication kicked off when a cached Drive was served instantly. Resolves
  // once the latest has synced (or a no-op if the Drive wasn't a cache hit).
  async sync (driveType, key) {
    const entry = this.drives.get(this.cacheKey(driveType, b4a.toString(key, 'hex')))
    if (entry && entry._sync) { try { await entry._sync } catch {} }
  }

  // Turn a file into renderable content. Markdown becomes a standalone HTML page; everything else
  // is served as-is. Pages load through the loopback http gateway, so relative sub-resources are
  // fetched live per-request like a normal website — no data-URI inlining (which produced giant
  // documents that OOM-killed Android WebView renderers) and no click-interception nav bridge.
  //
  // A rendered-Markdown page gets a tab title from ITS OWN first `#` heading, else the manifest
  // title (index.json). It's carried both as the document's <title> (so in-page navigations report
  // it via the WebView) and as `pageTitle` on the result (so the initial open uses it directly).
  async serveFile (reader, path, buffer, keyHex, manifestTitle = null) {
    const lower = path.toLowerCase()
    const isMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown')
    if (buffer && isMarkdown) {
      try {
        const raw = b4a.toString(buffer)
        const h1 = raw.match(/^\s*#\s+(.+?)\s*$/m)
        const pageTitle = (h1 && h1[1].trim()) || manifestTitle || null
        const html = renderMarkdownDoc(marked.parse(raw), path, pageTitle)
        return { kind: 'file', mime: 'text/html', buffer: b4a.from(html), pageTitle }
      } catch {}
    }
    return { kind: 'file', mime: mime.getType(path) || 'application/octet-stream', buffer }
  }

  // --- in-page nomad.* bridge (read-only) ---------------------------------
  // Backs the window.nomad shim injected into drive WebViews. Read-only: opens
  // the drive without a namespace, so writes / writer-management aren't available
  // here (those need the Vault's writable-drive plumbing). isWritable() is false
  // for these opens, so app frontends render read-only on mobile.
  async bridgeRead (driveType, key, path) {
    const { reader } = await this.open(driveType, key, () => {}, null)
    const buf = await reader.read(path)
    return buf ? b4a.toString(buf) : null
  }

  // Flat, recursive list of every file path under `folder` — mirrors desktop's
  // nomad.autobase list() (a Hyperbee key-range scan), which the blog relies on
  // to find /posts/<slug>/post.json. (reader.list() is only one level deep.)
  async bridgeListKeys (driveType, key, folder) {
    const { reader } = await this.open(driveType, key, () => {}, null)
    const f = folder.endsWith('/') ? folder : folder + '/'
    const out = []
    for await (const k of reader.keys(f)) out.push(k)
    return out
  }

  async bridgeInfo (driveType, key) {
    const { reader, drive } = await this.open(driveType, key, () => {}, null)
    let manifest = {}
    try {
      const buf = await reader.read('/index.json')
      if (buf) manifest = JSON.parse(b4a.toString(buf))
    } catch {}
    return {
      key: b4a.toString(key, 'hex'),
      writable: isWritable(drive),
      title: manifest.title || '',
      description: manifest.description || '',
      type: manifest.type || '',
      isCollaborative: driveType === DRIVE_AUTOBASE
    }
  }

  bridgeMarkdown (md) {
    return marked.parse(String(md == null ? '' : md))
  }

  // --- writing (drives you own) --------------------------------------------
  // Every method below opens the drive *writable* via its namespace `ns`. A
  // drive we own was created/reopened with that ns, so the cached handle is the
  // same writable structure the browser tab uses — edits show on reload.

  async _openOwned (driveType, key, ns) {
    if (!ns) throw new Error('Read-only drive: only drives you created can be edited')
    return this.open(driveType, key, () => {}, ns)
  }

  // List a folder's immediate children, plus whether the drive is writable.
  async listDir (driveType, key, ns, path) {
    const { reader, drive } = await this._openOwned(driveType, key, ns)
    const folder = path.endsWith('/') ? path : path + '/'
    const entries = await reader.list(folder)
    return { entries, writable: isWritable(drive) }
  }

  // A Space's drive registry: the `/drives.json` inside its (Autobase) Root Drive, listing the
  // drives that Space knows about. Read path (no ns needed) so Vault-synced spaces work too.
  // Returns the raw registry entries: [{ key, type?, tags?, forkOf? }].
  async readDriveRegistry (rootDriveKey, ns = null) {
    const entry = await this.open(DRIVE_AUTOBASE, rootDriveKey, () => {}, ns)
    // /drives.json may still be replicating from the inviter — retry a few times, nudging the
    // autobase to update between attempts.
    for (let i = 0; i < 6; i++) {
      const buf = await entry.reader.read('/drives.json')
      if (buf) {
        try {
          const parsed = JSON.parse(b4a.toString(buf))
          const drives = Array.isArray(parsed.drives) ? parsed.drives : []
          console.log('[registry] read /drives.json', drives.length, 'drives')
          return drives
        } catch {
          console.log('[registry] /drives.json parse failed')
          return []
        }
      }
      try { await entry.drive.update() } catch {}
      await new Promise((r) => setTimeout(r, 800))
    }
    console.log('[registry] /drives.json not found after retries')
    return []
  }

  // Add a drive to a Space's /drives.json registry so it syncs to the user's other devices. Mirrors
  // nomad's entry shape (app/bg/filesystem/index.js): { key, type:'autobase'? , tags? } — autobase
  // drives carry an explicit type, hyperdrives omit it. Requires the Space Root Drive to be writable
  // here (we own it, or we're a Vault writer of it). Returns the updated registry array.
  async addDriveToRegistry (rootDriveKey, ns, { key, type, tags } = {}) {
    if (!key) return []
    const entry = await this.open(DRIVE_AUTOBASE, rootDriveKey, () => {}, ns)
    if (!isWritable(entry.drive)) throw new Error('This space is read-only on this device')
    let drives = []
    const buf = await entry.reader.read('/drives.json')
    if (buf) {
      try {
        const parsed = JSON.parse(b4a.toString(buf))
        if (Array.isArray(parsed.drives)) drives = parsed.drives
      } catch {}
    }
    if (!drives.find((d) => d.key === key)) {
      const cfg = { key }
      if (type === DRIVE_AUTOBASE) cfg.type = 'autobase'
      if (tags && tags.length) cfg.tags = tags
      drives.push(cfg)
      await this._put(DRIVE_AUTOBASE, entry.drive, '/drives.json', b4a.from(JSON.stringify({ drives }, null, 2)), { inline: true })
    }
    return drives
  }

  // Bookmarks live in the space Root Drive at /bookmarks/<slug>.json as JSON bodies
  // ({ type:'nomad/bookmark', href, title, createdAt }) — Autobase has no file metadata, so the
  // data is in the body. Lookups/dedup are by href, so the slug only needs to be unique+stable.
  async listBookmarks (rootDriveKey, ns = null) {
    const entry = await this.open(DRIVE_AUTOBASE, rootDriveKey, () => {}, ns)
    const out = []
    for await (const k of entry.reader.keys('/bookmarks/')) {
      if (!k.endsWith('.json')) continue
      const buf = await entry.reader.read(k)
      if (!buf) continue
      try { out.push(JSON.parse(b4a.toString(buf))) } catch {}
    }
    return out
  }

  async addBookmark (rootDriveKey, ns, { href, title }) {
    const entry = await this.open(DRIVE_AUTOBASE, rootDriveKey, () => {}, ns)
    if (!isWritable(entry.drive)) throw new Error('This space is read-only on this device')
    const slug = b4a.toString(crypto.hash(b4a.from(href)), 'hex')
    const rec = { type: 'nomad/bookmark', href, title: title || href, createdAt: new Date().toISOString() }
    await this._put(DRIVE_AUTOBASE, entry.drive, `/bookmarks/${slug}.json`, b4a.from(JSON.stringify(rec)), { inline: true })
  }

  async removeBookmark (rootDriveKey, ns, href) {
    const entry = await this.open(DRIVE_AUTOBASE, rootDriveKey, () => {}, ns)
    const slug = b4a.toString(crypto.hash(b4a.from(href)), 'hex')
    await this._del(DRIVE_AUTOBASE, entry.drive, `/bookmarks/${slug}.json`)
  }

  // Raw file bytes for editing (no markdown/html rendering, no asset inlining).
  async readFile (driveType, key, ns, path) {
    const { reader } = await this._openOwned(driveType, key, ns)
    const buf = await reader.read(path)
    return { buf, mime: mime.getType(path) || 'application/octet-stream' }
  }

  async writeFile (driveType, key, ns, path, buf) {
    const { drive } = await this._openOwned(driveType, key, ns)
    await this._put(driveType, drive, path, buf)
  }

  async deletePath (driveType, key, ns, path, isDir) {
    const { drive, reader } = await this._openOwned(driveType, key, ns)
    if (!isDir) return this._del(driveType, drive, path)
    const prefix = path.endsWith('/') ? path : path + '/'
    const paths = []
    for await (const k of reader.keys(prefix)) paths.push(k)
    for (const p of paths) await this._del(driveType, drive, p, false)
    await this._flush(driveType, drive)
  }

  async renamePath (driveType, key, ns, from, to, isDir) {
    const { drive, reader } = await this._openOwned(driveType, key, ns)
    if (!isDir) {
      const buf = await reader.read(from)
      if (buf) await this._put(driveType, drive, to, buf)
      return this._del(driveType, drive, from)
    }
    const fromPrefix = from.endsWith('/') ? from : from + '/'
    const toPrefix = to.endsWith('/') ? to : to + '/'
    const srcs = []
    for await (const k of reader.keys(fromPrefix)) srcs.push(k)
    for (const src of srcs) {
      const buf = await reader.read(src)
      if (buf) await this._put(driveType, drive, toPrefix + src.slice(fromPrefix.length), buf, { flush: false })
      await this._del(driveType, drive, src, false)
    }
    await this._flush(driveType, drive)
  }

  // Both drive types are path-based with no native empty directories, so a new
  // folder is materialised with a hidden placeholder the UI filters out.
  async mkdir (driveType, key, ns, path) {
    const { drive } = await this._openOwned(driveType, key, ns)
    const folder = path.endsWith('/') ? path : path + '/'
    await this._put(driveType, drive, folder + '.keep', b4a.alloc(0))
  }

  // Hyperdrive writes directly; an Autobase records a v1 op and re-linearises. File content
  // becomes a blob (bytes kept out of the oplog); `opts.inline` stores small control records
  // (JSON) inline in the view instead. `opts.flush` controls whether we update() immediately.
  async _put (driveType, drive, path, buf, opts = {}) {
    const { flush = true, inline = false } = opts
    if (driveType === DRIVE_AUTOBASE) {
      let op
      if (inline || !buf || buf.length === 0) {
        op = _inlineOp(path, buf || b4a.alloc(0))
      } else {
        const blob = await _blobStore.putBlob(this._blobsForBase(drive), buf)
        op = { op: 'put', path, metadata: makeMetadata({ mtime: Date.now(), ctime: Date.now() }), blob }
      }
      await drive.append(op)
      if (flush) await drive.update()
    } else {
      await drive.put(path, buf)
    }
  }

  async _del (driveType, drive, path, flush = true) {
    if (driveType === DRIVE_AUTOBASE) {
      await drive.append({ op: 'del', path })
      if (flush) await drive.update()
    } else {
      await drive.del(path)
    }
  }

  async _flush (driveType, drive) {
    if (driveType === DRIVE_AUTOBASE) await drive.update()
  }

  // Host (seed) a drive — desktop's "Host This Hyperdrive" (bg/hyper/drives.js ensureHosting).
  // Normal read-only opens join the swarm topic lookup-only (server:false), so this device never
  // serves the drive to peers. Hosting re-joins ANNOUNCING, pins the entry (release() skips
  // hosted drives), and MIRRORS the drive — announcing alone is superficial: hypercore
  // replication is sparse-by-default, so this device only holds the blocks it happened to
  // browse, and a fresh peer syncing from an announce-only "host" gets an effectively empty
  // drive. Turning hosting off reverts the join to lookup-only, stops mirroring, and returns
  // the entry to normal tab lifecycle.
  async setHosting (driveType, key, on) {
    const keyHex = b4a.toString(key, 'hex')
    const entry = await this.open(driveType, key, () => {}, null)
    safe(() => entry.discovery && entry.discovery.destroy())
    entry.hosted = !!on
    entry._driveType = driveType
    entry.discovery = this.swarm.join(
      entry.drive.discoveryKey,
      on ? { server: true, client: true } : { server: false, client: true }
    )
    try { await entry.discovery.flushed() } catch {}
    if (on) {
      // Initial full mirror in the background (a big drive can take a while), then keep
      // mirroring as new content replicates in: the db/view core 'append' fires when a
      // peer pushes a new version, and the pass re-runs (idempotent — local blocks no-op).
      if (!entry._mirrorHook) {
        const core = driveType === DRIVE_AUTOBASE ? entry.drive.view?.core : entry.drive.core
        entry._mirrorHook = () => { this._mirror(entry).catch(() => {}) }
        if (core) { core.on('append', entry._mirrorHook); entry._mirrorCore = core }
      }
      this._meterAttach(entry)
      this._mirror(entry).catch(() => {})
    } else {
      if (entry._mirrorHook) {
        safe(() => entry._mirrorCore && entry._mirrorCore.off('append', entry._mirrorHook))
        entry._mirrorHook = entry._mirrorCore = null
      }
      if (entry._meterOff) entry._meterOff()
    }
    return { hosted: !!on, keyHex }
  }

  // Meter hosting traffic: hypercore 'download'/'upload' events carry per-block byte
  // lengths, reported to `onHostingBytes` (set by the backend, which enforces the user's
  // daily hosting budget). Hooked on the cores we can reach — db/view core plus the
  // Hyperdrive blobs core, which carries the bulk of the bytes. Approximate by design:
  // autobase per-writer blob cores are opened lazily inside readContent and aren't
  // centrally hookable, so autobase blob traffic under-counts.
  _meterAttach (entry) {
    if (entry._meterOff || typeof this.onHostingBytes !== 'function') return
    const offs = []
    const hook = (core) => {
      if (!core || typeof core.on !== 'function') return
      const onBytes = (_index, byteLength) => {
        if (typeof byteLength === 'number') this.onHostingBytes(byteLength)
      }
      core.on('download', onBytes)
      core.on('upload', onBytes)
      offs.push(() => { safe(() => core.off('download', onBytes)); safe(() => core.off('upload', onBytes)) })
    }
    if (entry._driveType === DRIVE_AUTOBASE) {
      hook(entry.drive.view?.core)
    } else {
      hook(entry.drive.core)
      Promise.resolve(entry.drive.getBlobs?.()).then((blobs) => {
        if (entry.hosted && blobs?.core) hook(blobs.core)
      }).catch(() => {})
    }
    entry._meterOff = () => { for (const off of offs) off(); entry._meterOff = null }
  }

  // One mirror pass: pull the latest (autobase linearizes from writer oplogs on update()),
  // then read every path through the entry's reader — bee/metadata traversal plus blob
  // resolution force every missing block to download, for both backends. Passes are
  // serialized per entry; an append during a pass queues exactly one follow-up pass.
  async _mirror (entry) {
    if (!entry.hosted) return
    if (entry._mirroring) { entry._mirrorAgain = true; return }
    entry._mirroring = true
    try {
      do {
        entry._mirrorAgain = false
        if (entry._driveType === DRIVE_AUTOBASE) { try { await entry.drive.update() } catch {} }
        for await (const path of entry.reader.keys('/')) {
          if (!entry.hosted) return
          try { await entry.reader.read(path) } catch {}
        }
      } while (entry._mirrorAgain && entry.hosted)
    } finally {
      entry._mirroring = false
    }
  }

  release (driveType, keyHex) {
    const ck = this.cacheKey(driveType, keyHex)
    const entry = this.drives.get(ck)
    if (!entry) return
    if (entry.hosted) return // pinned: keep seeding after the tab leaves
    if (--entry.refs > 0) return
    this.drives.delete(ck)
    safe(() => entry.discovery && entry.discovery.destroy())
    safe(() => entry.close())
  }

  async close () {
    for (const [, entry] of this.drives) {
      await safe(() => entry.close())
    }
    this.drives.clear()
    await this.swarm.destroy()
  }
}

// --- readers ---------------------------------------------------------------
// A reader normalises file access across the two drive types:
//   read(path)  -> Buffer | null
//   list(folder) -> [{ name, path, isDir }]

function hyperdriveReader (drive) {
  return {
    async read (path) {
      try { return await drive.get(path) } catch { return null }
    },
    async list (folder) {
      return listFromKeys(hyperdriveKeys(drive, folder), folder)
    },
    // Every file path under `folder`, recursively — for folder delete/rename.
    keys (folder) {
      return hyperdriveKeys(drive, folder)
    }
  }
}

async function * hyperdriveKeys (drive, folder) {
  try {
    for await (const node of drive.list(folder, { recursive: true })) yield node.key
  } catch {
    // list() failed (e.g. this key is really an Autobase and its blocks won't decode as a
    // Hyperdrive). Fall back to a shallow readdir, and if that throws too, yield nothing rather
    // than propagating — an undecodable wrong-type probe must not fail the whole drive load.
    try {
      for await (const name of drive.readdir(folder)) yield folder + name
    } catch {}
  }
}

function beeReader (bee, store) {
  return {
    async read (path) {
      try {
        const node = await bee.get(path)
        if (!node || !node.value) return null
        // v1 record: resolve inline value or a blob in the owning writer's Hyperblobs core.
        return _content.readContent(node.value, { store })
      } catch { return null }
    },
    async list (folder) {
      return listFromKeys(beeKeys(bee, folder), folder)
    },
    keys (folder) {
      return beeKeys(bee, folder)
    }
  }
}

async function * beeKeys (bee, folder) {
  const opts = folder === '/' ? {} : { gte: folder, lt: folder + '￿' }
  try {
    for await (const node of bee.createReadStream(opts)) {
      yield typeof node.key === 'string' ? node.key : b4a.toString(node.key)
    }
  } catch (err) {
    // A still-replicating or format-mismatched Autobase view can throw mid-stream (DECODING_ERROR).
    // Yield whatever decoded rather than failing the drive load with a raw decoding error.
    console.log('[beeKeys] read stream ended early:', (err && err.code) || err)
  }
}

// Group a stream of full paths into the immediate children of `folder`.
async function listFromKeys (keys, folder) {
  const out = []
  const seen = new Set()
  for await (const key of keys) {
    if (!key.startsWith(folder)) continue
    const rel = key.slice(folder.length)
    if (!rel) continue
    const cut = rel.indexOf('/')
    if (cut === -1) {
      if (!seen.has(rel)) { seen.add(rel); out.push({ name: rel, path: folder + rel, isDir: false }) }
    } else {
      const dir = rel.slice(0, cut)
      const dk = dir + '/'
      if (!seen.has(dk)) { seen.add(dk); out.push({ name: dir, path: folder + dir, isDir: true }) }
    }
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return out
}

// Build a read-only Autobase "drive" in nomad's collaborative-drive format so
// the two apps interoperate: the materialised view is a Hyperbee (paths -> file
// bytes), the oplog is json, and each node is a filesystem op. Any peer that
// replays the same apply() reconstructs an identical, readable drive.
//
// open/apply come from the SHARED module (nomad/shared/fs-core.mjs) so this stays
// byte-for-byte identical to the desktop app — the Autobase indexer signs the
// linearised view, so a divergent apply would fail signature verification and
// surface as a "decoding error". Do not inline a second copy here.
export function openAutobaseDrive (store, key) {
  return new Autobase(store, key, {
    ...AUTOBASE_OPTS,
    open: _fsOpen,
    apply: _fsApply
  })
}

// Is this opened drive writable? Hyperdrive exposes it on its metadata core;
// Autobase exposes it once our writer key has linearised.
function isWritable (drive) {
  try {
    if (typeof drive.writable === 'boolean') return drive.writable
    if (drive.core && typeof drive.core.writable === 'boolean') return drive.core.writable
    return false
  } catch {
    return false
  }
}

// True until the linearised view has at least one block (some content replicated).
function viewEmpty (base) {
  try {
    return !base.view || !base.view.core || base.view.core.length === 0
  } catch {
    return true
  }
}

// True until a Hyperdrive has replicated usable file entries. Its db (a Hyperbee)
// version getter returns Math.max(1, core.length), so version <= 1 means only the
// bootstrap header (or nothing) has arrived — no files yet. (Matches nomad's check.)
function hyperdriveEmpty (drive) {
  try {
    return !drive || drive.version <= 1
  } catch {
    return true
  }
}

// A drive's display title (for the tab), following the render order: an
// explicit index.json `title`, else index.html's <title>, else index.md's first
// `#` heading. Null if none.
async function readDriveTitle (reader) {
  const json = await reader.read('/index.json')
  if (json) {
    try {
      const meta = JSON.parse(b4a.toString(json))
      if (meta && typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim()
    } catch {}
  }
  const htmlBuf = await reader.read('/index.html')
  if (htmlBuf) {
    const tm = b4a.toString(htmlBuf).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (tm && tm[1].trim()) return decodeEntities(tm[1])
  }
  const md = await reader.read('/index.md')
  if (md) {
    const m = b4a.toString(md).match(/^\s*#\s+(.+?)\s*$/m)
    if (m) return m[1].trim()
  }
  return null
}

function decodeEntities (s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim()
}

function welcomeHtml (title) {
  const safe = String(title).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;font:16px -apple-system,system-ui,sans-serif;color:#1c1c22;background:#fff;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center;padding:24px"><h1 style="margin:0 0 8px">${safe}</h1>
<p style="color:#56565f;margin:0">Your new Nomad drive. Share its hyper:// address to let peers read it.</p></div></body>`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function safe (fn) {
  try { return await fn() } catch { return null }
}
