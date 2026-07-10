// Frontend routing helpers shared by the desktop hyper:// protocol handler
// (app/bg/protocols/hyper.js) and the mobile gateway (mobile/backend/lib/*) — the
// index.json `fallback` convention (ADR-0015).
//
// `"fallback": "/index.html"` in a drive's index.json names an in-drive file served — as a
// 200 rewrite, URL unchanged — when an HTML page navigation asks for a path that doesn't
// resolve to a real file. Real files always win (unlike the legacy /.ui/ui.html takeover,
// which `fallback` supersedes when both are present), and only page navigations fall back:
// a fetch()/sub-resource miss 404s honestly.

// The declared fallback path, or null. Only an absolute in-drive file path counts —
// anything else (non-string, relative, directory-like, or a malformed manifest upstream)
// disables the feature rather than erroring.
export function manifestFallback (manifest) {
  const val = manifest && manifest.fallback
  if (typeof val !== 'string') return null
  if (!val.startsWith('/') || val.endsWith('/')) return null
  return val
}

// Is this request a page (document) navigation, as opposed to a fetch()/sub-resource
// request? Prefer the explicit Sec-Fetch-Dest metadata when the engine provides it; fall
// back to Accept sniffing (custom protocols and older WebViews don't always carry
// Sec-Fetch-* headers).
export function isDocumentNavigation (headers) {
  const h = headers || {}
  const dest = h['Sec-Fetch-Dest'] || h['sec-fetch-dest']
  if (dest) return dest === 'document' || dest === 'iframe' || dest === 'frame'
  const accept = h.Accept || h.accept || ''
  return accept.split(',').some((part) => part.trim().split(';')[0] === 'text/html')
}
