// The pure parts of the phone's Markdown renderer (mobile/lib/markdown.ts), used by
// mobile/components/Markdown.tsx for AI answers. The tokens are shaped as marked's lexer (GFM)
// gives them.

import { describe, it, expect } from 'vitest'
import { plainText, measureColumns, fitColumns, listMarker, cellAlign, MIN_COL, MAX_COL, decodeEntities, nestHtml, htmlBlock, splitHtml } from '../../mobile/lib/markdown.ts'

const text = (t) => ({ type: 'text', text: t })
const cell = (tokens) => ({ text: '', tokens })

describe('plainText', () => {
  it('drops the Markdown around inline text', () => {
    expect(plainText([
      { type: 'strong', text: 'x', tokens: [text('bold')] },
      text(' and '),
      { type: 'codespan', text: 'code' },
      { type: 'br' },
      { type: 'link', href: 'https://a.example', tokens: [text('a link')] }
    ])).toBe('bold and code\na link')
  })

  it('leaves out a task checkbox', () => {
    expect(plainText([{ type: 'checkbox', checked: true }, text('done')])).toBe('done')
  })
})

describe('measureColumns', () => {
  const table = {
    header: [cell([text('#')]), cell([text('Name')]), cell([text('Notes')])],
    rows: [
      [cell([text('1')]), cell([{ type: 'strong', tokens: [text('Lisbon')] }]), cell([text('word '.repeat(60))])],
      [cell([text('2')]), cell([text('Porto')]), cell([text('short')])]
    ]
  }

  it('gives each column room for its longest line, within limits', () => {
    const cols = measureColumns(table)
    expect(cols).toHaveLength(3)
    expect(cols[0]).toEqual({ ideal: MIN_COL, min: MIN_COL })
    expect(cols[1].ideal).toBeGreaterThan(MIN_COL)
    expect(cols[1].ideal).toBeLessThan(MAX_COL)
    expect(cols[2].ideal).toBe(MAX_COL)
  })

  it("never goes below a column's longest word", () => {
    const [col] = measureColumns({ header: [cell([text('Word')])], rows: [[cell([text('a supercalifragilistic word')])]] })
    expect(col.min).toBeGreaterThan(MIN_COL)
    expect(col.min).toBeLessThan(col.ideal)
  })

  it('counts a column that only some rows fill', () => {
    const cols = measureColumns({ header: [cell([text('A')])], rows: [[cell([text('a')]), cell([text('extra column')])]] })
    expect(cols).toHaveLength(2)
    expect(cols[1].ideal).toBeGreaterThan(MIN_COL)
  })

  it('is empty for an empty table', () => {
    expect(measureColumns({})).toEqual([])
  })
})

describe('fitColumns', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0)

  it('stretches a narrow table to the width, keeping proportions', () => {
    const out = fitColumns([{ ideal: 50, min: 50 }, { ideal: 100, min: 60 }], 300)
    expect(sum(out)).toBe(300)
    expect(out[1]).toBeGreaterThan(out[0])
  })

  it('narrows the long columns first when the table is too wide', () => {
    const out = fitColumns([{ ideal: 60, min: 60 }, { ideal: 260, min: 80 }, { ideal: 120, min: 70 }], 300)
    expect(sum(out)).toBe(300)
    expect(out[0]).toBe(60)
    expect(out[1]).toBeGreaterThanOrEqual(80)
    expect(out[2]).toBeGreaterThanOrEqual(70)
  })

  it('keeps the floors and lets the table scroll when even they are too wide', () => {
    expect(fitColumns([{ ideal: 200, min: 150 }, { ideal: 200, min: 150 }], 250)).toEqual([150, 150])
  })

  it('uses the ideal widths before the width is known', () => {
    expect(fitColumns([{ ideal: 70, min: 50 }], 0)).toEqual([70])
  })
})

describe('listMarker', () => {
  it('numbers an ordered list from its start', () => {
    expect(listMarker({ ordered: true, start: 1 }, 0, 0)).toBe('1.')
    expect(listMarker({ ordered: true, start: 3 }, 2, 0)).toBe('5.')
    expect(listMarker({ ordered: true, start: '' }, 1, 0)).toBe('2.')
  })

  it('changes the bullet with depth', () => {
    expect(listMarker({ ordered: false, start: '' }, 0, 0)).toBe('•')
    expect(listMarker({ ordered: false }, 4, 1)).toBe('◦')
    expect(listMarker({ ordered: false }, 0, 2)).toBe('▪')
    expect(listMarker({ ordered: false }, 0, 3)).toBe('•')
  })
})

