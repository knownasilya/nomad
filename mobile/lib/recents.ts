import { siteKeyOf } from './hyperUrl'

// The home page's Recent list. History is newest first; a run of pages from one site, back to
// back, shows as one row: the newest page of the run. The same site later in the list, after a
// visit somewhere else, is its own row.

// The site a URL is on: the one its favicon belongs to (siteKeyOf: a web host, http and https
// alike, or a drive key), without "www.". Empty when it has none (about:, data:), and such an
// entry is never folded into another.
export function recentSite (url: string): string {
  return siteKeyOf(url).replace(/^www\./, '')
}

export function collapseRecents<T extends { url: string }> (history: T[]): T[] {
  const out: T[] = []
  let last = ''
  for (const h of history) {
    const site = recentSite(h.url)
    if (site && site === last) continue
    out.push(h)
    last = site
  }
  return out
}
