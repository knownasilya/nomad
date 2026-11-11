// An HTML page the user's AI draws from the AI Sidebar's components (ADR-0027): an OpenUI Lang
// program, the same language as an answer's ```openui-lang fence, saved to Assets as one .html file
// (saveAsset's `openui`). The file carries everything it needs: the program, the sidebar's
// <nomad-genui> as one inline script (app/fg/genui-page/, built to index.build.js), the colors in
// light and dark, and Font Awesome's solid font with only the icons the page can show. So it
// opens the same in Assets' sandboxed preview, on the phone, or downloaded into any browser. It
// loads nothing but a Map's OpenStreetMap tiles.
//
// Pure: the caller reads the script, the icon CSS and the font (app/bg/ai/genui-page.js).

// The icons <nomad-genui> draws by itself; an EntityCard names its own (see iconNames).
const BUILT_IN_ICONS = [
  'arrow-down',
  'arrow-up',
  'caret-down',
  'caret-up',
  'chart-bar',
  'check',
  'check-circle',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'clock',
  'comment-alt',
  'copy',
  'exclamation-circle',
  'exclamation-triangle',
  'external-link-alt',
  'folder',
  'folder-open',
  'globe',
  'hdd',
  'info-circle',
  'map-marker-alt',
  'spinner',
  'star',
  'star-half-alt',
  'table',
  'times',
]

const ICON_RULE = /\.fa-([a-z0-9-]+):before\{content:"([^"]+)"\}/g

// Every icon name the page might show: the built-in ones, and any quoted word in the program that
// looks like one (an EntityCard's icon is a string argument).
export function iconNames(source) {
  const names = new Set(BUILT_IN_ICONS)
  for (const m of String(source || '').matchAll(/"([a-z0-9][a-z0-9-]{0,39})"/g)) names.add(m[1])
  return names
}

// Font Awesome's CSS (fa-all.min.css) cut down to its base rules and the icons in `names`, with no
// @font-face (the page declares its own, with the font inline).
export function iconCss(faCss, names) {
  const text = String(faCss || '').replace(/@font-face\{[^}]*\}/g, '')
  const keep = []
  for (const m of text.matchAll(ICON_RULE)) if (names.has(m[1])) keep.push(m[0])
  return text.replace(ICON_RULE, '').replace(/\/\*[\s\S]*?\*\//g, '').trim() + keep.join('')
}

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// JSON that is safe inside a <script> element.
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

// A script's text that can't close its <script> element early.
const scriptText = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

// The sidebar's colors (ai-sidebar.js and design-tokens.css), which <nomad-genui> reads.
const COLORS = `:root{color-scheme:light dark;--bg-color--foreground:#fff;--bg-color--background:#f5f5f5;--text-color--input:#222;--ai-text:#222;--ai-text-muted:#6e6e78;--ai-accent:#2864dc;--ai-accent--hover:#1f55c0;--ai-border:#e2e2e8;--ai-hover:rgba(0,0,0,.05);--ai-code-bg:rgba(0,0,0,.045)}
@media (prefers-color-scheme:dark){:root{--bg-color--foreground:#333;--bg-color--background:#1f1f1f;--text-color--input:#eee;--ai-text:#eee;--ai-text-muted:#9d9da6;--ai-accent:#3f7bf0;--ai-accent--hover:#5a8ff5;--ai-border:#3a3a3a;--ai-hover:rgba(255,255,255,.07);--ai-code-bg:rgba(255,255,255,.05)}}
html{background:var(--page-bg,#fff)}
@media (prefers-color-scheme:dark){html{--page-bg:#1f1f1f}}
body{margin:0;color:var(--ai-text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:28px 20px 36px}
h1{margin:0 0 16px;font-size:22px;line-height:1.3}
footer{max-width:960px;margin:0 auto;padding:0 20px 24px;color:var(--ai-text-muted);font-size:12px}`

/**
 * The page.
 * @param {{ title?: string, source: string, script: string, faCss?: string, fontBase64?: string, made?: string }} p
 *   `script` is app/fg/genui-page/index.build.js; `faCss` fa-all.min.css; `fontBase64` fa-solid-900.woff2;
 *   `made` a line for the footer.
 */
export function genuiPage({ title = '', source, script, faCss = '', fontBase64 = '', made = '' }) {
  const t = String(title || '').trim()
  const font = fontBase64
    ? `@font-face{font-family:"Font Awesome 5 Free";font-style:normal;font-weight:900;font-display:block;src:url(data:font/woff2;base64,${fontBase64}) format("woff2")}\n`
    : ''
  const data = { source: String(source || ''), iconCss: faCss ? iconCss(faCss, iconNames(source)) : '' }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Nomad">
<title>${escHtml(t || 'Untitled')}</title>
<style>
${font}${COLORS}
</style>
<script type="application/json" id="nomad-genui">${scriptJson(data)}</script>
</head>
<body>
<main>
${t ? `<h1>${escHtml(t)}</h1>\n` : ''}<div id="nomad-genui-root"></div>
</main>
${made ? `<footer>${escHtml(made)}</footer>\n` : ''}<script>${scriptText(script)}</script>
</body>
</html>
`
}

// The program in a page this module made, or null (for reading one back).
export function pageSource(html) {
  const m = /<script type="application\/json" id="nomad-genui">([\s\S]*?)<\/script>/.exec(String(html || ''))
  if (!m) return null
  try {
    return String(JSON.parse(m[1]).source ?? '')
  } catch {
    return null
  }
}
