import { describe, it, expect } from 'vitest';
import { parseFragmentDirectives } from 'text-fragments-polyfill/text-fragment-utils';
import {
  HIGHLIGHTS_PREFIX,
  pageUrl,
  pageKey,
  highlightsPrefix,
  highlightPath,
  textDirective,
  isTextDirective,
  stripTextDirective,
  withTextDirective,
  newHighlightId,
  isHighlightId,
  makeHighlight,
  isHighlight,
  sortHighlights,
  noteLinkUrl,
  highlightNoteBody,
  quoteFragments,
} from '../../shared/highlights.mjs';
import { findLinks, noteTitle } from '../../shared/vault-apps.mjs';

const KEY = 'a'.repeat(64);
const NOW = '2026-10-11T12:00:00.000Z';

describe('highlights: pages', () => {
  it('keys a page by its address without the fragment', () => {
    expect(pageUrl('https://example.com/post?x=1#intro')).toBe('https://example.com/post?x=1');
    expect(pageUrl('https://example.com/#:~:text=hello')).toBe('https://example.com/');
    expect(pageUrl(`hyper://${KEY}/blog/post.html`)).toBe(`hyper://${KEY}/blog/post.html`);
    expect(pageKey('https://example.com/a#one')).toBe(pageKey('https://example.com/a#two'));
    expect(pageKey('https://example.com/a')).not.toBe(pageKey('https://example.com/b'));
    expect(pageKey('https://example.com/a')).toMatch(/^[0-9a-f]{14}$/);
  });
  it('treats an escaped parenthesis as the same page', () => {
    // A Note's link escapes them (noteLinkUrl); the tab it opens must find the same Highlights.
    expect(pageUrl('https://en.wikipedia.org/wiki/Mercury_%28planet%29')).toBe(
      'https://en.wikipedia.org/wiki/Mercury_(planet)'
    );
    expect(pageKey('https://en.wikipedia.org/wiki/Mercury_%28planet%29')).toBe(
      pageKey('https://en.wikipedia.org/wiki/Mercury_(planet)')
    );
  });
  it('ignores tracking parameters, and keeps the rest as written', () => {
    expect(pageUrl('https://example.com/a?utm_source=x&utm_medium=y')).toBe(
      'https://example.com/a'
    );
    expect(pageUrl('https://example.com/a?id=7&fbclid=abc&q=a%20b')).toBe(
      'https://example.com/a?id=7&q=a%20b'
    );
    expect(pageUrl('https://example.com/a?id=7')).toBe('https://example.com/a?id=7');
  });
  it('has no Highlights for other schemes', () => {
    expect(pageUrl('nomad://notes/')).toBe(null);
    expect(pageUrl('file:///tmp/a.html')).toBe(null);
    expect(pageUrl('not a url')).toBe(null);
    expect(() => pageKey('nomad://reader/')).toThrow();
  });
  it('stores a page’s Highlights under one prefix', () => {
    const prefix = highlightsPrefix('https://example.com/a');
    expect(prefix.startsWith(HIGHLIGHTS_PREFIX)).toBe(true);
    expect(highlightPath('https://example.com/a#x', 'abc-123')).toBe(prefix + 'abc-123.json');
    expect(() => highlightPath('https://example.com/a', '../x')).toThrow();
  });
});

describe('highlights: text directives', () => {
  it('writes the format Chromium reads', () => {
    expect(
      textDirective({ prefix: 'The', textStart: 'future of building', suffix: 'happens together' })
    ).toBe('The-,future%20of%20building,-happens%20together');
    expect(textDirective({ textStart: 'start', textEnd: 'end' })).toBe('start,end');
    expect(() => textDirective({})).toThrow();
  });
  it('escapes the characters that mark its parts, and parentheses', () => {
    const text = textDirective({ prefix: 'a-b', textStart: 'x, y & z (1)', suffix: "it's" });
    expect(text).toBe('a%2Db-,x%2C%20y%20%26%20z%20%281%29,-it%27s');
    expect(isTextDirective(text)).toBe(true);
  });
  it('round-trips through the text fragment parser', () => {
    const fragment = {
      prefix: 'well-known',
      textStart: 'one, two',
      textEnd: 'three-four',
      suffix: '(five)',
    };
    const parsed = parseFragmentDirectives({ text: [textDirective(fragment)] }).text[0];
    expect(parsed).toEqual(fragment);
  });
  it('adds a directive to a link, and keeps the page’s own fragment', () => {
    expect(withTextDirective('https://example.com/a', 'hi')).toBe(
      'https://example.com/a#:~:text=hi'
    );
    expect(withTextDirective('https://example.com/#/route', 'hi')).toBe(
      'https://example.com/#/route:~:text=hi'
    );
    // The page was opened from a Highlight link: the old directive goes.
    expect(withTextDirective('https://example.com/a#:~:text=old', 'new')).toBe(
      'https://example.com/a#:~:text=new'
    );
    expect(stripTextDirective('https://example.com/a#top:~:text=x')).toBe(
      'https://example.com/a#top'
    );
    expect(stripTextDirective('https://example.com/a')).toBe('https://example.com/a');
  });
  it('refuses a directive that would break the link', () => {
    expect(isTextDirective('')).toBe(false);
    expect(isTextDirective('has space')).toBe(false);
    expect(isTextDirective('a&text=b')).toBe(false);
    expect(isTextDirective('a#b')).toBe(false);
    expect(isTextDirective('x'.repeat(5000))).toBe(false);
  });
});

