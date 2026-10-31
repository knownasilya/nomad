// nomad/shared/web-feeds.mjs
//
// RSS and Atom feeds for Reader (ADR-0033 amendment): reading a feed's XML into the posts Reader
// lists, and finding the feeds a web page links to. Shared by desktop (bg/web-apis/bg/web-feeds.ts)
// and the phone's backend, which gets the XML from the app's fetch. Pure: no I/O, no DOM, so it runs
// in Electron's main process and in Bare alike. It reads a feed with regular expressions, which is
// enough for the elements a reader needs: it never evaluates anything from the feed.

export const MAX_ITEMS = 100;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// An element's text: CDATA unwrapped, entities decoded, once. (Entities inside CDATA are text.)
function textOf(raw) {
  const s = String(raw || '');
  let out = '';
  let i = 0;
  for (const m of s.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeEntities(s.slice(i, m.index)) + m[1];
    i = m.index + m[0].length;
  }
  return out + decodeEntities(s.slice(i));
}

// Plain text from HTML in a feed: tags dropped, blocks on their own line, entities decoded.
export function htmlText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const esc = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The raw inside of the first <name> element in `xml` (name may carry a prefix: 'dc:date').
function inner(xml, name) {
  const m = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}\\s*>`, 'i').exec(xml);
  return m ? m[1] : null;
}

function first(xml, names) {
  for (const n of names) {
    const v = inner(xml, n);
    if (v != null && textOf(v).trim()) return v;
  }
  return null;
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

function absolute(href, base) {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base || undefined);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function isoDate(raw) {
  const s = textOf(raw || '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function clip(s, n) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// True when `text` looks like an RSS, RDF or Atom document rather than a web page.
export function isFeedXml(text) {
  const head = String(text || '')
    .slice(0, 2000)
    .replace(/<!--[\s\S]*?-->/g, '');
  return /<(rss|rdf:RDF|feed)\b/i.test(head) && !/<html\b/i.test(head);
}

// A feed's XML as { title, siteUrl, posts: [{ title, summary, tags, createdAt, url, feedUrl, feedTitle }] },
// newest first. `feedUrl` is the address it was read from; relative links resolve against it.
// Throws when the text isn't an RSS or Atom feed.
export function parseWebFeed(xml, feedUrl) {
  const text = String(xml || '').replace(/<!--[\s\S]*?-->/g, '');
  if (!isFeedXml(text)) throw new Error('That address isn’t an RSS or Atom feed');
  const atom = /<feed\b/i.test(text.slice(0, 2000)) && !/<rss\b/i.test(text.slice(0, 2000));
  const itemRe = atom
    ? /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi
    : /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const firstItem = text.search(atom ? /<entry\b/i : /<item\b/i);
  const head = firstItem === -1 ? text : text.slice(0, firstItem);

  const title = clip(htmlText(textOf(inner(head, 'title') || '')), 200) || hostOf(feedUrl);
  const siteUrl = atom
    ? atomLink(head, feedUrl)
    : absolute(textOf(inner(head, 'link') || ''), feedUrl);

  const posts = [];
  for (const m of text.matchAll(itemRe)) {
    const item = m[1];
    let url = atom ? atomLink(item, feedUrl) : absolute(textOf(inner(item, 'link') || ''), feedUrl);
    if (!url) {
      const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(item);
      if (guid && !/ispermalink\s*=\s*["']false/i.test(guid[1]))
        url = absolute(textOf(guid[2]), feedUrl);
    }
    if (!url) continue;
    const body = first(
      item,
      atom ? ['summary', 'content'] : ['description', 'content:encoded', 'summary']
    );
    const itemTitle = clip(htmlText(textOf(inner(item, 'title') || '')), 300);
    const summary = clip(htmlText(textOf(body || '')), 300);
    const tags = [...item.matchAll(/<category\b([^>]*?)(?:\/>|>([\s\S]*?)<\/category>)/gi)]
      .map((c) => clip(textOf(c[2] || '') || attrs(c[1]).term || attrs(c[1]).label || '', 40))
      .filter(Boolean)
      .slice(0, 6);
    posts.push({
      title: itemTitle || summary.slice(0, 80) || url,
      summary: itemTitle ? summary : '',
      tags,
      createdAt: isoDate(
        first(
          item,
          atom ? ['published', 'updated'] : ['pubDate', 'dc:date', 'published', 'updated']
        )
      ),
      url,
      feedUrl,
      feedTitle: title,
    });
  }
  posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { url: feedUrl, title, siteUrl: siteUrl || null, posts: posts.slice(0, MAX_ITEMS) };
}

// An Atom element's alternate link (a <link> with rel="alternate" or no rel).
function atomLink(xml, base) {
  let fallback = null;
  for (const m of xml.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const a = attrs(m[1]);
    if (!a.href) continue;
    const rel = (a.rel || 'alternate').toLowerCase();
    if (rel === 'alternate' && (!a.type || /html/i.test(a.type))) return absolute(a.href, base);
    if (!fallback && rel !== 'self' && rel !== 'enclosure') fallback = absolute(a.href, base);
  }
  return fallback;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

// The RSS and Atom feeds a web page links to: [{ url, title }], in page order.
export function findFeedLinks(html, pageUrl) {
  const head = String(html || '').slice(0, 200000);
  const out = [];
  for (const m of head.matchAll(/<link\b([^>]*)>/gi)) {
    const a = attrs(m[1]);
    if (!/(^|\s)alternate(\s|$)/i.test(a.rel || '')) continue;
    if (!/application\/(rss|atom)\+xml|application\/feed\+json/i.test(a.type || '')) continue;
    if (/json/i.test(a.type)) continue; // JSON Feed: not read here
    const url = absolute(a.href, pageUrl);
    if (url && !out.some((f) => f.url === url)) out.push({ url, title: clip(a.title || '', 120) });
  }
  return out;
}
