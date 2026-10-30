import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, Image, StyleSheet, StatusBar, Alert, Keyboard, BackHandler, Platform, AppState } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { WebViewNavigation } from 'react-native-webview'
import { router, useFocusEffect } from 'expo-router'
import { captureRef } from 'react-native-view-shot'
import * as Clipboard from 'expo-clipboard'
import b4a from 'b4a'

import AddressBar from '../components/AddressBar'
import HyperView from '../components/HyperView'
import Suggestions from '../components/Suggestions'
import Library from '../components/Library'
import Reader from '../components/Reader'
import Notes from '../components/Notes'
import ActionSheet from '../components/ActionSheet'
import IconButton from '../components/IconButton'
import SiteIcon from '../components/SiteIcon'
import { ListSection, ListRow, ListEmpty } from '../components/List'
import Devices from '../components/Devices'
import SpaceSwitcher from '../components/SpaceSwitcher'
import Settings from '../components/Settings'
import Logs from '../components/Logs'
import UpdateBanner from '../components/UpdateBanner'
import DevTools from '../components/DevTools'
import AiPanel from '../components/AiPanel'
import Shortcuts from '../components/Shortcuts'
import FileExplorer, { type ExplorerDrive } from '../components/FileExplorer'
import type { HyperRender } from '../components/HyperView'
import { useBackend, type SpaceJoin } from '../lib/useBackend'
import { syncHostingService } from '../lib/hostingService'
import HostingSettings from '../components/HostingSettings'
import { usePersistence, type SavedSite, type SavedDrive } from '../lib/usePersistence'
import { useSpaces, PERSONAL_ID, SPACE_COLORS } from '../lib/useSpaces'
import { useFavicons } from '../lib/useFavicons'
import { useNames, useNamesForUrl, useNameMatches, mayBeName } from '../lib/useNames'
import NameSheet from '../components/NameSheet'
import { resolveAddress, isHyperUrl, shortKey, hyperKeyOf, type DriveType } from '../lib/hyperUrl'
import { useTheme, radius, type Theme } from '../lib/theme'
import { CONSOLE_SHIM, FAVICON_JS, VIEW_SOURCE_JS, type ContentMsg, type StatusMsg, type ErrorMsg, type LogEntry } from '../lib/types'
import { publishTabs, setTabActions, type TabThumb } from '../lib/tabSwitcher'
import { useShareOpenTabs, type DeviceTabsList, type SyncedSpace } from '../lib/openTabs'
import { checkForUpdate } from '../lib/updater'
import { pushScreen, closeScreen, loadEntry, pageLoaded, planStep, type NavEntry as StackEntry, type TabHistory } from '../lib/navStack'

// Thumbnails for the tab grid are scaled to this width; a grid card is about half a phone wide.
const THUMB_WIDTH = 360

type Kind = 'home' | 'web' | 'hyper'

// The full-screen pages over the browser. They stack (lib/navStack.ts): one opened from another
// sits on top of it, and back closes only the top one.
type Screen =
  | { name: 'library' | 'reader' | 'devices' | 'settings' | 'logs' | 'hosting' | 'devtools' }
  | { name: 'notes'; noteId?: string } // noteId: the note to open, e.g. the one a followed link was in
  | { name: 'explorer'; drive: ExplorerDrive }
type ScreenName = Screen['name']

// One entry in a tab's back/forward history.
type NavEntry = StackEntry<Screen>

// A tab's history (stack, sp, session, …) is lib/navStack.ts's TabHistory.
interface Tab extends TabHistory<Screen> {
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
  webCanGoBack?: boolean // the WebView on screen has its own history to step back through
  webCanGoForward?: boolean
}

let seq = 0
const newId = () => `tab_${++seq}_${Math.floor(Math.random() * 1e6)}`
// Each load of a history entry into a tab starts a new WebView session (see lib/navStack.ts).
let sessionSeq = 0
const newSession = () => ++sessionSeq

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
    stack: [{ kind: 'home', session: 0 }],
    sp: 0,
    session: 0,
    settled: true,
    pendingStep: false
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

// Native consent for a relayed AI permission (ADR-0013 §6): the agentic turn runs on the desktop
// Provider, but the human is here on the phone, so the prompt is shown natively. A modifyDrive prompt
// names the target drive (title + URL) so the user knows exactly what's being edited; the caller
// resolves that from the `modifyDrive:<hexDriveKey>` permission (see describeDrive). The Notes and
// Reader permissions (ADR-0019) each say what the AI wants; the Provider asks each once per turn.
// NOT cancelable: the user must explicitly tap Allow or Deny. (An `onDismiss`/cancelable dialog on
// Android can fire onDismiss alongside a button press and race it to resolve false — which denied
// writes even after the user tapped Allow.) The `settled` guard keeps the first choice
// authoritative regardless of any duplicate callback.
const VAULT_PROMPTS: Record<string, { title: string; message: string }> = {
  notesRead: { title: 'Allow AI to read your Notes?', message: 'The AI running on your other device wants to read your Notes.' },
  notesWrite: { title: 'Allow AI to edit your Notes?', message: 'The AI running on your other device wants to create or change your Notes.' },
  readerRead: { title: 'Allow AI to read your Reader?', message: 'The AI running on your other device wants to read the feeds you follow and their posts.' },
  readerWrite: { title: 'Allow AI to change your Reader?', message: 'The AI running on your other device wants to follow or unfollow feeds, or mark posts read.' },
  modsRead: { title: 'Allow AI to read your Mods?', message: 'The AI running on your other device wants to read your Mods: your own styles and scripts for sites.' },
  modsWrite: { title: 'Allow AI to change your Mods?', message: 'The AI running on your other device wants to create or change your Mods. A Mod can run a script on every page of its site.' }
}

