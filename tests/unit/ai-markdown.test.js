// The AI Sidebar's Markdown (app/fg/shell-window/ai-markdown.js): links to the user's things and to
// pages render as links; anything else stays text.

import { describe, it, expect } from 'vitest'
import { mdToHtml } from '../../app/fg/shell-window/ai-markdown.js'

describe('mdToHtml links', () => {
  it('links a Note the AI wrote', () => {
    expect(mdToHtml('Saved [Groceries](nomad://notes/0abc123de-x1y2z3).')).toBe(
      '<p>Saved <a href="nomad://notes/0abc123de-x1y2z3" title="nomad://notes/0abc123de-x1y2z3">Groceries</a>.</p>'
    )
  })

  it('links bare page URLs and leaves sentence punctuation out', () => {
    expect(mdToHtml('See hyper://blog/posts/x/, then (https://example.com/a?b=1&c=2).')).toBe(
      '<p>See <a href="hyper://blog/posts/x/" title="hyper://blog/posts/x/">hyper://blog/posts/x/</a>, then ' +
        '(<a href="https://example.com/a?b=1&amp;c=2" title="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>).</p>'
    )
  })

  it('opens a nomad:// link as Nomad builds it', () => {
    expect(mdToHtml('[Reader](nomad://reader/?subscribe=https://evil.example/f)')).toContain('href="nomad://reader/"')
    expect(mdToHtml('[Job](nomad://library/jobs?id=job-abc123-xyz)')).toContain(
      'href="nomad://library/jobs?id=job-abc123-xyz"'
    )
  })

  it('keeps other links as text', () => {
    expect(mdToHtml('[click](javascript:alert(1))')).not.toContain('<a')
    expect(mdToHtml('[x](nomad://settings)')).toBe('<p>[x](nomad://settings)</p>')
    expect(mdToHtml('[x](data:text/html,hi)')).not.toContain('<a')
  })

  it('escapes what goes in the link', () => {
    const html = mdToHtml('[<b>x</b>](https://example.com/"onmouseover="alert(1))')
    expect(html).not.toContain('<b>')
    expect(html).not.toMatch(/<a [^>]*onmouseover/)
  })

  it('keeps emphasis out of URLs and links out of code', () => {
    expect(mdToHtml('**[Plan](nomad://notes/abc-1)**')).toContain('<strong><a href="nomad://notes/abc-1"')
    expect(mdToHtml('https://example.com/*a*/b')).toContain('href="https://example.com/*a*/b"')
    expect(mdToHtml('`[x](https://example.com/)`')).toBe('<p><code>[x](https://example.com/)</code></p>')
  })

  it('links in lists and headings', () => {
    expect(mdToHtml('- [A](nomad://notes/a-1)\n- [B](nomad://notes/b-2)')).toBe(
      '<ul><li><a href="nomad://notes/a-1" title="nomad://notes/a-1">A</a></li>' +
        '<li><a href="nomad://notes/b-2" title="nomad://notes/b-2">B</a></li></ul>'
    )
  })
})
