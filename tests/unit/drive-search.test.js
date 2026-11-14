import { describe, it, expect } from 'vitest';
import {
  isSearchable,
  plainText,
  titleFor,
  makeDoc,
  rankDocs,
  snippetFor,
  queryWords,
  indexFiles,
  searchIndexes,
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

describe('indexFiles and searchIndexes', () => {
  const files = (list) => list.map(([path, text, mtime, stamp]) => ({ path, size: text.length, mtime, stamp, text }));
  const reader = (reads) => async (path, f) => {
    reads.push(path);
    return f.text;
  };

  it('reads only new and changed files, and keeps the rest', async () => {
    const reads = [];
    const first = await indexFiles(files([['/a.md', 'apples', 1], ['/b.png', 'x', 1], ['/.data/c.json', '{}', 1]]), { read: reader(reads) });
    expect([...first.docs.keys()]).toEqual(['/a.md']);
    expect(first.missing).toBe(false);
    const again = await indexFiles(files([['/a.md', 'apples', 1], ['/d.txt', 'dates', 2]]), { old: first.docs, read: reader(reads) });
    expect(reads).toEqual(['/a.md', '/d.txt']);
    expect(again.docs.get('/a.md')).toBe(first.docs.get('/a.md'));
  });

  it('tells a changed file by its stamp when it has no mtime', async () => {
    const reads = [];
    const one = await indexFiles(files([['/n.txt', 'pears', 0, 5]]), { read: reader(reads) });
    await indexFiles(files([['/n.txt', 'plums', 0, 5]]), { old: one.docs, read: reader(reads) });
    const three = await indexFiles(files([['/n.txt', 'plums', 0, 9]]), { old: one.docs, read: reader(reads) });
    expect(reads).toEqual(['/n.txt', '/n.txt']);
    expect(three.docs.get('/n.txt').body).toBe('plums');
  });

  it('marks the index missing when a file can’t be read or time runs out', async () => {
    const gone = await indexFiles(files([['/a.md', 'x', 1]]), { read: async () => null });
    expect(gone).toMatchObject({ missing: true });
    expect(gone.docs.size).toBe(0);
    const late = await indexFiles(files([['/a.md', 'x', 1]]), { read: async () => 'x', deadline: Date.now() - 1 });
    expect(late.missing).toBe(true);
  });

  it('ranks matches across drives and links each file', async () => {
    const a = await indexFiles(files([['/soup.md', '# Tomato soup\nwith basil', 10]]), { read: async (p, f) => f.text });
    const b = await indexFiles(files([['/notes/basil.txt', 'grow tomato plants', 20]]), { read: async (p, f) => f.text });
    const out = searchIndexes(
      [
        { key: 'a'.repeat(64), title: 'Recipes', docs: a.docs },
        { key: 'b'.repeat(64), title: 'Garden', docs: b.docs },
      ],
      queryWords('basil tomato'),
    );
    expect(out.map((r) => [r.driveTitle, r.path])).toEqual([
      ['Garden', '/notes/basil.txt'],
      ['Recipes', '/soup.md'],
    ]);
    expect(out[1]).toMatchObject({ url: `hyper://${'a'.repeat(64)}/soup.md`, title: 'Tomato soup' });
  });
});
