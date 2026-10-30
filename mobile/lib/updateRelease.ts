// The pure half of the phone's auto-updates (lib/updater.ts): which GitHub release to install, and
// whether it is newer than this build. Kept free of React Native so tests/unit can load it.

// Only published releases count: GitHub's "latest" skips drafts and prereleases, so a release
// reaches phones when its draft is published, and not before.
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/knownasilya/nomad/releases/latest'

export interface Release {
  version: string // the tag without its "v"
  apkUrl: string
  size: number
}

interface GithubAsset { name?: string; browser_download_url?: string; size?: number }

// The release workflow attaches nomad-<version>-android.apk (and an .aab, which can't be installed).
export function pickRelease (json: { tag_name?: string; assets?: GithubAsset[] } | null | undefined): Release | null {
  if (!json || typeof json.tag_name !== 'string') return null
  const apk = (json.assets ?? []).find((a) => typeof a.name === 'string' && a.name.endsWith('-android.apk') && !!a.browser_download_url)
  if (!apk) return null
  return { version: json.tag_name.replace(/^v/, ''), apkUrl: apk.browser_download_url!, size: apk.size ?? 0 }
}

// "1.22.0" > "1.21.0", and a release beats a dev build of the same number ("1.22.0-dev").
export function isNewer (candidate: string, current: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const a = parts(candidate)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return current.includes('-') && !candidate.includes('-')
}
