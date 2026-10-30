import { useColorScheme } from 'react-native'

// Design tokens ported from nomad's shell chrome (app/assets/css/design-tokens.css) and the
// nomad:// apps (app/userland/app-stdlib/css/colors.css): a clean, light-default browser language
// with a blue brand accent, neutral grays, and semantic trust colors. Adapted for a touch UI.
// nomad respects prefers-color-scheme, so we follow the system scheme and default to light. The
// dark grays are desktop's, which are neutral (no blue tint): chrome #1f1f1f, raised #333.

export interface Theme {
  scheme: 'light' | 'dark'
  bg: string // window / chrome background
  surface: string // content, current tab, inputs
  surfaceAlt: string // hover / pressed / elevated
  border: string
  text: string // primary text
  textDim: string // secondary text
  textMuted: string // tertiary / hints
  inputBg: string
  accent: string // interactive blue (nomad --highlight/--input-focused)
  accentBar: string // current-tab highlight bar
  trustBg: string // "secure / hyper" chip background (nomad cert--trusted)
  trustText: string
  secure: string // verified / connected green
  danger: string
  warn: string // caution text and borders (desktop's warning amber)
  onAccent: string
  ripple: string // Android press ripple on rows and icon buttons
  backdrop: string // dim behind sheets and dialogs
}

// Locked shape scale (mobile): inputs/cards/tabs = 10, pills/circles = full.
export const radius = { sm: 8, md: 10, lg: 14, pill: 999 }
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
// The smallest touch target (Material's 48dp): icon buttons, and the height of a one-line row.
export const touch = 48

const light: Theme = {
  scheme: 'light',
  bg: '#f5f5f5', // --bg-color--background
  surface: '#ffffff',
  surfaceAlt: '#f0f0f6', // --bg-color--semi-light
  border: '#e0e0e0', // --border-color--navbar / --tab
  text: '#222222',
  textDim: '#555555',
  textMuted: '#888891',
  inputBg: '#ffffff',
  accent: '#1d59c7', // --border-color--input--focused
  accentBar: '#005aff', // --highlight-color--tab--current
  trustBg: '#e6ebff', // --bg-color--cert--trusted
  trustText: '#0a52d6', // --text-color--cert--trusted
  secure: '#2f9e44',
  danger: '#d11a1a', // --text-color--cert--untrusted
  warn: '#b9770e',
  onAccent: '#ffffff',
  ripple: 'rgba(0,0,0,0.08)',
  backdrop: 'rgba(0,0,0,0.4)'
}

const dark: Theme = {
  scheme: 'dark',
  bg: '#1f1f1f', // --bg-color--background
  surface: '#2b2b2b',
  surfaceAlt: '#333333', // --bg-color--foreground
  border: '#3a3a3a',
  text: '#eeeeee', // --text-color--input
  textDim: '#bbbbbb', // --text-color--navbar-btn
  textMuted: '#8f8f8f',
  inputBg: '#2b2b2b',
  accent: '#5d80ff', // --text-color--link
  accentBar: '#4d82e4', // --bg-color--paneborder--active
  trustBg: '#2a3152',
  trustText: '#d2d8fd', // --text-color--cert--trusted
  secure: '#67bf6b', // --text-color--navbar-btn--success
  danger: '#ff6b6b',
  warn: '#e2b206', // --text-color--cert--warning
  onAccent: '#ffffff',
  ripple: 'rgba(255,255,255,0.1)',
  backdrop: 'rgba(0,0,0,0.6)'
}

export function useTheme (): Theme {
  return useColorScheme() === 'dark' ? dark : light
}
