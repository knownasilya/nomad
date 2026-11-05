// Import overrides for bare-pack (`npm run bundle --imports tools/bare-imports.cjs`): Bare has no
// `node:crypto`, which Yjs's lib0 imports, so it gets backend/lib/node-crypto-shim.mjs. Without
// this the bundle fails with "Cannot find module 'node:crypto'". Guarded by
// tests/unit/mobile-backend-deps.test.js.
const { pathToFileURL } = require('url')
const path = require('path')

module.exports = {
  'node:crypto': pathToFileURL(path.join(__dirname, '../backend/lib/node-crypto-shim.mjs')).href
}
