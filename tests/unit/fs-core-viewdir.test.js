// viewDirHasChildren() — the directory-vs-missing decision the serve path
// (bg/protocols/hyper.js serveAutobase) uses to choose the builtin file view over a 404 (the fix
// for `hyper://private/` and any no-index directory rendering "File Not Found" instead of a listing).
//
// The linearized view is a flat Hyperbee of file keys with no directory entries, so "is a directory"
// == "has any child key". The helper only needs `createReadStream({ gte, lt, limit })`, so this
// tests it against a faithful in-memory stand-in (sorted keys, gte inclusive / lt exclusive / limit)
// — no native P2P deps, so it runs under any runner. The REAL Hyperbee's createReadStream contract is
// already exercised by fs-core-golden.test.js.
import { describe, it, expect } from 'vitest'
import { viewDirHasChildren } from '../../shared/fs-core.mjs'

// Minimal Hyperbee-like view: yields sorted keys within [gte, lt), honouring limit.
function fakeBee(keys) {
  const sorted = [...keys].sort()
  return {
    createReadStream({ gte, lt, limit = Infinity } = {}) {
      const out = []
      for (const key of sorted) {
        if (gte != null && key < gte) continue
        if (lt != null && key >= lt) continue
        out.push({ key, value: {} })
        if (out.length >= limit) break
      }
      return (async function* () { for (const e of out) yield e })()
    },
  }
}

const bee = fakeBee([
  '/index.json',
  '/posts/2026-07-02-hello/post.json',
  '/posts/2026-07-02-hello/index.md',
  '/notes/todo.txt',
])

describe('viewDirHasChildren', () => {
  it('reports the root as a directory (has children)', async () => {
    expect(await viewDirHasChildren(bee, '/')).toBe(true)
  })

  it('reports a populated subdirectory as a directory, with or without trailing slash', async () => {
    expect(await viewDirHasChildren(bee, '/posts')).toBe(true)
    expect(await viewDirHasChildren(bee, '/posts/')).toBe(true)
    expect(await viewDirHasChildren(bee, '/posts/2026-07-02-hello')).toBe(true)
  })

  it('does NOT treat a missing path or a file leaf as a directory', async () => {
    expect(await viewDirHasChildren(bee, '/nope')).toBe(false)
    expect(await viewDirHasChildren(bee, '/notes/todo.txt')).toBe(false) // file has no children under "<key>/"
    expect(await viewDirHasChildren(bee, '/post')).toBe(false)           // prefix that isn't a real dir boundary
  })

  it('reports an empty view as having no children', async () => {
    expect(await viewDirHasChildren(fakeBee([]), '/')).toBe(false)
  })
})
