// Where a link in the phone's web tab goes (mobile/lib/webLinks.ts): web pages stay in Nomad, feeds
// go to Reader, and only links no web page can stand for go to another app.

import { describe, it, expect } from 'vitest'
import { routeLink, feedUrl, parseIntent } from '../../mobile/lib/webLinks.ts'

describe('routeLink', () => {
  it('loads web pages and in-page addresses in the tab', () => {
    for (const url of ['https://example.com/', 'http://example.com/a', 'about:blank', 'data:text/html,hi', 'blob:https://x/1', 'javascript:void(0)']) {
      expect(routeLink(url)).toEqual({ to: 'page' })
    }
  })

  it('sends feed: links to Reader as https', () => {
    expect(routeLink('feed://example.com/rss.xml')).toEqual({ to: 'reader', url: 'https://example.com/rss.xml' })
    expect(routeLink('feed:https://example.com/atom')).toEqual({ to: 'reader', url: 'https://example.com/atom' })
    expect(routeLink('feed:http://example.com/atom')).toEqual({ to: 'reader', url: 'http://example.com/atom' })
  })

  it('opens hyper:// links in the tab', () => {
    expect(routeLink('hyper://abc/posts/')).toEqual({ to: 'tab', url: 'hyper://abc/posts/' })
  })

  it('keeps an intent:// link to a web page in Nomad, even one aimed at Chrome', () => {
    expect(routeLink('intent://accounts.example.com/signin?x=1#Intent;scheme=https;package=com.android.chrome;end'))
      .toEqual({ to: 'tab', url: 'https://accounts.example.com/signin?x=1' })
  })

  it('hands an app intent to the app, with its web fallback', () => {
    const url = 'intent://open/track/1#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F1;end'
    expect(routeLink(url)).toEqual({ to: 'app', url, fallback: 'https://open.spotify.com/track/1' })
  })

  it('drops a fallback that is not a web page', () => {
    const url = 'intent://x#Intent;scheme=foo;S.browser_fallback_url=javascript%3Aalert(1);end'
    expect(routeLink(url)).toEqual({ to: 'app', url })
  })

  it('hands mail, phone and store links to other apps', () => {
    for (const url of ['mailto:a@b.c', 'tel:+15551234', 'market://details?id=x', 'sms:123']) {
      expect(routeLink(url)).toEqual({ to: 'app', url })
    }
  })
})

describe('feedUrl', () => {
  it('turns feed: forms into a web address', () => {
    expect(feedUrl('feed://a.com/f')).toBe('https://a.com/f')
    expect(feedUrl('feed:a.com/f')).toBe('https://a.com/f')
    expect(feedUrl('feeds://a.com/f')).toBe('https://a.com/f')
  })
})

describe('parseIntent', () => {
  it('reads the target, scheme and fallback', () => {
    expect(parseIntent('intent://h/p#Intent;scheme=http;end')).toEqual({ target: 'http://h/p', scheme: 'http', fallback: null })
    expect(parseIntent('intent:#Intent;action=x;end')).toEqual({ target: null, scheme: null, fallback: null })
  })
})
