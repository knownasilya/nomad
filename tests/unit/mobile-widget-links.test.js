// The home screen search widget's links (mobile/lib/widgetLinks.ts): a tap on the widget opens the
// app with one, and the browser opens a new tab, the Space switcher or the AI.

import { describe, it, expect } from 'vitest'
import { parseWidgetLink, isWidgetLink, widgetState, WIDGET_NAME_MAX } from '../../mobile/lib/widgetLinks.ts'

describe('parseWidgetLink', () => {
  it('reads a search in the active Space', () => {
    expect(parseWidgetLink('nomad-widget://search')).toEqual({ action: 'search' })
    expect(parseWidgetLink('nomad-widget://search/')).toEqual({ action: 'search' })
    expect(parseWidgetLink('NOMAD-WIDGET://Search')).toEqual({ action: 'search' })
  })

  it('reads a search in a Space, as Android encodes it', () => {
    expect(parseWidgetLink('nomad-widget://search?space=abc123')).toEqual({ action: 'search', space: 'abc123' })
    expect(parseWidgetLink('nomad-widget://search?space=a%2Fb%20c')).toEqual({ action: 'search', space: 'a/b c' })
    expect(parseWidgetLink('nomad-widget://search?x=1&space=k')).toEqual({ action: 'search', space: 'k' })
    expect(parseWidgetLink('nomad-widget://search?space=')).toEqual({ action: 'search' })
    expect(parseWidgetLink('nomad-widget://search?space=%E0%A4%A')).toEqual({ action: 'search' })
  })

  it('reads the Space switcher and the AI', () => {
    expect(parseWidgetLink('nomad-widget://spaces')).toEqual({ action: 'spaces' })
    expect(parseWidgetLink('nomad-widget://ai')).toEqual({ action: 'ai' })
  })

  it('ignores anything else', () => {
    for (const url of [null, undefined, '', 'nomad-widget://delete', 'nomad-widget:search', 'https://example.com/', 'nomad-invite:AQE', 'nomad-widget://search/../x']) {
      expect(parseWidgetLink(url)).toBe(null)
    }
  })

  it('tells widget links from other links', () => {
    expect(isWidgetLink('nomad-widget://ai')).toBe(true)
    expect(isWidgetLink('nomad-widget://unknown')).toBe(true)
    expect(isWidgetLink('nomad-invite:AQE')).toBe(false)
    expect(isWidgetLink(null)).toBe(false)
  })
})

describe('widgetState', () => {
  it('keeps only what the widget draws', () => {
    const spaces = [
      { id: 'personal', name: 'Personal', color: '#2563eb', rootDriveKey: 'aa', ns: 'secret' },
      { id: 'bb', name: '  Home  ', color: '#16a34a' }
    ]
    expect(JSON.parse(widgetState(spaces, 'bb'))).toEqual({
      spaces: [
        { id: 'personal', name: 'Personal', color: '#2563eb' },
        { id: 'bb', name: 'Home', color: '#16a34a' }
      ],
      active: 'bb'
    })
  })

  it('names an unnamed Space and shortens a long name', () => {
    const [a, b] = JSON.parse(widgetState([{ id: 'a', name: '', color: '#000' }, { id: 'b', name: 'x'.repeat(100), color: '#000' }], 'a')).spaces
    expect(a.name).toBe('Space')
    expect(b.name).toHaveLength(WIDGET_NAME_MAX)
  })
})
