// The Cmd/Ctrl+K command palette's rows (app/lib/command-palette.ts): what it lists for what's
// typed, in what order, and what Enter opens.

import { describe, it, expect } from 'vitest';
import {
  paletteResults,
  findOpenTab,
  moveSelection,
  isNewTabPage,
  BUILTIN_PAGES,
  RECENT_LIMIT,
  isNamesOnly,
} from '../../app/lib/command-palette.ts';

const engine = { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' };
const tabs = [
  { index: 0, title: 'Nomad docs', url: 'https://nomad.pages.dev/docs/', isActive: true },
  { index: 1, title: 'GitHub - knownasilya/nomad', url: 'https://github.com/knownasilya/nomad' },
  { index: 2, title: 'Groceries · Notes', url: 'nomad://notes/abc123' },
  { index: 3, title: 'Café menu', url: 'https://cafe.example/menu', isPinned: true },
];
const recent = [
  { url: 'nomad://desktop/', title: 'New Tab', ts: 9 },
  { url: 'https://news.ycombinator.com/', title: 'Hacker News', ts: 8 },
  { url: 'https://github.com/knownasilya/nomad', title: 'GitHub - knownasilya/nomad', ts: 7 },
  { url: 'https://news.ycombinator.com', title: 'Hacker News', ts: 6 },
  { url: 'https://example.com/recipes/rice', title: 'How to cook rice', ts: 5 },
  { url: 'nomad://settings/', title: 'Settings', ts: 4 },
];
const run = (query, extra = {}) => paletteResults({ query, tabs, recent, searchEngine: engine, ...extra });
const kinds = (rows) => rows.map((r) => r.kind);

describe('command palette with nothing typed', () => {
  it('lists the other tabs, then recent pages, then the main pages', () => {
    const rows = run('');
    expect(rows.filter((r) => r.kind === 'tab').map((r) => r.tabIndex)).toEqual([1, 2, 3]);
    const pages = rows.filter((r) => r.kind === 'page');
    // Notes is open in a tab, so it's listed there and not here
    expect(pages.length).toBe(BUILTIN_PAGES.filter((p) => p.top).length - 1);
    expect(pages.map((r) => r.title)).toContain('Reader');
    expect(pages.map((r) => r.title)).not.toContain('My Library · Jobs');
    // groups come in order: tabs, recent, pages
    const order = kinds(rows).filter((k, i, a) => a.indexOf(k) === i);
    expect(order).toEqual(['tab', 'recent', 'page']);
    expect(rows.some((r) => r.kind === 'search' || r.kind === 'goto')).toBe(false);
  });

  it("doesn't list the tab you're on", () => {
    expect(run('').some((r) => r.tabIndex === 0 && r.kind === 'tab')).toBe(false);
  });

  it('lists each recent page once, not the new tab page, open tabs or Nomad pages', () => {
    const rec = run('').filter((r) => r.kind === 'recent');
    expect(rec.map((r) => r.url)).toEqual([
      'https://news.ycombinator.com/',
      'https://example.com/recipes/rice',
    ]);
  });

  it('keeps recent pages to a few', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://site${i}.example/`, title: `Site ${i}` }));
    expect(paletteResults({ query: '', tabs, recent: many }).filter((r) => r.kind === 'recent').length).toBe(RECENT_LIMIT);
  });

  it("doesn't list a Nomad page again when its tab is listed", () => {
    const rows = run('');
    expect(rows.some((r) => r.kind === 'page' && r.title === 'Notes')).toBe(false);
    expect(rows.find((r) => r.kind === 'page' && r.title === 'Reader').tabIndex).toBeUndefined();
  });

  it('switches to a Nomad page that is already open', () => {
    const withReader = [...tabs, { index: 4, title: 'Reader', url: 'nomad://reader/' }];
    // "rss" finds the Reader page by its other words, but not the tab: the page row switches to it
    const rows = paletteResults({ query: 'rss', tabs: withReader });
    expect(rows[0]).toMatchObject({ kind: 'page', url: 'nomad://reader/', tabIndex: 4 });
  });
});

