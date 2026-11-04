// The main-process bundle (app/main.build.js) leaves npm packages as require() calls, and the
// packaged app resolves them from app/node_modules, which is installed from app/package.json.
// A package that only the repo root depends on builds and runs from a checkout but is missing
// from the packaged app: 1.41.0 shipped `import * as Y from 'yjs'` in app/bg/notes and every
// desktop build closed at launch with "Cannot find module 'yjs'".
//
// So every package that main-process code (app/main.js, app/bg, app/lib, shared) imports must be
// in app/package-lock.json.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'

const root = path.resolve(__dirname, '../..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'app/package-lock.json'), 'utf8')).packages
const builtins = new Set(builtinModules)

// A bare specifier: `pkg`, `pkg/sub`, `@scope/pkg`, `@scope/pkg/sub`.
const SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w./-]+)?$/
const IMPORT = /(?:^|[\s;])(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\(\s*)['"]([^'"]+)['"]/gm

function files (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') files(p, out) }
    else if (/\.(m?js|ts)$/.test(e.name) && !/\.build\.js$/.test(e.name)) out.push(p)
  }
  return out
}

function packageOf (spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

describe('main-process packages are packaged', () => {
  it('every package app/bg, app/lib and shared import is in app/package-lock.json', () => {
    const sources = [path.join(root, 'app/main.js'), ...['app/bg', 'app/lib', 'shared'].flatMap(d => files(path.join(root, d)))]
    const missing = new Map()
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8')
      for (const m of text.matchAll(IMPORT)) {
        const spec = m[1]
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || !SPEC.test(spec)) continue
        const name = packageOf(spec)
        if (builtins.has(name) || name === 'electron') continue
        if (!lock['node_modules/' + name] && !missing.has(name)) missing.set(name, path.relative(root, file))
      }
    }
    expect(Object.fromEntries(missing)).toEqual({})
  })
})
