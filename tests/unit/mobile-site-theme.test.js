// The phone tints its top bar with a site's theme color (mobile/lib/siteTheme.ts) and picks the
// bar's text color by contrast so the address stays readable.

import { describe, it, expect } from 'vitest'
import { parseColor, prefersDarkText, tintTheme, contrast } from '../../mobile/lib/siteTheme.ts'

const base = {
  scheme: 'light',
  bg: '#f5f5f5',
  text: '#222222',
  textDim: '#555555',
  textMuted: '#888891',
  inputBg: '#ffffff',
  border: '#e0e0e0',
  ripple: 'rgba(0,0,0,0.08)',
  accent: '#1d59c7',
  trustBg: '#e6ebff',
  surface: '#ffffff'
}

describe('parseColor', () => {
  it('reads what getComputedStyle reports', () => {
    expect(parseColor('rgb(29, 161, 242)')).toEqual({ r: 29, g: 161, b: 242 })
    expect(parseColor('rgba(0, 0, 0, 1)')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseColor('rgb(10 20 30 / 100%)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('reads hex colors', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#1DA1F2')).toEqual({ r: 29, g: 161, b: 242 })
  })

  it('ignores translucent and broken colors', () => {
    expect(parseColor('rgba(0, 0, 0, 0)')).toBe(null)
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toBe(null)
    expect(parseColor('rgb(300, 0, 0)')).toBe(null)
    expect(parseColor('papayawhip')).toBe(null)
    expect(parseColor(null)).toBe(null)
    expect(parseColor('')).toBe(null)
  })
})

describe('prefersDarkText', () => {
  it('uses dark text on light colors and light text on dark ones', () => {
    expect(prefersDarkText({ r: 255, g: 255, b: 255 })).toBe(true)
    expect(prefersDarkText({ r: 255, g: 221, b: 0 })).toBe(true) // yellow
    expect(prefersDarkText({ r: 0, g: 0, b: 0 })).toBe(false)
    expect(prefersDarkText({ r: 21, g: 32, b: 43 })).toBe(false) // x.com dim
    expect(prefersDarkText({ r: 204, g: 0, b: 0 })).toBe(false) // a strong red
  })
})

describe('tintTheme', () => {
  it('leaves the theme alone without a usable color', () => {
    expect(tintTheme(base, undefined)).toBe(base)
    expect(tintTheme(base, 'transparent')).toBe(base)
  })

  it('paints the bar with the site color and keeps the text readable', () => {
    for (const color of ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(29, 161, 242)', 'rgb(255, 102, 0)', 'rgb(128, 128, 128)', 'rgb(21, 32, 43)']) {
      const th = tintTheme(base, color)
      expect(th.bg).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(parseColor(th.bg), parseColor(th.text))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('switches the bar to dark on a dark color', () => {
    const th = tintTheme(base, 'rgb(0, 0, 0)')
    expect(th.scheme).toBe('dark')
    expect(th.text).toBe('#ffffff')
    expect(tintTheme(base, 'rgb(255, 255, 255)').scheme).toBe('light')
  })

  it('drops the accent when it would vanish into the site color', () => {
    expect(tintTheme(base, 'rgb(255, 255, 255)').accent).toBe(base.accent)
    expect(tintTheme(base, 'rgb(29, 89, 199)').accent).toBe('#ffffff')
  })
})