function confirmAiPermission (permission: string, drive?: { name: string; url: string }): Promise<boolean> {
  const vaultPrompt = VAULT_PROMPTS[permission]
  const name = drive?.name || 'this drive'
  const url = drive?.url || ''
  const title = vaultPrompt ? vaultPrompt.title : 'Allow AI to edit?'
  const message = vaultPrompt
    ? vaultPrompt.message
    : `The AI running on your other device wants to make changes to this drive:\n\n${name}${url ? `\n${url}` : ''}`
  return new Promise((resolve) => {
    let settled = false
    const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    Alert.alert(
      title,
      message,
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

  // The open screens, bottom first (lib/navStack.ts): each is a full-screen Modal, and Android's back
  // reaches the top one through its onRequestClose, which closes just that one.
  const [screens, setScreens] = useState<Screen[]>([])
  const screensRef = useRef(screens)
  screensRef.current = screens
  const openScreen = useCallback((screen: Screen) => setScreens((prev) => pushScreen(prev, screen)), [])
  const closeScreenNamed = useCallback((name: ScreenName) => setScreens((prev) => closeScreen(prev, name)), [])
  const isOpen = (name: ScreenName) => screens.some((sc) => sc.name === name)
  const libraryOpen = isOpen('library')
  const explorerScreen = screens.find((sc) => sc.name === 'explorer')
  const explorerDrive = explorerScreen?.name === 'explorer' ? explorerScreen.drive : null
  // FileExplorer renders nothing without a drive, so keep the last one while its Modal slides away.
  const lastExplorerDrive = useRef<ExplorerDrive | null>(null)
  if (explorerDrive) lastExplorerDrive.current = explorerDrive
  const notesScreen = screens.find((sc) => sc.name === 'notes')
  // The sheets over the browser, and the AI panel.
  const [spacesOpen, setSpacesOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [nameSheetOpen, setNameSheetOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
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
    ns: spacesApi.activeSpace.ns,
    onError: (message) => Alert.alert('Couldn’t save', message)
  })
  const favicons = useFavicons()
  const names = useNames(backend.apps, spacesApi.activeSpace.rootDriveKey || undefined)
  // The user's own name for the drive in the active tab: the address bar shows it in a green tag.
  const activeNames = useNamesForUrl(names, active.url, active.kind !== 'home')
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
    return sp
  }, [spacesApi])

  // Join a shared Space (ADR-0029) with a code from its owner. Once they approve, the phone makes a
  // Space for it (its own Root Drive, as desktop does) and marks it in the Vault as that Space's
  // Library, so the user's other Devices get it too. Throws with why not.
  const onJoinSpace = useCallback(async ({ code, name }: { code: string; name: string }) => {
    const res = await backend.apps<SpaceJoin>('spaces', 'join', { code, name: name || 'Someone' })
    if (!res.ok || !res.value) throw new Error(res.message || 'Couldn’t join that Space')
    const { library, memberId, index } = res.value
    const created = await onCreateSpace({ name: index.name || 'Shared space', color: index.color || SPACE_COLORS[0] })
    const rootDriveKey = created?.rootDriveKey
    if (!rootDriveKey) throw new Error('Joined, but this phone couldn’t make the Space. Try again from your computer.')
    const attached = await backend.apps('spaces', 'attach', { rootDriveKey, name: index.name, icon: index.icon, color: index.color, library, memberId })
    if (!attached.ok) throw new Error(attached.message || 'Joined, but couldn’t save it to your Vault')
    spacesApi.syncFromVault()
  }, [backend, onCreateSpace, spacesApi])

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
      const session = newSession()
      setTabs((prev) =>
        prev.map((tb) => (tb.id === id
          ? { ...tb, ...fields, ...loadEntry(tb, entry, push, session, sp), webCanGoBack: false, webCanGoForward: false }
          : tb))
      )
      if (entry.kind === 'hyper') backend.open(id, entry.url, entry.driveType, entry.ns, entry.detect ?? true)
    },
    [backend]
  )

  // A name the user gave a drive or URL (ADR-0018) goes where it points: typed ("blog" or
  // hyper://blog/posts/) or followed from a link in a page. The tab lands on the real address, so a
  // drive keeps one origin, as on desktop.
  const navigate = useCallback(
    (id: string, rawInput: string) => {
      const go = (input: string) => {
        const tab = tabsRef.current.find((tb) => tb.id === id)
        if (!tab) return
        const r = resolveAddress(input)
        // A drive's type is fixed at creation. If we already know it (library /
        // owned), use it directly; otherwise auto-detect by trying both.
        const known = persist.driveTypeFor(r.url)
        const entry: NavEntry = r.kind === 'hyper'
          ? { kind: 'hyper', url: r.url, driveType: known ?? 'hyperdrive', ns: persist.driveNsFor(r.url), detect: !known }
          : { kind: 'web', url: r.url }
        navTo(id, entry, true)
      }
      if (!mayBeName(rawInput)) return go(rawInput)
      names.resolve(rawInput).then(go)
    },
    [navTo, persist, names.resolve]
  )

  // URL-bar autocomplete. The address bar selects-all on focus, so treat the input as an empty query
  // (show most-recent) until it diverges from the committed URL, then filter by what's typed.
  // The user's names that match come first, the exact one at the top, as on desktop.
  const suggestQuery = active.input.trim() === active.url.trim() ? '' : active.input
  const nameMatches = useNameMatches(names, suggestQuery)
  const suggestions = useMemo(() => {
    const named = nameMatches.map((r) => ({ url: `hyper://${r.name}/`, title: r.title || r.url, ts: 0, name: r.name }))
    return [...named, ...persist.suggest(suggestQuery, 10)].slice(0, 10)
  }, [persist.suggest, suggestQuery, nameMatches])
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

  // Back (-1) or forward (+1) in a tab's history (lib/navStack.ts): inside the WebView on screen
  // when both entries are its own pages, else by loading the entry. Back from a page opened from a
  // screen (My Library, Reader, Notes) opens that screen again. Returns true if it went anywhere.
  const step = useCallback(
    (id: string, delta: -1 | 1): boolean => {
      const tab = tabsRef.current.find((tb) => tb.id === id)
      if (!tab) return false
      const plan = planStep(tab, delta, !!(delta < 0 ? tab.webCanGoBack : tab.webCanGoForward))
      if (plan.type === 'none') return false
      const wv = webviews.current[id]
      if (plan.type === 'native' && wv) {
        // The address bar and the entry follow when the WebView lands (onWebNav/onHyperNav).
        setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, sp: plan.sp, pendingStep: true } : tb)))
        if (delta < 0) wv.goBack()
        else wv.goForward()
      } else {
        navTo(id, tab.stack[plan.sp], false, plan.sp)
      }
      if (plan.returnTo) setScreens(plan.returnTo)
      return true
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
      // A page's icon (FAVICON_JS). Kept per site. A drive page is served from the loopback gateway,
      // so it counts toward the tab's hyper:// drive, and only a data URL outlives the gateway port.
      else if (msg.type === 'favicon') {
        const tab = tabsRef.current.find((tb) => tb.id === activeIdRef.current)
        if (!tab) return
        const dataUrl = typeof msg.dataUrl === 'string' && msg.dataUrl.startsWith('data:image/') ? msg.dataUrl : null
        if (tab.kind === 'hyper' && tab.url && dataUrl) favicons.remember(tab.url, dataUrl)
        else if (tab.kind === 'web' && typeof msg.page === 'string') {
          const href = typeof msg.href === 'string' && /^https?:\/\//.test(msg.href) ? msg.href : null
          if (dataUrl || href) favicons.remember(msg.page, (dataUrl || href)!)
        }
      }
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
        // A page's turn is never personal, whatever it posts: no names, other Drives, Notes or
        // Reader, and no tab but its own (ADR-0018, ADR-0019, ADR-0021).
        const opts = { ...(msg.payload.opts || {}), personal: false, space: null, tab: null }
        aiHandles.current[id] = backendRef.current.aiChat(msg.payload.messages || [], opts, {
          onChunk: (text) => inject({ kind: 'chunk', text }),
          onTool: (event) => inject({ kind: 'tool', event }),
          onReasoning: (text) => inject({ kind: 'reasoning', text }),
          onDone: () => { delete aiHandles.current[id]; inject({ kind: 'done' }) },
          onError: (message) => { delete aiHandles.current[id]; inject({ kind: 'error', message }) },
          onPrompt: (permission) => confirmAiPermission(permission, describeDrive(permission))
        })
      }
      else if (msg.type === 'nomad-ai-cancel' && msg.payload && msg.payload.id) {
        aiHandles.current[msg.payload.id]?.cancel()
        delete aiHandles.current[msg.payload.id]
      }
    },
    [navigate, describeDrive, favicons.remember]
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

  // Open a page from a screen (My Library, Reader, Notes) in the current tab. The screens close and
  // the page remembers them (`returnTo`), so back from the page opens them again.
  const openFromScreens = useCallback(
    (url: string, type?: DriveType, returnTo: Screen[] = screensRef.current) => {
      const r = resolveAddress(url)
      const known = type ?? persist.driveTypeFor(r.url)
      const entry: NavEntry = r.kind === 'hyper'
        ? { kind: 'hyper', url: r.url, driveType: known ?? 'hyperdrive', ns: persist.driveNsFor(r.url), detect: !known }
        : { kind: 'web', url: r.url }
      setScreens([])
      navTo(active.id, { ...entry, returnTo }, true)
    },
    [active.id, navTo, persist]
  )

  const openFromLibrary = useCallback((url: string, type?: DriveType) => openFromScreens(url, type), [openFromScreens])

  // A Reader post opens in the current tab, like an item from My Library.
  const openFromReader = useCallback((url: string) => openFromScreens(url), [openFromScreens])

  // A web or hyper:// link in a note opens in the current tab. Back returns to that note.
  const openFromNotes = useCallback(
    (url: string, noteId?: string) => {
      openFromScreens(url, undefined, screensRef.current.map((sc) => (sc.name === 'notes' ? { name: 'notes', noteId } : sc)))
    },
    [openFromScreens]
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
      const returnTo = screensRef.current
      setScreens([])
      navTo(active.id, { kind: 'hyper', url: res.url, driveType: type, ns: res.ns, detect: false, returnTo }, true)
    },
    [backend, persist, navTo, active.id, spacesApi.activeSpace]
  )

  // Open the file explorer/editor for a drive you own (carries an `ns`), over My Library when it
  // was opened from there.
  const openExplorer = useCallback((d: SavedDrive) => {
    if (!d.ns) return
    setMenuOpen(false)
    openScreen({ name: 'explorer', drive: { url: d.url, key: hyperKeyOf(d.url), name: d.name, type: d.type, ns: d.ns } })
  }, [openScreen])

  // On close, reflect any edits in an open tab showing the same drive.
  const closeExplorer = useCallback(() => {
    const edited = explorerDrive
    closeScreenNamed('explorer')
    if (edited && active.kind === 'hyper' && active.driveKey && active.driveKey.toLowerCase() === edited.key.toLowerCase()) {
      reload()
    }
  }, [explorerDrive, closeScreenNamed, active, reload])

  // --- tab management ----------------------------------------------------
  // Each tab's last look, taken when the tab grid opens (only the active tab is ever on screen).
  const [thumbs, setThumbs] = useState<Record<string, TabThumb>>({})
  const contentRef = useRef<View>(null)
  const contentSize = useRef({ width: 0, height: 0 })
  const dropThumbs = (ids: string[]) =>
    setThumbs((prev) => {
      if (!ids.some((id) => prev[id])) return prev
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })

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
        if (id === activeIdRef.current) setActiveId(next[next.length - 1].id)
        return next
      })
      dropThumbs([id])
    },
    [backend]
  )

  // Close every tab in the active space and start over with one new tab.
  const closeAllTabs = useCallback(() => {
    const closing = tabsRef.current
    for (const tb of closing) {
      if (tb.driveKey) backend.close(tb.driveType, tb.driveKey)
      delete webviews.current[tb.id]
    }
    dropThumbs(closing.map((tb) => tb.id))
    const fresh = blankTab()
    setTabs([fresh])
    setActiveId(fresh.id)
  }, [backend])

  // Snapshot the active tab's content area for its grid card. Best-effort: a failed capture just
  // leaves the card on its placeholder.
  const captureActive = useCallback(async () => {
    const id = activeIdRef.current
    const { width, height } = contentSize.current
    if (!contentRef.current || !width || !height) return
    try {
      const uri = await captureRef(contentRef, {
        format: 'jpg',
        quality: 0.6,
        width: THUMB_WIDTH,
        height: Math.round((THUMB_WIDTH * height) / width),
        result: 'data-uri'
      })
      setThumbs((prev) => ({ ...prev, [id]: { uri, aspect: width / height } }))
    } catch {}
  }, [])

  // Open the tab grid (app/tabs.tsx). The capture gets a short head start so the current tab's
  // card shows what was just on screen; a slow one lands in the grid when it finishes.
  const gridOpening = useRef(false)
  const openTabGrid = useCallback(async () => {
    if (gridOpening.current) return
    gridOpening.current = true
    Keyboard.dismiss()
    setUrlFocused(false)
    await Promise.race([captureActive(), new Promise((resolve) => setTimeout(resolve, 400))])
    router.push('/tabs')
    gridOpening.current = false
  }, [captureActive])

  const addressRef = useRef<TextInput>(null)
  const focusAddressOnReturn = useRef(false)

  // A URL from another Device's tabs (the tab grid) opens in a new tab here. navTo reads tabsRef,
  // so the new tab goes in there first; its setTabs update runs after the one that adds the tab.
  const openInNewTab = useCallback((url: string) => {
    const tb = blankTab()
    tabsRef.current = [...tabsRef.current, tb]
    setTabs((prev) => [...prev, tb])
    setActiveId(tb.id)
    navigate(tb.id, url)
  }, [navigate])

  // Share this phone's open tabs, per Space, with the user's other Devices (shared/open-tabs.mjs).
  // A Space this phone hasn't switched to since launch has no tabs here, so it isn't listed. The
  // backend writes only when something changed, only once linked; turning sharing off deletes them.
  const [shareTabs, setShareTabs] = useShareOpenTabs()
  useEffect(() => {
    const timer = setTimeout(() => {
      const spaces: SyncedSpace[] = []
      for (const sp of spacesApi.spaces) {
        if (!sp.rootDriveKey) continue
        const saved = sp.id === spacesApi.activeSpaceId
          ? { tabs, activeId }
          : tabsBySpace.current[sp.id]
        if (!saved) continue
        spaces.push({
          rootDriveKey: sp.rootDriveKey,
          name: sp.name,
          tabs: saved.tabs
            .filter((tb) => tb.kind !== 'home' && tb.url)
            .map((tb) => ({ url: tb.url, title: tb.title, active: tb.id === saved.activeId }))
        })
      }
      backend.apps('tabs', 'publish', { spaces, off: !shareTabs })
    }, 5000)
    return () => clearTimeout(timer)
  }, [backend, tabs, activeId, spacesApi.spaces, spacesApi.activeSpaceId, shareTabs])

  // Feed the tab grid route: what it shows, and what its buttons do.
  useEffect(() => {
    publishTabs({
      tabs: tabs.map((tb) => ({
        id: tb.id, title: tb.title, url: tb.url, kind: tb.kind, loading: tb.loading, thumb: thumbs[tb.id], icon: tb.url ? favicons.iconFor(tb.url) : undefined
      })),
      activeId,
      spaceName: spacesApi.activeSpace.name,
      spaceColor: spacesApi.activeSpace.color
    })
  }, [tabs, activeId, thumbs, favicons.iconFor, spacesApi.activeSpace.name, spacesApi.activeSpace.color])
  useEffect(() => {
    setTabActions({
      select: setActiveId,
      close: closeTab,
      // A new tab from the grid comes back ready to type into, as in Chrome.
      open: () => { openTab(); focusAddressOnReturn.current = true },
      closeAll: closeAllTabs,
      openUrl: openInNewTab,
      deviceTabs: async () => {
        const res = await backend.apps<DeviceTabsList>('tabs', 'list', { space: spacesApi.activeSpace.rootDriveKey })
        return res.ok && res.value ? res.value : null
      }
    })
    return () => setTabActions(null)
  }, [closeTab, openTab, closeAllTabs, openInNewTab, backend, spacesApi.activeSpace.rootDriveKey])

  useFocusEffect(
    useCallback(() => {
      if (!focusAddressOnReturn.current) return
      focusAddressOnReturn.current = false
      // Wait for the grid's fade-out; focusing mid-transition can drop the keyboard on Android.
      const timer = setTimeout(() => addressRef.current?.focus(), 250)
      return () => clearTimeout(timer)
    }, [])
  )

  // A page in the tab's WebView finished loading: a link followed in the page becomes its own
  // history entry, so back always returns to the page you were on (lib/navStack.ts pageLoaded).
  const settlePage = useCallback((id: string, url: string, fields: Partial<Tab>) => {
    const web = { canGoBack: !!fields.webCanGoBack, canGoForward: !!fields.webCanGoForward }
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, ...fields, ...pageLoaded(tb, url, web) } : tb)))
  }, [])

  const onWebNav = useCallback(
    (id: string, nav: WebViewNavigation) => {
      const fields = { url: nav.url, input: nav.url, title: nav.title || nav.url, loading: nav.loading, webCanGoBack: nav.canGoBack, webCanGoForward: nav.canGoForward }
      if (nav.loading) return patch(id, fields)
      settlePage(id, nav.url, fields)
      persist.recordVisit(nav.url, nav.title || nav.url)
    },
    [patch, settlePage, persist]
  )

  // Native in-page navigation within a drive (loopback origin): reflect the mapped hyper:// URL in
  // the address bar and track WebView history so back/forward drive the WebView, like web tabs.
  // The document title (e.g. a rendered Markdown page's h1) follows into the tab label when set.
  const onHyperNav = useCallback(
    (id: string, hyperUrl: string, canGoBack: boolean, canGoForward: boolean, title?: string) => {
      settlePage(id, hyperUrl, { url: hyperUrl, input: hyperUrl, webCanGoBack: canGoBack, webCanGoForward: canGoForward, ...(title ? { title } : {}) })
      persist.recordVisit(hyperUrl, title || hyperUrl)
    },
    [settlePage, persist]
  )

  // Go back in the active tab. Shared by the on-screen back button and Android's hardware back so
  // the two always agree.
  const goBackActive = useCallback((): boolean => step(activeIdRef.current, -1), [step])

  // Android hardware back navigates back instead of exiting the app. Returning false when there's
  // nowhere to go lets Android background the app as usual. A visible full-screen Modal (Library/…)
  // handles its own back via onRequestClose, so this handler won't fire while one is open — but the
  // AI panel is a plain in-tree overlay (see AiPanel), so closing it is this handler's job. Keeping
  // that here, rather than in a second BackHandler inside the panel, avoids depending on the order
  // RN happens to call two registered handlers in. Registered only while this screen has focus:
  // with the tab grid pushed on top, back must pop the grid, not step the tab's history under it.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (aiOpen) { setAiOpen(false); return true }
        return goBackActive()
      })
      return () => sub.remove()
    }, [goBackActive, aiOpen])
  )

  // --- render ------------------------------------------------------------
  const canBack = active.sp > 0
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
    // The backend shares one in-flight open per drive, so early retries just wait on the first
    // open. The later ones catch a /drives.json that lands after a slow cold open.
    const timers = [1500, 4000, 9000, 20000, 40000].map((d) => setTimeout(fetchOnce, d))
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

  // Hosting (seeding) for the active drive — desktop's "Host This Hyperdrive" toggle.
  // Only offered for drives this device doesn't own (owned drives announce already);
  // the persisted state is fetched lazily when the menu opens.
  const canHostActive = active.kind === 'hyper' && !!active.driveKey && !ownedActive
  const [activeHosted, setActiveHosted] = useState<boolean | null>(null)
  useEffect(() => {
    if (!menuOpen || !canHostActive || !active.driveKey) { setActiveHosted(null); return }
    backend.hosting('get', { driveType: active.driveType, key: active.driveKey }).then((r) => setActiveHosted(r.ok ? !!r.hosted : null))
  }, [menuOpen, canHostActive, active.driveKey, active.driveType, backend])

  // Keep the Android foreground service (which keeps seeding alive in the background) in
  // step with the backend: no drives hosted, or hosting paused by the daily budget → stop.
  const syncFromHosting = useCallback((r: { ok: boolean; count?: number; paused?: boolean }) => {
    if (r.ok) syncHostingService(r.paused ? 0 : (r.count ?? 0))
  }, [])

  const toggleHosting = useCallback(async () => {
    if (!canHostActive || !active.driveKey) return
    const next = !activeHosted
    setActiveHosted(next)
    const r = await backend.hosting('set', { driveType: active.driveType, key: active.driveKey, on: next })
    if (!r.ok) setActiveHosted(!next)
    syncFromHosting(r)
  }, [canHostActive, active.driveKey, active.driveType, activeHosted, backend, syncFromHosting])

  // On launch, restore the foreground service if this device was hosting drives —
  // the backend re-announces them on boot; this keeps that alive past backgrounding.
  useEffect(() => {
    backend.hosting('count').then(syncFromHosting)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Look for a new release on launch and each time the app comes back to the front
  // (lib/updater.ts limits this to once an hour).
  useEffect(() => {
    checkForUpdate()
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') checkForUpdate() })
    return () => sub.remove()
  }, [])

  return (
    <>
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
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
        onForward={() => { step(active.id, 1) }}
        onFocus={onUrlFocus}
        onBlur={onUrlBlur}
        hasDraft={!!active.hasDraft}
        draftPreviewing={!!active.draftPreviewing}
        onToggleDraft={onToggleDraftPreview}
        siteName={!urlFocused && activeNames?.approved ? activeNames.approved.name : ''}
        inputRef={addressRef}
        canReload={active.kind !== 'home'}
      />

      {/* Only the active tab is mounted: keeping inactive panes in an absolute
          stack let Android WebViews (which ignore zIndex) paint over the active
          one. Per-tab navigation state lives in `tabs`, so nothing is lost.
          contentRef is what the tab grid's thumbnail captures; collapsable={false} keeps the
          View in the native tree on Android so there is something to capture. */}
      <View
        ref={contentRef}
        collapsable={false}
        style={s.content}
        onLayout={(e) => { contentSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height } }}
      >
        <TabPane
          key={active.id}
          tab={active}
          home={{
            pins: persist.pins,
            history: persist.history,
            iconFor: favicons.iconFor,
            suggest: persist.suggest,
            onAddPin: (url, title) => persist.setPinned(url, title, true),
            onRemovePin: (url) => persist.setPinned(url, '', false),
            onRefresh: persist.refreshSynced
          }}
          onNavigate={(url) => navigate(active.id, url)}
          onWebNav={(nav) => onWebNav(active.id, nav)}
          onHyperNav={(hyperUrl, canGoBack, canGoForward, title) => onHyperNav(active.id, hyperUrl, canGoBack, canGoForward, title)}
          onMessage={handleWebMessage}
          onClearHistory={persist.clearHistory}
          onOpenLibrary={() => openScreen({ name: 'library' })}
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

      <UpdateBanner />

      {/* The bottom bar, in thumb reach: the Space, home, bookmark, the AI, the tab grid, the menu. */}
      <View style={s.toolbar}>
        <Pressable
          style={s.spaceChip}
          onPress={() => { spacesApi.syncFromVault(); setSpacesOpen(true) }}
          android_ripple={{ color: t.ripple, borderless: true }}
          accessibilityRole='button'
          accessibilityLabel={`Space: ${spacesApi.activeSpace.name}. Switch space`}
        >
          <View style={[s.spaceDot, { backgroundColor: spacesApi.activeSpace.color }]} />
          <Text style={s.spaceChipText} numberOfLines={1}>{spacesApi.activeSpace.name}</Text>
        </Pressable>
        <IconButton icon='home' label='Home' onPress={() => goHome(active.id)} />
        <IconButton
          icon='star'
          regular={!bookmarked}
          label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          active={bookmarked}
          disabled={!active.url}
          onPress={() => persist.toggleBookmark(active.url, active.title)}
        />
        <IconButton icon='robot' label='AI assistant' active={aiOpen} onPress={() => setAiOpen(true)} />
        <TabCountButton count={tabs.length} onPress={openTabGrid} />
        <IconButton icon='ellipsis-v' label='Menu' onPress={() => setMenuOpen(true)} />
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={active.kind === 'home' ? undefined : active.title}
        subtitle={active.kind === 'home' ? undefined : active.url}
        // A new tab has nothing to reload, copy, name or pin, so its menu starts at the list.
        quick={active.kind === 'home' ? undefined : [
          { label: 'Reload', icon: 'redo-alt', onPress: reload },
          { label: 'Copy link', icon: 'link', disabled: !active.url, onPress: copyLink },
          { label: activeNames?.named.length ? 'Rename' : 'Name', icon: 'tag', disabled: !active.url, onPress: () => setNameSheetOpen(true) },
          persist.isPinned(active.url)
            ? { label: 'On home', icon: 'thumbtack', active: true, onPress: () => persist.setPinned(active.url, '', false) }
            : { label: 'Add to home', icon: 'thumbtack', disabled: !active.url, onPress: () => persist.setPinned(active.url, active.title, true) }
        ]}
        groups={[
          [
            { label: 'My Library', icon: 'book', onPress: () => openScreen({ name: 'library' }) },
            { label: 'Reader', icon: 'rss', onPress: () => openScreen({ name: 'reader' }) },
            { label: 'Notes', icon: 'sticky-note', onPress: () => openScreen({ name: 'notes' }) }
          ],
          [
            // Only for a drive this phone owns, and hosting only for one it doesn't.
            { label: 'Edit files', icon: 'folder-open', hidden: !ownedActive, onPress: () => ownedActive && openExplorer(ownedActive) },
            { label: activeHosted ? 'Stop hosting this drive' : 'Host this drive', icon: 'server', active: !!activeHosted, hidden: !canHostActive, onPress: toggleHosting },
            { label: 'Developer tools', icon: 'code', onPress: () => { viewSource(); openScreen({ name: 'devtools' }) } }
          ],
          [
            { label: 'Devices', icon: 'laptop', onPress: () => openScreen({ name: 'devices' }) },
            { label: 'Settings', icon: 'cog', onPress: () => openScreen({ name: 'settings' }) }
          ]
        ]}
      />

      <NameSheet
        visible={nameSheetOpen}
        onClose={() => setNameSheetOpen(false)}
        names={names}
        url={active.url}
        title={active.title}
        spaceName={spacesApi.activeSpace.rootDriveKey ? spacesApi.activeSpace.name : undefined}
        onOpenDevices={() => { setNameSheetOpen(false); openScreen({ name: 'devices' }) }}
      />

      <Settings
        visible={isOpen('settings')}
        onClose={() => closeScreenNamed('settings')}
        onOpenDevices={() => openScreen({ name: 'devices' })}
        onOpenHosting={() => openScreen({ name: 'hosting' })}
        onOpenLogs={() => openScreen({ name: 'logs' })}
        shareTabs={shareTabs}
        onShareTabs={setShareTabs}
      />

      <Logs
        visible={isOpen('logs')}
        onClose={() => closeScreenNamed('logs')}
        logs={backend.logs}
      />

      <HostingSettings
        visible={isOpen('hosting')}
        onClose={() => closeScreenNamed('hosting')}
        hosting={backend.hosting}
        onStatus={syncFromHosting}
      />

      <DevTools
        visible={isOpen('devtools')}
        onClose={() => closeScreenNamed('devtools')}
        url={active.url}
        logs={logs}
        source={source}
        onClearLogs={() => setLogs([])}
        onViewSource={viewSource}
      />

      <Library
        visible={libraryOpen}
        onClose={() => closeScreenNamed('library')}
        drives={libraryDrives}
        bookmarks={persist.bookmarks}
        history={persist.history}
        iconFor={favicons.iconFor}
        onOpen={openFromLibrary}
        onCreateDrive={createDrive}
        onEditDrive={openExplorer}
        onRemoveDrive={persist.removeDrive}
        onRemoveBookmark={(url) => persist.toggleBookmark(url, '')}
        onClearHistory={persist.clearHistory}
      />

      <Reader
        visible={isOpen('reader')}
        onClose={() => closeScreenNamed('reader')}
        apps={backend.apps}
        onVaultChange={backend.onVaultChange}
        space={spacesApi.activeSpace.rootDriveKey}
        onOpenPost={openFromReader}
        onOpenDevices={() => openScreen({ name: 'devices' })}
      />

      <Notes
        visible={!!notesScreen}
        onClose={() => closeScreenNamed('notes')}
        openNoteId={notesScreen?.name === 'notes' ? notesScreen.noteId : undefined}
        apps={backend.apps}
        onVaultChange={backend.onVaultChange}
        space={spacesApi.activeSpace.rootDriveKey || undefined}
        spaceName={spacesApi.activeSpace.name}
        onOpenDevices={() => openScreen({ name: 'devices' })}
        onOpenUrl={openFromNotes}
      />

      <Devices
        visible={isOpen('devices')}
        onClose={() => closeScreenNamed('devices')}
        pair={backend.pair}
        vaultStatus={backend.vaultStatus}
        renameDevice={backend.renameDevice}
        removeDevice={backend.removeDevice}
        spaces={spacesApi.spaces}
        onUnlinked={handleUnlinked}
      />

      <SpaceSwitcher
        visible={spacesOpen}
        onClose={() => setSpacesOpen(false)}
        spaces={spacesApi.spaces}
        activeSpaceId={spacesApi.activeSpaceId}
        vaultKeys={spacesApi.vaultKeys}
        peopleKeys={spacesApi.peopleKeys}
        onSwitch={switchSpace}
        onCreate={onCreateSpace}
        onJoin={onJoinSpace}
      />

      <FileExplorer
        visible={!!explorerDrive}
        drive={explorerDrive ?? lastExplorerDrive.current}
        backend={backend}
        onClose={closeExplorer}
      />
    </SafeAreaView>

    {/* Rendered OUTSIDE the SafeAreaView on purpose. AiPanel is a full-screen absolute overlay (not
        a Modal — see its render comment), and an absolutely-positioned child is not inset by its
        parent's padding, so nesting it here made its inset behaviour depend on a detail of the
        parent it could not see. Out here it simply fills the window and owns both insets itself. */}
    <AiPanel
      visible={aiOpen}
      onClose={() => setAiOpen(false)}
      url={active.url}
      title={active.title}
      space={spacesApi.activeSpace.rootDriveKey}
      aiChat={backend.aiChat}
      onPrompt={(permission) => confirmAiPermission(permission, describeDrive(permission))}
      onPreviewDraft={onPreviewDraft}
    />
    </>
  )
}

