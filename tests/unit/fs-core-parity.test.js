// Version-parity net for the consensus-critical P2P deps (ADR-0010 Phase 0).
//
// The desktop app (app/node_modules) and the mobile backend (mobile/node_modules) keep
// SEPARATE, independently-maintained dependency trees but must replicate the SAME wire
// format. If their resolved versions of the Autobase/Hyperbee/blob stack drift apart,
// replication fails at runtime with `DECODING_ERROR: Unknown wire type` — silently, only
// on a real cross-device sync. This test turns that latent runtime failure into a loud
// build-time one by asserting both trees resolve identical versions.
//
// Scope: the modules whose ENCODING participates in the shared view/oplog/pairing wire
// format. hypercore/hyperdrive majors are deliberately allowed to differ (see the
// multi-device protocol doc §6) and are NOT checked here.

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const APP = path.join(ROOT, 'app', 'node_modules')
const MOBILE = path.join(ROOT, 'mobile', 'node_modules')

// Consensus-critical, encoding-bearing deps that MUST match across both apps.
const CONSENSUS_DEPS = ['autobase', 'hyperbee', 'corestore', 'hyperblobs', 'blind-pairing', 'b4a']

function resolvedVersion (nodeModulesDir, dep) {
  const pkg = path.join(nodeModulesDir, dep, 'package.json')
  if (!fs.existsSync(pkg)) return null
  return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
}

describe('desktop/mobile P2P dep version parity', () => {
  it('both node_modules trees exist', () => {
    expect(fs.existsSync(APP)).toBe(true)
    expect(fs.existsSync(MOBILE)).toBe(true)
  })

  for (const dep of CONSENSUS_DEPS) {
    it(`${dep}: app and mobile resolve the same version`, () => {
      const app = resolvedVersion(APP, dep)
      const mobile = resolvedVersion(MOBILE, dep)
      expect(app, `${dep} missing from app/node_modules`).not.toBeNull()
      expect(mobile, `${dep} missing from mobile/node_modules`).not.toBeNull()
      expect(
        app,
        `${dep} version drift: app=${app} mobile=${mobile} — replication will fail with DECODING_ERROR. Re-pin both trees to the same version.`
      ).toBe(mobile)
    })
  }
})
