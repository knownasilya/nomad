import { describe, it, expect } from 'vitest';
import {
  parseWebFeed,
  findFeedLinks,
  isFeedXml,
  htmlText,
  decodeEntities,
  MAX_ITEMS,
} from '../../shared/web-feeds.mjs';
import {
  makePostTopics,
  isPostTopics,
  postsToTag,
  postTopicsPath,
  POST_TOPICS_BATCH,
} from '../../shared/reader-articles.mjs';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment with <item> in it -->
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Ana &amp; Friends</title>
  <link>https://ana.example/</link>
  <description>Notes</description>
  <item>
    <title>Older post</title>
    <link>/2024/older</link>
    <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <category>Gardening</category>
  </item>
  <item>
    <title><![CDATA[Newer <b>post</b> & more]]></title>
    <guid isPermaLink="true">https://ana.example/2024/newer</guid>
    <content:encoded><![CDATA[<p>Body &amp; text</p><script>alert(1)</script>]]></content:encoded>
    <dc:date>2024-03-02T09:00:00Z</dc:date>
  </item>
  <item>
    <title>No link</title>
    <guid isPermaLink="false">tag:ana,2024:3</guid>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">Bo&#8217;s log</title>
  <link rel="self" href="https://bo.example/feed.xml"/>
  <link href="https://bo.example/"/>
  <entry>
    <title>First</title>
    <link rel="alternate" type="text/html" href="https://bo.example/first"/>
    <link rel="enclosure" href="https://bo.example/first.mp3"/>
    <updated>2024-05-01T00:00:00Z</updated>
    <summary type="html">&lt;em&gt;Short&lt;/em&gt; one</summary>
    <category term="Tech" label="Technology"/>
  </entry>
  <entry>
    <title>Second</title>
    <link href="second"/>
    <published>2024-06-01T00:00:00Z</published>
    <content type="html">Longer</content>
  </entry>
</feed>`;

describe('parseWebFeed', () => {
  it('reads an RSS feed, newest first, with relative links and CDATA', () => {
    const feed = parseWebFeed(RSS, 'https://ana.example/feed.xml');
    expect(feed.title).toBe('Ana & Friends');
    expect(feed.siteUrl).toBe('https://ana.example/');
    expect(feed.posts.map((p) => p.url)).toEqual([
      'https://ana.example/2024/newer',
      'https://ana.example/2024/older',
    ]);
    const [newer, older] = feed.posts;
    expect(newer.title).toBe('Newer post & more');
    expect(newer.summary).toBe('Body & text');
    expect(newer.createdAt).toBe('2024-03-02T09:00:00.000Z');
    expect(older.summary).toBe('Hello & welcome');
    expect(older.tags).toEqual(['Gardening']);
    expect(older.feedUrl).toBe('https://ana.example/feed.xml');
    expect(older.feedTitle).toBe('Ana & Friends');
  });

  it('reads an Atom feed and its alternate links', () => {
    const feed = parseWebFeed(ATOM, 'https://bo.example/feed.xml');
    expect(feed.title).toBe('Bo’s log');
    expect(feed.siteUrl).toBe('https://bo.example/');
    expect(feed.posts.map((p) => p.url)).toEqual([
      'https://bo.example/second',
      'https://bo.example/first',
    ]);
    expect(feed.posts[1].summary).toBe('Short one');
    expect(feed.posts[1].tags).toEqual(['Tech']);
  });

  it('refuses a web page', () => {
    expect(() =>
      parseWebFeed('<!doctype html><html><body>hi</body></html>', 'https://x.example/')
    ).toThrow(/RSS or Atom/);
    expect(isFeedXml('<html><rss></rss></html>')).toBe(false);
    expect(isFeedXml(RSS)).toBe(true);
  });

  it('keeps at most MAX_ITEMS posts and skips non-http links', () => {
    const items = Array.from(
      { length: MAX_ITEMS + 5 },
      (_, i) => `<item><title>${i}</title><link>https://x.example/${i}</link></item>`
    ).join('');
    const bad = '<item><title>js</title><link>javascript:alert(1)</link></item>';
    const feed = parseWebFeed(
      `<rss><channel><title>X</title>${bad}${items}</channel></rss>`,
      'https://x.example/rss'
    );
    expect(feed.posts).toHaveLength(MAX_ITEMS);
    expect(feed.posts.some((p) => p.url.startsWith('javascript'))).toBe(false);
  });
});

describe('findFeedLinks', () => {
  it('lists the RSS and Atom feeds a page links to', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/s.css">
      <link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://ana.example/atom.xml">
      <link rel="alternate" type="application/feed+json" href="/feed.json">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    </head></html>`;
    expect(findFeedLinks(html, 'https://ana.example/blog/')).toEqual([
      { url: 'https://ana.example/feed.xml', title: 'Posts' },
      { url: 'https://ana.example/atom.xml', title: '' },
    ]);
  });
});

describe('text helpers', () => {
  it('decodes entities and strips tags', () => {
    expect(decodeEntities('&lt;a&gt; &#169; &#x2014; &bogus;')).toBe('<a> © — &bogus;');
    expect(htmlText('<p>One</p><p>Two<br>three</p><style>p{}</style>')).toBe('One\nTwo\nthree');
  });
});

describe('post topics', () => {
  it('makes a record keyed by the post URL', () => {
    const rec = makePostTopics(
      'https://ana.example/a',
      ['gardening', 'Soil'],
      'ai',
      ['Gardening'],
      'T'
    );
    expect(rec.topics).toEqual(['Gardening', 'Soil']);
    expect(rec.topicsBy).toBe('ai');
    expect(isPostTopics(rec)).toBe(true);
    expect(postTopicsPath('a'.repeat(64), rec.url)).toContain('post-topics/' + rec.id + '.json');
    expect(isPostTopics({ type: 'other' })).toBe(false);
  });

  it('picks recent, untagged posts, newest first, a batch at most', () => {
    const now = Date.parse('2024-06-30T00:00:00Z');
    const posts = [
      { url: 'old', createdAt: '2024-01-01T00:00:00Z' },
      { url: 'done', createdAt: '2024-06-29T00:00:00Z' },
      { url: 'a', createdAt: '2024-06-20T00:00:00Z' },
      { url: 'b', createdAt: '2024-06-28T00:00:00Z' },
      { url: 'undated' },
    ];
    expect(postsToTag(posts, ['done'], now).map((p) => p.url)).toEqual(['b', 'a', 'undated']);
    const many = Array.from({ length: 40 }, (_, i) => ({ url: 'p' + i }));
    expect(postsToTag(many, [], now)).toHaveLength(POST_TOPICS_BATCH);
  });
});
