// Starts the phone's backend (backend/backend.mjs) in Bare, the runtime the phone runs it in, and
// fails if it dies while loading or starting. `npm run check:backend` runs it; CI runs it on every
// pull request (.github/workflows/phone-backend.yml) and release.yml runs it before the Android
// build.
//
// Why: Node and Vitest load modules more leniently than Bare. In 1.52.0 a shared module imported a
// `.js` file from app/, which Bare reads as CommonJS (app/package.json has no "type": "module"),
// so the worklet died on its `export` and the app closed at launch. Every unit test passed. Only
// starting the backend in Bare catches that kind of mistake.
//
// The phone passes the app's document and cache folders as Bare.argv and talks over BareKit.IPC;
// here they are a temp folder and a stream that answers nothing. The check passes once the backend
// has run for a few seconds (CHECK_BACKEND_MS) without an uncaught error. It needs no network.
//
// CommonJS, because Bare's CLI gives a script its module loader only as `module.constructor`, and
// the loader is what takes the import overrides below.

const os = require('bare-os')
const fs = require('bare-fs')
const path = require('bare-path')
const { Duplex } = require('bare-stream')

const RUN_MS = Number(Bare.env?.CHECK_BACKEND_MS) || 5000

// The overrides `npm run bundle` passes bare-pack (tools/bare-imports.cjs, which runs under Node,
// so its entry is repeated here; tests/unit/mobile-backend-deps.test.js checks the two agree).
const IMPORTS = {
  'node:crypto': new URL('../backend/lib/node-crypto-shim.mjs', 'file://' + __filename).href
}

let failed = false
function fail (what, err) {
  if (failed) return
  failed = true
  console.error(`✗ The phone backend failed in Bare (${what}):`)
  console.error((err && (err.stack || err.message)) || err)
  Bare.exit(1)
}
Bare.on('uncaughtException', (err) => fail('uncaught exception', err))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-backend-'))
const folder = (name) => {
  fs.mkdirSync(path.join(dir, name))
  return 'file://' + path.join(dir, name) + '/'
}
Bare.argv.splice(0, Bare.argv.length, folder('documents'), folder('cache'))

// Like the phone's worklet, the CLI has no TextEncoder, TextDecoder or crypto globals, so a module
// that touches one as it loads fails here too. The CLI does have Buffer and structuredClone, which
// its own module loader needs, so a module that leans on those can still pass here.

globalThis.BareKit = {
  IPC: new Duplex({
    read () {},
    write (data, cb) { cb(null) }
  })
}

const Module = module.constructor
const entry = new URL('../backend/backend.mjs', 'file://' + __filename)

Promise.resolve()
  .then(() => Module.load(entry, { referrer: module, imports: IMPORTS }))
  .catch((err) => fail('loading backend/backend.mjs', err))

setTimeout(() => {
  if (failed) return
  console.log(`✓ The phone backend loaded and ran for ${RUN_MS / 1000}s in Bare ${Bare.version}`)
  Bare.exit(0)
}, RUN_MS)
