// The phone's auto-updates (mobile/lib/updater.ts) pick the APK off GitHub's latest release and
// install it only when its version is newer than the build that is running.

import { describe, it, expect } from 'vitest'
import { isNewer, pickRelease } from '../../mobile/lib/updateRelease.ts'

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
