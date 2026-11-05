// The phone's backend (mobile/backend/backend.mjs) is bundled by bare-pack from mobile/node_modules
// only: the mobile build installs mobile/package.json and nothing else. So a package the backend
// reaches, through its own files or the shared/ modules it imports, must be in
// mobile/package-lock.json, or `npm run bundle` fails (or, for a package that only the repo root
// has, a checkout works and the release doesn't). Live Notes brought Yjs to the phone (ADR-0041):
// its lib0 imports `node:crypto`, which Bare doesn't have, so the bundle maps it to a shim.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(__dirname, '../..')
const lockOf = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')).packages
const mobileLock = lockOf('mobile/package-lock.json')

const SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w./-]+)?$/
const IMPORT = /(?:^|[\s;])(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|export\s[^'"]*?from\s*|require\(\s*)['"]([^'"]+)['"]/gm

function packageOf (spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// Every file the backend's module graph reaches through relative imports, with the bare
// specifiers each one imports.
function graph (entry) {
  const seen = new Map()
  const walk = (file) => {
    if (seen.has(file)) return
    const bare = []
    seen.set(file, bare)
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1]
      if (spec.startsWith('.')) {
        const next = path.resolve(path.dirname(file), spec)
        if (fs.existsSync(next) && fs.statSync(next).isFile()) walk(next)
      } else if (SPEC.test(spec) || spec.startsWith('node:')) bare.push(spec)
    }
  }
  walk(entry)
  return seen
}

const backend = graph(path.join(root, 'mobile/backend/backend.mjs'))

describe('the phone backend’s packages are in the mobile build', () => {
  it('reaches the live Notes modules', () => {
    const files = [...backend.keys()].map((f) => path.relative(root, f))
    expect(files).toContain('mobile/backend/lib/live-notes.mjs')
    expect(files).toContain('shared/note-live-hub.mjs')
    expect(files).toContain('shared/note-live-session.mjs')
  })

  it('every package it imports is in mobile/package-lock.json', () => {
    const missing = {}
    for (const [file, specs] of backend) {
      for (const spec of specs) {
        if (spec.startsWith('node:')) continue
        const name = packageOf(spec)
        if (!mobileLock['node_modules/' + name]) missing[name] = path.relative(root, file)
      }
    }
    expect(missing).toEqual({})
  })

  it('shared modules have no bare imports (the runtime passes its own in)', () => {
    const bare = {}
    for (const [file, specs] of backend) {
      if (path.relative(root, file).startsWith('shared/') && specs.length) bare[path.relative(root, file)] = specs
    }
    expect(bare).toEqual({})
  })

  it('maps lib0’s node:crypto to the shim when bundling', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'mobile/package.json'), 'utf8'))
    expect(pkg.scripts.bundle).toContain('--imports tools/bare-imports.cjs')
    const map = createRequire(import.meta.url)(path.join(root, 'mobile/tools/bare-imports.cjs'))
    const target = new URL(map['node:crypto'])
    expect(target.protocol).toBe('file:')
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toMatch(/export const webcrypto\b/)
  })

  it('pins Yjs, y-protocols and lib0 to the same versions as desktop', () => {
    const appLock = lockOf('app/package-lock.json')
    for (const name of ['yjs', 'y-protocols', 'lib0']) {
      expect(mobileLock['node_modules/' + name]?.version, name).toBe(appLock['node_modules/' + name]?.version)
    }
  })
})
