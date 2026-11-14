// The drive terminal's pure rules (app/userland/webterm/js/lib/): readline's editing keys, splitting
// a line into commands, the word under the caret, history (`!!`, suggestions, Ctrl+R, Up/Down),
// the line diff, and the matching and error wording its commands use.

import { describe, it, expect } from 'vitest'
import * as line from '../../app/userland/webterm/js/lib/line.js'
import * as hist from '../../app/userland/webterm/js/lib/history.js'
import { diffLines, hunks, stats, unified } from '../../app/userland/webterm/js/lib/diff.js'
import * as fmt from '../../app/userland/webterm/js/lib/format.js'
import { friendlyError, cleanMessage } from '../../app/userland/webterm/js/lib/errors.js'

const at = (value, start, end = start) => ({ value, start, end })

describe('editing keys', () => {
  it('Ctrl+W deletes the word before the caret, a slash at a time in a path', () => {
    expect(line.deleteWordBack(at('cat posts/hello.md', 18))).toEqual(at('cat posts/', 10))
    expect(line.deleteWordBack(at('cat posts/', 10))).toEqual(at('cat posts', 9))
    expect(line.deleteWordBack(at('ls  ', 4))).toEqual(at('', 0))
    expect(line.deleteWordBack(at('abc', 1, 3))).toEqual(at('a', 1))
  })

  it('Ctrl+U and Ctrl+K cut before and after the caret', () => {
    expect(line.deleteToStart(at('rm -r old', 6))).toEqual(at('old', 0))
    expect(line.deleteToEnd(at('rm -r old', 5))).toEqual(at('rm -r', 5))
  })

  it('Alt+D, Alt+B and Alt+F work by words', () => {
    expect(line.deleteWordForward(at('mv a b', 2))).toEqual(at('mv b', 2))
    expect(line.wordLeft('mv alpha beta', 13)).toBe(9)
    expect(line.wordRight('mv alpha beta', 0)).toBe(2)
  })
})

describe('splitting a line', () => {
  it('splits on ; and && outside quotes', () => {
    expect(line.splitCommands('mkdir a && cd a; ls')).toEqual([
      { line: 'mkdir a', and: false },
      { line: 'cd a', and: true },
      { line: 'ls', and: false },
    ])
    expect(line.splitCommands('echo "a; b && c"')).toEqual([{ line: 'echo "a; b && c"', and: false }])
    expect(line.splitCommands('echo a\\;b')).toEqual([{ line: 'echo a\\;b', and: false }])
    expect(line.splitCommands(' ; ')).toEqual([])
  })

  it('takes > and >> at the end as where the output goes', () => {
    expect(line.splitRedirect('ls -l > files.txt')).toEqual({ line: 'ls -l', redirect: { path: 'files.txt', append: false } })
    expect(line.splitRedirect('echo hi >> "my notes.md"')).toEqual({ line: 'echo hi', redirect: { path: 'my notes.md', append: true } })
    expect(line.splitRedirect('echo "a > b"')).toEqual({ line: 'echo "a > b"', redirect: null })
    expect(() => line.splitRedirect('ls >')).toThrow(/Write the output where/)
  })

  it('finds the word at the caret', () => {
    expect(line.wordAt('cat pos', 7)).toMatchObject({ start: 4, end: 7, word: 'pos', index: 1 })
    expect(line.wordAt('cat ', 4)).toMatchObject({ start: 4, end: 4, word: '', index: 1 })
    expect(line.wordAt('cat my\\ fi', 10)).toMatchObject({ start: 4, word: 'my\\ fi', index: 1 })
    expect(line.wordAt('l', 1)).toMatchObject({ word: 'l', index: 0 })
    expect(line.wordAt('', 0)).toMatchObject({ word: '', index: 0 })
  })

  it('agrees on a common prefix, escapes words and finds near names', () => {
    expect(line.commonPrefix(['posts', 'post.md', 'poster'])).toBe('post')
    expect(line.commonPrefix([])).toBe('')
    expect(line.escapeWord("my file's")).toBe("my\\ file\\'s")
    expect(line.closest('lss', ['ls', 'cd', 'less', 'rm'])).toEqual(['ls', 'less'])
    expect(line.closest('grpe', ['grep', 'go', 'cat'])).toEqual(['grep'])
    expect(line.closest('zzzzzz', ['ls'])).toEqual([])
  })
})

