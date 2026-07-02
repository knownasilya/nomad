// End-to-end check of the hyper:// resolver used by the mobile backend.
//
// It seeds a Hyperdrive and an Autobase-backed drive on this machine, announces
// them on the Hyperswarm DHT, then reads them back through the SAME
// DriveManager the app's Bare backend uses — exercising the real P2P path
// (swarm discovery + replication), not a mock. Run with: node tools/verify-drives.mjs
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

import DriveManager, { openAutobaseDrive } from '../backend/lib/drive-manager.mjs'
import { parseHyperUrl } from '../backend/lib/hyper-url.mjs'

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name))
const cleanups = []
let failures = 0

const kill = setTimeout(() => {
  console.error('✗ timed out waiting for the DHT / replication')
  process.exit(1)
}, 90_000)

function assert (cond, msg) {
  if (cond) console.log('  ✓', msg)
  else { console.error('  ✗', msg); failures++ }
}

async function main () {
  await testHyperdrive()
  await testAutobase()
  await testAutobaseMultiwriter()
  await testCreateDrive()
  await testAutoDetect()
  await testInlining()

  clearTimeout(kill)
  for (const fn of cleanups) await fn().catch(() => {})
  console.log(failures === 0 ? '\nALL PASSED ✅' : `\n${failures} FAILED ❌`)
  process.exit(failures === 0 ? 0 : 1)
}

async function testHyperdrive () {
  console.log('\n[hyperdrive]')
  const store = new Corestore(tmp('pub-hd-'))
  const drive = new Hyperdrive(store)
  await drive.ready()
  await drive.put('/index.html', b4a.from('<h1>hello from hyperdrive</h1>'))
  await drive.put('/notes/readme.txt', b4a.from('a file in a folder'))

  const swarm = new Hyperswarm()
  swarm.on('connection', (c) => store.replicate(c))
  await swarm.join(drive.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => swarm.destroy())

  const keyHex = b4a.toString(drive.key, 'hex')
  await readBack('hyperdrive', `hyper://${keyHex}/`, (res) => {
    assert(res.kind === 'file' && /hello from hyperdrive/.test(b4a.toString(res.buffer)), 'served index.html for "/"')
  })
  await readBack('hyperdrive', `hyper://${keyHex}/notes/`, (res) => {
    assert(res.kind === 'dir' && res.entries.some((e) => e.name === 'readme.txt'), 'listed /notes/ directory')
  })
}

async function testAutobase () {
  console.log('\n[autobase drive]')
  const store = new Corestore(tmp('pub-ab-'))
  const base = openAutobaseDrive(store, null)
  await base.ready()
  // Append filesystem ops in nomad's collaborative-drive format.
  await base.append({ op: 'put', path: '/index.html', data: '<h1>hello from autobase</h1>' })
  await base.append({ op: 'put', path: '/notes/readme.txt', data: 'a file in a folder' })
  await base.update()

  const swarm = new Hyperswarm()
  swarm.on('connection', (c) => store.replicate(c))
  await swarm.join(base.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => swarm.destroy())
  cleanups.push(() => base.close())

  const keyHex = b4a.toString(base.key, 'hex')
  await readBack('autobase', `hyper://${keyHex}/`, (res) => {
    assert(res.kind === 'file' && /hello from autobase/.test(b4a.toString(res.buffer)), 'served index.html from autobase (Hyperbee) view')
  })
  await readBack('autobase', `hyper://${keyHex}/notes/`, (res) => {
    assert(res.kind === 'dir' && res.entries.some((e) => e.name === 'readme.txt'), 'listed /notes/ from autobase view')
  })
}

