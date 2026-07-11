// Wrap a rendered-Markdown HTML fragment in a standalone, readable document.
// The CSS follows the system colour scheme so it sits well next to the app's
// light/dark chrome. The result then goes through inlineAssets(), so relative
// images and links inside the Markdown resolve against the drive.
export function renderMarkdownDoc (bodyHtml, path, title = null) {
  const titleTag = title
    ? `<title>${String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>\n`
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8">
${titleTag}<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; --fg:#1c1c22; --muted:#56565f; --bg:#ffffff; --border:#e2e2e8; --code:#f4f4f6; --accent:#1d59c7; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#ededf2; --muted:#b2b2bc; --bg:#191919; --border:#34343b; --code:#26262b; --accent:#5b8cff; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:16px/1.65 -apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
  -webkit-text-size-adjust:100%; }
.md { max-width:720px; margin:0 auto; padding:24px 18px 64px; }
.md h1,.md h2,.md h3,.md h4 { line-height:1.25; margin:1.6em 0 .5em; font-weight:700; }
.md h1 { font-size:1.8em; margin-top:.2em; }
.md h2 { font-size:1.4em; border-bottom:1px solid var(--border); padding-bottom:.25em; }
.md h3 { font-size:1.15em; }
.md p,.md ul,.md ol,.md blockquote,.md table { margin:0 0 1em; }
.md a { color:var(--accent); text-decoration:none; }
.md a:hover { text-decoration:underline; }
.md img { max-width:100%; height:auto; border-radius:6px; }
.md code { background:var(--code); padding:.15em .4em; border-radius:4px; font-size:.9em;
  font-family:ui-monospace,Menlo,Consolas,monospace; }
.md pre { background:var(--code); padding:14px 16px; border-radius:8px; overflow:auto; }
.md pre code { background:none; padding:0; }
.md blockquote { border-left:3px solid var(--border); margin-left:0; padding-left:16px; color:var(--muted); }
.md hr { border:none; border-top:1px solid var(--border); margin:2em 0; }
.md table { border-collapse:collapse; width:100%; }
.md th,.md td { border:1px solid var(--border); padding:6px 10px; text-align:left; }
</style></head>
<body><div class="md">${bodyHtml}</div></body></html>`
}
