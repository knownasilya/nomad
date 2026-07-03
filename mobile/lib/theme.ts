import { useColorScheme } from 'react-native'

// Design tokens ported from nomad's shell chrome (app/assets/css/design-tokens.css):
// a clean, light-default browser language with a blue brand accent, neutral
// grays, and semantic trust colors. Adapted for a touch UI. nomad respects
// prefers-color-scheme, so we follow the system scheme and default to light.

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
  onAccent: string
}

// Locked shape scale (mobile): inputs/cards/tabs = 10, pills/circles = full.
export const radius = { sm: 8, md: 10, lg: 14, pill: 999 }
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }

const light: Theme = {
  scheme: 'light',
  bg: '#f4f4f6',
  surface: '#ffffff',
  surfaceAlt: '#ececf2',
  border: '#e2e2e8',
  text: '#1c1c22',
  textDim: '#56565f',
  textMuted: '#8a8a94',
  inputBg: '#ffffff',
  accent: '#1d59c7',
  accentBar: '#005aff',
  trustBg: '#e7ecfb',
  trustText: '#1d59c7',
  secure: '#2f9e44',
  danger: '#d11a1a',
  onAccent: '#ffffff'
}

const dark: Theme = {
  scheme: 'dark',
  bg: '#191919',
  surface: '#2a2a2e',
  surfaceAlt: '#33333a',
  border: '#34343b',
  text: '#ededf2',
  textDim: '#b2b2bc',
  textMuted: '#85858f',
  inputBg: '#232327',
  accent: '#5b8cff',
  accentBar: '#4d82e4',
  trustBg: '#232c45',
  trustText: '#9bb6ff',
  secure: '#51cf66',
  danger: '#ff6b6b',
  onAccent: '#ffffff'
}

export function useTheme (): Theme {
  return useColorScheme() === 'dark' ? dark : light
}
