// Tests for shared/frontend-routing.mjs — the index.json `fallback` convention (ADR-0015).
//
// These two helpers are the shared contract between the desktop protocol handler
// (bg/protocols/hyper.js, both the Hyperdrive and Autobase serve paths) and the mobile gateway
// (mobile/backend/lib/http-gateway.mjs + drive-manager.mjs):
//   - manifestFallback: which manifest values enable fallback routing at all
//   - isDocumentNavigation: which requests count as a page navigation (only those may fall back;
//     sub-resource misses must keep 404ing honestly)
// The serve-path wiring itself (real-files-win, .ui precedence) is exercised in the live app —
// the handlers are Electron/Bare-coupled and not importable here.
import { describe, it, expect } from 'vitest'
import { manifestFallback, isDocumentNavigation } from '../../shared/frontend-routing.mjs'

describe('manifestFallback', () => {
  it('accepts an absolute in-drive file path', () => {
    expect(manifestFallback({ fallback: '/index.html' })).toBe('/index.html')
    expect(manifestFallback({ fallback: '/app/index.html' })).toBe('/app/index.html')
  })

  it('returns null when not declared', () => {
    expect(manifestFallback({})).toBe(null)
    expect(manifestFallback({ title: 'A drive' })).toBe(null)
    expect(manifestFallback(null)).toBe(null)
    expect(manifestFallback(undefined)).toBe(null)
  })

  it('rejects non-string values', () => {
    expect(manifestFallback({ fallback: true })).toBe(null)
    expect(manifestFallback({ fallback: { rewrite: '/index.html' } })).toBe(null)
    expect(manifestFallback({ fallback: 42 })).toBe(null)
  })

  it('rejects relative and directory-like paths', () => {
    expect(manifestFallback({ fallback: 'index.html' })).toBe(null)
    expect(manifestFallback({ fallback: './index.html' })).toBe(null)
    expect(manifestFallback({ fallback: '/app/' })).toBe(null)
    expect(manifestFallback({ fallback: '/' })).toBe(null)
    expect(manifestFallback({ fallback: '' })).toBe(null)
  })

  it('rejects external URLs (not an in-drive absolute path)', () => {
    expect(manifestFallback({ fallback: 'https://example.com/x.html' })).toBe(null)
    expect(manifestFallback({ fallback: 'hyper://abc/index.html' })).toBe(null)
  })
})

describe('isDocumentNavigation', () => {
  it('trusts Sec-Fetch-Dest when present, for document-like destinations', () => {
    expect(isDocumentNavigation({ 'Sec-Fetch-Dest': 'document' })).toBe(true)
    expect(isDocumentNavigation({ 'sec-fetch-dest': 'document' })).toBe(true)
    expect(isDocumentNavigation({ 'Sec-Fetch-Dest': 'iframe' })).toBe(true)
  })

  it('Sec-Fetch-Dest marks sub-resources even when Accept mentions text/html', () => {
    // e.g. fetch(url, { headers: { Accept: 'text/html' } }) from a page script
    expect(
      isDocumentNavigation({ 'Sec-Fetch-Dest': 'empty', Accept: 'text/html,*/*' })
    ).toBe(false)
    expect(isDocumentNavigation({ 'Sec-Fetch-Dest': 'image' })).toBe(false)
    expect(isDocumentNavigation({ 'Sec-Fetch-Dest': 'script' })).toBe(false)
  })

  it('falls back to Accept sniffing without fetch metadata', () => {
    // Chromium's real navigation Accept header
    expect(
      isDocumentNavigation({
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      })
    ).toBe(true)
    // spaces after commas and q-params on the html part still match
    expect(isDocumentNavigation({ accept: 'application/xml, text/html;q=0.9' })).toBe(true)
  })

  it('treats fetch()/sub-resource Accept headers as non-navigations', () => {
    expect(isDocumentNavigation({ Accept: '*/*' })).toBe(false)
    expect(isDocumentNavigation({ Accept: 'application/json' })).toBe(false)
    expect(isDocumentNavigation({ Accept: 'image/avif,image/webp,*/*' })).toBe(false)
  })

  it('handles missing headers', () => {
    expect(isDocumentNavigation({})).toBe(false)
    expect(isDocumentNavigation(null)).toBe(false)
    expect(isDocumentNavigation(undefined)).toBe(false)
  })
})