describe('command palette with a search', () => {
  it('matches every word, in any order, ignoring case and accents', () => {
    const rows = run('menu cafe');
    expect(rows[0]).toMatchObject({ kind: 'tab', tabIndex: 3, isPinned: true });
  });

  it('lists matching Nomad pages before matching history', () => {
    const rows = run('settings');
    expect(kinds(rows).filter((k, i, a) => a.indexOf(k) === i)).toEqual(['page', 'search']);
    const both = run('library', { history: [{ url: 'https://lib.example/', title: 'Library hours' }] });
    expect(kinds(both).indexOf('page')).toBeLessThan(kinds(both).indexOf('recent'));
  });

  it('finds Nomad pages by title, section and other words', () => {
    expect(run('jobs')[0]).toMatchObject({ kind: 'page', url: 'nomad://library/jobs', title: 'My Library · Jobs' });
    expect(run('api keys')[0]).toMatchObject({ kind: 'page', url: 'nomad://library/secrets' });
    expect(run('rss')[0]).toMatchObject({ kind: 'page', url: 'nomad://reader/' });
  });

  it('puts a title that starts with the word first', () => {
    const titles = run('ai').filter((r) => r.kind === 'page').map((r) => r.title);
    expect(titles[0]).toBe('AI');
    // Jobs comes before the AI page's own pages in the list, but only matches "ai" by another word
    expect(titles.indexOf('My Library · Jobs')).toBeGreaterThan(titles.indexOf('AI · Setup'));
  });

  it('adds older history that matches, after the newest visits', () => {
    const rows = run('rice', { history: [{ url: 'https://old.example/rice', title: 'Rice, old' }] });
    expect(rows.filter((r) => r.kind === 'recent').map((r) => r.url)).toEqual([
      'https://example.com/recipes/rice',
      'https://old.example/rice',
    ]);
  });

  it('ends with a search on the Space’s search engine; Enter searches when nothing matches', () => {
    const rows = run('how do magnets work');
    expect(kinds(rows)).toEqual(['search']);
    expect(rows[0].url).toBe('https://duckduckgo.com/?q=how+do+magnets+work');
    expect(rows[0].title).toContain('DuckDuckGo');
  });

  it('goes to an address first', () => {
    const rows = run('example.org');
    expect(rows[0]).toMatchObject({ kind: 'goto', url: 'https://example.org' });
    expect(rows[rows.length - 1].kind).toBe('search');
    expect(run('hyper://private/')[0]).toMatchObject({ kind: 'goto', url: 'hyper://private/' });
  });

  it('has no Go to for a plain word', () => {
    expect(run('groceries').some((r) => r.kind === 'goto')).toBe(false);
    expect(run('groceries')[0]).toMatchObject({ kind: 'tab', tabIndex: 2 });
  });

  it('searches Nomad when no engine is set', () => {
    const rows = paletteResults({ query: 'zzz', tabs: [] });
    expect(rows[rows.length - 1].url).toBe('nomad://search/?q=zzz');
  });
});

describe('names', () => {
  const names = [
    { name: 'blog', url: 'hyper://' + 'a'.repeat(64) + '/', title: 'My blog' },
    { name: 'blogroll', url: 'https://example.com/blogroll', title: 'Blogroll' },
    { name: 'recipes', url: 'hyper://' + 'b'.repeat(64) + '/', title: 'Family recipes' },
    { name: 'hidden', url: 'https://hidden.example/', hidden: true },
  ];
  it('opens the exact name first, as hyper://<name>/', () => {
    const rows = run('blog', { names });
    expect(rows[0]).toMatchObject({ kind: 'name', title: 'blog', url: 'hyper://blog/' });
    expect(rows[0].group).toBeUndefined();
    const more = rows.filter((r) => r.kind === 'name' && r.group);
    expect(more.map((r) => r.title)).toEqual(['blogroll']);
  });
  it('finds a name by its title', () => {
    expect(run('family', { names }).find((r) => r.kind === 'name').title).toBe('recipes');
  });
  it("doesn't add Go to for hyper://<name>/ itself", () => {
    const rows = run('hyper://blog/', { names });
    expect(rows[0]).toMatchObject({ kind: 'name', title: 'blog' });
    expect(rows.some((r) => r.kind === 'goto')).toBe(false);
  });
  it('searches only names after #', () => {
    expect(kinds(run('#', { names }))).toEqual(['name', 'name', 'name']);
    expect(run('#', { names }).map((r) => r.title)).toEqual(['blog', 'blogroll', 'recipes']);
    const rows = run('#blog', { names });
    expect(rows.map((r) => r.title)).toEqual(['blog', 'blogroll']);
    // no Go to, no search, no tabs or pages, even when other things match
    expect(run('# notes', { names })).toEqual([]);
    expect(isNamesOnly(' #x')).toBe(true);
    expect(isNamesOnly('x#')).toBe(false);
  });

  it('leaves out a hidden name and lists none before you type', () => {
    expect(run('hidden', { names }).some((r) => r.kind === 'name')).toBe(false);
    expect(run('', { names }).some((r) => r.kind === 'name')).toBe(false);
  });
});

describe('a Nomad page open in the tab you are on', () => {
  it("switches (stays) instead of opening a second copy", () => {
    const onCalendar = [{ index: 0, title: 'Calendar', url: 'nomad://calendar/', isActive: true }];
    const rows = paletteResults({ query: 'calendar', tabs: onCalendar });
    expect(rows[0]).toMatchObject({ kind: 'page', url: 'nomad://calendar/', tabIndex: 0 });
  });
});

describe('findOpenTab', () => {
  const open = [
    { index: 0, url: 'nomad://notes/abc' },
    { index: 1, url: 'nomad://library/jobs?id=1' },
    { index: 2, url: 'nomad://library/mods' },
  ];
  it('counts an app’s own pages as the app', () => {
    expect(findOpenTab(open, 'nomad://notes/').index).toBe(0);
  });
  it('tells My Library’s pages apart', () => {
    expect(findOpenTab(open, 'nomad://library/jobs').index).toBe(1);
    expect(findOpenTab(open, 'nomad://library/mods').index).toBe(2);
    expect(findOpenTab(open, 'nomad://library/')).toBeUndefined();
    expect(findOpenTab(open, 'nomad://library/names')).toBeUndefined();
  });
});

describe('palette keys', () => {
  it('moves the selection and wraps around', () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });
  it('opens in place over the new tab page', () => {
    expect(isNewTabPage('nomad://desktop/')).toBe(true);
    expect(isNewTabPage('')).toBe(true);
    expect(isNewTabPage('https://example.com')).toBe(false);
  });
});
