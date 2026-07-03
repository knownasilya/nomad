import b4a from 'b4a'
import mime from 'mime'

// Make a hyper:// HTML page self-contained so it renders inside a WebView that
// can't speak hyper:// itself. We resolve relative sub-resources (images,
// scripts, stylesheets, and CSS url() references) from the same drive and
// inline them as data: URIs. Absolute http(s)/data/anchor links are left alone.

const MAX_ASSET = 8 * 1024 * 1024 // 8 MB per asset
const MAX_TOTAL = 24 * 1024 * 1024 // 24 MB total inlined

export async function inlineAssets (view, htmlPath, html, keyHex) {
  const baseDir = dirname(htmlPath)
  const budget = { used: 0 }

  // 1. Rewrite url() in existing inline <style> blocks (resolve vs the page).
  html = await replaceAsync(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi, async (m, css) => {
    const rewritten = await rewriteCssUrls(view, baseDir, css, budget)
    return m.replace(css, rewritten)
  })

  // 2. Replace <link rel="stylesheet" href="rel.css"> with an inline <style>,
  //    rewriting url()s relative to the stylesheet's own directory.
  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag
    const href = attr(tag, 'href')
    if (!isInlineable(href)) return tag
    const path = resolvePath(baseDir, href)
    const buf = await load(view, path, budget)
    if (!buf) return tag
    const css = await rewriteCssUrls(view, dirname(path), b4a.toString(buf), budget)
    return `<style>\n${css}\n</style>`
  })

  // 3. Inline src="" assets (img/script/source/audio/video/iframe).
  html = await replaceAsync(html, /\ssrc=(["'])([^"']*)\1/gi, async (m, q, ref) => {
    if (!isInlineable(ref)) return m
    const path = resolvePath(baseDir, ref)
    const uri = await dataUri(view, path, budget)
    return uri ? ` src=${q}${uri}${q}` : m
  })

  // 4. Inject a bridge so in-page relative links navigate back through the
  //    backend instead of dead-ending in the WebView.
  if (keyHex) html += navigationBridge(keyHex, baseDir)

  return html
}

function navigationBridge (keyHex, baseDir) {
  const KEY = JSON.stringify(keyHex)
  const DIR = JSON.stringify(baseDir)
  return `
<script>(function(){
  var KEY=${KEY}, DIR=${DIR};
  try { window.__hyperBase = 'hyper://' + KEY + '/'; } catch(e){}
  function resolve(href){
    if(!href) return null;
    if(href.charAt(0)==='#') return null;
    if(/^[a-z]+:/i.test(href)) return href.indexOf('hyper://')===0 ? href : null;
    var path = href.charAt(0)==='/' ? href : DIR+href;
    var out=[], segs=path.split('?')[0].split('#')[0].split('/');
    for(var i=0;i<segs.length;i++){var s=segs[i]; if(s===''||s==='.')continue; if(s==='..'){out.pop();continue;} out.push(s);}
    return 'hyper://'+KEY+'/'+out.join('/');
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if(!a) return;
    var url = resolve(a.getAttribute('href'));
    if(!url) return;
    e.preventDefault();
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'navigate',url:url}));
  }, true);
})();</script>`
}

async function rewriteCssUrls (view, baseDir, css, budget) {
  return replaceAsync(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async (m, q, ref) => {
    if (!isInlineable(ref)) return m
    const path = resolvePath(baseDir, ref)
    const uri = await dataUri(view, path, budget)
    return uri ? `url(${uri})` : m
  })
}

async function dataUri (view, path, budget) {
  const buf = await load(view, path, budget)
  if (!buf) return null
  const type = mime.getType(path) || 'application/octet-stream'
  return `data:${type};base64,${b4a.toString(buf, 'base64')}`
}

async function load (view, path, budget) {
  if (!path) return null
  try {
    const buf = await view.read(path)
    if (!buf) return null
    if (buf.byteLength > MAX_ASSET || budget.used + buf.byteLength > MAX_TOTAL) return null
    budget.used += buf.byteLength
    return buf
  } catch {
    return null
  }
}

// --- url helpers -----------------------------------------------------------

function isInlineable (ref) {
  if (!ref) return false
  return !/^(https?:|data:|blob:|mailto:|tel:|javascript:|hyper:|#|\/\/)/i.test(ref)
}

function dirname (p) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i + 1)
}

function resolvePath (baseDir, ref) {
  let r = ref.split('#')[0].split('?')[0]
  if (!r) return null
  const abs = r.startsWith('/') ? r : baseDir + r
  const parts = []
  for (const seg of abs.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  return '/' + parts.join('/')
}

function attr (tag, name) {
  const m = tag.match(new RegExp(`${name}=(["'])([^"']*)\\1`, 'i'))
  return m ? m[2] : null
}

// Run an async replacer over every regex match.
async function replaceAsync (str, regex, fn) {
  const tasks = []
  str.replace(regex, (...args) => {
    tasks.push(fn(...args))
    return ''
  })
  const results = await Promise.all(tasks)
  let i = 0
  return str.replace(regex, () => results[i++])
}
