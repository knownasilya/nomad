import { describe, it, expect } from 'vitest';
import {
  ucfirst,
  pluralize,
  shorten,
  shortenHash,
  makeSafe,
  joinPath,
  toNiceUrl,
  slugify,
  globToRegex,
  parseSimplePathSpec,
} from '../../app/lib/strings.js';

describe('ucfirst', () => {
  it('capitalizes the first character', () => {
    expect(ucfirst('hello')).toBe('Hello');
    expect(ucfirst('world test')).toBe('World test');
  });
  it('handles empty string', () => {
    expect(ucfirst('')).toBe('');
    expect(ucfirst()).toBe('');
  });
  it('coerces non-strings', () => {
    expect(ucfirst(123)).toBe('123');
  });
});

describe('pluralize', () => {
  it('returns base for 1', () => {
    expect(pluralize(1, 'file')).toBe('file');
  });
  it('returns base+s for other counts', () => {
    expect(pluralize(0, 'file')).toBe('files');
    expect(pluralize(2, 'file')).toBe('files');
  });
  it('uses custom suffix', () => {
    expect(pluralize(2, 'match', 'es')).toBe('matches');
  });
});

describe('shorten', () => {
  it('shortens long strings', () => {
    const result = shorten('abcdefghijklmno', 6);
    expect(result.length).toBeLessThanOrEqual(9 + 3); // n + '...'
    expect(result).toContain('...');
  });
  it('leaves short strings unchanged', () => {
    expect(shorten('hi', 6)).toBe('hi');
  });
});

describe('makeSafe', () => {
  it('removes script tags', () => {
    const result = makeSafe('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
  });
  it('handles empty input', () => {
    expect(makeSafe()).toBe('');
    expect(makeSafe('')).toBe('');
  });
});

describe('joinPath', () => {
  it('joins path segments', () => {
    expect(joinPath('/foo', 'bar')).toBe('/foo/bar');
    expect(joinPath('/foo/', '/bar')).toBe('/foo/bar');
  });
  it('handles single segment', () => {
    expect(joinPath('/foo')).toBe('/foo');
  });
});

describe('toNiceUrl', () => {
  it('returns parsed URL string for http URLs', () => {
    const result = toNiceUrl('http://example.com');
    expect(result).toContain('example.com');
  });
  it('shortens long drive key hostnames in hyper:// URLs', () => {
    const key = 'a'.repeat(64);
    const result = toNiceUrl(`hyper://${key}/`);
    expect(result.length).toBeLessThan(`hyper://${key}/`.length);
    expect(result).toContain('..');
  });
  it('returns empty string for falsy input', () => {
    expect(toNiceUrl('')).toBe('');
    expect(toNiceUrl(undefined)).toBe('');
  });
  it('returns non-URL strings unchanged', () => {
    expect(toNiceUrl('not a url')).toBe('not a url');
  });
});

describe('slugify', () => {
  it('converts spaces to hyphens (preserves case)', () => {
    expect(slugify('Hello World')).toBe('Hello-World');
  });
  it('removes special characters', () => {
    expect(slugify('foo & bar!')).toBe('foo-bar');
  });
  it('handles empty string', () => {
    expect(slugify()).toBe('');
  });
});

describe('globToRegex', () => {
  it('converts *.md to match file paths ending in .md', () => {
    const regex = globToRegex('*.md');
    // prepends **/ so needs a leading path segment
    expect(regex.test('/readme.md')).toBe(true);
    expect(regex.test('/readme.txt')).toBe(false);
  });
  it('converts /posts/*.md to match files in /posts/', () => {
    const regex = globToRegex('/posts/*.md');
    expect(regex.test('/posts/entry.md')).toBe(true);
    expect(regex.test('/posts/entry.txt')).toBe(false);
    expect(regex.test('/other/entry.md')).toBe(false);
  });
  it('anchors to start of path', () => {
    const regex = globToRegex('/docs/*.md');
    expect(regex.test('/docs/file.md')).toBe(true);
    expect(regex.test('/other/docs/file.md')).toBe(false);
  });
});

describe('parseSimplePathSpec', () => {
  it('parses extension from path', () => {
    const result = parseSimplePathSpec('/posts/*.md');
    expect(result.prefix).toBe('/posts');
    expect(result.extension).toBe('.md');
  });
  it('handles root wildcard', () => {
    const result = parseSimplePathSpec('/*.json');
    expect(result.extension).toBe('.json');
  });
});
