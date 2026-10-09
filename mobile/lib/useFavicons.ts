import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { siteKeyOf } from './hyperUrl'

const FAVICONS_KEY = 'hb:favicons'
const LIMIT = 300 // sites kept; the least recently seen go first

interface Entry { uri: string; ts: number }

// Favicons for shortcuts and tab cards, one per site (siteKeyOf). A page reports its icon after it
// loads (FAVICON_JS in lib/types.ts), so a site gets one once it has been opened on this phone.
// Device-local, and never fetched from a third-party icon service.
export function useFavicons () {
  const [icons, setIcons] = useState<Record<string, Entry>>({})

  useEffect(() => {
    AsyncStorage.getItem(FAVICONS_KEY).then((v) => {
      if (!v) return
      try { setIcons((prev) => ({ ...JSON.parse(v), ...prev })) } catch {}
    }).catch(() => {})
  }, [])

  const remember = useCallback((url: string, uri: string) => {
    const key = siteKeyOf(url)
    if (!key || !uri) return
    setIcons((prev) => {
      if (prev[key]?.uri === uri) return prev
      let next: Record<string, Entry> = { ...prev, [key]: { uri, ts: Date.now() } }
      const keys = Object.keys(next)
      if (keys.length > LIMIT) {
        const keep = keys.sort((a, b) => next[b].ts - next[a].ts).slice(0, LIMIT)
        next = Object.fromEntries(keep.map((k) => [k, next[k]]))
      }
      AsyncStorage.setItem(FAVICONS_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const iconFor = useCallback((url: string): string | undefined => icons[siteKeyOf(url)]?.uri, [icons])

  return { iconFor, remember }
}
