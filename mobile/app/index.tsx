import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Image, Modal, StyleSheet, StatusBar, Alert, Keyboard, BackHandler, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { WebViewNavigation } from 'react-native-webview'
import * as Clipboard from 'expo-clipboard'
import b4a from 'b4a'

import TabStrip from '../components/TabStrip'
import AddressBar from '../components/AddressBar'
import HyperView from '../components/HyperView'
import Suggestions from '../components/Suggestions'
import Library from '../components/Library'
import Devices from '../components/Devices'
import SpaceSwitcher from '../components/SpaceSwitcher'
import DevTools from '../components/DevTools'
import AiPanel from '../components/AiPanel'
import FileExplorer, { type ExplorerDrive } from '../components/FileExplorer'
import type { HyperRender } from '../components/HyperView'
import { useBackend } from '../lib/useBackend'
import { usePersistence, type SavedSite, type SavedDrive } from '../lib/usePersistence'
import { useSpaces, PERSONAL_ID } from '../lib/useSpaces'
import { resolveAddress, isHyperUrl, shortKey, hyperKeyOf, type DriveType } from '../lib/hyperUrl'
import { useTheme, radius, type Theme } from '../lib/theme'
import { CONSOLE_SHIM, VIEW_SOURCE_JS, type ContentMsg, type StatusMsg, type ErrorMsg, type LogEntry } from '../lib/types'

type Kind = 'home' | 'web' | 'hyper'

// One entry in a tab's back/forward history.
type NavEntry =
  | { kind: 'home' }
  | { kind: 'web'; url: string }
  | { kind: 'hyper'; url: string; driveType: DriveType; ns?: string; detect?: boolean }

interface Tab {
  id: string
  input: string // address bar text
  kind: Kind
  url: string // committed navigation target
  title: string
  driveType: DriveType
  reloadToken: number
  loading: boolean // shows a spinner on the tab
  render?: HyperRender // hyper-only view state
  driveKey?: string // for backend cleanup on close
  hasDraft?: boolean // drive has unpublished draft changes (ADR-0012)
  draftPreviewing?: boolean // this tab is rendering the merged draft
  webCanGoBack?: boolean // web tab's WebView has in-page history to step back through
  stack: NavEntry[] // back/forward history
  sp: number // stack pointer
}

let seq = 0
const newId = () => `tab_${++seq}_${Math.floor(Math.random() * 1e6)}`

function blankTab (): Tab {
  return {
    id: newId(),
    input: '',
    kind: 'home',
    url: '',
    title: 'New tab',
    driveType: 'hyperdrive',
    reloadToken: 0,
    loading: false,
    stack: [{ kind: 'home' }],
    sp: 0
  }
}

// `sameDrive` => navigating to another file in the drive that's already open:
// keep the current page (and driveKey) visible and just show a tab spinner,
// instead of flashing the full "connecting" screen.
function fieldsFor (tab: Tab, entry: NavEntry, sameDrive: boolean): Partial<Tab> {
  if (entry.kind === 'home') {
    return { kind: 'home', url: '', input: '', title: 'New tab', loading: false, render: undefined, driveKey: undefined }
  }
  if (entry.kind === 'web') {
    return { kind: 'web', url: entry.url, input: entry.url, loading: true, render: undefined, driveKey: undefined, reloadToken: tab.reloadToken + 1 }
  }
  if (sameDrive) {
    return { kind: 'hyper', url: entry.url, input: entry.url, driveType: entry.driveType, loading: true }
  }
  return {
    kind: 'hyper',
    url: entry.url,
    input: entry.url,
    driveType: entry.driveType,
    loading: true,
    title: 'Loading…',
    render: { type: 'loading', status: 'Connecting…', peers: 0 },
    driveKey: undefined
  }
}

function decodeContent (msg: ContentMsg): HyperRender {
  if (msg.isDir) {
    return { type: 'dir', path: msg.path || '/', entries: msg.entries || [], keyHex: msg.key }
  }
  // Gateway-served file: the WebView loads it from the drive's loopback port (real origin, native
  // navigation/history/sub-resources) — the normal path for all file content.
  if (msg.http && msg.port) {
    return { type: 'http', uri: msg.http, keyHex: msg.key, url: msg.url, port: msg.port }
  }
  const mime = msg.mime || 'application/octet-stream'
  const b64 = msg.bodyBase64 || ''
  if (mime.startsWith('image/')) return { type: 'image', uri: `data:${mime};base64,${b64}` }
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return { type: 'html', html: b4a.toString(b4a.from(b64, 'base64')), keyHex: msg.key, url: msg.url }
  }
  if (mime.startsWith('text/') || /(json|javascript|xml|svg)/.test(mime)) {
    return { type: 'text', text: b4a.toString(b4a.from(b64, 'base64')), mime }
  }
  return { type: 'text', text: `Binary file (${mime})`, mime }
}

