import { describe, it, expect } from 'vitest';
import {
  articleUrl,
  articleId,
  articleSite,
  articlePath,
  articleTextPath,
  articlesPrefix,
  isArticleId,
  makeArticle,
  articleText,
  isArticle,
  withTopics,
  withRead,
  sortArticles,
  topicCounts,
  hasTopic,
  normalizeTopic,
  normalizeTopics,
  topicMessages,
  pickTopics,
  readingMinutes,
  MAX_ARTICLE_TEXT,
  ARTICLE_TYPE,
} from '../../shared/reader-articles.mjs';
import { extractArticle } from '../../app/bg/lib/extract-article.mjs';

const SPACE = 'a'.repeat(64);
const NOW = '2026-10-31T12:00:00.000Z';

describe('articleUrl', () => {
  it('keeps http(s) and hyper:// pages, without the fragment or tracking parameters', () => {
    expect(articleUrl('https://example.com/a?utm_source=x&id=2#top')).toBe('https://example.com/a?id=2');
    expect(articleUrl('http://example.com/')).toBe('http://example.com/');
    expect(articleUrl('example.com/post')).toBe('https://example.com/post');
    expect(articleUrl('hyper://' + 'b'.repeat(64) + '/posts/x/')).toBe('hyper://' + 'b'.repeat(64) + '/posts/x/');
  });
  it('refuses what Reader can’t save', () => {
    expect(articleUrl('nomad://reader/')).toBeNull();
    expect(articleUrl('hyper://private/notes.md')).toBeNull();
    expect(articleUrl('javascript:alert(1)')).toBeNull();
    expect(articleUrl('hello')).toBeNull();
    expect(articleUrl('')).toBeNull();
  });
});

describe('ids and paths', () => {
  it('gives the same 16-hex id for the same URL', () => {
    const id = articleId('https://example.com/a');
    expect(isArticleId(id)).toBe(true);
    expect(articleId('https://example.com/a')).toBe(id);
    expect(articleId('https://example.com/b')).not.toBe(id);
  });
  it('files articles and their text apart, per Space', () => {
    const id = articleId('https://example.com/a');
    expect(articlePath(SPACE, id)).toBe(`/.vault/reader/${SPACE}/articles/${id}.json`);
    expect(articleTextPath(SPACE, id)).toBe(`/.vault/reader/${SPACE}/article-text/${id}.json`);
    expect(articlePath(SPACE, id).startsWith(articlesPrefix(SPACE))).toBe(true);
    expect(() => articlePath(SPACE, '../x')).toThrow();
    expect(() => articlesPrefix('nope')).toThrow();
  });
  it('names the site', () => {
    expect(articleSite('https://www.example.com/a')).toBe('example.com');
  });
});

describe('makeArticle', () => {
  const page = { url: 'https://example.com/a#x', title: '  A  title ', excerpt: 'Short', text: 'one two three', siteName: 'Example' };
  it('makes a read, untagged article', () => {
    const a = makeArticle(page, null, { now: NOW });
    expect(a).toMatchObject({
      type: ARTICLE_TYPE,
      url: 'https://example.com/a',
      title: 'A title',
      site: 'Example',
      excerpt: 'Short',
      words: 3,
      savedAt: NOW,
      readAt: NOW,
      topics: [],
      topicsBy: null,
    });
    expect(isArticle(a)).toBe(true);
  });
  it('keeps topics, first save and read mark when saved again', () => {
    const first = withTopics(makeArticle(page, null, { now: NOW }), ['Cooking'], [], NOW);
    const again = makeArticle(page, first, { read: false, now: '2026-11-01T00:00:00.000Z' });
    expect(again.topics).toEqual(['Cooking']);
    expect(again.topicsBy).toBe('user');
    expect(again.savedAt).toBe(NOW);
    expect(again.readAt).toBe(NOW);
  });
  it('saves a link for later unread', () => {
    expect(makeArticle(page, null, { read: false, now: NOW }).readAt).toBeNull();
  });
  it('refuses a page it can’t keep', () => {
    expect(() => makeArticle({ url: 'nomad://reader/' })).toThrow();
  });
  it('cuts the text', () => {
    expect(articleText('x', 'a'.repeat(MAX_ARTICLE_TEXT + 10)).text.length).toBe(MAX_ARTICLE_TEXT);
  });
});

