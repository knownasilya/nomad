// nomad://search's named sources (app/userland/search/js/sources.js): the saved list is cleaned,
// new sources are checked, and the answers of several indexes become one ranked, de-duplicated list
// that says which source found each Drive.
import { describe, it, expect } from 'vitest';
import {
  normalizeSources,
  newSource,
  cleanUrl,
  mergeResults,
  mergeTopics,
} from '../../app/userland/search/js/sources.js';

const A = { id: 'a', name: 'Built-in' };
const B = { id: 'b', name: 'Team index' };
const rec = (driveKey, extra = {}) => ({
  driveKey,
  title: driveKey,
  matched: 1,
  score: 1,
  lastSeen: 1,
  ...extra,
});

describe('cleanUrl', () => {
  it('keeps http(s) addresses without a trailing slash', () => {
    expect(cleanUrl('https://index.example/')).toBe('https://index.example');
    expect(cleanUrl(' http://localhost:8787 ')).toBe('http://localhost:8787');
    expect(cleanUrl('https://index.example/api/')).toBe('https://index.example/api');
  });
  it('assumes http for a bare host', () => {
    expect(cleanUrl('index.example:9000')).toBe('http://index.example:9000');
  });
  it('rejects other schemes and junk', () => {
    expect(cleanUrl('hyper://abc/')).toBe('');
    expect(cleanUrl('')).toBe('');
    expect(cleanUrl('http://')).toBe('');
  });
});

describe('normalizeSources', () => {
  it('drops entries without an address and duplicates, and names unnamed ones by host', () => {
    const out = normalizeSources([
      { id: 'x', name: 'Mine', url: 'https://a.example/' },
      { id: 'y', url: 'https://b.example', enabled: false },
      { id: 'z', name: 'Dup', url: 'https://a.example' },
      { name: 'Broken', url: 'ftp://c.example' },
      null,
    ]);
    expect(out).toEqual([
      { id: 'x', name: 'Mine', url: 'https://a.example', enabled: true },
      { id: 'y', name: 'b.example', url: 'https://b.example', enabled: false },
    ]);
  });
  it('treats anything but a list as no sources', () => {
    expect(normalizeSources(undefined)).toEqual([]);
    expect(normalizeSources('[]')).toEqual([]);
  });
});

describe('newSource', () => {
  it('makes an enabled, named source', () => {
    const s = newSource(' Team ', 'https://team.example/');
    expect(s).toMatchObject({ name: 'Team', url: 'https://team.example', enabled: true });
    expect(typeof s.id).toBe('string');
  });
  it('refuses a bad or repeated address', () => {
    expect(() => newSource('x', 'nope://')).toThrow(/http/);
    expect(() => newSource('x', 'https://a.example/', [{ url: 'https://a.example' }])).toThrow(
      /already/
    );
  });
});

describe('mergeResults', () => {
  it('lists a Drive found by two sources once, naming both', () => {
    const out = mergeResults([
      { source: A, results: [rec('k1'), rec('k2')] },
      { source: B, results: [rec('k1')] },
    ]);
    expect(out.map((r) => r.driveKey)).toEqual(['k1', 'k2']);
    expect(out[0].sources).toEqual([A, B]);
    expect(out[1].sources).toEqual([A]);
  });
  it('ranks across sources like one index: matched, then score, then last seen', () => {
    const out = mergeResults([
      { source: A, results: [rec('low', { score: 2 }), rec('old', { score: 5, lastSeen: 1 })] },
      {
        source: B,
        results: [
          rec('two-words', { matched: 2, score: 1 }),
          rec('new', { score: 5, lastSeen: 9 }),
        ],
      },
    ]);
    expect(out.map((r) => r.driveKey)).toEqual(['two-words', 'new', 'old', 'low']);
  });
  it('keeps the best match and the freshest details for a shared Drive', () => {
    const [r] = mergeResults([
      { source: A, results: [rec('k', { title: 'Old title', score: 7, lastSeen: 1 })] },
      { source: B, results: [rec('k', { title: 'New title', score: 2, lastSeen: 5 })] },
    ]);
    expect(r).toMatchObject({ title: 'New title', score: 7, lastSeen: 5 });
  });
  it('ignores malformed answers', () => {
    expect(
      mergeResults([
        { source: A, results: null },
        { source: B, results: [{}, rec('k')] },
      ])
    ).toHaveLength(1);
  });
});

describe('mergeTopics', () => {
  it('takes the highest count any source reports, never a sum', () => {
    const out = mergeTopics([
      {
        topics: [
          { topic: 'music', count: 3 },
          { topic: 'art', count: 1 },
        ],
      },
      {
        topics: [
          { topic: 'music', count: 2 },
          { topic: 'zines', count: 4 },
        ],
      },
    ]);
    expect(out).toEqual([
      { topic: 'zines', count: 4 },
      { topic: 'music', count: 3 },
      { topic: 'art', count: 1 },
    ]);
  });
});