// Native consent for a relayed AI write (ADR-0013 §6): the agentic turn runs on the desktop
// Provider, but the human is here on the phone, so the modifyDrive prompt is shown natively. The
// prompt names the target drive (title + URL) so the user knows exactly what's being edited; the
// caller resolves that from the `modifyDrive:<hexDriveKey>` permission (see describeDrive).
// NOT cancelable: the user must explicitly tap Allow or Deny. (An `onDismiss`/cancelable dialog on
// Android can fire onDismiss alongside a button press and race it to resolve false — which denied
// writes even after the user tapped Allow.) The `settled` guard keeps the first choice
// authoritative regardless of any duplicate callback.
function confirmModifyDrive (permission: string, drive?: { name: string; url: string }): Promise<boolean> {
  const name = drive?.name || 'this drive'
  const url = drive?.url || ''
  return new Promise((resolve) => {
    let settled = false
    const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    Alert.alert(
      'Allow AI to edit?',
      `The AI running on your other device wants to make changes to this drive:\n\n${name}${url ? `\n${url}` : ''}`,
      [
        { text: 'Deny', style: 'cancel', onPress: () => settle(false) },
        { text: 'Allow', onPress: () => settle(true) }
      ],
      { cancelable: false }
    )
  })
}

export default function Browser () {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [tabs, setTabs] = useState<Tab[]>([blankTab()])
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const webviews = useRef<Record<string, WebView | null>>({})
  // In-flight nomad.ai.chat() turns from drive pages, by stream id, so a page's cancel can abort them.
  const aiHandles = useRef<Record<string, { cancel: () => void }>>({})
  // Per-space tab sets: snapshot the current space's tabs on switch, restore the target's.
  const tabsBySpace = useRef<Record<string, { tabs: Tab[]; activeId: string }>>({})
  const activeSpaceIdRef = useRef('')

  const active = useMemo(() => tabs.find((tb) => tb.id === activeId) ?? tabs[0], [tabs, activeId])

  // Resolve a 'modifyDrive:<hexKey>' permission to a name + drive-root URL for the consent prompt.
  // The relayed write is always scoped to an open tab's drive (its hex driveKey matches the key), so
  // the tab supplies the title and the URL the user recognizes; fall back to the raw key if unmatched.
  const describeDrive = useCallback((permission: string): { name: string; url: string } => {
    const key = (String(permission).split(':')[1] || '').toLowerCase()
    const tab = tabsRef.current.find((tb) => (tb.driveKey || '').toLowerCase() === key)
    const name = tab && tab.title && tab.title !== 'Loading…' ? tab.title : 'Untitled drive'
    const url = tab?.url ? `hyper://${hyperKeyOf(tab.url)}` : (key ? `hyper://${key}` : '')
    return { name, url }
  }, [])
  // persist is space-scoped, but it depends on the active space id (from useSpaces, which needs
  // backend, which uses persist in its callbacks) — so we late-bind persist via a ref to break the
  // cycle. The actual `persist` is created below, after backend + useSpaces.
  const persistRef = useRef<ReturnType<typeof usePersistence> | null>(null)

  // menu / devtools / library overlay state
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [spacesOpen, setSpacesOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [explorerDrive, setExplorerDrive] = useState<ExplorerDrive | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [source, setSource] = useState('')
  // URL-bar autocomplete: visible while the address bar is focused. blurTimer delays hiding so a tap
  // on a suggestion lands before the list disappears.
  const [urlFocused, setUrlFocused] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Drives registered in the active space's Root Drive (/drives.json) — incl. drives added on other
  // devices. Merged with the locally-known drives for the Library.
  const [registryDrives, setRegistryDrives] = useState<{ key: string; type?: DriveType }[]>([])

  const patch = useCallback((id: string, fields: Partial<Tab>) => {
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, ...fields } : tb)))
  }, [])

  // --- backend message routing -------------------------------------------
  const backend = useBackend({
    onStatus: (msg: StatusMsg) => {
      setTabs((prev) =>
        prev.map((tb) =>
          tb.id === msg.tabId && tb.render?.type === 'loading'
            ? { ...tb, render: { type: 'loading', status: msg.message, peers: msg.peers } }
            : tb
        )
      )
    },
    onContent: (msg: ContentMsg) => {
      // A background refresh (instant-cache phase 2) must not clobber the page if the user has since
      // navigated the tab elsewhere — only apply it while the tab is still on that url.
      if (msg.updated) {
        const tab = tabsRef.current.find((t) => t.id === msg.tabId)
        if (!tab || tab.url !== msg.url) return
        // Gateway-served page at the same uri: the drive is fresher but the uri hasn't changed, so
        // patching the render is a no-op — reload the WebView to re-fetch through the gateway.
        if (msg.http && tab.render?.type === 'http' && tab.render.uri === msg.http) {
          webviews.current[msg.tabId]?.reload()
          return
        }
      }
      const render = decodeContent(msg)
      // Prefer the drive's own title (index.json / index.md / index.html), then
      // fall back to a short key (with the sub-path for directories).
      const driveTitle = msg.title || shortKey(msg.key)
      const title = msg.isDir && msg.path && msg.path !== '/' ? `${driveTitle}${msg.path}` : driveTitle
      // Adopt the type the backend actually detected so the badge is correct.
      patch(msg.tabId, { render, driveKey: msg.key, title, driveType: msg.driveType, loading: false })
      persistRef.current?.recordVisit(msg.url, title)
      // Remember the drive (and its detected type) in the library.
      persistRef.current?.rememberDrive(`hyper://${msg.key}/`, driveTitle, msg.driveType)
    },
    onError: (msg: ErrorMsg) => {
      patch(msg.tabId, { render: { type: 'error', message: msg.message, url: msg.url }, loading: false })
    }
  })

  // Spaces — each has its own Root Drive; bookmarks/history/drives are scoped to the active space.
  const spacesApi = useSpaces(backend)
  const persist = usePersistence(spacesApi.activeSpaceId, {
    backend,
    rootDriveKey: spacesApi.activeSpace.rootDriveKey,
    ns: spacesApi.activeSpace.ns
  })
  persistRef.current = persist
  activeSpaceIdRef.current = spacesApi.activeSpaceId

  // Switch spaces: snapshot the current space's open tabs, restore the target space's (or a fresh
  // home tab). Tab logic is otherwise untouched — we just swap what `tabs` holds.
  const switchSpace = useCallback((id: string) => {
    const cur = activeSpaceIdRef.current
    if (id === cur) return
    tabsBySpace.current[cur] = { tabs: tabsRef.current, activeId: activeIdRef.current }
    const saved = tabsBySpace.current[id]
    if (saved && saved.tabs.length) {
      setTabs(saved.tabs)
      setActiveId(saved.activeId || saved.tabs[0].id)
    } else {
      const fresh = blankTab()
      setTabs([fresh])
      setActiveId(fresh.id)
    }
    spacesApi.setActive(id)
  }, [spacesApi])

  // Create a space and drop into it with a fresh tab (createSpace activates the new space).
  const onCreateSpace = useCallback(async (opts: { name: string; color: string }) => {
    const cur = activeSpaceIdRef.current
    tabsBySpace.current[cur] = { tabs: tabsRef.current, activeId: activeIdRef.current }
    const sp = await spacesApi.createSpace(opts)
    const fresh = blankTab()
    if (sp) tabsBySpace.current[sp.id] = { tabs: [fresh], activeId: fresh.id }
    setTabs([fresh])
    setActiveId(fresh.id)
  }, [spacesApi])

  // After unlinking this phone from the Vault: drop the shared markers, then ask whether to also
  // remove the spaces that only existed here because of the Vault (keep = local-only copies).
  const handleUnlinked = useCallback(() => {
    const left = spacesApi.leaveVault()
    if (!left.length) return
    const n = left.length
    const noun = n === 1 ? 'space' : 'spaces'
    Alert.alert(
      'Unlinked from your devices',
      `${n} ${noun} shared from your other devices ${n === 1 ? 'is' : 'are'} now local-only on this phone. Remove ${n === 1 ? 'it' : 'them'} from this device?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const ids = left.map((s) => s.id)
            // If the active space is being removed, switch to Personal first so its tabs swap in.
            if (ids.includes(activeSpaceIdRef.current)) switchSpace(PERSONAL_ID)
            spacesApi.removeSpaces(ids)
          }
        }
      ]
    )
  }, [spacesApi, switchSpace])

  // --- navigation --------------------------------------------------------
  const navTo = useCallback(
    (id: string, entry: NavEntry, push: boolean, sp?: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id)
      if (!tab) return
      // Same drive, different file? Keep it open — don't close/rejoin.
      const sameDrive = entry.kind === 'hyper' && !!tab.driveKey && hyperKeyOf(entry.url) === tab.driveKey.toLowerCase()
      if (tab.driveKey && !sameDrive) backend.close(tab.driveType, tab.driveKey)
      setLogs([]) // page-scoped console resets on navigation
      setSource('')
      // Any navigation (typed URL, suggestion, back/forward, home button) dismisses the autocomplete.
      if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null }
      setUrlFocused(false)
      const fields = fieldsFor(tab, entry, sameDrive)
      setTabs((prev) =>
        prev.map((tb) => {
          if (tb.id !== id) return tb
          if (push) {
            const stack = [...tb.stack.slice(0, tb.sp + 1), entry]
            return { ...tb, ...fields, stack, sp: stack.length - 1 }
          }
          return { ...tb, ...fields, sp: sp ?? tb.sp }
        })
      )
      if (entry.kind === 'hyper') backend.open(id, entry.url, entry.driveType, entry.ns, entry.detect ?? true)
    },
    [backend]
  )

  const navigate = useCallback(
    (id: string, rawInput: string) => {
      const tab = tabsRef.current.find((tb) => tb.id === id)
      if (!tab) return
      const r = resolveAddress(rawInput)
      // A drive's type is fixed at creation. If we already know it (library /
      // owned), use it directly; otherwise auto-detect by trying both.
      const known = persist.driveTypeFor(r.url)
      const entry: NavEntry = r.kind === 'hyper'
        ? { kind: 'hyper', url: r.url, driveType: known ?? 'hyperdrive', ns: persist.driveNsFor(r.url), detect: !known }
        : { kind: 'web', url: r.url }
      navTo(id, entry, true)
    },
    [navTo, persist]
  )

  // URL-bar autocomplete. The address bar selects-all on focus, so treat the input as an empty query
  // (show most-recent) until it diverges from the committed URL, then filter by what's typed.
  const suggestQuery = active.input.trim() === active.url.trim() ? '' : active.input
  const suggestions = useMemo(() => persist.suggest(suggestQuery, 10), [persist.suggest, suggestQuery])
  const showSuggestions = urlFocused && suggestions.length > 0

  const onUrlFocus = useCallback(() => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null }
    setUrlFocused(true)
  }, [])
  const onUrlBlur = useCallback(() => {
    blurTimer.current = setTimeout(() => setUrlFocused(false), 150)
  }, [])
  const onSelectSuggestion = useCallback((url: string) => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null }
    setUrlFocused(false)
    Keyboard.dismiss()
    navigate(activeIdRef.current, url)
  }, [navigate])
  // Dismiss the autocomplete whenever the active tab changes (close / switch / new tab). urlFocused is
  // plain state, decoupled from the TextInput's real focus — without this it can stay true after a tab
  // close and, since no blur event follows, the dropdown gets stuck open over the new (home) tab.
  useEffect(() => {
    if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null }
    setUrlFocused(false)
  }, [activeId])

  const step = useCallback(
    (id: string, delta: number) => {
      const tab = tabsRef.current.find((tb) => tb.id === id)
      if (!tab) return
      const nsp = tab.sp + delta
      if (nsp < 0 || nsp >= tab.stack.length) return
      navTo(id, tab.stack[nsp], false, nsp)
    },
    [navTo]
  )

  const goHome = useCallback((id: string) => navTo(id, { kind: 'home' }, true), [navTo])

  const reload = useCallback(() => {
    if (active.kind === 'web' || (active.kind === 'hyper' && active.render?.type === 'http')) {
      webviews.current[active.id]?.reload()
    } else if (active.kind === 'hyper' && active.url) {
      patch(active.id, { loading: true })
      backend.open(active.id, active.url, active.driveType, persist.driveNsFor(active.url), false)
    }
  }, [active, backend, patch, persist])

  // Draft Mode (ADR-0012): reflect whether the shown Drive has unpublished changes (synced from
  // another device via the Vault), so the address bar can offer a preview toggle. Refreshes on
  // navigate/reload.
  useEffect(() => {
    if (active.kind !== 'hyper' || active.driveType !== 'autobase' || !active.url) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await backend.nomad({ api: 'fs', method: 'draftStatus', url: active.url, args: [] })
        const v: any = (res && res.value) || {}
        if (!cancelled) patch(active.id, { hasDraft: !!(v.changes && v.changes.length) })
      } catch {}
    })()
    return () => { cancelled = true }
  }, [active.id, active.url, active.driveType, active.render?.type, backend, patch])

  const onToggleDraftPreview = useCallback(async () => {
    if (active.kind !== 'hyper' || !active.url) return
    const next = !active.draftPreviewing
    try {
      await backend.nomad({ api: 'fs', method: 'setDraftPreview', url: active.url, args: [next] })
      patch(active.id, { draftPreviewing: next })
      reload()
    } catch {}
  }, [active, backend, patch, reload])

  // Preview an AI-staged Draft from the AI panel: turn preview ON, reload the tab so it renders the
  // merged Draft, and close the panel so the user sees the result.
  const onPreviewDraft = useCallback(async () => {
    if (active.kind !== 'hyper' || !active.url) return
    try {
      await backend.nomad({ api: 'fs', method: 'setDraftPreview', url: active.url, args: [true] })
      patch(active.id, { draftPreviewing: true, hasDraft: true })
      setAiOpen(false)
      reload()
    } catch {}
  }, [active, backend, patch, reload])

  // Keep a ref to the latest backend so the stable WebView message handler can
  // forward in-page nomad.* calls without changing identity every render.
  const backendRef = useRef(backend)
  backendRef.current = backend

  // Messages posted by a page WebView: in-page link navigation, captured console
  // output, in-page nomad.* calls (the NOMAD_SHIM bridge), and view-source.
  const handleWebMessage = useCallback(
    (data: string) => {
      let msg: any
      try { msg = JSON.parse(data) } catch { return }
      if (msg.type === 'navigate' && typeof msg.url === 'string') navigate(activeIdRef.current, msg.url)
      else if (msg.type === 'console') setLogs((prev) => [...prev.slice(-199), { level: msg.level, text: msg.text, ts: Date.now() }])
      else if (msg.type === 'source') setSource(String(msg.html || ''))
      else if (msg.type === 'nomad-rpc' && msg.payload && msg.payload.id) {
        const wv = webviews.current[activeIdRef.current]
        backendRef.current.nomad(msg.payload).then((result) => {
          wv?.injectJavaScript(`window.__nomadResolve(${JSON.stringify(msg.payload.id)}, ${JSON.stringify(result)}); true;`)
        })
      }
      // Streaming nomad.ai.chat() from a page (ADR-0013). Each event is pushed back into the SAME
      // WebView (captured now, so a later tab switch can't misroute it). The relayed modifyDrive
      // consent is shown as a NATIVE dialog here — the page never sees it.
      else if (msg.type === 'nomad-ai-chat' && msg.payload && msg.payload.id) {
        const id = msg.payload.id
        const wv = webviews.current[activeIdRef.current]
        const inject = (ev: unknown) =>
          wv?.injectJavaScript(`window.__nomadAiEvent(${JSON.stringify(id)}, ${JSON.stringify(ev)}); true;`)
        aiHandles.current[id] = backendRef.current.aiChat(msg.payload.messages || [], msg.payload.opts || {}, {
          onChunk: (text) => inject({ kind: 'chunk', text }),
          onTool: (event) => inject({ kind: 'tool', event }),
          onDone: () => { delete aiHandles.current[id]; inject({ kind: 'done' }) },
          onError: (message) => { delete aiHandles.current[id]; inject({ kind: 'error', message }) },
          onPrompt: (permission) => confirmModifyDrive(permission, describeDrive(permission))
        })
      }
      else if (msg.type === 'nomad-ai-cancel' && msg.payload && msg.payload.id) {
        aiHandles.current[msg.payload.id]?.cancel()
        delete aiHandles.current[msg.payload.id]
      }
    },
    [navigate, describeDrive]
  )

  const viewSource = useCallback(() => {
    const a = tabsRef.current.find((tb) => tb.id === activeIdRef.current)
    if (a?.kind === 'hyper' && a.render && (a.render.type === 'html' || a.render.type === 'text')) {
      setSource(a.render.type === 'html' ? a.render.html : a.render.text)
    } else {
      setSource('')
      webviews.current[activeIdRef.current]?.injectJavaScript(VIEW_SOURCE_JS)
    }
  }, [])

  const copyLink = useCallback(() => {
    if (active.url) Clipboard.setStringAsync(active.url)
  }, [active.url])

  const openFromLibrary = useCallback(
    (url: string, type?: DriveType) => {
      setLibraryOpen(false)
      const r = resolveAddress(url)
      const known = type ?? persist.driveTypeFor(r.url)
      const entry: NavEntry = r.kind === 'hyper'
        ? { kind: 'hyper', url: r.url, driveType: known ?? 'hyperdrive', ns: persist.driveNsFor(r.url), detect: !known }
        : { kind: 'web', url: r.url }
      navTo(active.id, entry, true)
    },
    [active.id, navTo, persist]
  )

  // Create a brand-new writable drive (nomad's createNewDrive): the backend
  // generates a key + URL; we save it (with its ns, so it reopens writable) and
  // open it.
  const createDrive = useCallback(
    async (title: string, type: DriveType, description: string) => {
      const res = await backend.create(type, title, description)
      if (!res.ok || !res.url) return
      persist.rememberDrive(res.url, title, type, res.ns)
      // Register it in the active space's Drive Registry (/drives.json) so it syncs to the user's
      // other devices, not just this phone. Best-effort: needs the space's Root Drive to be writable
      // here (we own it, or we're a Vault writer of it); a read-only space just keeps it local.
      const sp = spacesApi.activeSpace
      if (sp.rootDriveKey && res.key) {
        backend.addSpaceDrive(sp.rootDriveKey, sp.ns, res.key, type)
          .then((r) => { if (r.ok) setRegistryDrives(r.drives || []) })
          .catch(() => {})
      }
      setLibraryOpen(false)
      navTo(active.id, { kind: 'hyper', url: res.url, driveType: type, ns: res.ns, detect: false }, true)
    },
    [backend, persist, navTo, active.id, spacesApi.activeSpace]
  )

  // Open the file explorer/editor for a drive you own (carries an `ns`).
  const openExplorer = useCallback((d: SavedDrive) => {
    if (!d.ns) return
    setMenuOpen(false)
    setLibraryOpen(false)
    setExplorerDrive({ url: d.url, key: hyperKeyOf(d.url), name: d.name, type: d.type, ns: d.ns })
  }, [])

  // On close, reflect any edits in an open tab showing the same drive.
  const closeExplorer = useCallback(() => {
    const edited = explorerDrive
    setExplorerDrive(null)
    if (edited && active.kind === 'hyper' && active.driveKey && active.driveKey.toLowerCase() === edited.key.toLowerCase()) {
      reload()
    }
  }, [explorerDrive, active, reload])

  // --- tab management ----------------------------------------------------
  const openTab = useCallback(() => {
    const tb = blankTab()
    setTabs((prev) => [...prev, tb])
    setActiveId(tb.id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const closing = prev.find((tb) => tb.id === id)
        if (closing?.driveKey) backend.close(closing.driveType, closing.driveKey)
        delete webviews.current[id]
        const next = prev.filter((tb) => tb.id !== id)
        if (next.length === 0) {
          const fresh = blankTab()
          setActiveId(fresh.id)
          return [fresh]
        }
        if (id === activeId) setActiveId(next[next.length - 1].id)
        return next
      })
    },
    [activeId, backend]
  )

  const onWebNav = useCallback(
    (id: string, nav: WebViewNavigation) => {
      patch(id, { url: nav.url, input: nav.url, title: nav.title || nav.url, loading: nav.loading, webCanGoBack: nav.canGoBack })
      if (!nav.loading) persist.recordVisit(nav.url, nav.title || nav.url)
    },
    [patch, persist]
  )

  // Native in-page navigation within a drive (loopback origin): reflect the mapped hyper:// URL in
  // the address bar and track WebView history so back/forward drive the WebView, like web tabs.
  // The document title (e.g. a rendered Markdown page's h1) follows into the tab label when set.
  const onHyperNav = useCallback(
    (id: string, hyperUrl: string, canGoBack: boolean, title?: string) => {
      patch(id, { url: hyperUrl, input: hyperUrl, webCanGoBack: canGoBack, ...(title ? { title } : {}) })
      persist.recordVisit(hyperUrl, title || hyperUrl)
    },
    [patch, persist]
  )

  // Go back in the active tab: inside a web page's own history first (in-page link navigation lives
  // in the WebView, not the app stack), then across the tab's app-level nav stack (hyper pages,
  // typed URLs, home). Returns true if it navigated. Shared by the on-screen ‹ button and Android's
  // hardware back so the two always agree.
  const goBackActive = useCallback((): boolean => {
    const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current)
    if (!tab) return false
    if ((tab.kind === 'web' || (tab.kind === 'hyper' && tab.render?.type === 'http')) && tab.webCanGoBack) {
      webviews.current[tab.id]?.goBack()
      return true
    }
    if (tab.sp > 0) {
      step(tab.id, -1)
      return true
    }
    return false
  }, [step])

  // Android hardware back navigates back instead of exiting the app. Returning false when there's
  // nowhere to go lets Android background the app as usual. A visible full-screen Modal (AI/Library/…)
  // handles its own back via onRequestClose, so this handler won't fire while one is open.
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', goBackActive)
    return () => sub.remove()
  }, [goBackActive])

  // --- render ------------------------------------------------------------
  const canBack = active.sp > 0 || (active.kind === 'web' && !!active.webCanGoBack)
  const canForward = active.sp < active.stack.length - 1
  const bookmarked = persist.isBookmarked(active.url)
  // Load the active space's drive registry (its drives, incl. ones added on other devices). A
  // shared space's /drives.json replicates a beat after the space record itself, so a single fetch
  // often comes back empty — retry a few times and keep the largest result, the same way the Vault
  // space sync catches up. Reset first so switching spaces never shows the previous one's drives.
  useEffect(() => {
    const rk = spacesApi.activeSpace.rootDriveKey
    setRegistryDrives([])
    if (!rk) return
    const ns = spacesApi.activeSpace.ns
    let cancelled = false
    let best = 0
    const fetchOnce = () => {
      backend.spaceDrives(rk, ns).then((res) => {
        if (cancelled || !res.ok) return
        const drives = res.drives || []
        // Never clobber a populated list with a later empty read (the registry only grows).
        if (drives.length >= best) { best = drives.length; setRegistryDrives(drives) }
      }).catch(() => {})
    }
    fetchOnce()
    const timers = [1500, 4000, 9000].map((d) => setTimeout(fetchOnce, d))
    return () => { cancelled = true; timers.forEach(clearTimeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacesApi.activeSpace.rootDriveKey, spacesApi.activeSpace.ns, libraryOpen])

  // Library list = locally-known drives + registry drives not yet known here (type left undefined
  // so opening auto-detects it).
  const libraryDrives = useMemo<SavedDrive[]>(() => {
    const localKeys = new Set(persist.drives.map((d) => hyperKeyOf(d.url)))
    const extras = registryDrives
      .filter((rd) => rd.key && !localKeys.has(rd.key.toLowerCase()))
      .map((rd) => ({ url: `hyper://${rd.key}/`, name: shortKey(rd.key), type: rd.type as DriveType, ts: 0 }))
    return [...persist.drives, ...extras]
  }, [persist.drives, registryDrives])

  // The drive in the active tab, if it's one you own (so it can be edited).
  const ownedActive = useMemo(
    () => (active.kind === 'hyper' && active.driveKey
      ? persist.drives.find((d) => hyperKeyOf(d.url) === active.driveKey!.toLowerCase() && d.ns) ?? null
      : null),
    [active, persist.drives]
  )

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
      <TabStrip
        tabs={tabs.map((tb) => ({ id: tb.id, title: tb.title, isHyper: tb.kind === 'hyper', loading: tb.loading }))}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={openTab}
      />
      <AddressBar
        value={active.input}
        onChangeText={(text) => patch(active.id, { input: text })}
        onSubmit={() => { setUrlFocused(false); navigate(active.id, active.input) }}
        onReload={reload}
        loading={active.kind === 'hyper' && active.render?.type === 'loading'}
        isHyper={isHyperUrl(active.input)}
        driveType={active.driveType}
        canBack={canBack}
        canForward={canForward}
        onBack={goBackActive}
        onForward={() => step(active.id, 1)}
        onFocus={onUrlFocus}
        onBlur={onUrlBlur}
        hasDraft={!!active.hasDraft}
        draftPreviewing={!!active.draftPreviewing}
        onToggleDraft={onToggleDraftPreview}
      />

      {/* Only the active tab is mounted: keeping inactive panes in an absolute
          stack let Android WebViews (which ignore zIndex) paint over the active
          one. Per-tab navigation state lives in `tabs`, so nothing is lost. */}
      <View style={s.content}>
        <TabPane
          key={active.id}
          tab={active}
          bookmarks={persist.bookmarks}
          history={persist.history}
          onNavigate={(url) => navigate(active.id, url)}
          onWebNav={(nav) => onWebNav(active.id, nav)}
          onHyperNav={(hyperUrl, canGoBack, title) => onHyperNav(active.id, hyperUrl, canGoBack, title)}
          onMessage={handleWebMessage}
          onRemoveBookmark={(url) => persist.toggleBookmark(url, '')}
          onClearHistory={persist.clearHistory}
          onOpenLibrary={() => setLibraryOpen(true)}
          registerWebView={(ref) => { webviews.current[active.id] = ref }}
        />
        {/* Floating autocomplete: overlays the top of the page (anchored just below the address
            bar), so it never shifts the page down. A full-bleed backdrop underneath it catches taps
            outside the list to dismiss — RN's TextInput blur doesn't fire when you tap non-input
            content, so without this the dropdown wouldn't close on an outside tap. elevation keeps
            the backdrop above page content (incl. Android WebViews) but below the list itself. */}
        {showSuggestions ? (
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 11 }]}
            activeOpacity={1}
            onPress={() => { if (blurTimer.current) { clearTimeout(blurTimer.current); blurTimer.current = null } setUrlFocused(false); Keyboard.dismiss() }}
          />
        ) : null}
        {showSuggestions ? <Suggestions items={suggestions} onSelect={onSelectSuggestion} /> : null}
      </View>

      <View style={s.toolbar}>
        <TouchableOpacity style={s.spaceChip} onPress={() => { spacesApi.syncFromVault(); setSpacesOpen(true) }} hitSlop={6}>
          <View style={[s.spaceDot, { backgroundColor: spacesApi.activeSpace.color }]} />
          <Text style={s.spaceChipText} numberOfLines={1}>{spacesApi.activeSpace.name}</Text>
        </TouchableOpacity>
        <ToolButton label='⌂' onPress={() => goHome(active.id)} />
        <ToolButton
          label={bookmarked ? '★' : '☆'}
          active={bookmarked}
          disabled={!active.url}
          onPress={() => persist.toggleBookmark(active.url, active.title)}
        />
        <ToolButton label='✦' active={aiOpen} onPress={() => setAiOpen(true)} />
        <ToolButton label='☰' onPress={() => setMenuOpen(true)} />
      </View>

      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { label: 'My Library', onPress: () => setLibraryOpen(true) },
          { label: 'Edit files', disabled: !ownedActive, onPress: () => ownedActive && openExplorer(ownedActive) },
          { label: 'Devices', onPress: () => setDevicesOpen(true) },
          { label: 'Developer tools', onPress: () => { viewSource(); setDevtoolsOpen(true) } },
          { label: 'Copy link', disabled: !active.url, onPress: copyLink },
          { label: 'Reload', disabled: active.kind === 'home', onPress: reload }
        ]}
      />

      <DevTools
        visible={devtoolsOpen}
        onClose={() => setDevtoolsOpen(false)}
        url={active.url}
        logs={logs}
        source={source}
        onClearLogs={() => setLogs([])}
        onViewSource={viewSource}
      />

      <AiPanel
        visible={aiOpen}
        onClose={() => setAiOpen(false)}
        url={active.url}
        title={active.title}
        aiChat={backend.aiChat}
        onPrompt={(permission) => confirmModifyDrive(permission, describeDrive(permission))}
        onPreviewDraft={onPreviewDraft}
      />

      <Library
        visible={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        drives={libraryDrives}
        bookmarks={persist.bookmarks}
        history={persist.history}
        onOpen={openFromLibrary}
        onCreateDrive={createDrive}
        onEditDrive={openExplorer}
        onRemoveDrive={persist.removeDrive}
        onRemoveBookmark={(url) => persist.toggleBookmark(url, '')}
        onClearHistory={persist.clearHistory}
      />

      <Devices
        visible={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        pair={backend.pair}
        vaultStatus={backend.vaultStatus}
        renameDevice={backend.renameDevice}
        removeDevice={backend.removeDevice}
        onUnlinked={handleUnlinked}
      />

      <SpaceSwitcher
        visible={spacesOpen}
        onClose={() => setSpacesOpen(false)}
        spaces={spacesApi.spaces}
        activeSpaceId={spacesApi.activeSpaceId}
        vaultKeys={spacesApi.vaultKeys}
        onSwitch={switchSpace}
        onCreate={onCreateSpace}
      />

      <FileExplorer
        visible={!!explorerDrive}
        drive={explorerDrive}
        backend={backend}
        onClose={closeExplorer}
      />
    </SafeAreaView>
  )
}

