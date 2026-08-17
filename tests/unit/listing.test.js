import { describe, it, expect } from 'vitest';
import {
  normalizeTopic,
  normalizeTopics,
  normalizeKeyword,
  normalizeKeywords,
  sanitizeListingFields,
  MAX_TOPICS,
  MAX_KEYWORDS,
} from '../../app/lib/listing.ts';

describe('normalizeTopic', () => {
  it('lowercases and hyphenates', () => {
    expect(normalizeTopic('Raised Beds')).toBe('raised-beds');
    expect(normalizeTopic('  Permaculture  ')).toBe('permaculture');
  });
  it('collapses runs of punctuation/space to one hyphen and trims edges', () => {
    expect(normalizeTopic('web___dev!!!')).toBe('web-dev');
    expect(normalizeTopic('--hello--')).toBe('hello');
  });
  it('keeps unicode letters (any script)', () => {
    expect(normalizeTopic('Café Culture')).toBe('café-culture');
    expect(normalizeTopic('日本語')).toBe('日本語');
  });
  it('returns empty when nothing usable remains', () => {
    expect(normalizeTopic('🌱')).toBe('');
    expect(normalizeTopic('   ')).toBe('');
    expect(normalizeTopic(42)).toBe('');
    expect(normalizeTopic(undefined)).toBe('');
  });
  it('caps length without leaving a trailing dash', () => {
    const slug = normalizeTopic('a'.repeat(60));
    expect(slug.length).toBe(40);
    expect(normalizeTopic('x'.repeat(39) + ' y').endsWith('-')).toBe(false);
  });
});

describe('normalizeTopics', () => {
  it('slugifies, dedupes, and caps at MAX_TOPICS', () => {
    expect(normalizeTopics(['Gardening', 'gardening', 'Raised Beds'])).toEqual([
      'gardening',
      'raised-beds',
    ]);
    const many = Array.from({ length: 10 }, (_, i) => `topic-${i}`);
    expect(normalizeTopics(many)).toHaveLength(MAX_TOPICS);
  });
  it('drops empties and handles non-arrays', () => {
    expect(normalizeTopics(['ok', '🌱', ''])).toEqual(['ok']);
    expect(normalizeTopics('nope')).toEqual([]);
    expect(normalizeTopics(undefined)).toEqual([]);
  });
});

describe('normalizeKeyword / normalizeKeywords', () => {
  it('preserves wording, only trims and collapses whitespace', () => {
    expect(normalizeKeyword('  raised   beds ')).toBe('raised beds');
    expect(normalizeKeyword('Permaculture')).toBe('Permaculture');
  });
  it('dedupes case-insensitively but keeps first wording, caps at MAX_KEYWORDS', () => {
    expect(normalizeKeywords(['Beds', 'beds', 'Soil'])).toEqual(['Beds', 'Soil']);
    const many = Array.from({ length: 20 }, (_, i) => `kw${i}`);
    expect(normalizeKeywords(many)).toHaveLength(MAX_KEYWORDS);
  });
});

describe('sanitizeListingFields', () => {
  it('only touches present keys and coerces indexable to boolean', () => {
    expect(sanitizeListingFields({ indexable: 1, topics: ['A B'] })).toEqual({
      indexable: true,
      topics: ['a-b'],
    });
    expect(sanitizeListingFields({ keywords: ['x', 'x'] })).toEqual({ keywords: ['x'] });
    expect(sanitizeListingFields({ title: 'unrelated' })).toEqual({});
  });
});
