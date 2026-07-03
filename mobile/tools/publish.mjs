// Seed a local folder as a hyper:// drive so the mobile app has something to
// open. Stays online (announcing on the DHT) until you Ctrl-C.
//
//   node tools/publish.mjs ./site                 # publish as a Hyperdrive
//   node tools/publish.mjs ./site --autobase      # publish as an Autobase drive
//
// Copy the printed hyper:// URL into the app's address bar (pick HD or AB to
// match how you published).
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import fs from 'fs'
import path from 'path'

import { openAutobaseDrive } from '../backend/lib/drive-manager.mjs'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--')) || './site'
const autobase = args.includes('--autobase')

if (!fs.existsSync(dir)) {
  console.error(`No such folder: ${dir}`)
  process.exit(1)
}

const store = new Corestore(`./.publish-store-${autobase ? 'ab' : 'hd'}`)
const swarm = new Hyperswarm()
swarm.on('connection', (conn) => store.replicate(conn))

const files = walk(dir).map((abs) => ({ abs, rel: '/' + path.relative(dir, abs).split(path.sep).join('/') }))

let key
let discoveryKey

if (autobase) {
  const base = openAutobaseDrive(store, null)
  await base.ready()
  for (const f of files) {
    // nomad's collaborative-drive op format: base64 for binary-safe transfer.
    await base.append({ op: 'put', path: f.rel, data: b4a.toString(fs.readFileSync(f.abs), 'base64'), encoding: 'base64' })
  }
  await base.update()
  key = base.key
  discoveryKey = base.discoveryKey
} else {
  const drive = new Hyperdrive(store)
  await drive.ready()
  for (const f of files) await drive.put(f.rel, fs.readFileSync(f.abs))
  key = drive.key
  discoveryKey = drive.discoveryKey
}

await swarm.join(discoveryKey, { server: true, client: false }).flushed()

const url = `hyper://${b4a.toString(key, 'hex')}/`
console.log(`\nPublished ${files.length} file(s) from ${dir} as ${autobase ? 'an Autobase drive' : 'a Hyperdrive'}.`)
console.log(`\n  ${url}\n`)
console.log(`Open it in the app with the ${autobase ? 'AB' : 'HD'} pill selected. Keep this running to stay online. Ctrl-C to stop.`)

function walk (root) {
  const out = []
  for (const name of fs.readdirSync(root)) {
    const abs = path.join(root, name)
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs))
    else out.push(abs)
  }
  return out
}
