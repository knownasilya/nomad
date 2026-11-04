// nomad://notes' tab title (app/userland/notes/js/page-title.js): the open note's title, then Notes.

import { describe, it, expect } from 'vitest'
import { notesPageTitle, APP_TITLE } from '../../app/userland/notes/js/page-title.js'

describe('Notes tab title', () => {
  it('is Notes with no note open', () => {
    expect(notesPageTitle(null)).toBe(APP_TITLE)
    expect(APP_TITLE).toBe('Notes')
  })

  it('names the open note first, from its first line', () => {
    expect(notesPageTitle('# Groceries\n\nmilk')).toBe('Groceries · Notes')
    expect(notesPageTitle('\n\n  Plan for   Monday  \nmore')).toBe('Plan for Monday · Notes')
  })

  it('calls an empty note a new note', () => {
    expect(notesPageTitle('')).toBe('New note · Notes')
  })

  it('is Notes on the canvas, even with a note open behind it', () => {
    expect(notesPageTitle('# Groceries', { canvas: true })).toBe('Notes')
  })
})
