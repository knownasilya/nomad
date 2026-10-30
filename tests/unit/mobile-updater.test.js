// The phone's auto-updates (mobile/lib/updater.ts) pick the APK off GitHub's latest release and
// install it only when its version is newer than the build that is running.

import { describe, it, expect } from 'vitest'
import { isNewer, pickNewestRelease, pickRelease } from '../../mobile/lib/updateRelease.ts'

describe('isNewer', () => {
  it('compares version numbers part by part', () => {
    expect(isNewer('1.22.0', '1.21.0')).toBe(true)
    expect(isNewer('1.21.10', '1.21.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.21.0', '1.21.0')).toBe(false)
    expect(isNewer('1.20.0', '1.21.0')).toBe(false)
  })

  it('treats a missing part as 0', () => {
    expect(isNewer('1.22', '1.21.5')).toBe(true)
    expect(isNewer('1.21', '1.21.0')).toBe(false)
  })

  it('lets a release replace a dev build of the same number, not the other way round', () => {
    expect(isNewer('1.21.0', '1.21.0-dev')).toBe(true)
    expect(isNewer('1.21.0-dev', '1.21.0')).toBe(false)
  })

  it('orders beta releases', () => {
    expect(isNewer('1.22.0-beta.0', '1.21.0')).toBe(true)
    expect(isNewer('1.22.0-beta.1', '1.22.0-beta.0')).toBe(true)
    expect(isNewer('1.22.0-beta.10', '1.22.0-beta.9')).toBe(true)
    expect(isNewer('1.22.0-beta.0', '1.22.0-beta.0')).toBe(false)
    expect(isNewer('1.22.0', '1.22.0-beta.3')).toBe(true)
    expect(isNewer('1.22.0-beta.3', '1.22.0')).toBe(false)
    expect(isNewer('1.21.1', '1.22.0-beta.0')).toBe(false)
    expect(isNewer('1.22.0-beta', '1.22.0-alpha.4')).toBe(true)
    expect(isNewer('1.22.0-beta.0', '1.22.0-beta')).toBe(true)
  })
})

describe('pickRelease', () => {
  const release = {
    tag_name: 'v1.22.0',
    assets: [
      { name: 'nomad-1.22.0-arm64.dmg', browser_download_url: 'https://example.com/dmg', size: 1 },
      { name: 'nomad-1.22.0-android.aab', browser_download_url: 'https://example.com/aab', size: 2 },
      { name: 'nomad-1.22.0-android.apk', browser_download_url: 'https://example.com/apk', size: 3 }
    ]
  }

  it('takes the Android APK and the version from the tag', () => {
    expect(pickRelease(release)).toEqual({ version: '1.22.0', apkUrl: 'https://example.com/apk', size: 3 })
  })

  it('returns null for a release without an APK', () => {
    expect(pickRelease({ ...release, assets: release.assets.slice(0, 2) })).toBe(null)
    expect(pickRelease({ tag_name: 'v1.22.0' })).toBe(null)
    expect(pickRelease(null)).toBe(null)
    expect(pickRelease({ message: 'Not Found' })).toBe(null)
  })
})

describe('pickNewestRelease', () => {
  const apk = (v) => [{ name: `nomad-${v}-android.apk`, browser_download_url: `https://example.com/${v}`, size: 1 }]

  it('takes the newest release with an APK, betas included', () => {
    const list = [
      { tag_name: 'v1.21.0', assets: apk('1.21.0') },
      { tag_name: 'v1.22.0-beta.1', prerelease: true, assets: apk('1.22.0-beta.1') },
      { tag_name: 'v1.22.0-beta.2', prerelease: true, assets: [] },
      { tag_name: 'v1.22.0-beta.0', prerelease: true, assets: apk('1.22.0-beta.0') }
    ]
    expect(pickNewestRelease(list)?.version).toBe('1.22.0-beta.1')
  })

  it('prefers the release over its betas, and skips drafts', () => {
    const list = [
      { tag_name: 'v1.23.0', draft: true, assets: apk('1.23.0') },
      { tag_name: 'v1.22.0-beta.1', prerelease: true, assets: apk('1.22.0-beta.1') },
      { tag_name: 'v1.22.0', assets: apk('1.22.0') }
    ]
    expect(pickNewestRelease(list)?.version).toBe('1.22.0')
  })

  it('returns null for an answer that is not a list', () => {
    expect(pickNewestRelease({ message: 'API rate limit exceeded' })).toBe(null)
    expect(pickNewestRelease([])).toBe(null)
    expect(pickNewestRelease(null)).toBe(null)
  })
})