describe('history', () => {
  it('keeps each line once, newest last, and skips blank and space-led lines', () => {
    let list = []
    for (const l of ['ls', 'cd posts', 'ls', '   ', ' secret', 'cat a']) list = hist.addEntry(list, l)
    expect(list).toEqual(['cd posts', 'ls', 'cat a'])
  })

  it('caps how many it keeps', () => {
    let list = []
    for (let i = 0; i < hist.HISTORY_MAX + 5; i++) list = hist.addEntry(list, `echo ${i}`)
    expect(list.length).toBe(hist.HISTORY_MAX)
    expect(list[0]).toBe('echo 5')
  })

  it('expands !!, !$, !n, !-n and !word', () => {
    const list = ['ls posts', 'cat posts/a.md', 'cd posts']
    expect(hist.expandBang('sudo !!', list).line).toBe('sudo cd posts')
    expect(hist.expandBang('ls !$', list).line).toBe('ls posts')
    expect(hist.expandBang('!2', list).line).toBe('cat posts/a.md')
    expect(hist.expandBang('!-3', list).line).toBe('ls posts')
    expect(hist.expandBang('!cat', list).line).toBe('cat posts/a.md')
    expect(hist.expandBang('echo hi!', list)).toEqual({ line: 'echo hi!', expanded: false })
    expect(() => hist.expandBang('!nope', list)).toThrow(/no such command/)
  })

  it('suggests the newest longer line that starts with what is typed', () => {
    const list = ['cat index.html', 'cat about.md', 'cd posts']
    expect(hist.suggest(list, 'cat')).toBe('cat about.md')
    expect(hist.suggest(list, 'cat i')).toBe('cat index.html')
    expect(hist.suggest(list, 'cd posts')).toBe('')
    expect(hist.suggest(list, '')).toBe('')
  })

  it('searches back with Ctrl+R', () => {
    const list = ['grep TODO', 'ls', 'grep FIXME']
    expect(hist.searchBack(list, 'grep')).toBe(2)
    expect(hist.searchBack(list, 'grep', 2)).toBe(0)
    expect(hist.searchBack(list, 'nothing')).toBe(-1)
  })

  it('steps with Up and Down, only through lines that start with what was typed', () => {
    const list = ['ls', 'cat a', 'cd b', 'cat c']
    let nav = { index: list.length, prefix: 'cat' }
    let s = hist.step(list, nav, -1)
    expect(s).toEqual({ index: 3, value: 'cat c' })
    s = hist.step(list, { ...nav, index: s.index }, -1)
    expect(s).toEqual({ index: 1, value: 'cat a' })
    expect(hist.step(list, { ...nav, index: 1 }, -1)).toBe(null)
    expect(hist.step(list, { ...nav, index: 3 }, 1)).toEqual({ index: 4, value: 'cat' })
  })
})