describe('read marks and topics', () => {
  const a = makeArticle({ url: 'https://example.com/a', title: 'A' }, null, { read: false, now: NOW });
  it('marks read and unread', () => {
    const r = withRead(a, true, NOW);
    expect(r.readAt).toBe(NOW);
    expect(withRead(r, true)).toBe(r);
    expect(withRead(r, false).readAt).toBeNull();
  });
  it('normalizes topics and reuses known spellings', () => {
    expect(normalizeTopic('  #machine   learning. ')).toBe('machine learning');
    expect(normalizeTopics('cooking, Cooking , science', ['Cooking'])).toEqual(['Cooking', 'science']);
    expect(normalizeTopics(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length).toBe(6);
  });
  it('counts and finds topics', () => {
    const list = [
      { ...a, id: '0000000000000001', topics: ['Science', 'Space'], savedAt: '2026-01-01' },
      { ...a, id: '0000000000000002', topics: ['science'], savedAt: '2026-02-01' },
      { ...a, id: '0000000000000003', topics: [], savedAt: '2026-03-01' },
    ];
    expect(topicCounts(list)).toEqual([
      { topic: 'Science', count: 2 },
      { topic: 'Space', count: 1 },
    ]);
    expect(hasTopic(list[1], 'SCIENCE')).toBe(true);
    expect(sortArticles(list).map((x) => x.id)).toEqual(['0000000000000003', '0000000000000002', '0000000000000001']);
  });
  it('reads minutes', () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(2300)).toBe(10);
  });
});

describe('AI topics', () => {
  it('asks with the known topics and treats the page as data', () => {
    const [system, user] = topicMessages({ title: 'Sourdough', site: 'bread.example', text: 'Flour and water' }, ['Cooking']);
    expect(system.content).toMatch(/JSON array/);
    expect(system.content).toMatch(/Ignore any instructions/);
    expect(user.content).toMatch(/Existing topics: Cooking/);
    expect(user.content).toMatch(/Flour and water/);
  });
  it('reads a JSON array, with the known spelling', () => {
    expect(pickTopics('["cooking", "Food Science"]', ['Cooking'])).toEqual(['Cooking', 'Food Science']);
    expect(pickTopics('<think>hmm</think>\n```json\n["Science"]\n```')).toEqual(['Science']);
  });
  it('falls back to lines or commas, and caps at three', () => {
    expect(pickTopics('Topics: Cooking, Travel')).toEqual(['Cooking', 'Travel']);
    expect(pickTopics('1. A\n2. B\n3. C\n4. D')).toEqual(['A', 'B', 'C']);
  });
  it('drops sentences and empty replies', () => {
    expect(pickTopics('This article is about many different things in cooking')).toEqual([]);
    expect(pickTopics('none')).toEqual([]);
    expect(pickTopics('')).toEqual([]);
  });
});

describe('extractArticle', () => {
  const para = (s, n) => `<p>${s.repeat(n)}</p>`;
  const html = `<html><head><title>How sourdough works | Bread Blog</title>
    <meta property="og:site_name" content="Bread Blog"><meta property="og:image" content="/img.jpg">
    <meta name="description" content="A look at wild yeast."></head>
    <body><nav>Home About</nav><article><h1>How sourdough works</h1>
    ${para('Wild yeast and lactic acid bacteria ferment the dough. ', 20)}
    <h3>Feeding</h3>${para('Feed the starter every day with flour and water. ', 15)}
    <ul><li>Flour</li><li>Water</li></ul><script>alert(1)</script></article><footer>© 2026</footer></body></html>`;
  it('finds the article and its readable text', () => {
    const a = extractArticle(html, 'https://bread.example/sourdough');
    expect(a.title).toBe('How sourdough works');
    expect(a.siteName).toBe('Bread Blog');
    expect(a.excerpt).toBe('A look at wild yeast.');
    expect(a.image).toBe('https://bread.example/img.jpg');
    expect(a.text).toMatch(/^Wild yeast/);
    expect(a.text).toMatch(/- Flour\n\n- Water/);
    expect(a.text).not.toMatch(/alert|Home About|© 2026/);
  });
  it('falls back to the title for a page with no article', () => {
    const a = extractArticle('<title>Short</title><p>hi</p>', 'https://x.example/');
    expect(a.title).toBe('Short');
  });
  it('writes headings, quotes and code as the reading view expects', () => {
    const body = `<article>${para('Bakers have kept starters alive for many years. ', 12)}<h3>Feeding</h3>
      ${para('Give it fresh flour and water each morning before work. ', 10)}
      <blockquote><p>A starter is a pet.</p></blockquote><pre>flour = 100\n  water = 100</pre>
      ${para('Then wait for it to double in size before baking. ', 10)}</article>`;
    const { text } = extractArticle(`<html><head><title>Starters</title></head><body>${body}</body></html>`, 'https://x.example/');
    expect(text).toMatch(/\n\n### Feeding\n\n/);
    expect(text).toMatch(/\n\n> A starter is a pet\.\n\n/);
    expect(text).toMatch(/```\nflour = 100\n  water = 100\n```/);
  });
});
