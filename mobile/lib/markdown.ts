// Pure parts of the phone's Markdown renderer (components/Markdown.tsx), which draws marked's
// tokens as native views. Tests: tests/unit/mobile-markdown.test.js.

// The words a run of inline tokens shows, without the Markdown around them.
export function plainText (tokens: any[] | undefined): string {
  return nestHtml(tokens).map((tk: any) => {
    if (tk.type === 'br') return '\n'
    if (tk.type === 'checkbox' || tk.type === 'html') return ''
    if (tk.type === 'tag' && tk.kind === 'hidden') return ''
    if (tk.tokens) return plainText(tk.tokens)
    if (tk.type === 'text') return decodeEntities(tk.text ?? '')
    return tk.text ?? ''
  }).join('')
}

// Column widths for a table, so its rows line up. A phone can't measure text before it lays it
// out, so this guesses from the characters: `ideal` fits a column's longest line, `min` its
// longest word (a cell never breaks inside a word). fitColumns then sizes them to the answer.
export const MIN_COL = 48
export const MAX_COL = 260
const CHAR_PX = 7.5
const CELL_PAD = 20

export interface Column { ideal: number, min: number }

export function measureColumns (tok: { header?: any[], rows?: any[][] }): Column[] {
  const header = tok.header || []
  const rows = tok.rows || []
  const count = Math.max(header.length, ...rows.map(r => r.length), 0)
  const cols: Column[] = []
  for (let c = 0; c < count; c++) {
    let line = 0
    let word = 0
    for (const cell of [header[c], ...rows.map(r => r[c])]) {
      if (!cell) continue
      // A header is bold, so its letters count a little wider.
      const scale = cell === header[c] ? 1.1 : 1
      const text = cell.tokens ? plainText(cell.tokens) : String(cell.text ?? '')
      for (const l of text.split('\n')) {
        line = Math.max(line, l.length * scale)
        for (const w of l.split(/\s+/)) word = Math.max(word, w.length * scale)
      }
    }
    const px = (chars: number) => Math.ceil(chars * CHAR_PX + CELL_PAD)
    const min = Math.min(MAX_COL, Math.max(MIN_COL, px(word)))
    cols.push({ ideal: Math.min(MAX_COL, Math.max(min, px(line))), min })
  }
  return cols
}

// Widths that fill `width`: a table that fits is stretched to the answer's width, as on desktop; a
// wider one gives up room from its long columns first (their cells wrap), never below a column's
// longest word. If even that is too wide, the table keeps those widths and scrolls sideways.
export function fitColumns (cols: Column[], width: number): number[] {
  const ideal = cols.map(c => c.ideal)
  const total = ideal.reduce((a, b) => a + b, 0)
  if (!cols.length || !(width > 0)) return ideal
  if (total <= width) {
    const extra = width - total
    const out = ideal.map(w => Math.floor(w + extra * w / total))
    out[out.length - 1] += width - out.reduce((a, b) => a + b, 0)
    return out
  }
  const floor = cols.map(c => c.min)
  const floorTotal = floor.reduce((a, b) => a + b, 0)
  if (floorTotal >= width) return floor
  // Share the room above the floors in proportion to how much more each column would like.
  const slack = total - floorTotal
  const room = width - floorTotal
  const out = cols.map(c => Math.floor(c.min + (c.ideal - c.min) * room / slack))
  out[out.length - 1] += width - out.reduce((a, b) => a + b, 0)
  return out
}

// The marker before a list item: its number, or a bullet that changes with depth as a browser's
// does (disc, circle, square).
const BULLETS = ['•', '◦', '▪']
export function listMarker (list: { ordered?: boolean, start?: number | string }, index: number, depth: number): string {
  if (list.ordered) {
    const start = Number(list.start)
    return `${(Number.isFinite(start) && list.start !== '' ? start : 1) + index}.`
  }
  return BULLETS[depth % BULLETS.length]
}

// textAlign for a table cell from marked's column alignment.
export function cellAlign (align: string | null | undefined): 'left' | 'center' | 'right' {
  return align === 'center' || align === 'right' ? align : 'left'
}