// What the home page shows: pinned shortcuts and recent pages.
interface HomeData {
  pins: SavedSite[]
  history: SavedSite[]
  iconFor: (url: string) => string | undefined
  suggest: (query: string, limit?: number) => SavedSite[]
  onAddPin: (url: string, title: string) => void
  onRemovePin: (url: string) => void
  onRefresh: () => void
}

function TabPane ({
  tab,
  home,
  onNavigate,
  onWebNav,
  onMessage,
  onClearHistory,
  onOpenLibrary,
  registerWebView,
  onHyperNav
}: {
  tab: Tab
  home: HomeData
  onNavigate: (url: string) => void
  onWebNav: (nav: WebViewNavigation) => void
  onMessage: (data: string) => void
  onClearHistory: () => void
  onOpenLibrary: () => void
  registerWebView: (ref: WebView | null) => void
  onHyperNav: (hyperUrl: string, canGoBack: boolean, canGoForward: boolean, title?: string) => void
}) {
  const t = useTheme()
  if (tab.kind === 'home') {
    return (
      <Home
        home={home}
        onNavigate={onNavigate}
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
      injectedJavaScript={FAVICON_JS}
      webviewDebuggingEnabled
      allowsBackForwardNavigationGestures
    />
  )
}

function Home ({
  home,
  onNavigate,
  onClearHistory,
  onOpenLibrary
}: {
  home: HomeData
  onNavigate: (url: string) => void
  onClearHistory: () => void
  onOpenLibrary: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { pins, history, iconFor, suggest, onAddPin, onRemovePin, onRefresh } = home
  // Pins can change on another device, so pick up the latest whenever home opens.
  useEffect(() => { onRefresh() }, [onRefresh])
  return (
    <ScrollView style={s.home} contentContainerStyle={s.homeContent}>
      <View style={s.brandRow}>
        <Image source={require('../assets/images/nomad-logo.png')} style={s.brandMark} />
        <View style={{ flex: 1 }}>
          <Text style={s.logo}>Nomad</Text>
          <Text style={s.tagline}>Peer-to-peer browser</Text>
        </View>
        <Pressable style={s.libBtn} onPress={onOpenLibrary} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
          <Text style={s.libBtnText}>My Library</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>Enter a web address, a search, or a hyper:// drive key. Open My Library to manage drives, bookmarks, and history.</Text>

      <Shortcuts
        pins={pins}
        iconFor={iconFor}
        suggest={suggest}
        onOpen={onNavigate}
        onAdd={onAddPin}
        onRemove={onRemovePin}
      />

      <ListSection title='Recent' style={s.section} action={history.length ? { label: 'Clear', onPress: onClearHistory } : undefined}>
        {history.length === 0 ? (
          <ListEmpty text='Pages you visit appear here.' />
        ) : (
          history.slice(0, 30).map((h, i) => (
            <ListRow
              key={h.url + h.ts}
              title={h.title}
              subtitle={h.url}
              divider={i > 0}
              left={<SiteIcon url={h.url} title={h.title} uri={iconFor(h.url)} size={24} />}
              onPress={() => onNavigate(h.url)}
            />
          ))
        )}
      </ListSection>
    </ScrollView>
  )
}

// Chrome's tab switcher button: the open-tab count in a rounded square. Past 99 it gives up and
// grins, as Chrome does.
function TabCountButton ({ count, onPress }: { count: number; onPress: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <IconButton onPress={onPress} label={`${count} open ${count === 1 ? 'tab' : 'tabs'}`}>
      <View style={s.tabCount}>
        <Text style={s.tabCountText}>{count > 99 ? ':D' : count}</Text>
      </View>
    </IconButton>
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
      justifyContent: 'space-between',
      alignItems: 'center',
      height: 56,
      paddingHorizontal: 6,
      backgroundColor: t.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border
    },
    spaceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 124,
      height: 36,
      paddingHorizontal: 12,
      marginRight: 2,
      borderRadius: radius.pill,
      backgroundColor: t.surfaceAlt
    },
    spaceDot: { width: 10, height: 10, borderRadius: radius.pill },
    spaceChipText: { color: t.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    tabCount: { minWidth: 22, height: 22, paddingHorizontal: 3, borderRadius: 6, borderWidth: 2, borderColor: t.textDim, alignItems: 'center', justifyContent: 'center' },
    tabCountText: { color: t.textDim, fontSize: 11, fontWeight: '700' },
    home: { flex: 1, backgroundColor: t.bg },
    homeContent: { padding: 20, paddingBottom: 40 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
    brandMark: { width: 46, height: 46, borderRadius: radius.pill },
    libBtn: { backgroundColor: t.trustBg, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center', overflow: 'hidden' },
    libBtnText: { color: t.trustText, fontSize: 13, fontWeight: '600' },
    logo: { fontSize: 22, fontWeight: '700', color: t.text },
    tagline: { color: t.textDim, fontSize: 14, marginTop: 1 },
    hint: { color: t.textMuted, fontSize: 13, marginTop: 18, lineHeight: 19 },
    section: { marginTop: 22 }
  })
}
