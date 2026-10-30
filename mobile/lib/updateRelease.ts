// The pure half of the phone's auto-updates (lib/updater.ts): which GitHub release to install, and
// whether it is newer than this build. Kept free of React Native so tests/unit can load it.

// Only published releases count: GitHub's "latest" skips drafts and prereleases, so a release
// reaches phones when its draft is published, and not before.
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/knownasilya/nomad/releases/latest'
// With Settings → Updates → Beta releases on, the phone reads the recent releases instead, which
// include published prereleases (never drafts, for a request without a token), and takes the newest.
export const RECENT_RELEASES_URL = 'https://api.github.com/repos/knownasilya/nomad/releases?per_page=20'

export interface Release {
  version: string // the tag without its "v"
  apkUrl: string
  size: number
}

interface GithubAsset { name?: string; browser_download_url?: string; size?: number }
interface GithubRelease { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: GithubAsset[] }

// The release workflow attaches nomad-<version>-android.apk (and an .aab, which can't be installed).
export function pickRelease (json: GithubRelease | null | undefined): Release | null {
  if (!json || typeof json.tag_name !== 'string') return null
  const apk = (json.assets ?? []).find((a) => typeof a.name === 'string' && a.name.endsWith('-android.apk') && !!a.browser_download_url)
  if (!apk) return null
  return { version: json.tag_name.replace(/^v/, ''), apkUrl: apk.browser_download_url!, size: apk.size ?? 0 }
}

// The newest release with an APK in GitHub's release list, prereleases included. Drafts are skipped
// even though a request without a token never sees them.
export function pickNewestRelease (json: GithubRelease[] | null | undefined): Release | null {
  if (!Array.isArray(json)) return null
  let best: Release | null = null
  for (const item of json) {
    if (!item || item.draft) continue
    const release = pickRelease(item)
    if (release && (!best || isNewer(release.version, best.version))) best = release
  }
  return best
}

// Semver order: "1.22.0" > "1.21.0", a release beats a prerelease of the same number
// ("1.22.0" > "1.22.0-beta.1", and a dev build "1.22.0-dev"), and "1.22.0-beta.2" > "1.22.0-beta.1".
export function isNewer (candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

export function compareVersions (a: string, b: string): number {
  const [aMain, aPre] = splitVersion(a)
  const [bMain, bPre] = splitVersion(b)
  for (let i = 0; i < Math.max(aMain.length, bMain.length); i++) {
    const x = aMain[i] ?? 0
    const y = bMain[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (!aPre.length && !bPre.length) return 0
  if (!aPre.length) return 1
  if (!bPre.length) return -1
  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    const x = aPre[i]
    const y = bPre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return parseInt(x, 10) > parseInt(y, 10) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1 // numbers sort before words
    return x > y ? 1 : -1
  }
  return 0
}

function splitVersion (v: string): [number[], string[]] {
  const dash = v.indexOf('-')
  const main = (dash < 0 ? v : v.slice(0, dash)).split('.').map((n) => parseInt(n, 10) || 0)
  const pre = dash < 0 ? [] : v.slice(dash + 1).split('+')[0].split('.')
  return [main, pre]
}
