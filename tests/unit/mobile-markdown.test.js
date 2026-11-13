// The pure parts of the phone's Markdown renderer (mobile/lib/markdown.ts), used by
// mobile/components/Markdown.tsx for AI answers. The tokens are shaped as marked's lexer (GFM)
// gives them.

import { describe, it, expect } from 'vitest'
import { plainText, measureColumns, fitColumns, listMarker, cellAlign, MIN_COL, MAX_COL } from '../../mobile/lib/markdown.ts'

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
