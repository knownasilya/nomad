import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  suggestName,
  nameError,
  namePath,
  makeNameRecord,
  isNameRecord,
  nameTarget,
  joinTarget,
  resolveNamedUrl,
  matchNames,
} from '../../shared/names.mjs';

const KEY = 'a'.repeat(64);

describe('names', () => {
  it('turns typed words into a valid name', () => {
    expect(normalizeName('  My Blog ')).toBe('my-blog');
    expect(normalizeName('--héllo!!--')).toBe('hllo');
    // A typed dot stays, so the save says why it isn't allowed.
    expect(normalizeName('Garden_Notes.v2')).toBe('garden-notes.v2');
    expect(suggestName('Garden_Notes.v2')).toBe('garden-notes-v2');
    expect(suggestName('example.com')).toBe('example-com');
  });
  it('accepts DNS labels and refuses keys and reserved words', () => {
    expect(nameError('blog')).toBe(null);
    expect(nameError('my-blog-2')).toBe(null);
    expect(nameError('')).toMatch(/Enter/);
    expect(nameError('My Blog')).toMatch(/lowercase/);
    expect(nameError('-blog')).toMatch(/lowercase/);
    expect(nameError(KEY)).toMatch(/drive key/);
    expect(nameError('private')).toMatch(/reserved/);
    expect(nameError('my.blog')).toMatch(/dots/);
    expect(nameError('blog.example.com')).toMatch(/dots/);
  });
  it('refuses names Chromium reads as a number', () => {
    // hyper:// is a standard scheme, so these hosts become IPv4 addresses (hyper://0.0.0.123/).
    for (const n of ['123', '2024', '0777', '0x1f', '0x', '0xdeadbeef']) expect(nameError(n)).toMatch(/number/);
    for (const n of ['1e3', 'deadbeef', '42-a', 'a1', '0xg']) expect(nameError(n)).toBe(null);
    expect(namePath('blog')).toBe('/.vault/names/blog.json');
    expect(() => namePath('../x')).toThrow();
  });
  it('makes records that keep createdAt', () => {
    const a = makeNameRecord({ name: 'blog', url: `hyper://${KEY}/`, title: 'My Blog' }, null, 'T1');
    expect(a).toEqual({ name: 'blog', url: `hyper://${KEY}/`, title: 'My Blog', createdAt: 'T1', updatedAt: 'T1' });
    expect(makeNameRecord({ name: 'blog', url: 'https://x.org' }, a, 'T2').createdAt).toBe('T1');
    expect(isNameRecord(a)).toBe(true);
    // A record a later version wrote with a name this one can't use is skipped, not broken.
    expect(isNameRecord({ name: 'work.blog', url: `hyper://${KEY}/` })).toBe(false);
    expect(isNameRecord({ name: '123', url: `hyper://${KEY}/` })).toBe(false);
    expect(() => makeNameRecord({ name: 'blog', url: 'javascript:alert(1)' })).toThrow(/points to/);
  });
  it('names a hyper:// page by its folder, any other URL whole', () => {
    expect(nameTarget(`hyper://${KEY}/index.html`)).toBe(`hyper://${KEY}/`);
    expect(nameTarget(`hyper://${KEY}`)).toBe(`hyper://${KEY}/`);
    expect(nameTarget('hyper://private/apps/todo/index.html?x=1')).toBe('hyper://private/apps/todo/');
    expect(nameTarget('hyper://private/apps/todo')).toBe('hyper://private/apps/todo/');
    expect(nameTarget('https://github.com/knownasilya?tab=repos')).toBe('https://github.com/knownasilya?tab=repos');
  });
  it('appends the short address path, query and hash', () => {
    expect(joinTarget(`hyper://${KEY}/`, '/posts/x/')).toBe(`hyper://${KEY}/posts/x/`);
    expect(joinTarget('hyper://private/apps/todo/', '/style.css')).toBe('hyper://private/apps/todo/style.css');
    expect(joinTarget('https://github.com/knownasilya', '/nomad', '?tab=1', '#top')).toBe('https://github.com/knownasilya/nomad?tab=1#top');
    expect(joinTarget('https://x.org/?q=1', '/', '?other=2')).toBe('https://x.org/?q=1');
  });
  it('resolves short addresses of known names only', () => {
    const recs = { blog: { url: `hyper://${KEY}/` }, gh: { url: 'https://github.com/knownasilya' } };
    const lookup = (n) => recs[n] || null;
    expect(resolveNamedUrl('hyper://blog/', lookup)).toBe(`hyper://${KEY}/`);
    expect(resolveNamedUrl('hyper://BLOG/posts/?a=1#h', lookup)).toBe(`hyper://${KEY}/posts/?a=1#h`);
    expect(resolveNamedUrl('hyper://gh/nomad', lookup)).toBe('https://github.com/knownasilya/nomad');
    expect(resolveNamedUrl('hyper://unknown/', lookup)).toBe(null);
    expect(resolveNamedUrl('hyper://private/', lookup)).toBe(null);
    expect(resolveNamedUrl(`hyper://${KEY}/`, lookup)).toBe(null);
    expect(resolveNamedUrl('hyper://blog.example.com/', lookup)).toBe(null);
    expect(resolveNamedUrl('https://blog/', lookup)).toBe(null);
  });
  it('ranks URL bar matches: exact, prefix, then contains', () => {
    const recs = [
      { name: 'blogroll', url: 'https://a.org' },
      { name: 'blog', url: `hyper://${KEY}/` },
      { name: 'notes', url: 'nomad://notes/', title: 'My blog notes' },
      { name: 'other', url: 'https://b.org' },
    ];
    expect(matchNames('blog', recs).map((r) => r.name)).toEqual(['blog', 'blogroll', 'notes']);
    expect(matchNames('hyper://blog/', recs)[0].name).toBe('blog');
    expect(matchNames('', recs)).toEqual([]);
  });
});
