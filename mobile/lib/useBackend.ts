import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import { Paths } from 'expo-file-system'
import RPC from 'bare-rpc'
import b4a from 'b4a'

import bundle from '../app/app.bundle.mjs'
import { holdForAiTurn } from './hostingService'
import { currentVersion } from './updater'
import {
  RPC_OPEN,
  RPC_CLOSE,
  RPC_CREATE,
  RPC_PAIR_SUBMIT,
  RPC_VAULT_STATUS,
  RPC_RENAME_DEVICE,
  RPC_REMOVE_DEVICE,
  RPC_VAULT_ADD_SPACE,
  RPC_SPACE_ADD_DRIVE,
  RPC_FS_LIST,
  RPC_FS_READ,
  RPC_FS_WRITE,
  RPC_FS_DELETE,
  RPC_FS_RENAME,
  RPC_FS_MKDIR,
  RPC_STATUS,
  RPC_CONTENT,
  RPC_ERROR,
  RPC_CREATED,
  RPC_PAIRED,
  RPC_VAULT,
  RPC_FS_RESULT,
  RPC_SPACE_DRIVES,
  RPC_SPACE_DRIVES_RESULT,
  RPC_BOOKMARKS,
  RPC_BOOKMARKS_RESULT,
  RPC_HOSTING,
  RPC_HOSTING_RESULT,
  RPC_NOMAD,
  RPC_NOMAD_RESULT,
  RPC_AI_CHAT,
  RPC_AI_CANCEL,
  RPC_AI_PROMPT_RESULT,
  RPC_AI_EVENT,
  RPC_APPS,
  RPC_APPS_RESULT,
  RPC_LOGS,
  RPC_LOGS_RESULT,
  RPC_VAULT_CHANGED
} from '../rpc-commands.mjs'
import type { LogEntry } from './log'

export interface Bookmark { href: string; title: string; createdAt?: string }
// `pins`: the space's pinned-shortcut hrefs (/nomad/pins.json), sent with every bookmarks reply.
export interface BookmarksMsg { reqId?: string; ok: boolean; bookmarks: Bookmark[]; pins?: string[]; message?: string }
export interface HostingMsg { reqId?: string; ok: boolean; hosted?: boolean; count?: number; paused?: boolean; usageBytes?: number; dailyLimitMB?: number; message?: string }
import type { DriveType } from './hyperUrl'
import type { StatusMsg, ContentMsg, ErrorMsg, CreatedMsg, DirEntry } from './types'

export interface FsResult {
  reqId?: string
  ok: boolean
  entries?: DirEntry[]
  writable?: boolean
  base64?: string
  mime?: string
  exists?: boolean
  message?: string
}

export interface PairedMsg {
  reqId: string
  ok: boolean
  vaultKey?: string
  deviceKey?: string
  writable?: boolean
  message?: string
}

// spaces: the Spaces that Device says it has (it writes this itself); missing on an older Nomad.
export interface DeviceSpace { rootDriveKey: string; name: string }
// version: the Nomad version the Device runs, written by that Device (absent on older versions).
export interface VaultDevice { key: string; name: string; platform: string; addedAt?: string; spaces?: DeviceSpace[]; version?: string }
// movedTo: the Space's Root Drive got a new key; this record only points at it.
export interface VaultSpace { rootDriveKey: string; name: string; icon?: string; color?: string; movedTo?: string }
// Replication state of one Autobase (the Vault, or a Space Root Drive). `loaded: false` means
// this phone hasn't opened it yet, so the rest is unknown.
export interface DriveSync {
  key: string
  loaded: boolean
  writable?: boolean
  peers?: number
  length?: number
  remoteLength?: number
  driveCount?: number | null
  error?: string // the drive's last error this session; it closed and is opened again on the next read
  errorAt?: number
}
export interface SyncStatus { connections: number; vault: DriveSync; spaces: DriveSync[] }
export interface VaultMsg {
  reqId: string
  hasVault: boolean
  opening?: boolean // paired, but the Vault base is still opening/replicating
  vaultKey?: string
  thisDeviceKey?: string | null
  removed?: boolean // this device was removed from the Vault on another device
  devices?: VaultDevice[]
  spaces?: VaultSpace[]
  writable?: boolean
  sync?: SyncStatus
  connectedDevices?: string[] // Vault writer keys of the Devices connected to this phone right now
  message?: string
}

