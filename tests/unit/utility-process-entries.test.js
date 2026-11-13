// A utility process (utilityProcess.fork) loads its entry file straight from disk. A packaged build
// ships only app/, so an entry that imports the repo-root shared/ modules can't load there: from
// 1.50.0 to 1.50.4 the AI's execute worker imported search-execute.mjs, which reaches
// shared/home-live.mjs, and every execute call failed with "execute process exited (1)" (desktop
// sidebar and the phone's AI over the Bridge alike), while a checkout ran fine.
//
// So every entry forked from app/bg is a `.build.js` that scripts/build.js bundles.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function files (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') files(p, out) }
    else if (/\.(m?js|ts)$/.test(e.name) && !/\.build\.js$/.test(e.name)) out.push(p)
  }
  return out
}

// The app-relative script paths named in a file that forks a utility process.
function forkedEntries () {
  const out = []
  for (const file of files(path.join(root, 'app/bg'))) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('utilityProcess.fork(')) continue
    for (const m of text.matchAll(/['"`]((?:bg|tools|lib)\/[\w./-]+\.m?js)['"`]/g)) {
      out.push({ file: path.relative(root, file), entry: m[1] })
    }
  }
  return out
}

describe('utility process entries are bundled', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/build.js'), 'utf8')

  it('finds the execute worker and the crawler', () => {
    const entries = forkedEntries().map(e => e.entry)
    expect(entries).toContain('bg/ai/execute-worker.build.js')
    expect(entries).toContain('tools/crawler-process.build.js')
  })

  it('every forked entry is a .build.js that scripts/build.js makes', () => {
    for (const { file, entry } of forkedEntries()) {
      expect(entry, `${file} forks ${entry}`).toMatch(/\.build\.js$/)
      expect(build, `scripts/build.js bundles ${entry}`).toContain(`p(appDir, '${entry}')`)
    }
  })
})
