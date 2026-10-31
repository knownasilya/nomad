import type { Theme } from './theme'

// A site's own color for the browser's top bar, as Chrome does: the page's
// <meta name="theme-color"> (the one whose media query matches), else its web manifest's
// theme_color. The page reports it with THEME_COLOR_JS (lib/types.ts), already resolved by the
// page's CSS engine to rgb()/rgba(); this file turns it into a Theme for the bar, picking dark or
// light text by contrast so the address stays readable on any color.

export interface Rgb { r: number; g: number; b: number }

// Accepts what the page reports: rgb(…)/rgba(…) or #rgb/#rrggbb. Anything see-through is ignored, as
// Chrome ignores a translucent theme color.
export function parseColor (input: unknown): Rgb | null {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()
  let m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
      if (!(a >= 0.99)) return null
    }
    const [r, g, b] = [m[1], m[2], m[3]].map(Number)
    return r <= 255 && g <= 255 && b <= 255 ? { r, g, b } : null
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
  }
  return null
}

export function toHex ({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

// WCAG relative luminance, 0 (black) to 1 (white).
export function luminance ({ r, g, b }: Rgb): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast (a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

// Dark text on a light color, light text on a dark one: whichever reads better. Black or white
// text on any color reaches at least 4.5:1, WCAG's bar for body text.
export function prefersDarkText (bg: Rgb): boolean {
  return contrast(bg, BLACK) >= contrast(bg, WHITE)
}

// rgba(ink, alpha) laid over a color, as the screen draws it.
export function blend (under: Rgb, ink: string, alpha: number): Rgb {
  const [r, g, b] = ink.split(',').map(Number)
  const mix = (top: number, bottom: number) => Math.round(top * alpha + bottom * (1 - alpha))
  return { r: mix(r, under.r), g: mix(g, under.g), b: mix(b, under.b) }
}

// The highlight for selected text in the field (the address is all selected on focus): one that
// shows against the field and keeps the text on it at 4.5:1. The app's blue first, as elsewhere,
// then a lighter or darker shade, whichever the text needs.
function selectionOn (field: Rgb, text: Rgb, accent: Rgb | null): string {
  const away = luminance(text) < 0.5 ? '255,255,255' : '0,0,0'
  const toward = luminance(text) < 0.5 ? '0,0,0' : '255,255,255'
  const candidates: [string, number][] = [
    ...(accent ? [[`${accent.r},${accent.g},${accent.b}`, 0.3] as [string, number]] : []),
    [away, 0.45],
    [toward, 0.12]
  ]
  for (const [ink, alpha] of candidates) {
    const under = blend(field, ink, alpha)
    if (contrast(under, text) >= 4.5 && contrast(under, field) >= 1.12) return `rgba(${ink},${alpha})`
  }
  return `rgba(${toward},0.12)`
}

// The browser's Theme with the bar's colors swapped for the site's. Only what the top bar draws
// with changes; the accent stays the app's, unless it would vanish into the site's color.
export function tintTheme (base: Theme, color: unknown): Theme {
  const rgb = parseColor(color)
  if (!rgb) return base
  const darkText = prefersDarkText(rgb)
  const ink = darkText ? '0,0,0' : '255,255,255'
  const accent = parseColor(base.accent)
  return {
    ...base,
    scheme: darkText ? 'light' : 'dark',
    bg: toHex(rgb),
    text: darkText ? '#000000' : '#ffffff',
    textDim: `rgba(${ink},${darkText ? 0.72 : 0.85})`,
    textMuted: `rgba(${ink},${darkText ? 0.55 : 0.7})`,
    // The field is a shade off the bar, as Chrome's is, so it still reads as a field.
    inputBg: `rgba(${ink},${darkText ? 0.07 : 0.16})`,
    border: `rgba(${ink},${darkText ? 0.12 : 0.22})`,
    ripple: `rgba(${ink},${darkText ? 0.1 : 0.16})`,
    selection: selectionOn(blend(rgb, ink, darkText ? 0.07 : 0.16), darkText ? BLACK : WHITE, accent),
    accent: accent && contrast(rgb, accent) >= 3 ? base.accent : (darkText ? '#000000' : '#ffffff'),
    trustBg: `rgba(${ink},0.1)`
  }
}