// previous: the last session's lines, sent only when asked for.
export interface LogsMsg { reqId?: string; ok: boolean; entries: LogEntry[]; previous?: LogEntry[]; message?: string }

export interface BackendHandlers {
  onStatus: (msg: StatusMsg) => void
  onContent: (msg: ContentMsg) => void
  onError: (msg: ErrorMsg) => void
}

export interface Backend {
  open: (tabId: string, url: string, driveType: DriveType, ns?: string, detect?: boolean) => void
  close: (driveType: DriveType, key?: string) => void
  create: (type: DriveType, title: string, description?: string) => Promise<CreatedMsg>
  pair: (code: string, name?: string) => Promise<PairedMsg>
  // ownSpaces: this phone's Spaces, written to its own Device record when they changed.
  vaultStatus: (spaceKeys?: string[], ownSpaces?: DeviceSpace[]) => Promise<VaultMsg>
  renameDevice: (deviceKey: string, name: string) => Promise<VaultMsg>
  removeDevice: (deviceKey: string, self?: boolean) => Promise<VaultMsg>
  addVaultSpace: (space: { rootDriveKey: string; name: string; icon?: string; color?: string }) => Promise<VaultMsg>
  spaceDrives: (rootDriveKey: string, ns?: string) => Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>
  addSpaceDrive: (rootDriveKey: string, ns: string | undefined, key: string, type?: DriveType) => Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>
  bookmarksList: (rootDriveKey: string, ns?: string) => Promise<BookmarksMsg>
  bookmarkAdd: (rootDriveKey: string, ns: string | undefined, href: string, title: string) => Promise<BookmarksMsg>
  bookmarkRemove: (rootDriveKey: string, ns: string | undefined, href: string) => Promise<BookmarksMsg>
  // addBookmark: also write a bookmark for it — desktop only shows a pin that has one.
  bookmarkPin: (rootDriveKey: string, ns: string | undefined, href: string, title: string, addBookmark: boolean) => Promise<BookmarksMsg>
  bookmarkUnpin: (rootDriveKey: string, ns: string | undefined, href: string) => Promise<BookmarksMsg>
  hosting: (action: 'get' | 'set' | 'count' | 'settings', opts?: { driveType?: DriveType; key?: string; on?: boolean; dailyLimitMB?: number }) => Promise<HostingMsg>
  // The backend's log lines with id > since (and the previous session's, with `previous`).
  logs: (since?: number, previous?: boolean) => Promise<LogsMsg>
  fsList: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  fsRead: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  fsWrite: (driveType: DriveType, key: string, ns: string, path: string, base64: string) => Promise<FsResult>
  fsDelete: (driveType: DriveType, key: string, ns: string, path: string, isDir: boolean) => Promise<FsResult>
  fsRename: (driveType: DriveType, key: string, ns: string, from: string, to: string, isDir: boolean) => Promise<FsResult>
  fsMkdir: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  nomad: (payload: NomadCall) => Promise<NomadResult>
  apps: <T = unknown>(app: AppName, action: string, args?: Record<string, unknown>) => Promise<AppsResult<T>>
  aiChat: (messages: unknown[], opts: Record<string, unknown>, handlers: AiChatHandlers) => AiChatHandle
  // Call `listener` whenever the Vault changes, here or on another Device (RPC_VAULT_CHANGED).
  // Returns the function that stops it. The same function on every render.
  onVaultChange: (listener: () => void) => () => void
}

