// The url and tab group the openTab capability opens. No Electron imports, so unit tests load this file.
//
// The AI may open web pages, hyper:// drives (hyper://<name>/ goes to what the user named, as when
// they type it), and Nomad's own apps. Nothing else: no file:, javascript: or data: URLs.

const SCHEMES = ['http:', 'https:', 'hyper:', 'nomad:']

// null opens the default new tab page.
export function openTabUrl(url) {
  if (url == null || url === '') return null
  if (typeof url !== 'string') throw new Error('url must be a string')
  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error(`Not a URL: ${url}. Pass a full URL, such as https://example.com/ or hyper://<name>/`)
  }
  if (!SCHEMES.includes(parsed.protocol)) {
    throw new Error('openTab opens http, https, hyper:// and nomad:// URLs only')
  }
  return parsed.href
}

// The tab group to open it in, by name or id: null for none. openTab makes the group when the
// window has none by that name.
export function openTabGroup(group) {
  if (group == null) return null
  if (typeof group !== 'string') throw new Error('group must be a string')
  const name = group.trim()
  if (!name) return null
  if (name.length > 60) throw new Error('group is a short name, 60 characters at most')
  return name
}

// The url an AI Job's openPage opens (ADR-0038): a web page or a hyper:// drive, never Nomad's own
// apps or the user's private drive. A bare address ("example.com/news") is https.
export function jobPageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('Pass `url`, the page to open, e.g. https://example.com/')
  let s = url.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  let parsed
  try {
    parsed = new URL(s)
  } catch {
    throw new Error(`Not a URL: ${url}. Pass a full URL, such as https://example.com/`)
  }
  if (!['http:', 'https:', 'hyper:'].includes(parsed.protocol)) {
    throw new Error('A Job opens http, https and hyper:// pages only')
  }
  if (parsed.protocol === 'hyper:' && parsed.hostname.toLowerCase() === 'private') {
    throw new Error("A Job can't open the user's private drive")
  }
  return parsed.href
}
