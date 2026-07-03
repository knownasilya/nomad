import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { DriveType } from './hyperUrl'
import type { Backend } from './useBackend'

export interface SavedSite {
  url: string
  title: string
  ts: number
}

export interface SavedDrive {
  url: string // hyper://<key>/
  name: string
  type: DriveType
  ns?: string // set for drives we created (writable)
  ts: number
}

const BOOKMARKS_KEY = 'hb:bookmarks'
const HISTORY_KEY = 'hb:history'
const DRIVES_KEY = 'hb:drives'
const HISTORY_LIMIT = 200

const driveKey = (url: string) => (url.replace('hyper://', '').split('/')[0] || '').toLowerCase()

// Bookmark records from the drive ({href,title,createdAt}) -> SavedSite ({url,title,ts}).
const fromDriveBookmarks = (bms: Array<{ href: string; title: string; createdAt?: string }>): SavedSite[] =>
  bms.map((b) => ({ url: b.href, title: b.title || b.href, ts: b.createdAt ? Date.parse(b.createdAt) : 0 }))

// Bookmarks, browsing history, and the library of known drives (each with its
// drive type, which is fixed when the drive is created). Persisted to
// AsyncStorage; state is held in memory for reactive rendering.
//
// Pass a `spaceId` to scope everything to a Space (keys become e.g. `hb:bookmarks:<id>`); omit it
// for the legacy global behaviour. Switching spaceId reloads that space's data.
export function usePersistence (
  spaceId?: string,
  opts?: { backend?: Backend; rootDriveKey?: string; ns?: string }
) {
  const [bookmarks, setBookmarks] = useState<SavedSite[]>([])
  const [history, setHistory] = useState<SavedSite[]>([])
  const [drives, setDrives] = useState<SavedDrive[]>([])

  const keys = useMemo(() => {
    const suffix = spaceId ? `:${spaceId}` : ''
    return { bookmarks: BOOKMARKS_KEY + suffix, history: HISTORY_KEY + suffix, drives: DRIVES_KEY + suffix }
  }, [spaceId])
  const keysRef = useRef(keys)
  keysRef.current = keys
  const optsRef = useRef(opts)
  optsRef.current = opts
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  // When the space has a Root Drive, bookmarks live there (synced); otherwise they're local.
  const rootDriveKey = opts?.rootDriveKey
  const ns = opts?.ns

  useEffect(() => {
    // Reset so the previous space's data doesn't linger while the new space loads.
    setBookmarks([])
    setHistory([])
    setDrives([])
    // History + the local drive list are always device-local (history isn't synced in nomad).
    AsyncStorage.multiGet([keys.history, keys.drives]).then((pairs) => {
      for (const [key, value] of pairs) {
        if (!value) continue
        try {
          const parsed = JSON.parse(value)
          if (key === keys.history) setHistory(parsed)
          else if (key === keys.drives) setDrives(parsed)
        } catch {}
      }
    })
    // Bookmarks: from the Root Drive when available (synced), else local.
    if (rootDriveKey && optsRef.current?.backend) {
      optsRef.current.backend.bookmarksList(rootDriveKey, ns).then((res) => {
        if (res.ok) setBookmarks(fromDriveBookmarks(res.bookmarks))
      }).catch(() => {})
    } else {
      AsyncStorage.getItem(keys.bookmarks).then((v) => {
        if (v) { try { setBookmarks(JSON.parse(v)) } catch {} }
      })
    }
  }, [keys, rootDriveKey, ns])

  const recordVisit = useCallback((url: string, title: string) => {
    if (!url || url === 'about:home') return
    setHistory((prev) => {
      const next = [{ url, title: title || url, ts: Date.now() }, ...prev.filter((h) => h.url !== url)].slice(0, HISTORY_LIMIT)
      AsyncStorage.setItem(keysRef.current.history, JSON.stringify(next))
      return next
    })
  }, [])

  const toggleBookmark = useCallback((url: string, title: string) => {
    if (!url || url === 'about:home') return
    const o = optsRef.current
    if (o?.rootDriveKey && o.backend) {
      const exists = bookmarksRef.current.some((b) => b.url === url)
      const p = exists
        ? o.backend.bookmarkRemove(o.rootDriveKey, o.ns, url)
        : o.backend.bookmarkAdd(o.rootDriveKey, o.ns, url, title || url)
      p.then((res) => { if (res.ok) setBookmarks(fromDriveBookmarks(res.bookmarks)) }).catch(() => {})
      return
    }
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.url === url)
      const next = exists
        ? prev.filter((b) => b.url !== url)
        : [{ url, title: title || url, ts: Date.now() }, ...prev]
      AsyncStorage.setItem(keysRef.current.bookmarks, JSON.stringify(next))
      return next
    })
  }, [])

  const isBookmarked = useCallback((url: string) => bookmarks.some((b) => b.url === url), [bookmarks])

  const clearHistory = useCallback(() => {
    setHistory([])
    AsyncStorage.setItem(keysRef.current.history, JSON.stringify([]))
  }, [])

  // Remember a drive (and its type). Called when a drive opens, and from the
  // library's "Add drive" form. Keyed by drive key so re-opens just refresh.
  const rememberDrive = useCallback((url: string, name: string, type: DriveType, ns?: string) => {
    const k = driveKey(url)
    if (!k) return
    setDrives((prev) => {
      const root = `hyper://${k}/`
      const rest = prev.filter((d) => driveKey(d.url) !== k)
      const existing = prev.find((d) => driveKey(d.url) === k)
      const next = [{ url: root, name: name || existing?.name || k.slice(0, 6), type, ns: ns ?? existing?.ns, ts: Date.now() }, ...rest]
      AsyncStorage.setItem(keysRef.current.drives, JSON.stringify(next))
      return next
    })
  }, [])

  const removeDrive = useCallback((url: string) => {
    const k = driveKey(url)
    setDrives((prev) => {
      const next = prev.filter((d) => driveKey(d.url) !== k)
      AsyncStorage.setItem(keysRef.current.drives, JSON.stringify(next))
      return next
    })
  }, [])

  // The fixed drive type for a hyper URL, if we already know this drive.
  const driveTypeFor = useCallback(
    (url: string): DriveType | undefined => drives.find((d) => driveKey(d.url) === driveKey(url))?.type,
    [drives]
  )

  // The namespace for a drive we own (so it reopens writable), if any.
  const driveNsFor = useCallback(
    (url: string): string | undefined => drives.find((d) => driveKey(d.url) === driveKey(url))?.ns,
    [drives]
  )

  // URL-bar autocomplete: recently-visited sites + known drives for THIS space (history and drives
  // are both device-local and space-scoped), deduped by URL, filtered by the typed query (matches
  // url or title), most-recent first, capped. On-device only — nothing leaves the phone.
  const suggest = useCallback(
    (query: string, limit = 10): SavedSite[] => {
      const q = query.trim().toLowerCase()
      const byUrl = new Map<string, SavedSite>()
      const add = (url: string, title: string, ts: number) => {
        if (!url || url === 'about:home') return
        const k = url.toLowerCase()
        const prev = byUrl.get(k)
        if (!prev || ts > prev.ts) byUrl.set(k, { url, title: title || url, ts })
      }
      history.forEach((h) => add(h.url, h.title, h.ts))
      drives.forEach((d) => add(d.url, d.name, d.ts || 0))
      let list = [...byUrl.values()]
      // Don't suggest the exact thing already typed; filter the rest by substring match.
      if (q) list = list.filter((it) => it.url.toLowerCase() !== q && (it.url.toLowerCase().includes(q) || it.title.toLowerCase().includes(q)))
      list.sort((a, b) => b.ts - a.ts)
      return list.slice(0, limit)
    },
    [history, drives]
  )

  return {
    bookmarks,
    history,
    drives,
    recordVisit,
    toggleBookmark,
    isBookmarked,
    clearHistory,
    rememberDrive,
    removeDrive,
    driveTypeFor,
    driveNsFor,
    suggest
  }
}
