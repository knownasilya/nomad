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