async function testInlining () {
  console.log('\n[sub-resource inlining]')
  // 1x1 transparent PNG
  const png = b4a.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQNQqUKzAAAAAElFTkSuQmCC', 'base64')
  const store = new Corestore(tmp('pub-inline-'))
  const drive = new Hyperdrive(store)
  await drive.ready()
  await drive.put('/index.html', b4a.from(
    '<html><head><link rel="stylesheet" href="css/site.css">' +
    '<style>.hero{background:url(bg.png)}</style></head>' +
    '<body><img src="./logo.png"><script src="app.js"></script>' +
    '<a href="https://example.com">ext</a></body></html>'
  ))
  await drive.put('/css/site.css', b4a.from('body{background:url(../bg.png)}'))
  await drive.put('/logo.png', png)
  await drive.put('/bg.png', png)
  await drive.put('/app.js', b4a.from('console.log("hi")'))

  const swarm = new Hyperswarm()
  swarm.on('connection', (c) => store.replicate(c))
  await swarm.join(drive.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => swarm.destroy())

  const keyHex = b4a.toString(drive.key, 'hex')
  await readBack('hyperdrive', `hyper://${keyHex}/`, (res) => {
    const html = b4a.toString(res.buffer)
    assert(html.includes('data:image/png;base64'), 'inlined <img> + css background as data URIs')
    assert(html.includes('<style>') && html.includes('body{background:url(data:image/png'), 'inlined linked stylesheet + rewrote its url()')
    assert(/src=["']data:(text|application)\/javascript/.test(html), 'inlined <script src> as a data URI')
    assert(!/src=["']\.?\/?logo\.png/.test(html) && !/href=["']css\/site\.css/.test(html), 'removed the original relative refs')
    assert(html.includes('href="https://example.com"'), 'left the external <a> link untouched')
    assert(html.includes('ReactNativeWebView.postMessage') && html.includes(keyHex), 'injected the in-page navigation bridge')
  })
}

async function testAutoDetect () {
  console.log('\n[auto-detect drive type (try both)]')

  // A Hyperdrive published by one peer…
  const hdStore = new Corestore(tmp('auto-hd-'))
  const drive = new Hyperdrive(hdStore)
  await drive.ready()
  await drive.put('/index.json', b4a.from(JSON.stringify({ title: 'Ilya Radchenko' })))
  await drive.put('/index.html', b4a.from('<h1>i am a hyperdrive</h1>'))
  const hdSwarm = new Hyperswarm()
  hdSwarm.on('connection', (c) => hdStore.replicate(c))
  await hdSwarm.join(drive.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => hdSwarm.destroy())

  // …and an Autobase published by another.
  const abStore = new Corestore(tmp('auto-ab-'))
  const base = openAutobaseDrive(abStore, null)
  await base.ready()
  await base.append({ op: 'put', path: '/index.md', data: '# Autobase Forum\n\nHello **world**' })
  await base.update()
  const abSwarm = new Hyperswarm()
  abSwarm.on('connection', (c) => abStore.replicate(c))
  await abSwarm.join(base.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => abSwarm.destroy())
  cleanups.push(() => base.close())

  // The reader knows neither type up front. Hint hyperdrive both times so the
  // autobase case must fall through hyperdrive -> autobase.
  const manager = new DriveManager(new Corestore(tmp('auto-reader-')))
  cleanups.push(() => manager.close())

  const a = await manager.resolveAuto(drive.key, '/', 'hyperdrive', () => {})
  assert(a.driveType === 'hyperdrive' && /a hyperdrive/.test(b4a.toString(a.result.buffer)), 'detected hyperdrive')
  assert(a.title === 'Ilya Radchenko', 'title from index.json')

  const b = await manager.resolveAuto(base.key, '/', 'hyperdrive', () => {})
  const bHtml = b4a.toString(b.result.buffer)
  assert(b.driveType === 'autobase', 'detected autobase despite hyperdrive hint')
  assert(b.result.mime === 'text/html' && /<h1[^>]*>Autobase Forum<\/h1>/.test(bHtml) && /Hello <strong>world/.test(bHtml), 'rendered index.md to HTML')
  assert(b.title === 'Autobase Forum', 'title from index.md #')
}

async function testCreateDrive () {
  console.log('\n[create drive]')
  const manager = new DriveManager(new Corestore(tmp('creator-')))
  cleanups.push(() => manager.close())
  for (const type of ['hyperdrive', 'autobase']) {
    const { key, ns } = await manager.createDrive(type, { title: `My ${type}` })
    assert(!!key && !!ns, `${type}: created with a key + ns`)
    const res = await manager.resolve(type, b4a.from(key, 'hex'), '/')
    assert(res.kind === 'file' && /My /.test(b4a.toString(res.buffer)), `${type}: serves seeded index.html`)
  }
}

async function testAutobaseMultiwriter () {
  console.log('\n[autobase multiwriter (addWriter)]')
  const store = new Corestore(tmp('pub-abw-'))
  const base = openAutobaseDrive(store, null)
  await base.ready()
  // An addWriter op like nomad's "My Forum" — apply must write the writer
  // record into the view or a reader's view diverges from the signed output.
  const writerKey = b4a.toString(b4a.from(crypto.randomBytes(32)), 'hex')
  await base.append({ addWriter: writerKey, profileUrl: 'hyper://example/' })
  await base.append({ op: 'put', path: '/index.html', data: '<h1>forum</h1>' })
  await base.update()

  const swarm = new Hyperswarm()
  swarm.on('connection', (c) => store.replicate(c))
  await swarm.join(base.discoveryKey, { server: true, client: false }).flushed()
  cleanups.push(() => swarm.destroy())
  cleanups.push(() => base.close())

  const keyHex = b4a.toString(base.key, 'hex')
  await readBack('autobase', `hyper://${keyHex}/`, (res) => {
    assert(res.kind === 'file' && /forum/.test(b4a.toString(res.buffer)), 'reader replayed addWriter + served file (no decode error)')
  })
  await readBack('autobase', `hyper://${keyHex}/.data/walled.garden/writers/`, (res) => {
    assert(res.kind === 'dir' && res.entries.some((e) => e.name === `${writerKey}.json`), 'writer record present in replayed view')
  })
}

async function readBack (driveType, url, check) {
  const store = new Corestore(tmp('reader-'))
  const manager = new DriveManager(store)
  cleanups.push(() => manager.close())
  const { key, path: p } = parseHyperUrl(url)
  const res = await manager.resolve(driveType, key, p, (phase, msg, peers) =>
    console.log(`    … ${phase}: ${msg}${peers != null ? ` (${peers} peers)` : ''}`)
  )
  check(res)
}

main().catch((err) => {
  console.error('✗ crashed:', err)
  process.exit(1)
})
