// The AI's component pages (saveAsset `openui`): app/lib/genui/page.mjs builds one self-contained
// HTML file from an OpenUI Lang program, and the guide that teaches the model the language.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { genuiPage, iconCss, iconNames, pageSource } from '../../app/lib/genui/page.mjs'
import { genuiPagesGuide } from '../../app/bg/ai/search-execute.mjs'
import { programError } from '../../app/bg/ai/genui-page.js'

const FA_CSS = fs.readFileSync(path.join(__dirname, '../../app/assets/css/fa-all.min.css'), 'utf8')
const PROGRAM = `root = Stack([card])
card = Card([CardHeader("Visits </script><script>alert(1)</script>"), chart, EntityCard("Hypercore", "Log", [], null, [], "code")])
chart = LineChart(["Mon", "Tue"], [Series("Visits", [120, 98])])`

describe('a page from components', () => {
  it('carries the program, its script and title, safely inside the HTML', () => {
    const html = genuiPage({ title: 'Week <1>', source: PROGRAM, script: 'console.log("</script>")', faCss: FA_CSS, fontBase64: 'AAAA', made: 'Made with Nomad' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Week &lt;1&gt;</title>')
    expect(html).toContain('<h1>Week &lt;1&gt;</h1>')
    // Nothing in the program or the script can end a <script> element early.
    expect(html.match(/<\/script>/g).length).toBe(2)
    expect(html).toContain('console.log("<\\/script>")')
    expect(pageSource(html)).toBe(PROGRAM)
    expect(html).toContain('url(data:font/woff2;base64,AAAA)')
    expect(html).toContain('<footer>Made with Nomad</footer>')
    expect(html).toContain('prefers-color-scheme:dark')
    // It names no other place to load from.
    expect(html).not.toMatch(/(src|href)="(https?:|nomad:|\/\/)/)
  })

  it('keeps only the icons the page can show', () => {
    const names = iconNames(PROGRAM)
    expect(names.has('code')).toBe(true) // the EntityCard's
    expect(names.has('star')).toBe(true) // a ProductCard's rating
    const css = iconCss(FA_CSS, names)
    expect(css).toContain('.fa-code:before')
    expect(css).toContain('.fa-check-circle:before')
    expect(css).toContain('.fa-fw{')
    expect(css).not.toContain('.fa-500px:before')
    expect(css).not.toContain('@font-face')
    expect(css.length).toBeLessThan(6000)
  })

  it('sends back a program that draws nothing', () => {
    expect(programError('')).toMatch(/empty/)
    expect(programError('```openui-lang\nroot = Stack([])\n```')).toMatch(/fence/)
    expect(programError('hello there')).toMatch(/draws nothing/)
    expect(programError(PROGRAM)).toBe('')
  })

  it('teaches the model the language in guide:genui-pages', () => {
    const g = genuiPagesGuide()
    expect(g.id).toBe('genui-pages')
    expect(g.markdown).toMatch(/^## Pages built from components/)
    expect(g.markdown).toContain('LineChart')
    expect(g.markdown).toContain('openui')
    // One top heading; the language's own sit under it.
    expect(g.markdown.match(/^## /gm).length).toBe(1)
  })
})