// The phone's Reader, Notes and Names (ADR-0017, ADR-0018), and open tabs (shared/open-tabs.mjs).
// `noVault`: this phone isn't linked, so there's no data.
export type AppName = 'reader' | 'notes' | 'names' | 'tabs'
export interface AppsResult<T = unknown> { ok: boolean; value?: T; noVault?: boolean; message?: string }
// title and snippet are worked out by the backend (shared/vault-apps.mjs); they aren't stored.
// conflictOf: this Note is a conflict copy of that one (two Devices edited it at once).
// space: the Space's key when the note is kept only in that Space (ADR-0029), else null.
export interface Note { type: 'nomad/note'; id: string; body: string; createdAt: string; updatedAt: string; title: string; snippet: string; conflictOf?: string; space?: string | null }
export interface ReaderState { follows: string[]; read: string[]; writable: boolean }
export interface FeedPost { title: string; summary: string; tags: string[]; createdAt: string; url: string; feedUrl: string; feedTitle: string }
export interface Feed { url: string; title: string; posts: FeedPost[] }
// A short name the user gave a drive or URL (shared/names.mjs). auto: the AI gave it and the user
// hasn't kept it yet.
// space: the Space's key for a name kept only in that Space (ADR-0029), else null. hidden: a Space
// name the user's own name with the same word hides.
export interface NameRecord { name: string; url: string; title: string; auto?: boolean; createdAt: string; updatedAt: string; space?: string | null; hidden?: boolean }
// approved: the user's own name for the page, shown in the address bar. named: every name that
// points to it. suggested: a name to offer for its title.
export interface NamesForUrl { approved: NameRecord | null; named: NameRecord[]; suggested: string; writable: boolean }

// An in-page nomad.* call forwarded from a drive WebView (see NOMAD_SHIM).
export interface NomadCall { id?: string; api: string; method: string; url?: string | null; args?: unknown[] }
export interface NomadResult { ok: boolean; value?: unknown; error?: string }

// Streaming nomad.ai.chat() — runs on a remote AI Provider over the Bridge (ADR-0013). Unlike the
// single-reply calls above it delivers many events until onDone/onError; cancel() aborts the turn.
export interface AiChatHandlers {
  onChunk?: (text: string) => void
  onTool?: (event: unknown) => void
  onReasoning?: (text: string) => void // the model's reasoning, streamed (desktop Providers since this release)
  onPrompt?: (permission: string) => boolean | Promise<boolean> // relayed modifyDrive consent
  onDone?: () => void
  onError?: (message: string) => void
}
export interface AiChatHandle { cancel: () => void }