function TabPane ({
  tab,
  bookmarks,
  history,
  onNavigate,
  onWebNav,
  onMessage,
  onRemoveBookmark,
  onClearHistory,
  onOpenLibrary,
  registerWebView,
  onHyperNav
}: {
  tab: Tab
  bookmarks: SavedSite[]
  history: SavedSite[]
  onNavigate: (url: string) => void
  onWebNav: (nav: WebViewNavigation) => void
  onMessage: (data: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
  onOpenLibrary: () => void
  registerWebView: (ref: WebView | null) => void
  onHyperNav: (hyperUrl: string, canGoBack: boolean, title?: string) => void
}) {
  const t = useTheme()
  if (tab.kind === 'home') {
    return (
      <Home
        bookmarks={bookmarks}
        history={history}
        onNavigate={onNavigate}
        onRemoveBookmark={onRemoveBookmark}
        onClearHistory={onClearHistory}
        onOpenLibrary={onOpenLibrary}
      />
    )
  }
  if (tab.kind === 'hyper') {
    const render = tab.render ?? { type: 'loading', status: 'Connecting…', peers: 0 }
    return <HyperView render={render} onNavigate={onNavigate} onMessage={onMessage} registerWebView={registerWebView} onHyperNav={onHyperNav} />
  }
  return (
    <WebView
      key={tab.reloadToken}
      ref={registerWebView}
      source={{ uri: tab.url }}
      style={{ flex: 1, backgroundColor: t.surface }}
      onNavigationStateChange={onWebNav}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      injectedJavaScriptBeforeContentLoaded={CONSOLE_SHIM}
      webviewDebuggingEnabled
      allowsBackForwardNavigationGestures
    />
  )
}

function Home ({
  bookmarks,
  history,
  onNavigate,
  onRemoveBookmark,
  onClearHistory,
  onOpenLibrary
}: {
  bookmarks: SavedSite[]
  history: SavedSite[]
  onNavigate: (url: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
  onOpenLibrary: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <ScrollView style={s.home} contentContainerStyle={s.homeContent}>
      <View style={s.brandRow}>
        <Image source={require('../assets/images/nomad-logo.png')} style={s.brandMark} />
        <View style={{ flex: 1 }}>
          <Text style={s.logo}>Nomad</Text>
          <Text style={s.tagline}>Peer-to-peer browser</Text>
        </View>
        <TouchableOpacity style={s.libBtn} onPress={onOpenLibrary}>
          <Text style={s.libBtnText}>My Library</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.hint}>Enter a web address, a search, or a hyper:// drive key. Open My Library to manage drives, bookmarks, and history.</Text>

      <Section title='Bookmarks'>
        {bookmarks.length === 0 ? (
          <Text style={s.empty}>Tap the star to save a page.</Text>
        ) : (
          bookmarks.map((b, i) => (
            <SiteRow key={b.url} site={b} hyper={b.url.startsWith('hyper://')} divider={i > 0} onPress={() => onNavigate(b.url)} onLongPress={() => onRemoveBookmark(b.url)} />
          ))
        )}
      </Section>

      <Section title='Recent' action={history.length ? { label: 'Clear', onPress: onClearHistory } : undefined}>
        {history.length === 0 ? (
          <Text style={s.empty}>Pages you visit appear here.</Text>
        ) : (
          history.slice(0, 30).map((h, i) => (
            <SiteRow key={h.url + h.ts} site={h} hyper={h.url.startsWith('hyper://')} divider={i > 0} onPress={() => onNavigate(h.url)} />
          ))
        )}
      </Section>
    </ScrollView>
  )
}

function Section ({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {action && (
          <TouchableOpacity onPress={action.onPress} hitSlop={8}>
            <Text style={s.sectionAction}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={s.card}>{children}</View>
    </View>
  )
}

function SiteRow ({ site, hyper, divider, onPress, onLongPress }: { site: SavedSite; hyper: boolean; divider: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <TouchableOpacity style={[s.siteRow, divider && s.siteDivider]} activeOpacity={0.7} onPress={onPress} onLongPress={onLongPress}>
      <View style={[s.siteDot, { backgroundColor: hyper ? t.secure : t.textMuted }]} />
      <View style={s.siteText}>
        <Text numberOfLines={1} style={s.siteTitle}>{site.title}</Text>
        <Text numberOfLines={1} style={s.siteUrl}>{site.url}</Text>
      </View>
    </TouchableOpacity>
  )
}

function Menu ({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: { label: string; onPress: () => void; disabled?: boolean }[] }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onClose}>
      <TouchableOpacity style={s.menuBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.menuSheet} onPress={() => {}}>
          {items.map((it) => (
            <TouchableOpacity key={it.label} style={s.menuItem} disabled={it.disabled} onPress={() => { onClose(); it.onPress() }}>
              <Text style={[s.menuItemText, it.disabled && { color: t.textMuted }]}>{it.label}</Text>
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function ToolButton ({ label, onPress, disabled, active }: { label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <TouchableOpacity style={s.toolBtn} onPress={onPress} disabled={disabled} hitSlop={6}>
      <Text style={[s.toolBtnText, active && { color: t.accent }, disabled && s.toolBtnDisabled]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    content: { flex: 1, position: 'relative', backgroundColor: t.bg },
    // display:'none' (not opacity:0) so inactive panes are removed from native
    // layout — Android WebViews ignore zIndex and otherwise paint over the
    // active tab. Components stay mounted, so tab state is preserved.
    hidden: { display: 'none' },
    toolbar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      height: 52,
      backgroundColor: t.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border
    },
    toolBtn: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
    toolBtnText: { color: t.textDim, fontSize: 24, fontWeight: '500' },
    spaceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 130, paddingHorizontal: 12, height: 52 },
    spaceDot: { width: 10, height: 10, borderRadius: radius.pill },
    spaceChipText: { color: t.text, fontSize: 13, fontWeight: '500' },
    toolBtnDisabled: { color: t.border },
    menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    menuSheet: { backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingVertical: 8, paddingBottom: 28 },
    menuItem: { paddingHorizontal: 22, paddingVertical: 15 },
    menuItemText: { color: t.text, fontSize: 16 },
    home: { flex: 1, backgroundColor: t.bg },
    homeContent: { padding: 20, paddingBottom: 40 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
    brandMark: { width: 46, height: 46, borderRadius: radius.pill },
    libBtn: { backgroundColor: t.trustBg, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    libBtnText: { color: t.trustText, fontSize: 13, fontWeight: '600' },
    logo: { fontSize: 22, fontWeight: '700', color: t.text },
    tagline: { color: t.textDim, fontSize: 14, marginTop: 1 },
    hint: { color: t.textMuted, fontSize: 13, marginTop: 18, lineHeight: 19 },
    section: { marginTop: 26 },
    sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
    sectionTitle: { color: t.text, fontSize: 15, fontWeight: '700' },
    sectionAction: { color: t.accent, fontSize: 13, fontWeight: '500' },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    empty: { color: t.textMuted, fontSize: 13, padding: 16 },
    siteRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, gap: 12 },
    siteDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    siteDot: { width: 8, height: 8, borderRadius: radius.pill },
    siteText: { flex: 1, paddingVertical: 9 },
    siteTitle: { color: t.text, fontSize: 14, fontWeight: '500' },
    siteUrl: { color: t.textMuted, fontSize: 12, marginTop: 1 }
  })
}
