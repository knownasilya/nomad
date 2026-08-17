// Tests for the cross-drive write/writer-management permission gate (app/bg/web-apis/bg/fs-write-guard.js).
//
// hyperdrive.ts's assertWritePermission already gates the legacy Hyperdrive backend: same-origin
// writes are free, everything else needs a `modifyDrive:<key>` permission grant. Autobase — the
// backend for every new drive — had no equivalent, so any loaded page that knew another drive's URL
// could silently write its files or manage its writers. This module closes that gap; these tests
// cover the decision matrix it's responsible for.
//
// createFsWriteGuard is a pure DI module (only imports the UserDeniedError type, no Electron), so
// this test just injects plain fakes and runs in any runner. beaker-error-constants lives in
// app/node_modules (not the repo root), so rather than import it here too, denial is asserted by
// error name — UserDeniedError sets `this.name = 'UserDeniedError'`.
import { describe, it, expect, beforeEach } from 'vitest'
import { createFsWriteGuard } from '../../app/bg/web-apis/bg/fs-write-guard.js'

const OWN_KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

let requests, granted, trusted
function build() {
  requests = []
  granted = new Set()
  trusted = false
  const sender = { getURL: () => `hyper://${OWN_KEY}/` }
  const guard = createFsWriteGuard({
    isWcTrusted: () => trusted,
    senderDriveKey: async () => OWN_KEY,
    getTitle: async (baseKey) => `Title of ${baseKey}`,
    requestPermission: async (permId, s, opts) => {
      requests.push({ permId, sender: s, opts })
      return granted.has(permId)
    },
    queryPermission: async (permId) => granted.has(permId),
  })
  return { guard, sender }
}

describe('fs-write-guard', () => {
  beforeEach(() => { /* fresh state per test via build() */ })

  it('allows a same-origin write with no prompt', async () => {
    const { guard, sender } = build()
    await guard.assertWrite({ sender }, OWN_KEY)
    expect(requests).toEqual([])
  })

  it('allows a trusted nomad:// sender with no prompt', async () => {
    const { guard, sender } = build()
    trusted = true
    await guard.assertWrite({ sender }, OTHER_KEY)
    expect(requests).toEqual([])
  })

  it('prompts for a cross-origin write and blocks on refusal', async () => {
    const { guard, sender } = build()
    await expect(guard.assertWrite({ sender }, OTHER_KEY)).rejects.toMatchObject({ name: 'UserDeniedError' })
    expect(requests).toHaveLength(1)
    expect(requests[0].permId).toBe(`modifyDrive:${OTHER_KEY}`)
    expect(requests[0].opts.title).toBe(`Title of ${OTHER_KEY}`)
  })

  it('prompts for a cross-origin write and allows on approval', async () => {
    const { guard, sender } = build()
    granted.add(`modifyDrive:${OTHER_KEY}`)
    await expect(guard.assertWrite({ sender }, OTHER_KEY)).resolves.toBeUndefined()
    // queryPermission short-circuits before requestPermission is reached
    expect(requests).toEqual([])
  })

  it('skips the prompt when a decision was already persisted', async () => {
    const { guard, sender } = build()
    granted.add(`modifyDrive:${OTHER_KEY}`)
    await guard.assertWrite({ sender }, OTHER_KEY)
    await guard.assertWrite({ sender }, OTHER_KEY)
    expect(requests).toEqual([])
  })

  it('is a no-op when there is no sender context', async () => {
    const { guard } = build()
    await expect(guard.assertWrite({}, OTHER_KEY)).resolves.toBeUndefined()
  })

  it('gates writer-management under manageDriveWriters, independently of modifyDrive', async () => {
    const { guard, sender } = build()
    granted.add(`modifyDrive:${OTHER_KEY}`)
    await expect(guard.assertManage({ sender }, OTHER_KEY)).rejects.toMatchObject({ name: 'UserDeniedError' })
    expect(requests[0].permId).toBe(`manageDriveWriters:${OTHER_KEY}`)
  })

  it('allows managing your own drive with no prompt', async () => {
    const { guard, sender } = build()
    await guard.assertManage({ sender }, OWN_KEY)
    expect(requests).toEqual([])
  })
})
