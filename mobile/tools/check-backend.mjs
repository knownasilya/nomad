// `npm run check:backend`: starts the phone's backend in Bare (tools/check-backend-starts.cjs says
// why). Bare's runtime is fetched into a cache folder outside mobile/ instead of being a
// devDependency, because adding it to package-lock.json moves packages the phone's bundle ships
// (bare-pipe, bare-type). Node runs this file; Bare runs the check.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BARE_RUNTIME = '1.37.1'

const here = path.dirname(fileURLToPath(import.meta.url))
const cache = path.join(os.tmpdir(), `nomad-bare-runtime-${BARE_RUNTIME}`)
const bin = path.join(cache, 'node_modules', 'bare-runtime', 'bin', 'bare')

if (!fs.existsSync(path.join(here, '..', 'node_modules', 'bare-stream'))) {
  console.error('✗ mobile/node_modules is missing: run `npm ci` in mobile/ first (the check loads the phone backend from it).')
  process.exit(1)
}

if (!fs.existsSync(bin)) {
  fs.mkdirSync(cache, { recursive: true })
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npm, ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund',
    '--prefix', cache, `bare-runtime@${BARE_RUNTIME}`], { stdio: 'inherit' })
}

const run = spawnSync(process.execPath, [bin, path.join(here, 'check-backend-starts.cjs')], {
  cwd: path.dirname(here),
  stdio: 'inherit'
})
process.exit(run.status ?? 1)
