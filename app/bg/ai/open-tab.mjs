// The url the openTab capability opens. No Electron imports, so unit tests load this file.
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