// ── HTML in Markdown ────────────────────────────────────────────────────────────────────────────
// A Markdown file may hold HTML (READMEs do: <sup>, <br>, <kbd>, <p align="center">, &dagger;).
// Nothing here runs or loads it: the tags a phone can draw as text become styled runs (`tag`
// tokens), a link keeps only an http(s), hyper, nomad, mailto or in-page href, a picture shows as a
// link named by its alt text, script/style/… and their contents are dropped, and any other tag is
// left out with its text kept. Entities (&amp; &dagger; &#169; &#x2014;) are decoded on text.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwj: '‍', zwnj: '‌', shy: '­', dagger: '†', Dagger: '‡', bull: '•', middot: '·', hellip: '…',
  mdash: '—', ndash: '–', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″', copy: '©', reg: '®', trade: '™',
  deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²',
  sup3: '³', micro: 'µ', para: '¶', sect: '§', cent: '¢', pound: '£', yen: '¥', euro: '€', curren: '¤',
  iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', not: '¬', macr: '¯', acute: '´', uml: '¨', cedil: '¸',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒', hArr: '⇔', crarr: '↵',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', equiv: '≡', infin: '∞', sum: '∑', prod: '∏', radic: '√', part: '∂',
  int: '∫', isin: '∈', notin: '∉', cap: '∩', cup: '∪', sub: '⊂', sup: '⊃', and: '∧', or: '∨', forall: '∀',
  exist: '∃', empty: '∅', nabla: '∇', there4: '∴', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  check: '✓', star: '☆', starf: '★', oline: '‾', frasl: '⁄', permil: '‰', alpha: 'α', beta: 'β', gamma: 'γ',
  delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', szlig: 'ß', aelig: 'æ', AElig: 'Æ', oslash: 'ø',
  Oslash: 'Ø', aring: 'å', Aring: 'Å', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ', eacute: 'é',
  Eacute: 'É', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', Auml: 'Ä',
  atilde: 'ã', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', oacute: 'ó', ograve: 'ò', ocirc: 'ô',
  ouml: 'ö', Ouml: 'Ö', otilde: 'õ', uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', Uuml: 'Ü', yacute: 'ý',
  yuml: 'ÿ', thorn: 'þ', eth: 'ð'
}

// Text with its character references decoded. One not known is left as it is.
export function decodeEntities (text: string): string {
  if (!text || text.indexOf('&') < 0) return text
  return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!(code > 0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, ref) ? ENTITIES[ref] : all
  })
}

// The inline tags drawn as styled text; `kind` is how components/Markdown.tsx draws each.
const INLINE_TAGS: Record<string, string> = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', cite: 'italic', dfn: 'italic', var: 'italic', q: 'quote',
  u: 'underline', ins: 'underline', s: 'del', strike: 'del', del: 'del', code: 'code', kbd: 'code', samp: 'code',
  tt: 'code', mark: 'mark', small: 'small', sup: 'sup', sub: 'sub', a: 'link', abbr: 'plain', span: 'plain', font: 'plain'
}
// Tags whose contents never show.
const HIDDEN_TAGS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'title', 'head', 'textarea', 'select', 'button', 'video', 'audio', 'canvas'])
// Tags that start a new line in an HTML block.
const BLOCK_TAGS = new Set(['p', 'div', 'center', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption', 'blockquote', 'pre', 'address', 'details', 'summary', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'body', 'html'])
const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr', 'input', 'meta', 'link', 'source', 'track', 'area', 'base', 'col', 'embed', 'param'])
const SAFE_HREF = /^(https?:|hyper:|nomad:|mailto:|#)/i

export interface HtmlPiece { kind: 'open' | 'close' | 'text'; name?: string; attrs?: Record<string, string>; selfClosing?: boolean; text?: string }

// HTML as a flat run of open tags, close tags and text. Comments, doctypes and stray `<` that open
// no tag are handled the way a browser would: the first two dropped, the last kept as text.
export function splitHtml (html: string): HtmlPiece[] {
  const out: HtmlPiece[] = []
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([A-Za-z][A-Za-z0-9-]*)\s*>|<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
  let last = 0
  for (const m of html.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: html.slice(last, at) })
    last = at + m[0].length
    if (m[1]) out.push({ kind: 'close', name: m[1].toLowerCase() })
    else if (m[2]) {
      const attrs: Record<string, string> = {}
      for (const a of (m[3] || '').matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
      }
      out.push({ kind: 'open', name: m[2].toLowerCase(), attrs, selfClosing: !!m[4] })
    }
  }
  if (last < html.length) out.push({ kind: 'text', text: html.slice(last) })
  return out
}

// One opened tag as a token: { type: 'tag', kind, href?, tokens }, or a picture as a link.
function tagToken (name: string, attrs: Record<string, string> = {}): any {
  if (HIDDEN_TAGS.has(name)) return { type: 'tag', kind: 'hidden', tag: name, tokens: [] }
  const kind = INLINE_TAGS[name] || (/^h[1-6]$/.test(name) ? 'bold' : 'plain')
  const tok: any = { type: 'tag', kind, tag: name, tokens: [] }
  if (kind === 'link') {
    const href = (attrs.href || '').trim()
    if (SAFE_HREF.test(href)) tok.href = href
    else tok.kind = 'plain'
  }
  return tok
}

function imageToken (attrs: Record<string, string> = {}): any {
  const src = (attrs.src || '').trim()
  const text = attrs.alt || attrs.title || ''
  if (!SAFE_HREF.test(src) || src.startsWith('#')) return text ? { type: 'text', text } : null
  return { type: 'image', href: src, text: text || src }
}

// marked's inline tokens with its `html` ones (each a tag, or a few) made into nested `tag` tokens.
// Each run of tokens is done once: Markdown.tsx calls it for every run it draws, and tokens it has
// made pass through untouched.
export function nestHtml (tokens: any[] | undefined): any[] {
  if (!tokens || !tokens.some((tk) => tk && (tk.type === 'html' || tk.type === 'br'))) return tokens || []
  const root: any = { tokens: [] }
  const stack: any[] = [root]
  const top = () => stack[stack.length - 1]
  const push = (tk: any) => {
    if (!tk) return
    const list = top().tokens
    // A line break swallows the source's own newline after it (`<br>\n`), as HTML does.
    if (tk.type === 'text' && list.length && list[list.length - 1].type === 'br' && typeof tk.text === 'string' && tk.text.startsWith('\n')) {
      tk = { ...tk, text: tk.text.replace(/^\n[ \t]*/, ''), raw: tk.raw }
      if (!tk.text) return
    }
    list.push(tk)
  }
  for (const tk of tokens) {
    if (!tk || tk.type !== 'html') { push(tk); continue }
    for (const p of splitHtml(String(tk.text ?? tk.raw ?? ''))) {
      if (p.kind === 'text') { if (p.text) push({ type: 'text', text: p.text }); continue }
      const name = p.name!
      if (p.kind === 'close') {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === name) { stack.length = i; break }
        }
        continue
      }
      if (name === 'br' || name === 'hr') { push({ type: 'br' }); continue }
      if (name === 'img') { push(imageToken(p.attrs)); continue }
      if (VOID_TAGS.has(name) || p.selfClosing) continue
      const t = tagToken(name, p.attrs)
      push(t)
      stack.push(t)
    }
  }
  // A <br> that ends the run (a README's list of links, one per line) adds no empty line.
  while (root.tokens.length && root.tokens[root.tokens.length - 1].type === 'br' && tokens[tokens.length - 1]?.type === 'html') root.tokens.pop()
  return root.tokens
}