// Boots the Bare worklet (the P2P backend) once and wires up RPC. The returned
// `open`/`close` functions post commands to the backend; responses are routed
// back through the latest `handlers` via a ref so the worklet only starts once.
export function useBackend (handlers: BackendHandlers): Backend {
  const rpcRef = useRef<any>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  // reqId -> resolver for in-flight create()/pair()/vaultStatus() calls
  const pending = useRef<Record<string, (msg: any) => void>>({})
  // reqId -> streaming AI event sink (many RPC_AI_EVENT frames per turn; see aiChat)
  const aiStreams = useRef<Record<string, (msg: any) => void>>({})
  // Keep-alive: how many things currently need the backend to go on running while the app is
  // backgrounded, and the worklet they need kept awake. Only AI turns take a hold today.
  const awakeHolds = useRef(0)
  const workletRef = useRef<any>(null)
  const vaultListeners = useRef(new Set<() => void>())
  const onVaultChange = useRef((listener: () => void) => {
    vaultListeners.current.add(listener)
    return () => { vaultListeners.current.delete(listener) }
  }).current

  useEffect(() => {
    const worklet = new Worklet()
    const w = worklet as any
    workletRef.current = worklet
    // react-native-bare-kit registers its OWN AppState listener at import time, which suspends the
    // worklet on every 'background' transition. That parks the Bare event loop, so the Hyperswarm
    // connection to the AI Provider stalls and an in-flight turn dies the moment the user switches
    // away — the "AI disconnects in the background" symptom. That listener reaches the worklet
    // through its instance update(), so shadowing update() suppresses the suspend at the source
    // instead of racing to resume after it. With no holds the original behaviour runs untouched,
    // so an idle app still sleeps as it should.
    const suspendOnBackground = w.update.bind(worklet)
    w.update = (state?: AppStateStatus) => {
      if (state === 'background' && awakeHolds.current > 0) return
      return suspendOnBackground(state)
    }
    // Belt and braces: if anything else suspends the worklet (a state we didn't see, a future
    // bare-kit change), a hold still gets it running again on the next AppState change.
    const appStateSub = AppState.addEventListener('change', () => {
      if (awakeHolds.current > 0 && w.suspended) {
        try { worklet.resume() } catch {}
      }
    })
    // Pass the document directory so the backend has somewhere to store cores.
    worklet.start('/app.bundle', bundle, [Paths.document.uri])

    const { IPC } = worklet
    const rpc = new RPC(IPC, (req: any) => {
      let msg: any
      try {
        msg = JSON.parse(b4a.toString(req.data))
      } catch {
        return
      }
      const h = handlersRef.current
      if (req.command === RPC_STATUS) h.onStatus(msg)
      else if (req.command === RPC_CONTENT) h.onContent(msg)
      else if (req.command === RPC_ERROR) h.onError(msg)
      else if (req.command === RPC_VAULT_CHANGED) {
        for (const listener of [...vaultListeners.current]) listener()
      }
      else if (req.command === RPC_AI_EVENT) {
        // Streaming: many frames per reqId, so the sink stays registered until it sees done|error.
        aiStreams.current[msg.reqId]?.(msg)
      }
      else if (req.command === RPC_CREATED || req.command === RPC_PAIRED || req.command === RPC_VAULT || req.command === RPC_FS_RESULT || req.command === RPC_SPACE_DRIVES_RESULT || req.command === RPC_BOOKMARKS_RESULT || req.command === RPC_HOSTING_RESULT || req.command === RPC_NOMAD_RESULT || req.command === RPC_APPS_RESULT || req.command === RPC_LOGS_RESULT) {
        pending.current[msg.reqId]?.(msg)
        delete pending.current[msg.reqId]
      }
    })
    rpcRef.current = rpc

    return () => {
      appStateSub.remove()
      if (typeof worklet.terminate === 'function') worklet.terminate()
    }
  }, [])

  // Shared request/response helper for the file-system ops: register a resolver
  // by reqId, send, and resolve when the matching RPC_FS_RESULT comes back.
  function fsCall (command: number, payload: Record<string, unknown>): Promise<FsResult> {
    return new Promise<FsResult>((resolve) => {
      const rpc = rpcRef.current
      if (!rpc) return resolve({ ok: false, message: 'backend not ready' })
      const reqId = `f_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        if (pending.current[reqId]) {
          delete pending.current[reqId]
          resolve({ ok: false, message: 'Backend did not respond. Rebuild the app backend (npm run bundle) and restart.' })
        }
      }, 15000)
      pending.current[reqId] = (msg: FsResult) => { clearTimeout(timer); resolve(msg) }
      const req = rpc.request(command)
      req.send(b4a.from(JSON.stringify({ reqId, ...payload })))
    })
  }

  // An in-page nomad.* call from a drive WebView: forward to the backend and
  // resolve with its reply ({ ok, value | error }). Always resolves so the caller
  // can hand the result straight back into the WebView.
  function nomadCall (payload: NomadCall): Promise<NomadResult> {
    return new Promise<NomadResult>((resolve) => {
      const rpc = rpcRef.current
      if (!rpc) return resolve({ ok: false, error: 'backend not ready' })
      const reqId = `bk_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        if (pending.current[reqId]) { delete pending.current[reqId]; resolve({ ok: false, error: 'backend did not respond' }) }
      }, 15000)
      pending.current[reqId] = (msg: NomadResult) => { clearTimeout(timer); resolve(msg) }
      const req = rpc.request(RPC_NOMAD)
      req.send(b4a.from(JSON.stringify({ reqId, ...payload })))
    })
  }

  // A Reader, Notes or Names call. Always resolves, so screens can show `message` instead of catching.
  // Opening a Feed may wait on the swarm (both drive types, ~15 s each), so it gets longer.
  function appsCall<T> (app: AppName, action: string, args: Record<string, unknown> = {}): Promise<AppsResult<T>> {
    return new Promise<AppsResult<T>>((resolve) => {
      const rpc = rpcRef.current
      if (!rpc) return resolve({ ok: false, message: 'backend not ready' })
      const reqId = `ap_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        if (pending.current[reqId]) { delete pending.current[reqId]; resolve({ ok: false, message: 'backend did not respond' }) }
      }, action === 'feed' ? 45000 : 15000)
      pending.current[reqId] = (msg: AppsResult<T>) => { clearTimeout(timer); resolve(msg) }
      const req = rpc.request(RPC_APPS)
      req.send(b4a.from(JSON.stringify({ reqId, app, action, ...args })))
    })
  }

  // Take a keep-awake hold on the backend (and, on Android, on the foreground service that stops
  // the OS freezing the process). Returns the release; it is safe to call more than once. Releasing
  // the LAST hold while the app is already in the background suspends the worklet there and then —
  // without that, work started in the foreground would leave the backend running until the user
  // came back, since nothing else re-checks AppState in between.
  function acquireAwake (): () => void {
    awakeHolds.current++
    const releaseService = holdForAiTurn()
    let released = false
    return () => {
      if (released) return
      released = true
      awakeHolds.current = Math.max(0, awakeHolds.current - 1)
      releaseService()
      const worklet = workletRef.current
      if (awakeHolds.current === 0 && worklet && !worklet.suspended && AppState.currentState !== 'active') {
        try { worklet.update('background') } catch {}
      }
    }
  }

  // Streaming nomad.ai.chat(). Registers a sink by reqId, forwards each frame to the handlers, and
  // clears on done|error. Uses an IDLE (heartbeat) timeout — reset on every frame — not the fixed
  // 15s the request/response calls use, since a turn legitimately runs much longer than any single
  // gap between tokens (ADR-0013 §5d).
  function aiChat (messages: unknown[], opts: Record<string, unknown>, h: AiChatHandlers): AiChatHandle {
    const rpc = rpcRef.current
    const reqId = `ai_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    if (!rpc) { h.onError?.('backend not ready'); return { cancel () {} } }

    // A turn can legitimately run for minutes (model load, tool round-trips) and the user will
    // background the app mid-answer, so hold the backend awake until it settles.
    const releaseHold = acquireAwake()

    let idle: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(idle); delete aiStreams.current[reqId]; releaseHold() }
    const armIdle = () => {
      clearTimeout(idle)
      idle = setTimeout(() => { cleanup(); h.onError?.('AI stream timed out') }, 60000)
    }

    aiStreams.current[reqId] = (msg: any) => {
      armIdle()
      if (msg.kind === 'chunk') h.onChunk?.(msg.text)
      else if (msg.kind === 'tool') h.onTool?.(msg.event)
      else if (msg.kind === 'reasoning') h.onReasoning?.(msg.text)
      else if (msg.kind === 'prompt') {
        Promise.resolve(h.onPrompt ? h.onPrompt(msg.permission) : false).then((allow) => {
          const r = rpc.request(RPC_AI_PROMPT_RESULT)
          r.send(b4a.from(JSON.stringify({ reqId, allow: !!allow })))
        })
      }
      else if (msg.kind === 'done') { cleanup(); h.onDone?.() }
      else if (msg.kind === 'error') { cleanup(); h.onError?.(msg.message || 'AI error') }
    }
    armIdle()
    const req = rpc.request(RPC_AI_CHAT)
    req.send(b4a.from(JSON.stringify({ reqId, messages, opts: opts || {} })))

    return {
      cancel () {
        const r = rpc.request(RPC_AI_CANCEL)
        r.send(b4a.from(JSON.stringify({ reqId })))
        cleanup()
      }
    }
  }

  return {
    nomad: (payload) => nomadCall(payload),
    logs (since = 0, previous = false) {
      return new Promise<LogsMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ ok: false, entries: [], message: 'backend not ready' })
        const reqId = `lg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        const timer = setTimeout(() => {
          if (pending.current[reqId]) { delete pending.current[reqId]; resolve({ ok: false, entries: [], message: 'backend did not respond' }) }
        }, 5000)
        pending.current[reqId] = (msg: LogsMsg) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_LOGS)
        req.send(b4a.from(JSON.stringify({ reqId, since, previous })))
      })
    },
    apps: (app, action, args) => appsCall(app, action, args),
    onVaultChange,
    aiChat: (messages, opts, handlers) => aiChat(messages, opts, handlers),
    fsList: (driveType, key, ns, path) => fsCall(RPC_FS_LIST, { driveType, key, ns, path }),
    fsRead: (driveType, key, ns, path) => fsCall(RPC_FS_READ, { driveType, key, ns, path }),
    fsWrite: (driveType, key, ns, path, base64) => fsCall(RPC_FS_WRITE, { driveType, key, ns, path, base64 }),
    fsDelete: (driveType, key, ns, path, isDir) => fsCall(RPC_FS_DELETE, { driveType, key, ns, path, isDir }),
    fsRename: (driveType, key, ns, from, to, isDir) => fsCall(RPC_FS_RENAME, { driveType, key, ns, from, to, isDir }),
    fsMkdir: (driveType, key, ns, path) => fsCall(RPC_FS_MKDIR, { driveType, key, ns, path }),
    spaceDrives (rootDriveKey, ns) {
      return new Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ ok: false, drives: [], message: 'backend not ready' })
        const reqId = `sd_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        // Don't hang if the backend predates RPC_SPACE_DRIVES (rebuild with npm run bundle). The
        // limit must outlast a cold open of a shared space's Root Drive: swarm join, up to 15 s of
        // replication (AUTOBASE_LOAD_TIMEOUT), then the registry's own retries. A shorter limit
        // drops the real answer and the Library stays empty.
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ ok: false, drives: [], message: 'backend did not respond' })
          }
        }, 45000)
        pending.current[reqId] = (msg: any) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_SPACE_DRIVES)
        req.send(b4a.from(JSON.stringify({ reqId, rootDriveKey, ns })))
      })
    },
    addSpaceDrive (rootDriveKey, ns, key, type) {
      return new Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ ok: false, drives: [], message: 'backend not ready' })
        const reqId = `ad_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ ok: false, drives: [], message: 'backend did not respond' })
          }
        }, 12000)
        pending.current[reqId] = (msg: any) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_SPACE_ADD_DRIVE)
        req.send(b4a.from(JSON.stringify({ reqId, rootDriveKey, ns, key, type })))
      })
    },
    open (tabId, url, driveType, ns, detect = true) {
      const rpc = rpcRef.current
      if (!rpc) return
      const req = rpc.request(RPC_OPEN)
      req.send(b4a.from(JSON.stringify({ tabId, url, driveType, ns, detect })))
    },
    close (driveType, key) {
      const rpc = rpcRef.current
      if (!rpc || !key) return
      const req = rpc.request(RPC_CLOSE)
      req.send(b4a.from(JSON.stringify({ driveType, key })))
    },
    create (type, title, description = '') {
      return new Promise<CreatedMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', ok: false, message: 'backend not ready' })
        const reqId = `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        pending.current[reqId] = resolve
        const req = rpc.request(RPC_CREATE)
        req.send(b4a.from(JSON.stringify({ reqId, type, title, description })))
      })
    },
    pair (code, name) {
      return new Promise<PairedMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', ok: false, message: 'backend not ready' })
        const reqId = `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        // Pairing needs the other device to approve, so allow generous time — but don't spin
        // forever if approval/confirmation never arrives.
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ reqId, ok: false, message: 'Timed out waiting for approval. Make sure both devices are online, then try again.' })
          }
        }, 120000)
        pending.current[reqId] = (msg: PairedMsg) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_PAIR_SUBMIT)
        req.send(b4a.from(JSON.stringify({ reqId, code, name })))
      })
    },
    vaultStatus (spaceKeys = [], ownSpaces) {
      return new Promise<VaultMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', hasVault: false, message: 'backend not ready' })
        const reqId = `v_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        // Don't hang forever if the backend doesn't reply (e.g. an old app.bundle.mjs that predates
        // RPC_VAULT_STATUS — rebuild with `npm run bundle`). Surface an error instead.
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ reqId, hasVault: false, message: 'Backend did not respond. Rebuild the app backend (npm run bundle) and restart.' })
          }
        }, 10000)
        pending.current[reqId] = (msg: VaultMsg) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_VAULT_STATUS)
        // ownVersion: what the phone runs, for its own Device record (null in Expo Go / iOS).
        req.send(b4a.from(JSON.stringify({ reqId, spaceKeys, ownSpaces, ownVersion: currentVersion() })))
      })
    },
    renameDevice (deviceKey, name) {
      return new Promise<VaultMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', hasVault: false, message: 'backend not ready' })
        const reqId = `r_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        pending.current[reqId] = resolve
        const req = rpc.request(RPC_RENAME_DEVICE)
        req.send(b4a.from(JSON.stringify({ reqId, deviceKey, name })))
      })
    },
    removeDevice (deviceKey, self = false) {
      return new Promise<VaultMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', hasVault: false, message: 'backend not ready' })
        const reqId = `rd_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ reqId, hasVault: !self, message: 'backend did not respond' })
          }
        }, 15000)
        pending.current[reqId] = (msg: VaultMsg) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_REMOVE_DEVICE)
        req.send(b4a.from(JSON.stringify({ reqId, deviceKey, self })))
      })
    },
    addVaultSpace ({ rootDriveKey, name, icon, color }) {
      return new Promise<VaultMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ reqId: '', hasVault: false, message: 'backend not ready' })
        const reqId = `as_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        pending.current[reqId] = resolve
        const req = rpc.request(RPC_VAULT_ADD_SPACE)
        req.send(b4a.from(JSON.stringify({ reqId, rootDriveKey, name, icon, color })))
      })
    },
    bookmarksList: (rootDriveKey, ns) => bmCall({ action: 'list', rootDriveKey, ns }),
    bookmarkAdd: (rootDriveKey, ns, href, title) => bmCall({ action: 'add', rootDriveKey, ns, href, title }),
    bookmarkRemove: (rootDriveKey, ns, href) => bmCall({ action: 'remove', rootDriveKey, ns, href }),
    bookmarkPin: (rootDriveKey, ns, href, title, addBookmark) => bmCall({ action: 'pin', rootDriveKey, ns, href, title, addBookmark }),
    bookmarkUnpin: (rootDriveKey, ns, href) => bmCall({ action: 'unpin', rootDriveKey, ns, href }),
    // Query/toggle hosting (seeding) a drive — desktop's "Host This Hyperdrive" — and
    // read/write the daily hosting budget ('settings' with dailyLimitMB, 0 = unlimited).
    hosting (action, opts = {}) {
      return new Promise<HostingMsg>((resolve) => {
        const rpc = rpcRef.current
        if (!rpc) return resolve({ ok: false, message: 'backend not ready' })
        const reqId = `h_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        const timer = setTimeout(() => {
          if (pending.current[reqId]) { delete pending.current[reqId]; resolve({ ok: false, message: 'backend did not respond' }) }
        }, 12000)
        pending.current[reqId] = (msg: any) => { clearTimeout(timer); resolve(msg) }
        const req = rpc.request(RPC_HOSTING)
        req.send(b4a.from(JSON.stringify({ reqId, action, ...opts })))
      })
    }
  }

  function bmCall (payload: { action: string; rootDriveKey: string; ns?: string; href?: string; title?: string; addBookmark?: boolean }) {
    return new Promise<BookmarksMsg>((resolve) => {
      const rpc = rpcRef.current
      if (!rpc) return resolve({ ok: false, bookmarks: [], message: 'backend not ready' })
      const reqId = `bm_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const timer = setTimeout(() => {
        if (pending.current[reqId]) { delete pending.current[reqId]; resolve({ ok: false, bookmarks: [], message: 'backend did not respond' }) }
      }, 12000)
      pending.current[reqId] = (msg: any) => { clearTimeout(timer); resolve(msg) }
      const req = rpc.request(RPC_BOOKMARKS)
      req.send(b4a.from(JSON.stringify({ reqId, ...payload })))
    })
  }
}
