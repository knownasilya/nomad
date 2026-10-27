import { describe, it, expect } from 'vitest';
import {
  AUTO_NAME_MIN_VISITS,
  autoNameError,
  autoNameMessages,
  makeNameRecord,
  nameAnchors,
  pickAutoName,
  siteOf,
} from '../../shared/names.mjs';

const KEY = 'a'.repeat(64);

describe('auto-names', () => {
  it('names a site after more than two visits', () => {
    expect(AUTO_NAME_MIN_VISITS).toBe(3);
  });
  it('finds the site a page belongs to', () => {
    expect(siteOf('https://github.com/knownasilya/nomad?tab=1')).toBe('https://github.com/');
    expect(siteOf('http://Example.org:8080/a')).toBe('http://example.org:8080/');
    expect(siteOf(`hyper://${KEY}/posts/x/`)).toBe(`hyper://${KEY}/`);
    expect(siteOf('hyper://blog.example.com/x')).toBe('hyper://blog.example.com/');
    for (const url of [
      'hyper://private/apps/todo/',
      'hyper://blog/',
      'nomad://notes/',
      'http://localhost:3000/',
      'http://192.168.1.4/',
      'http://intranet/',
      'file:///etc/hosts',
      '',
    ])
      expect(siteOf(url)).toBe(null);
  });
  it('anchors a web site to its host and a drive to its title', () => {
    expect(nameAnchors('https://www.github.com/')).toEqual(['github']);
    expect(nameAnchors('https://docs.google.com/')).toEqual(['docs', 'google']);
    expect(nameAnchors('http://example.org:8080/')).toEqual(['example']);
    expect(nameAnchors(`hyper://${KEY}/`, 'Hacker News: Daily')).toEqual(['hacker', 'news', 'daily']);
    expect(nameAnchors(`hyper://${KEY}/`, '')).toEqual([]);
    // A web page's title never becomes an anchor.
    expect(nameAnchors('https://evil.example/', 'Gmail')).toEqual(['evil']);
  });
  it('accepts names spelled from the anchors only', () => {
    expect(autoNameError('gh', ['github'])).toBe(null);
    expect(autoNameError('github', ['github'])).toBe(null);
    expect(autoNameError('gdocs', ['docs', 'google'])).toBe(null);
    expect(autoNameError('docs', ['docs', 'google'])).toBe(null);
    expect(autoNameError('hn', ['hacker', 'news'])).toBe(null);
    expect(autoNameError('my-notes', ['my', 'garden', 'notes'])).toBe(null);
    expect(autoNameError('gmail', ['evil'])).toMatch(/start|spelled/);
    expect(autoNameError('hub', ['github'])).toMatch(/start/);
    expect(autoNameError('gx', ['github'])).toMatch(/spelled/);
    expect(autoNameError('g', ['github'])).toMatch(/2 to 24/);
    expect(autoNameError('private', ['private', 'site'])).toMatch(/reserved/);
    expect(autoNameError('gh', [])).toMatch(/Nothing/);
  });
  it('reads the name out of the reply and checks it', () => {
    const a = ['github'];
    expect(pickAutoName('gh', a)).toBe('gh');
    expect(pickAutoName('  `GH`\n', a)).toBe('gh');
    expect(pickAutoName('"github".', a)).toBe('github');
    expect(pickAutoName('Name: hyper://gh/', a)).toBe('gh');
    expect(pickAutoName('<think>maybe hub?</think>\ngh', a)).toBe('gh');
    expect(pickAutoName('none', a)).toBe(null);
    expect(pickAutoName('', a)).toBe(null);
    expect(pickAutoName('gmail', a)).toBe(null);
    expect(pickAutoName('docs.google', ['docs', 'google'])).toBe('docs-google');
  });
  it('asks with the site, page hints and words', () => {
    const [sys, user] = autoNameMessages({
      site: 'https://github.com/',
      title: 'GitHub',
      description: 'Where   the world builds software',
      heading: '',
      anchors: ['github'],
    });
    expect(sys.role).toBe('system');
    expect(sys.content).toMatch(/none/);
    expect(user.content).toContain('Site: https://github.com/');
    expect(user.content).toContain('Description: Where the world builds software');
    expect(user.content).toContain('Words: github');
    expect(user.content).not.toContain('Heading');
  });
  it('marks an AI name, and a later save drops the mark', () => {
    const rec = makeNameRecord({ name: 'gh', url: 'https://github.com/', title: 'GitHub', auto: true });
    expect(rec.auto).toBe(true);
    const kept = makeNameRecord({ name: 'gh', url: 'https://github.com/', title: 'GitHub' }, rec);
    expect(kept.auto).toBe(undefined);
    expect(kept.createdAt).toBe(rec.createdAt);
  });
});