// An HTML block (marked's block `html` token) as inline tokens to draw as one paragraph: block tags
// start lines, a list item gets a bullet, runs of white space are one space (but in <pre>).
// -> [] when nothing in it shows.
export function htmlBlock (html: string): any[] {
  const root: any = { tokens: [] }
  const stack: any[] = [root]
  let pre = 0
  const top = () => stack[stack.length - 1]
  const hidden = () => stack.some((t) => t.kind === 'hidden')
  const lastText = (): string => {
    // The text drawn so far, at its end, to know whether a line has just started.
    const walk = (list: any[]): string | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const tk = list[i]
        if (tk.type === 'br') return '\n'
        if (tk.type === 'text' && tk.text) return tk.text
        if (tk.tokens) { const r = walk(tk.tokens); if (r != null) return r }
        if (tk.type === 'image') return tk.text
      }
      return null
    }
    return walk(root.tokens) ?? '\n'
  }
  const newLine = () => {
    if (lastText().endsWith('\n')) return
    const list = top().tokens
    const end = list[list.length - 1]
    if (end && end.type === 'text' && !pre) list[list.length - 1] = { ...end, text: end.text.replace(/[ \t]+$/, '') }
    list.push({ type: 'br' })
  }
  for (const p of splitHtml(html)) {
    if (p.kind === 'text') {
      if (hidden()) continue
      let text = p.text || ''
      if (!pre) {
        text = text.replace(/\s+/g, ' ')
        if (lastText().endsWith('\n') || /\s$/.test(lastText())) text = text.replace(/^ /, '')
      }
      if (text) top().tokens.push({ type: 'text', text })
      continue
    }
    const name = p.name!
    if (p.kind === 'close') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) { stack.length = i; break }
      }
      if (name === 'pre') pre = Math.max(0, pre - 1)
      if (BLOCK_TAGS.has(name) && !hidden()) newLine()
      continue
    }
    if (hidden() && !HIDDEN_TAGS.has(name)) continue
    if (name === 'br') { top().tokens.push({ type: 'br' }); continue }
    if (name === 'hr') { newLine(); continue }
    if (name === 'img') { const img = imageToken(p.attrs); if (img) top().tokens.push(img); continue }
    if (VOID_TAGS.has(name) || p.selfClosing) continue
    if (BLOCK_TAGS.has(name)) {
      newLine()
      if (name === 'pre') pre++
      if (name === 'li') top().tokens.push({ type: 'text', text: '• ' })
      if (/^h[1-6]$/.test(name) || name === 'dt' || name === 'summary' || name === 'pre') {
        const t = { type: 'tag', kind: name === 'pre' ? 'code' : 'bold', tag: name, tokens: [] }
        top().tokens.push(t)
        stack.push(t)
      } else stack.push({ type: 'tag', kind: 'plain', tag: name, tokens: top().tokens, flat: true })
      continue
    }
    const t = tagToken(name, p.attrs)
    top().tokens.push(t)
    stack.push(t)
  }
  // Trim the line breaks and spaces at its ends.
  const list = root.tokens
  while (list.length && (list[list.length - 1].type === 'br' || (list[list.length - 1].type === 'text' && !list[list.length - 1].text.trim()))) list.pop()
  while (list.length && (list[0].type === 'br' || (list[0].type === 'text' && !list[0].text.trim()))) list.shift()
  if (list.length && list[list.length - 1].type === 'text') list[list.length - 1] = { ...list[list.length - 1], text: list[list.length - 1].text.replace(/\s+$/, '') }
  return plainText(list).trim() || list.some((tk: any) => tk.type === 'image') ? list : []
}
