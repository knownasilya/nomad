// RSS and Atom feeds for Reader (ADR-0033 amendment), and the fetch Reader uses for any web page.
// Parsing is shared/web-feeds.mjs (the phone's backend uses it too); this file fetches.
//
// A feed is fetched with the calling page's session, so a feed behind the user's sign-in works, at
// most every few minutes per address unless the Reader asks for a fresh copy (its Refresh button).

import { net } from 'electron';
import { parseWebFeed, isFeedXml, findFeedLinks } from '../../../../shared/web-feeds.mjs';
import { webFeedUrl } from '../../../../shared/vault-apps.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT = 20e3;
const FRESH_FOR = 5 * 60e3;

const cache = new Map<string, { at: number; feed: any }>();

// GET `url`: { text, finalUrl, type } where type is 'feed', 'html' or 'other' (text is '' then).
export async function fetchPage(
  url,
  session = null,
  { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const doFetch = session?.fetch ? session.fetch.bind(session) : net.fetch;
    let res;
    try {
      res = await doFetch(url, { signal: controller.signal, headers: { Accept: accept } });
    } catch (err) {
      throw new Error(
        controller.signal.aborted
          ? 'That page took too long to load'
          : `Couldn’t load that page (${err?.message || err})`
      );
    }
    if (!res.ok) throw new Error(`Couldn’t load that page (${res.status})`);
    const finalUrl = res.url || url;
    const ctype = res.headers.get('content-type') || '';
    if (!/html|xml|rss|atom|text\/plain/i.test(ctype)) return { text: '', finalUrl, type: 'other' };
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(
      buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
    );
    return {
      text,
      finalUrl,
      type: isFeedXml(text)
        ? 'feed'
        : /html/i.test(ctype) || /<html\b/i.test(text.slice(0, 2000))
          ? 'html'
          : 'other',
    };
  } finally {
    clearTimeout(timer);
  }
}

// A followed feed: { url, title, siteUrl, posts }. Posts carry feedUrl = `url` as followed.
export async function loadWebFeed(url, { session = null, fresh = false } = {}) {
  const key = webFeedUrl(url);
  if (!key) throw new Error('Not an RSS or Atom feed’s address');
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < FRESH_FOR) return hit.feed;
  const { text, type } = await fetchPage(key, session, {
    accept:
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  });
  if (type !== 'feed') throw new Error('This address doesn’t give an RSS or Atom feed any more');
  const feed = parseWebFeed(text, key);
  cache.set(key, { at: Date.now(), feed });
  return feed;
}

// What a pasted link is: { kind: 'feed', url } for a feed, { kind: 'html', html, finalUrl, feeds }
// for a web page (feeds: the RSS/Atom feeds it links to), or { kind: 'other', finalUrl }.
export async function probe(url, session = null) {
  const { text, finalUrl, type } = await fetchPage(url, session);
  if (type === 'feed') {
    const feed = parseWebFeed(text, webFeedUrl(url) || url);
    cache.set(feed.url, { at: Date.now(), feed });
    return { kind: 'feed', url: feed.url, title: feed.title };
  }
  if (type === 'html')
    return { kind: 'html', html: text, finalUrl, feeds: findFeedLinks(text, finalUrl) };
  return { kind: 'other', finalUrl };
}
