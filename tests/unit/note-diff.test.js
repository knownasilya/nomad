// The edits live Notes make from a whole-body write (shared/note-diff.mjs, ADR-0041).

import { describe, it, expect } from 'vitest'
import { diffEdits, applyEdits, rebaseEdits } from '../../shared/note-diff.mjs'

const cases = [
  ['', ''],
  ['', 'hello'],
  ['hello', ''],
  ['# Groceries\nmilk\neggs\n', '# Groceries\nmilk\nbread\neggs\n'],
  ['# Plan\n\n- one\n- two\n- three\n', '# Plan\n\n- one\n- 2\n- three\n- four\n'],
  ['a\nb\nc\nd\ne', 'a\nB\nc\nD\ne'],
  ['no newline at end', 'no newline at the end'],
  ['line\n', 'line\nline\n'],
  ['x\ny\nz\n', 'z\ny\nx\n'],
]

describe('diffEdits', () => {
  it('turns one text into the other', () => {
    for (const [a, b] of cases) expect(applyEdits(a, diffEdits(a, b))).toBe(b)
  })

  it('is small for a small change', () => {
    const a = '# Trip\n\nPack the tent and the stove.\nBuy fuel.\n'
    const b = '# Trip\n\nPack the tent and the big stove.\nBuy fuel.\n'
    expect(diffEdits(a, b)).toEqual([{ from: a.indexOf('stove'), to: a.indexOf('stove'), insert: 'big ' }])
  })

  it('keeps edits in separate places apart', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\n'
    const b = 'ONE\ntwo\nthree\nfour\nFIVE\n'
    const edits = diffEdits(a, b)
    expect(edits.length).toBe(2)
    expect(edits[0].from).toBeLessThan(edits[1].from)
  })
})

describe('rebaseEdits', () => {
  it('moves edits past text someone else added', () => {
    const base = 'Title\n\nfirst\nsecond\n'
    const mine = 'Title\n\nfirst\nsecond\nthird\n' // the AI adds a line at the end
    const now = 'Title (draft)\n\nfirst\nsecond\n' // the user retitled meanwhile
    const edits = rebaseEdits(base, diffEdits(base, mine), now)
    expect(applyEdits(now, edits)).toBe('Title (draft)\n\nfirst\nsecond\nthird\n')
  })

  it('refuses edits to text that changed', () => {
    const base = 'one two three'
    expect(rebaseEdits(base, diffEdits(base, 'one 2 three'), 'one TWO three')).toBe(null)
  })

  it('keeps a delete clear of an insert at its edge', () => {
    const base = 'aaa\nbbb\nccc\n'
    const mine = 'aaa\nccc\n' // delete bbb
    const now = 'aaa\nNEW\nbbb\nccc\n' // someone inserted before bbb
    const edits = rebaseEdits(base, diffEdits(base, mine), now)
    expect(applyEdits(now, edits)).toBe('aaa\nNEW\nccc\n')
  })

  it('is the same edits when nothing changed', () => {
    const base = 'x'
    expect(rebaseEdits(base, diffEdits(base, 'xy'), base)).toEqual(diffEdits(base, 'xy'))
  })
})