describe('highlights: text the AI quotes', () => {
  it('looks for a one-block quote as it is, spaces made one', () => {
    expect(quoteFragments('  the smallest\u00a0  planet ')).toEqual([{ textStart: 'the smallest planet' }]);
  });
  it('finds a quote of several blocks by its first and last', () => {
    expect(quoteFragments('First paragraph.\n\nSecond one.\nLast one.')).toEqual([
      { textStart: 'First paragraph.', textEnd: 'Last one.' },
    ]);
    // Table cells, as innerText gives them.
    expect(quoteFragments('Mercury\t0.39 AU')).toEqual([{ textStart: 'Mercury', textEnd: '0.39 AU' }]);
  });
  it('tries a quote cut with an ellipsis as it is, then by the text around the cut', () => {
    expect(quoteFragments('It is the smallest … closest to the Sun')).toEqual([
      { textStart: 'It is the smallest … closest to the Sun' },
      { textStart: 'It is the smallest', textEnd: 'closest to the Sun' },
    ]);
    expect(quoteFragments('It is the smallest planet...')).toEqual([
      { textStart: 'It is the smallest planet...' },
      { textStart: 'It is the smallest planet' },
    ]);
  });
  it('has nothing to look for in an empty quote', () => {
    expect(quoteFragments('')).toEqual([]);
    expect(quoteFragments(' \n\t ')).toEqual([]);
    expect(quoteFragments(null)).toEqual([]);
  });
});

describe('highlights: records', () => {
  it('makes ids that sort by time', () => {
    const a = newHighlightId(1000, () => 0.1);
    const b = newHighlightId(2000, () => 0.1);
    expect(isHighlightId(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(isHighlightId('../etc')).toBe(false);
  });
  it('builds a record for the page, without its fragment', () => {
    const rec = makeHighlight(
      {
        id: 'h1',
        url: 'https://example.com/a#:~:text=x',
        text: 'hello',
        quote: '  hello\n  world ',
        title: 'A page',
      },
      null,
      NOW
    );
    expect(rec).toEqual({
      type: 'nomad/highlight',
      id: 'h1',
      url: 'https://example.com/a',
      text: 'hello',
      quote: 'hello world',
      title: 'A page',
      createdAt: NOW,
    });
    expect(isHighlight(rec)).toBe(true);
  });
  it('keeps the creation time when a Note is added', () => {
    const first = makeHighlight({ id: 'h1', url: 'https://example.com/', text: 'hi' }, null, NOW);
    const next = makeHighlight({ ...first, noteId: 'n1' }, first, '2027-01-01T00:00:00.000Z');
    expect(next.createdAt).toBe(NOW);
    expect(next.noteId).toBe('n1');
  });
  it('refuses records it can’t use', () => {
    expect(() => makeHighlight({ id: 'h1', url: 'nomad://notes/', text: 'hi' })).toThrow();
    expect(() => makeHighlight({ id: 'h1', url: 'https://example.com/', text: 'a b' })).toThrow();
    expect(isHighlight({ type: 'nomad/note', id: 'h1', url: 'x', text: 'hi' })).toBe(false);
    expect(isHighlight(null)).toBe(false);
  });
  it('sorts oldest first', () => {
    const list = [{ createdAt: '2026-02-01' }, { createdAt: '2026-01-01' }];
    expect(sortHighlights(list).map((h) => h.createdAt)).toEqual(['2026-01-01', '2026-02-01']);
  });
});

describe('highlights: notes', () => {
  const link = withTextDirective(
    'https://en.wikipedia.org/wiki/Mercury_(planet)',
    'smallest%20planet'
  );

  it('makes a link a Markdown link can hold', () => {
    expect(noteLinkUrl(link)).toBe(
      'https://en.wikipedia.org/wiki/Mercury_%28planet%29#:~:text=smallest%20planet'
    );
  });
  it('quotes the text under the page’s title and links back to it', () => {
    const body = highlightNoteBody({
      title: 'Mercury (planet)',
      quote: 'It is the smallest planet.\n\n\nIt is close to the Sun.',
      link,
    });
    expect(body).toBe(
      '# Mercury (planet)\n\n' +
        '> It is the smallest planet.\n>\n> It is close to the Sun.\n\n' +
        'From [en.wikipedia.org](https://en.wikipedia.org/wiki/Mercury_%28planet%29#:~:text=smallest%20planet)\n\n'
    );
    expect(noteTitle(body)).toBe('Mercury (planet)');
    // The link is a URL, not a link to another note.
    expect(findLinks(body)).toEqual([]);
  });
  it('puts what the AI wrote below the link', () => {
    const body = highlightNoteBody({ title: 'Mercury', quote: 'hi', link, text: '  The **key** fact.\n' });
    expect(body.endsWith(`(${noteLinkUrl(link)})\n\nThe **key** fact.\n`)).toBe(true);
    expect(highlightNoteBody({ title: 'Mercury', quote: 'hi', link, text: '  ' })).toBe(
      highlightNoteBody({ title: 'Mercury', quote: 'hi', link })
    );
  });
  it('names a Drive page by its title, not its key', () => {
    const body = highlightNoteBody({
      title: 'My [blog]',
      quote: 'hi',
      link: `hyper://${KEY}/post#:~:text=hi`,
    });
    expect(body).toContain(`From [My blog](hyper://${KEY}/post#:~:text=hi)`);
  });
});