describe('cellAlign', () => {
  it('maps marked alignments to textAlign', () => {
    expect(cellAlign('right')).toBe('right')
    expect(cellAlign('center')).toBe('center')
    expect(cellAlign('left')).toBe('left')
    expect(cellAlign(null)).toBe('left')
  })
})

describe('HTML in Markdown', () => {
  // As marked's lexer gives a paragraph's inline tokens.
  const html = (h) => ({ type: 'html', raw: h, text: h, block: false })

  it('decodes named and numeric character references, and leaves unknown ones', () => {
    expect(decodeEntities('AT&amp;T &dagger; &Dagger; &copy; &#169; &#x2014; &nbsp;|&bogus; &')).toBe('AT&T † ‡ © © —  |&bogus; &')
    expect(decodeEntities('&#0; &#xD800; &#x110000;')).toBe('� � �')
  })

  it('nests inline tags around the tokens between them', () => {
    const out = nestHtml([html('<sup>'), text('&dagger;: note '), { type: 'link', href: 'https://a.example', tokens: [text('more')] }, html('</sup>'), html('<br>'), text('\nnext')])
    expect(out.map((t) => t.type)).toEqual(['tag', 'br', 'text'])
    expect(out[0]).toMatchObject({ kind: 'sup', tag: 'sup' })
    expect(out[0].tokens.map((t) => t.type)).toEqual(['text', 'link'])
    // The source's newline after a <br> is not a second line break.
    expect(out[2].text).toBe('next')
    expect(plainText(out)).toBe('†: note more\nnext')
  })

  it('drops a trailing <br>, scripts and their text, and unsafe links', () => {
    const out = nestHtml([text('a'), html('<script>'), text('alert(1)'), html('</script>'), html('<a href="javascript:alert(1)">'), text('b'), html('</a>'), html('<a href="https://ok.example">'), text('c'), html('</a>'), html('<br>')])
    expect(out.map((t) => t.type === 'tag' ? t.kind : t.type)).toEqual(['text', 'hidden', 'plain', 'link'])
    expect(out[3].href).toBe('https://ok.example')
    expect(plainText(out)).toBe('abc')
  })

  it('styles the tags a phone can draw, keeps the text of others, and skips comments', () => {
    const kinds = (h) => nestHtml([html(`<${h}>`), text('x'), html(`</${h}>`)])[0]
    expect(kinds('b').kind).toBe('bold')
    expect(kinds('kbd').kind).toBe('code')
    expect(kinds('sub').kind).toBe('sub')
    expect(kinds('mark').kind).toBe('mark')
    expect(kinds('blink').kind).toBe('plain')
    expect(nestHtml([html('<!-- note -->'), text('y')])).toEqual([text('y')])
  })

  it('shows a picture as a link named by its alt text, and never loads it', () => {
    expect(nestHtml([html('<img src="https://a.example/logo.png" alt="Logo">')])).toEqual([{ type: 'image', href: 'https://a.example/logo.png', text: 'Logo' }])
    expect(nestHtml([html('<img src="logo.png" alt="Logo">')])).toEqual([{ type: 'text', text: 'Logo' }])
  })

  it('draws an HTML block as one paragraph: block tags start lines, white space collapses', () => {
    const out = htmlBlock('<p align="center">\n  <img src="https://a.example/x.png" alt="Logo">\n  <b>Hi</b>   &amp; bye\n</p>\n<ul><li>one</li><li>two</li></ul>')
    expect(plainText(out)).toBe('Logo Hi & bye\n• one\n• two')
    expect(out.find((t) => t.type === 'tag').kind).toBe('bold')
  })

  it('shows nothing for a block that holds only a comment, a closing tag or a script', () => {
    expect(htmlBlock('<!-- hidden -->')).toEqual([])
    expect(htmlBlock('</details>')).toEqual([])
    expect(htmlBlock('<script>alert(1)</script>')).toEqual([])
  })

  it('keeps a <pre> block’s lines', () => {
    expect(plainText(htmlBlock('<pre>a  b\nc</pre>'))).toBe('a  b\nc')
  })

  it('splits HTML into tags and text, with attributes decoded', () => {
    expect(splitHtml('<a href="x?a=1&amp;b=2" title=\'t\'>hi</a><br/>')).toEqual([
      { kind: 'open', name: 'a', attrs: { href: 'x?a=1&b=2', title: 't' }, selfClosing: false },
      { kind: 'text', text: 'hi' },
      { kind: 'close', name: 'a' },
      { kind: 'open', name: 'br', attrs: {}, selfClosing: true }
    ])
    expect(splitHtml('1 < 2')).toEqual([{ kind: 'text', text: '1 < 2' }])
  })
})
