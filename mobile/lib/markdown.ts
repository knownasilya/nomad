// Pure parts of the phone's Markdown renderer (components/Markdown.tsx), which draws marked's
// tokens as native views. Tests: tests/unit/mobile-markdown.test.js.

// The words a run of inline tokens shows, without the Markdown around them.
export function plainText (tokens: any[] | undefined): string {
  return (tokens || []).map((tk: any) => {
    if (tk.type === 'br') return '\n'
    if (tk.type === 'checkbox') return ''
    if (tk.tokens) return plainText(tk.tokens)
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
