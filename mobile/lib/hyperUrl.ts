// UI-side URL helpers. Mirrors backend/lib/hyper-url.mjs for detection, and
// decides what kind of view an address bar entry should open.

export type DriveType = 'hyperdrive' | 'autobase'
export type Resolved =
  | { kind: 'hyper'; url: string }
  | { kind: 'web'; url: string }

export function isHyperUrl (input: string): boolean {
  const s = (input || '').trim()
  if (s.startsWith('hyper://')) return true
  if (/^[0-9a-fA-F]{64}(\/|$)/.test(s)) return true // hex key
  if (/^[a-z2-7]{52}(\/|$)/.test(s)) return true // z-base-32 key
  return false
}

// Turn whatever the user typed into a concrete navigation target.
export function resolveAddress (input: string): Resolved {
  const s = (input || '').trim()
  if (!s) return { kind: 'web', url: 'https://duckduckgo.com' }

  if (isHyperUrl(s)) {
    const url = s.startsWith('hyper://') ? s : `hyper://${s}`
    return { kind: 'hyper', url }
  }

  // Explicit scheme → web as-is.
  if (/^https?:\/\//i.test(s)) return { kind: 'web', url: s }

  // Looks like a domain (has a dot, no spaces) → assume https.
  if (/^[^\s]+\.[^\s]+$/.test(s) && !s.includes(' ')) {
    return { kind: 'web', url: `https://${s}` }
  }

  // Otherwise treat it as a search query.
  return { kind: 'web', url: `https://duckduckgo.com/?q=${encodeURIComponent(s)}` }
}

// Short, display-friendly label for a hyper key.
export function shortKey (key?: string): string {
  if (!key) return ''
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key
}

// The drive-key portion of a hyper URL (lowercased), for "is this the same
// drive?" checks. In-drive links/listings use the backend's hex key, so this
// matches the tab's stored hex driveKey.
export function hyperKeyOf (url: string): string {
  const s = (url || '').trim().replace(/^hyper:\/\//, '')
  const slash = s.indexOf('/')
  return (slash === -1 ? s : s.slice(0, slash)).toLowerCase()
}

// The same canonical form desktop's normalizeUrl (app/lib/urls.ts) gives a URL: no userinfo, no
// default port, and at least a '/' path. Pinned shortcuts are stored and matched in this form in
// /nomad/pins.json, so both devices must agree on it. http(s) hosts are lowercased; a hyper:// host
// is an opaque key and is kept as written, as WHATWG URL does.
export function normalizeUrl (url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec((url || '').trim())
  if (!m) return url
  const scheme = m[1].toLowerCase()
  let host = m[2].replace(/^[^@]*@/, '')
  if (scheme === 'http' || scheme === 'https') {
    host = host.toLowerCase().replace(scheme === 'https' ? /:443$/ : /:80$/, '')
  }
  return `${scheme}://${host}${m[3] || '/'}${m[4] || ''}${m[5] || ''}`
}

// What a favicon belongs to: the host of a web URL, or the drive key of a hyper:// URL. Every page
// of a site shares one icon.
export function siteKeyOf (url: string): string {
  if (isHyperUrl(url)) return 'hyper:' + hyperKeyOf(url)
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec((url || '').trim())
  return m ? m[1].toLowerCase() : ''
}