describe('diff', () => {
  it('finds added, removed and kept lines with their numbers', () => {
    const ops = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(ops.map((o) => o.op + o.text)).toEqual([' a', '-b', '+B', ' c', '+d'])
    expect(stats(ops)).toEqual({ added: 2, removed: 1 })
    expect(ops[1]).toMatchObject({ a: 2 })
    expect(ops[4]).toMatchObject({ b: 4 })
  })

  it('makes unified hunks with context, and none for the same text', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const b = a.replace('line 10', 'line ten')
    const hs = hunks(diffLines(a, b), 3)
    expect(hs.length).toBe(1)
    expect(hs[0].header).toBe('@@ -7,7 +7,7 @@')
    expect(hunks(diffLines(a, a))).toEqual([])
    expect(unified(diffLines('x\n', 'y\n'), { from: 'old', to: 'new' })).toBe('--- old\n+++ new\n@@ -1,1 +1,1 @@\n-x\n+y\n')
  })

  it('handles empty sides', () => {
    expect(diffLines('', 'a\nb').map((o) => o.op)).toEqual(['+', '+'])
    expect(diffLines('a', '').map((o) => o.op)).toEqual(['-'])
    expect(unified(diffLines('', ''))).toBe('')
  })
})

describe('formatting and matching', () => {
  it('formats sizes', () => {
    expect(fmt.formatBytes(0)).toBe('0 B')
    expect(fmt.formatBytes(1536)).toBe('1.5 KB')
    expect(fmt.formatBytes(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('says when, relative to now', () => {
    const now = new Date(2026, 10, 14, 12, 0).getTime()
    expect(fmt.formatWhen(now - 10_000, now)).toBe('just now')
    expect(fmt.formatWhen(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(fmt.formatWhen(now - 2 * 3_600_000, now)).toBe('2 h ago')
    expect(fmt.formatWhen(0, now)).toBe('')
    expect(fmt.formatWhen(new Date(2026, 10, 13, 9, 0).getTime(), now)).toMatch(/^Yesterday /)
  })

  it('matches globs on names, and plain words anywhere in them', () => {
    expect(fmt.globToRegExp('*.md').test('hello.md')).toBe(true)
    expect(fmt.globToRegExp('*.md').test('hello.mdx')).toBe(false)
    expect(fmt.globToRegExp('post-?.html').test('post-1.html')).toBe(true)
    expect(fmt.globToRegExp('*.{js,css}').test('app.css')).toBe(true)
    expect(fmt.globToRegExp('[ab]*').test('beta')).toBe(true)
    expect(fmt.globToRegExp('index').test('my-INDEX.html')).toBe(true)
  })

  it('greps lines and marks the matches', () => {
    const hits = fmt.grepLines('one TODO\ntwo\nTODO and todo', fmt.grepPattern('todo', { ignoreCase: true }))
    expect(hits.map((h) => h.n)).toEqual([1, 3])
    expect(hits[1].parts).toEqual(['', 'TODO', ' and ', 'todo', ''])
    expect(fmt.grepPattern('/h[12]>/').test('<h1>')).toBe(true)
    expect(fmt.grepPattern('a.b').test('axb')).toBe(false)
  })

  it('tells text files and binary apart', () => {
    expect(fmt.isTextPath('/posts/a.md')).toBe(true)
    expect(fmt.isTextPath('/README')).toBe(true)
    expect(fmt.isTextPath('/photo.jpg')).toBe(false)
    expect(fmt.looksBinary('abc\u0000def')).toBe(true)
    expect(fmt.looksBinary('plain')).toBe(false)
  })
})

describe('errors', () => {
  it('cleans up remote error messages', () => {
    expect(cleanMessage("Error invoking remote method 'fs': Error: NotFoundError: File not found")).toBe('NotFoundError: File not found')
  })

  it('says what to do next', () => {
    expect(friendlyError(new Error('NotFoundError: File not found: /a.md'))).toMatchObject({ message: 'File not found: /a.md', tip: expect.stringMatching(/Tab/) })
    expect(friendlyError(new Error('PermissionsError: Cannot write to this drive')).message).toBe("You can't change this drive")
    expect(friendlyError(new Error('No AI Device is online')).tip).toMatch(/nomad:\/\/ai\/setup/)
    const err = new Error('Command not found: lss')
    err.tip = 'Did you mean ls?'
    expect(friendlyError(err)).toEqual({ message: 'Command not found: lss', tip: 'Did you mean ls?' })
  })
})
