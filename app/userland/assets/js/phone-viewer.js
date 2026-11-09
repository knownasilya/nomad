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
    xhr.onload = () => (xhr.response ? resolve(new Uint8Array(xhr.response)) : reject(new Error('The file is empty')))
    xhr.onerror = () => reject(new Error('The file couldn’t be read'))
    xhr.send()
  })
}

const moduleUrl = (id) => URL.createObjectURL(new Blob([document.getElementById(id).textContent], { type: 'text/javascript' }))

async function start() {
  const data = await readFile(file)
  if (kind === 'pdf') {
    const pdfjs = await import(/* @vite-ignore */ moduleUrl('pdfjs'))
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(moduleUrl('pdfjs-worker'), { type: 'module' })
    const node = document.createElement('div')
    node.className = 'pdf'
    app.replaceChildren(node)
    await showPdf(node, data, pdfjs, { root: null, maxWidth: 2000 })
  } else {
    const book = openBook(data)
    createReader(app, book, { key: q.get('key') || file, theme })
  }
  post({ type: 'ready' })
}

start().catch((err) => fail(err instanceof BookError ? err.message : `This ${kind === 'pdf' ? 'PDF' : 'book'} can’t be shown here (${err?.message || err})`))
