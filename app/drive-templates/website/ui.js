// Routes are extensionless virtual paths (/, /about, …) with page content stored
// under /pages/<route>.html. A route has no real file, so the manifest `fallback`
// serves this shell there and we render the stored page into it. (/index.html is
// the shell itself; storing pages at real .html paths would win the navigation
// and serve them raw, outside the site chrome.)
var route = location.pathname.replace(/\/$/, '') || '/'
var pathname = route === '/' || route === '/index.html'
  ? '/pages/index.html'
  : `/pages${route}.html`

const $ = (sel, parent = document) => parent.querySelector(sel)
const nav = $('nav')
const main = $('main')
const editor = $('#editor')

async function readPage () {
  return nomad.fs.readFile(pathname).catch(e => '')
}

async function onNew (e) {
  var page = prompt('Enter the name of your new page')
  if (!page) return
  page = page.replace(/\.html$/, '').replace(/^\//, '')
  await nomad.fs.writeFile(`/pages/${page}.html`, `<h1>${page}</h1>`)
  location.pathname = `/${page}`
}

async function onSave (e) {
  await nomad.fs.writeFile(pathname, editor.value)
  location.reload()
}

async function onDelete (e) {
  if (!confirm('Are you sure?')) return
  await nomad.fs.unlink(pathname)
  location.reload()
}

async function enterEditMode () {
  $('.view-mode', nav).classList.remove('active')
  $('.edit-mode', nav).classList.add('active')
  main.classList.remove('active')
  editor.classList.add('active')
  editor.value = await readPage()
}

async function enterViewMode () {
  $('.view-mode', nav).classList.add('active')
  $('.edit-mode', nav).classList.remove('active')
  main.classList.add('active')
  editor.classList.remove('active')
  main.innerHTML = await readPage()
}

async function setup () {
  // register event listeners
  $('button.new', nav).addEventListener('click', onNew)
  $('button.edit', nav).addEventListener('click', e => enterEditMode())
  $('button.remove', nav).addEventListener('click', onDelete)
  $('button.save', nav).addEventListener('click', onSave)
  $('button.cancel', nav).addEventListener('click', e => enterViewMode())

  // start in view mode
  enterViewMode()
}
setup()