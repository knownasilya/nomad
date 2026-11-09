import { useEffect, useRef } from 'react'
import native from '../modules/nomad-search-widget'
import { widgetState } from './widgetLinks'

// Keep the home screen search widget's Spaces in step with the app's: their names and colors, and
// which one a search opens in. Writes only when something it shows changed.
export function useSearchWidget (spaces: Array<{ id: string; name: string; color: string }>, activeId: string, ready: boolean) {
  const last = useRef('')
  useEffect(() => {
    if (!native || !ready) return
    const json = widgetState(spaces, activeId)
    if (json === last.current) return
    last.current = json
    try { native.setSpaces(json) } catch {}
  }, [spaces, activeId, ready])
}

// Settings → Add the search widget: the launcher asks where to put it.
export function canAddSearchWidget (): boolean {
  try { return !!native?.canPin() } catch { return false }
}

export function addSearchWidget (): boolean {
  try { return !!native?.requestPin() } catch { return false }
}
