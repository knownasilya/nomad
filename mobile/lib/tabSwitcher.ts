import { useSyncExternalStore } from 'react'

// The tab grid (app/tabs.tsx) is its own stack route, but the tabs live in the browser screen's
// state (app/index.tsx), which stays mounted under it. This store carries what the grid shows across
// the route boundary: the browser publishes a snapshot of its tabs and registers the actions; the
// grid reads the snapshot and calls the actions.

export interface TabThumb {
  uri: string // data:image/jpeg URL of the tab's content area
  aspect: number // width / height of that capture
}

export interface TabCard {
  id: string
  title: string
  url: string
  kind: 'home' | 'web' | 'hyper'
  loading: boolean
  thumb?: TabThumb
  icon?: string // the site's favicon, if this phone has seen it
}

export interface TabSnapshot {
  tabs: TabCard[]
  activeId: string
  spaceName: string
  spaceColor: string
}

export interface TabActions {
  select: (id: string) => void
  close: (id: string) => void
  open: () => void
  closeAll: () => void
}

let snapshot: TabSnapshot = { tabs: [], activeId: '', spaceName: '', spaceColor: '' }
let actions: TabActions | null = null
const listeners = new Set<() => void>()

export function publishTabs (next: TabSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function setTabActions (next: TabActions | null) {
  actions = next
}

export function tabActions (): TabActions | null {
  return actions
}

function subscribe (listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTabSnapshot (): TabSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}
