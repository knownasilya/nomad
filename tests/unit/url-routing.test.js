import { describe, it, expect } from 'vitest';
import { matchesUrlPattern, resolveRoutedSpaceId } from '../../app/lib/url-routing.ts';

describe('matchesUrlPattern', () => {
  it('matches a bare domain and its subdomains', () => {
    expect(matchesUrlPattern('https://github.com/foo', 'github.com')).toBe(true);
    expect(matchesUrlPattern('https://gist.github.com/foo', 'github.com')).toBe(true);
    expect(matchesUrlPattern('https://notgithub.com/foo', 'github.com')).toBe(false);
  });

  it('matches a wildcard subdomain pattern only against subdomains', () => {
    expect(matchesUrlPattern('https://mail.google.com/', '*.google.com')).toBe(true);
    expect(matchesUrlPattern('https://google.com/', '*.google.com')).toBe(false);
  });

  it('matches a host + path glob', () => {
    expect(matchesUrlPattern('https://github.com/myorg/repo', 'github.com/myorg/*')).toBe(true);
    expect(matchesUrlPattern('https://github.com/other/repo', 'github.com/myorg/*')).toBe(false);
  });

  it('ignores a scheme written into the pattern', () => {
    expect(matchesUrlPattern('https://github.com/foo', 'https://github.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesUrlPattern('https://GitHub.com/foo', 'github.com')).toBe(true);
  });

  it('returns false for invalid urls or empty inputs', () => {
    expect(matchesUrlPattern('not a url', 'github.com')).toBe(false);
    expect(matchesUrlPattern('', 'github.com')).toBe(false);
    expect(matchesUrlPattern('https://github.com/', '')).toBe(false);
  });
});

describe('resolveRoutedSpaceId', () => {
  const rules = [
    { id: '1', pattern: 'github.com', spaceId: 2, enabled: true },
    { id: '2', pattern: '*.google.com', spaceId: 3, enabled: false },
    { id: '3', pattern: 'google.com', spaceId: 4, enabled: true },
  ];

  it('returns the spaceId of the first matching enabled rule', () => {
    expect(resolveRoutedSpaceId('https://github.com/x', rules)).toBe(2);
    expect(resolveRoutedSpaceId('https://google.com/x', rules)).toBe(4);
  });

  it('skips disabled rules', () => {
    const onlyDisabled = [{ id: '1', pattern: '*.google.com', spaceId: 3, enabled: false }];
    expect(resolveRoutedSpaceId('https://mail.google.com/x', onlyDisabled)).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveRoutedSpaceId('https://example.com/x', rules)).toBeUndefined();
  });

  it('returns undefined for a non-array rules value', () => {
    expect(resolveRoutedSpaceId('https://github.com/x', undefined)).toBeUndefined();
    expect(resolveRoutedSpaceId('https://github.com/x', null)).toBeUndefined();
  });
});
