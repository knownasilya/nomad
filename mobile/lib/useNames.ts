import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Backend, NameRecord, NamesForUrl } from './useBackend'

// The user's names (ADR-0018): short words for drives and URLs, kept in the Vault so every Device
// has them. The backend reads and writes the records with the shared rules (shared/names.mjs); this
// side only asks. Desktop and other Devices change names while the phone is away, so the looked-up
// state refreshes whenever the app comes back to the foreground, and after the phone saves a name.

// How long a navigation waits to learn whether the address is a name before it goes on as typed.
const RESOLVE_WAIT_MS = 1500

// An address that could be a name: a bare word ("blog") or hyper://<word>/…, but not a drive key.
export function mayBeName (input: string): boolean {
  const s = (input || '').trim()
  const m = /^(?:hyper:\/\/)?([a-z0-9-]+)(?:\/?$|[/?#])/i.exec(s)
  if (!m) return false
  if (!s.toLowerCase().startsWith('hyper://') && !/^[a-z0-9-]+\/?$/i.test(s)) return false
  return m[1].length !== 64 && m[1].length !== 52
}

export function useNames (apps: Backend['apps']) {
  // backend.apps is a new function on every parent render; calling through a ref keeps the
  // callbacks and effects below stable.
  const appsRef = useRef(apps)
  appsRef.current = apps
  const [version, setVersion] = useState(0)
  const changed = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') changed() })
    return () => sub.remove()
  }, [changed])

  // Where a navigation to `input` should go: the named address, or `input` itself. Never stalls a
  // navigation for long, and never fails it.
  const resolve = useCallback((input: string): Promise<string> => {
    if (!mayBeName(input)) return Promise.resolve(input)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(input), RESOLVE_WAIT_MS)
      appsRef.current<string | null>('names', 'resolve', { input }).then((r) => {
        clearTimeout(timer)
        resolve(r.ok && r.value ? r.value : input)
      })
    })
  }, [])

  const forUrl = useCallback((url: string, title = '') =>
    appsRef.current<NamesForUrl>('names', 'forUrl', { url, title }), [])

  const set = useCallback(async (rec: { name: string; url: string; title: string; previous?: string }) => {
    const r = await appsRef.current<NameRecord>('names', 'set', rec)
    if (r.ok) changed()
    return r
  }, [changed])

  const remove = useCallback(async (name: string) => {
    const r = await appsRef.current('names', 'remove', { name })
    if (r.ok) changed()
    return r
  }, [changed])

  const match = useCallback((query: string) =>
    appsRef.current<NameRecord[]>('names', 'match', { query, limit: 5 }), [])

  return { version, changed, resolve, forUrl, set, remove, match }
}

export type Names = ReturnType<typeof useNames>

// The names for the page at `url` (null while loading, or when the phone isn't linked). The address
// bar shows `approved`.
export function useNamesForUrl (names: Names, url: string, enabled: boolean): NamesForUrl | null {
  const [info, setInfo] = useState<{ url: string; value: NamesForUrl } | null>(null)
  useEffect(() => {
    if (!enabled || !url) return
    let cancelled = false
    names.forUrl(url).then((r) => {
      if (!cancelled) setInfo(r.ok && r.value ? { url, value: r.value } : null)
    })
    return () => { cancelled = true }
  }, [names.forUrl, names.version, url, enabled])
  return enabled && info && info.url === url ? info.value : null
}

// The names that match what's typed in the address bar.
export function useNameMatches (names: Names, query: string): NameRecord[] {
  const [found, setFound] = useState<{ query: string; value: NameRecord[] }>({ query: '', value: [] })
  const q = query.trim()
  useEffect(() => {
    if (!q) return
    let cancelled = false
    names.match(q).then((r) => {
      if (!cancelled) setFound({ query: q, value: r.ok && Array.isArray(r.value) ? r.value : [] })
    })
    return () => { cancelled = true }
  }, [names.match, names.version, q])
  return q && found.query === q ? found.value : []
}
