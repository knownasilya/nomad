import { describe, it, expect } from 'vitest';
import {
  isSearchable,
  plainText,
  titleFor,
  makeDoc,
  rankDocs,
  snippetFor,
  queryWords,
  MAX_FILE_BYTES,
} from '../../shared/drive-search.mjs';

describe('isSearchable', () => {
  it('takes text files that are not too big and not in a dot folder', () => {
    expect(isSearchable('/posts/hi/post.md', 100)).toBe(true);
    expect(isSearchable('/index.html')).toBe(true);
    expect(isSearchable('/photo.jpg')).toBe(false);
    expect(isSearchable('/.data/walled.garden/x.json')).toBe(false);
    expect(isSearchable('/a/.hidden/b.md')).toBe(false);
    expect(isSearchable('/big.txt', MAX_FILE_BYTES + 1)).toBe(false);
    expect(isSearchable('README')).toBe(false);
  });
});

describe('plainText and titleFor', () => {
  it('drops tags, scripts and styles from a page, and decodes entities', () => {
    const html =
      '<html><head><title>My &amp; site</title><style>p{color:red}</style></head>' +
      '<body><script>var secret = 1</script><p>Caf&eacute; &#233; &lt;3</p></body></html>';
    const t = plainText('/index.html', html);
    expect(t).not.toMatch(/secret|color|<p>/);
    expect(t).toContain('&eacute;'); // only the common named ones are decoded
    expect(t).toContain('é <3');
    expect(titleFor('/index.html', html)).toBe('My & site');
  });

  it('titles Markdown by its first heading, JSON by its title, else the name', () => {
    expect(titleFor('/a.md', 'intro\n# Packing list\nsocks')).toBe('Packing list');
    expect(titleFor('/post.json', '{"title":"Hello"}')).toBe('Hello');
    expect(titleFor('/notes/todo.txt', 'x')).toBe('todo.txt');
    expect(titleFor('/bad.json', '{')).toBe('bad.json');
  });
});

describe('rankDocs', () => {
  const docs = [
    makeDoc({ path: '/trip/packing.md', text: '# Packing\nsocks and a charger for Lisbon', mtime: 1 }),
    makeDoc({ path: '/lisbon.md', text: '# Lisbon\nthe café near the river', mtime: 2 }),
    makeDoc({ path: '/other.md', text: 'nothing here', mtime: 3 }),
  ];

  it('needs every word, in any order, ignoring case and accents', () => {
    expect(rankDocs(docs, queryWords('CAFE river')).map((r) => r.doc.path)).toEqual(['/lisbon.md']);
    expect(rankDocs(docs, queryWords('socks river'))).toEqual([]);
    expect(rankDocs(docs, [])).toEqual([]);
  });

  it('puts a title or path match first', () => {
    expect(rankDocs(docs, queryWords('lisbon')).map((r) => r.doc.path)).toEqual(['/lisbon.md', '/trip/packing.md']);
  });
});

describe('snippetFor', () => {
  it('shows the text around the first word', () => {
    const body = 'a '.repeat(200) + 'the charger is in the blue bag ' + 'b '.repeat(200);
    const s = snippetFor(body, queryWords('charger'), 80);
    expect(s).toContain('charger');
    expect(s.startsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(82);
  });

  it('shows the start when no word is in the text', () => {
    expect(snippetFor('short text', queryWords('title-only'))).toBe('short text');
  });
});
