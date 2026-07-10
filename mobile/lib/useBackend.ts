import { useEffect, useRef } from 'react'
import { Worklet } from 'react-native-bare-kit'
import { Paths } from 'expo-file-system'
import RPC from 'bare-rpc'
import b4a from 'b4a'

import bundle from '../app/app.bundle.mjs'
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
  RPC_NOMAD,
  RPC_NOMAD_RESULT,
  RPC_AI_CHAT,
  RPC_AI_CANCEL,
  RPC_AI_PROMPT_RESULT,
  RPC_AI_EVENT
} from '../rpc-commands.mjs'

export interface Bookmark { href: string; title: string; createdAt?: string }
export interface BookmarksMsg { reqId?: string; ok: boolean; bookmarks: Bookmark[]; message?: string }
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

export interface VaultDevice { key: string; name: string; platform: string; addedAt?: string }
export interface VaultSpace { rootDriveKey: string; name: string; icon?: string; color?: string }
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
  message?: string
}

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
  vaultStatus: () => Promise<VaultMsg>
  renameDevice: (deviceKey: string, name: string) => Promise<VaultMsg>
  removeDevice: (deviceKey: string, self?: boolean) => Promise<VaultMsg>
  addVaultSpace: (space: { rootDriveKey: string; name: string; icon?: string; color?: string }) => Promise<VaultMsg>
  spaceDrives: (rootDriveKey: string, ns?: string) => Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>
  addSpaceDrive: (rootDriveKey: string, ns: string | undefined, key: string, type?: DriveType) => Promise<{ ok: boolean; drives: Array<{ key: string; type?: DriveType; tags?: string[] }>; message?: string }>
  bookmarksList: (rootDriveKey: string, ns?: string) => Promise<BookmarksMsg>
  bookmarkAdd: (rootDriveKey: string, ns: string | undefined, href: string, title: string) => Promise<BookmarksMsg>
  bookmarkRemove: (rootDriveKey: string, ns: string | undefined, href: string) => Promise<BookmarksMsg>
  fsList: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  fsRead: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  fsWrite: (driveType: DriveType, key: string, ns: string, path: string, base64: string) => Promise<FsResult>
  fsDelete: (driveType: DriveType, key: string, ns: string, path: string, isDir: boolean) => Promise<FsResult>
  fsRename: (driveType: DriveType, key: string, ns: string, from: string, to: string, isDir: boolean) => Promise<FsResult>
  fsMkdir: (driveType: DriveType, key: string, ns: string, path: string) => Promise<FsResult>
  nomad: (payload: NomadCall) => Promise<NomadResult>
  aiChat: (messages: unknown[], opts: Record<string, unknown>, handlers: AiChatHandlers) => AiChatHandle
}

// An in-page nomad.* call forwarded from a drive WebView (see NOMAD_SHIM).
export interface NomadCall { id?: string; api: string; method: string; url?: string | null; args?: unknown[] }
export interface NomadResult { ok: boolean; value?: unknown; error?: string }

// Streaming nomad.ai.chat() — runs on a remote AI Provider over the Bridge (ADR-0013). Unlike the
// single-reply calls above it delivers many events until onDone/onError; cancel() aborts the turn.
export interface AiChatHandlers {
  onChunk?: (text: string) => void
  onTool?: (event: unknown) => void
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

  useEffect(() => {
    const worklet = new Worklet()
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
      else if (req.command === RPC_AI_EVENT) {
        // Streaming: many frames per reqId, so the sink stays registered until it sees done|error.
        aiStreams.current[msg.reqId]?.(msg)
      }
      else if (req.command === RPC_CREATED || req.command === RPC_PAIRED || req.command === RPC_VAULT || req.command === RPC_FS_RESULT || req.command === RPC_SPACE_DRIVES_RESULT || req.command === RPC_BOOKMARKS_RESULT || req.command === RPC_NOMAD_RESULT) {
        pending.current[msg.reqId]?.(msg)
        delete pending.current[msg.reqId]
      }
    })
    rpcRef.current = rpc

    return () => {
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

  // Streaming nomad.ai.chat(). Registers a sink by reqId, forwards each frame to the handlers, and
  // clears on done|error. Uses an IDLE (heartbeat) timeout — reset on every frame — not the fixed
  // 15s the request/response calls use, since a turn legitimately runs much longer than any single
  // gap between tokens (ADR-0013 §5d).
  function aiChat (messages: unknown[], opts: Record<string, unknown>, h: AiChatHandlers): AiChatHandle {
    const rpc = rpcRef.current
    const reqId = `ai_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    if (!rpc) { h.onError?.('backend not ready'); return { cancel () {} } }

    let idle: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(idle); delete aiStreams.current[reqId] }
    const armIdle = () => {
      clearTimeout(idle)
      idle = setTimeout(() => { cleanup(); h.onError?.('AI stream timed out') }, 60000)
    }

    aiStreams.current[reqId] = (msg: any) => {
      armIdle()
      if (msg.kind === 'chunk') h.onChunk?.(msg.text)
      else if (msg.kind === 'tool') h.onTool?.(msg.event)
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
        // Don't hang if the backend predates RPC_SPACE_DRIVES (rebuild with npm run bundle).
        const timer = setTimeout(() => {
          if (pending.current[reqId]) {
            delete pending.current[reqId]
            resolve({ ok: false, drives: [], message: 'backend did not respond' })
          }
        }, 12000)
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
    vaultStatus () {
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
        req.send(b4a.from(JSON.stringify({ reqId })))
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
    bookmarkRemove: (rootDriveKey, ns, href) => bmCall({ action: 'remove', rootDriveKey, ns, href })
  }

  function bmCall (payload: { action: string; rootDriveKey: string; ns?: string; href?: string; title?: string }) {
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
