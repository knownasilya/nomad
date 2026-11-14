// Names for files added to a drive from the phone (mobile/lib/fileNames.ts).

import { describe, it, expect } from 'vitest'
import { freeName } from '../../mobile/lib/fileNames.ts'

describe('freeName', () => {
  it('keeps a name the folder doesn\'t have', () => {
    expect(freeName('Beach.jpg', new Set(['other.jpg']))).toBe('Beach.jpg')
  })

  it('numbers a name the folder has, ignoring case, and keeps the extension', () => {
    expect(freeName('Beach.jpg', new Set(['beach.jpg']))).toBe('Beach (2).jpg')
    expect(freeName('Beach.jpg', new Set(['beach.jpg', 'beach (2).jpg']))).toBe('Beach (3).jpg')
    expect(freeName('README', new Set(['readme']))).toBe('README (2)')
    expect(freeName('.env', new Set(['.env']))).toBe('.env (2)')
  })

  it('never makes a path', () => {
    expect(freeName('a/b\\c.txt', new Set())).toBe('a-b-c.txt')
    expect(freeName('', new Set())).toBe('file')
  })
})
