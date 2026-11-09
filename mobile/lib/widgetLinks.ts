// The home screen search widget's taps (modules/nomad-search-widget). Each opens the app with a
// nomad-widget:// link, sent only to Nomad's own activity:
//   nomad-widget://search            a new tab, ready to type, in the active Space
//   nomad-widget://search?space=<id> the same, in that Space (the tall widget's Space chips)
//   nomad-widget://spaces            the Space switcher
//   nomad-widget://ai                the AI panel
// Tests: tests/unit/mobile-widget-links.test.js.

export type WidgetLink =
  | { action: 'search'; space?: string }
  | { action: 'spaces' }
  | { action: 'ai' }

const LINK = /^nomad-widget:\/\/([a-z]+)\/?(?:\?(.*))?$/i

export function isWidgetLink (url: string | null | undefined): boolean {
  return !!url && /^nomad-widget:/i.test(url)
}

export function parseWidgetLink (url: string | null | undefined): WidgetLink | null {
  const m = url ? LINK.exec(url.trim()) : null
  if (!m) return null
  switch (m[1].toLowerCase()) {
    case 'search': {
      let space: string | undefined
      for (const part of (m[2] || '').split('&')) {
        const eq = part.indexOf('=')
        if (eq < 0 || part.slice(0, eq) !== 'space') continue
        try { space = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')) || undefined } catch {}
      }
      return space ? { action: 'search', space } : { action: 'search' }
    }
    case 'spaces':
      return { action: 'spaces' }
    case 'ai':
      return { action: 'ai' }
    default:
      return null
  }
}

export const WIDGET_NAME_MAX = 40

// What the widget draws: each Space's id, name and color, and the active one. Only what it needs,
// so no drive key or namespace leaves the app for the launcher's process.
export function widgetState (spaces: Array<{ id: string; name: string; color: string }>, activeId: string): string {
  return JSON.stringify({
    spaces: spaces.map((s) => ({ id: s.id, name: (s.name || 'Space').trim().slice(0, WIDGET_NAME_MAX), color: s.color })),
    active: activeId
  })
}
