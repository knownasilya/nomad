// The phone's viewer page for a PDF or an e-book in Assets: mobile/components/Assets.tsx writes
// it (mobile/lib/docViewerHtml.ts, made by scripts/build-doc-viewer.mjs) next to the file the
// backend put in the app's cache, and opens it in a WebView as
//
//   viewer.html?kind=pdf|book&file=<file: URL, or a name next to the page>&key=<asset id>&theme=<JSON { scheme, bg, text, link }>
//
// pdf.js and its worker ride in the page as text (<script type="text/plain">) and load as blob:
// modules. The page reads the file next to it; nothing here reaches the network.

import { showPdf } from './pdf-view.js'
import { openBook, BookError } from './book/parse.js'
import { createReader } from './book/reader.js'

const q = new URLSearchParams(location.search)
const kind = q.get('kind')
const file = q.get('file') || ''
let theme = { scheme: 'light', bg: '#fff', text: '#1f2328', link: '#4040e7' }
try {
  theme = { ...theme, ...JSON.parse(q.get('theme') || '{}') }
} catch {}
document.documentElement.dataset.scheme = theme.scheme
document.documentElement.style.setProperty('--page-bg', kind === 'book' ? theme.bg : '#000')

const app = document.getElementById('app')

function post(msg) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(msg))
  } catch {}
}

// Every step goes to the app, which logs it (Settings → Logs) and gives up on a page that has gone
// quiet: without them a PDF that never drew left only a black screen and nothing to go on.
const step = (name, more = {}) => post({ type: 'step', step: name, ...more })
window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message || e.error || 'error') }))
window.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason?.message || e.reason || 'rejection') }))

function fail(text) {
  const box = document.createElement('div')
  box.className = 'failed'
  box.textContent = text
  app.replaceChildren(box)
  post({ type: 'failed', message: text })
}

// The file next to this page. fetch() can't read file: URLs; XHR can.
function readFile(name) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // The phone passes the file's whole file: URL; a bare name is a file next to this page.
    xhr.open('GET', /^file:/i.test(name) ? name : encodeURIComponent(name))
    xhr.responseType = 'arraybuffer'
    let said = 0
    xhr.onprogress = (e) => {
      if (Date.now() - said < 1000) return
      said = Date.now()
      step('reading', { bytes: e.loaded })
    }
    xhr.onload = () => (xhr.response ? resolve(new Uint8Array(xhr.response)) : reject(new Error('The file is empty')))
    xhr.onerror = () => reject(new Error('The file couldn’t be read'))
    xhr.send()
  })
}

const moduleUrl = (id) => URL.createObjectURL(new Blob([document.getElementById(id).textContent], { type: 'text/javascript' }))

// pdf.js's worker, once it has said it's ready, or null after it runs pdf.js on this page instead.
// Handed a worker that never loaded, pdf.js waits for it forever, and an Android WebView left the
// screen black that way: a PDF that never opened, and nothing to say why.
const WORKER_WAIT_MS = 10000

async function pdfWorker() {
  const src = moduleUrl('pdfjs-worker')
  let worker = null
  let why = 'no answer'
  try {
    worker = new Worker(src, { type: 'module' })
    const ok = await new Promise((resolve) => {
      const done = (v) => {
        clearTimeout(timer)
        resolve(v)
      }
      const timer = setTimeout(() => done(false), WORKER_WAIT_MS)
      // The worker's first message is its "ready" (pdf.worker.mjs initializeFromPort).
      worker.addEventListener('message', (e) => e.data?.action === 'ready' && done(true))
      worker.addEventListener('error', (e) => {
        why = e.message || 'it didn’t load'
        done(false)
      })
    })
    if (ok) {
      step('worker')
      return worker
    }
  } catch (err) {
    why = err?.message || String(err)
  }
  worker?.terminate()
  // Imported here, the worker's module only sets globalThis.pdfjsWorker, which pdf.js then runs in
  // this page (its "fake worker"): slower to draw, but it draws.
  step('worker', { failed: why, fallback: 'this page' })
  await import(/* @vite-ignore */ src)
  return null
}

async function start() {
  step('start')
  const data = await readFile(file)
  step('read', { bytes: data.length })
  if (kind === 'pdf') {
    const pdfjs = await import(/* @vite-ignore */ moduleUrl('pdfjs'))
    step('pdfjs', { version: pdfjs.version })
    const worker = await pdfWorker()
    if (worker) pdfjs.GlobalWorkerOptions.workerPort = worker
    const node = document.createElement('div')
    node.className = 'pdf'
    app.replaceChildren(node)
    // The size this page has now: a WebView that hasn't laid it out yet says 0.
    step('layout', { width: innerWidth, height: innerHeight, dpr: devicePixelRatio })
    const { doc } = await showPdf(node, data, pdfjs, { root: null, maxWidth: 2000, onPage: (n) => step('page', { n }) })
    step('opened', { pages: doc.numPages, width: innerWidth, height: innerHeight })
  } else {
    const book = openBook(data)
    createReader(app, book, { key: q.get('key') || file, theme })
  }
  post({ type: 'ready' })
}

start().catch((err) => fail(err instanceof BookError ? err.message : `This ${kind === 'pdf' ? 'PDF' : 'book'} can’t be shown here (${err?.message || err})`))
