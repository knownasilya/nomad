// The AI's Notes and Reader capabilities: the pure parts (app/bg/ai/vault-tools.mjs). The Vault and
// Drive I/O (bg/web-apis/bg/ai-vault.ts) is Electron-coupled and not covered here.

import { describe, it, expect, vi } from 'vitest';
import {
  VAULT_TOOL_PERMS,
  VAULT_PERMS,
  askOncePerTurn,
  jobPermitFor,
  findNotes,
  findNote,
  noteForModel,
  loadFeedPosts,
  findPosts,
  splitPostUrl,
  htmlToText,
  clip,
  clampLimit,
  findMods,
  modForModel,
} from '../../app/bg/ai/vault-tools.mjs';
import { makeMod } from '../../shared/mods.mjs';
import { CAPABILITIES } from '../../app/bg/ai/search-execute.mjs';

const note = (id, body, updatedAt) => ({ type: 'nomad/note', id, body, createdAt: updatedAt, updatedAt });
const NOTES = [
  note('a1', '# Seed order\nTomatoes and [[Garden plan]]', '2026-10-01T00:00:00.000Z'),
  note('b2', '# Garden plan\nBeds by the fence', '2026-10-03T00:00:00.000Z'),
  note('c3', 'Shopping\nmilk, eggs', '2026-10-02T00:00:00.000Z'),
];

describe('vault tools: permissions', () => {
  it('gives every Notes, Reader and Mods capability one of its permissions', () => {
    // openTab is the user's own AI's too, but opens a tab: no Vault data, no Vault permission.
    // Secrets (listSecrets, httpRequest) aren't Vault data: they ask per secret (ADR-0033).
    const gated = CAPABILITIES.filter(
      (c) => c.gates?.personal && !c.gates?.tab && !c.gates?.secrets && !c.namedDescription && c.name !== 'openTab'
    ).map((c) => c.name);
    expect(gated.sort()).toEqual(Object.keys(VAULT_TOOL_PERMS).sort());
    expect([...new Set(Object.values(VAULT_TOOL_PERMS))].sort()).toEqual([...VAULT_PERMS].sort());
    // Reading and writing are separate grants for both.
    expect(VAULT_TOOL_PERMS.readNote).toBe('notesRead');
    expect(VAULT_TOOL_PERMS.writeNote).toBe('notesWrite');
    expect(VAULT_TOOL_PERMS.highlightText).toBe('notesWrite');
    expect(VAULT_TOOL_PERMS.readReaderPost).toBe('readerRead');
    expect(VAULT_TOOL_PERMS.markPostsRead).toBe('readerWrite');
    expect(VAULT_TOOL_PERMS.listMods).toBe('modsRead');
    expect(VAULT_TOOL_PERMS.saveMod).toBe('modsWrite');
    expect(VAULT_TOOL_PERMS.deleteMod).toBe('modsWrite');
  });

  it('asks once per turn for a Vault permission, and every time for any other', async () => {
    const permit = vi.fn(async (p) => p !== 'readerWrite');
    const ask = askOncePerTurn(permit);
    expect(await ask('notesRead', 'wc')).toBe(true);
    expect(await ask('notesRead', 'wc')).toBe(true);
    expect(await ask('readerWrite', 'wc')).toBe(false);
    expect(await ask('readerWrite', 'wc')).toBe(false); // a "no" holds for the turn too
    await ask('deleteDrive', 'wc');
    await ask('deleteDrive', 'wc');
    expect(permit.mock.calls.map((c) => c[0])).toEqual(['notesRead', 'readerWrite', 'deleteDrive', 'deleteDrive']);
    expect(permit).toHaveBeenCalledWith('notesRead', 'wc');
  });

  // The phone keeps no grant, so a Bridge turn that writes several files asked once per file.
  it('asks once per turn to edit each drive', async () => {
    const permit = vi.fn(async () => true);
    const ask = askOncePerTurn(permit);
    expect(await ask('modifyDrive:abc', 'wc')).toBe(true);
    expect(await ask('modifyDrive:abc', 'wc')).toBe(true);
    await ask('modifyDrive:def', 'wc');
    expect(permit.mock.calls.map((c) => c[0])).toEqual(['modifyDrive:abc', 'modifyDrive:def']);
  });

  it('asks again on another site in the same turn', async () => {
    const permit = vi.fn(async () => true);
    const ask = askOncePerTurn(permit);
    const tab = (url) => ({ getURL: () => url });
    await ask('notesRead', tab('hyper://aaa/index.html'));
    await ask('notesRead', tab('hyper://aaa/about.html'));
    await ask('notesRead', tab('https://example.com/'));
    expect(permit).toHaveBeenCalledTimes(2);
  });

  it('asks again in the next turn', async () => {
    const permit = vi.fn(async () => true);
    await askOncePerTurn(permit)('notesRead');
    await askOncePerTurn(permit)('notesRead');
    expect(permit).toHaveBeenCalledTimes(2);
  });
});

describe('vault tools: Notes', () => {
  it('lists notes newest first, and searches their text', () => {
    expect(findNotes(NOTES).map((n) => n.id)).toEqual(['b2', 'c3', 'a1']);
    expect(findNotes(NOTES)[0]).toEqual({ id: 'b2', title: 'Garden plan', url: 'nomad://notes/b2', snippet: 'Beds by the fence', updatedAt: NOTES[1].updatedAt });
    expect(findNotes(NOTES, { query: 'garden' }).map((n) => n.id)).toEqual(['b2', 'a1']);
    expect(findNotes(NOTES, { query: 'GARDEN fence' }).map((n) => n.id)).toEqual(['b2']);
    expect(findNotes(NOTES, { query: 'nothing' })).toEqual([]);
    expect(findNotes(NOTES, { limit: 1 })).toHaveLength(1);
  });

  it('lists a note’s topics, and finds one topic’s notes (ADR-0035)', () => {
    const tagged = [{ ...NOTES[0], topics: ['Garden'] }, { ...NOTES[1], topics: ['garden', 'Plans'] }, NOTES[2]];
    expect(findNotes(tagged, { topic: 'GARDEN' }).map((n) => n.id)).toEqual(['b2', 'a1']);
    expect(findNotes(tagged, { topic: 'plans' })[0].topics).toEqual(['garden', 'Plans']);
    expect(findNotes(tagged, { query: 'plans' }).map((n) => n.id)).toContain('b2');
    expect(noteForModel(tagged[0]).topics).toEqual(['Garden']);
  });

  it('finds one note by id or exact title', () => {
    expect(findNote(NOTES, { id: 'c3' }).id).toBe('c3');
    expect(findNote(NOTES, { title: 'seed order' }).id).toBe('a1');
    expect(findNote(NOTES, { title: 'Seed' })).toBe(null);
    expect(findNote(NOTES, { id: 'zz' })).toBe(null);
    expect(findNote(NOTES, {})).toBe(null);
  });

  it('gives the model the whole note and the titles it links to', () => {
    expect(noteForModel(NOTES[0])).toEqual({
      id: 'a1',
      title: 'Seed order',
      url: 'nomad://notes/a1',
      body: NOTES[0].body,
      links: ['Garden plan'],
      topics: [],
      createdAt: NOTES[0].createdAt,
      updatedAt: NOTES[0].updatedAt,
    });
  });
});

describe('vault tools: Reader', () => {
  const KEY = 'c'.repeat(64);
  const root = `hyper://${KEY}/`;
  const files = {
    '/index.json': JSON.stringify({ type: 'walled.garden/feed', title: 'Garden blog', itemsPath: '/posts' }),
    '/posts/2026-10-01-beds/post.json': JSON.stringify({ title: 'New beds', summary: 'Built two', tags: ['build'], createdAt: '2026-10-01' }),
    '/posts/2026-10-05-frost/post.json': JSON.stringify({ title: 'First frost', createdAt: '2026-10-05' }),
    '/posts/2026-10-06-wip/post.json': JSON.stringify({ title: 'Not yet', draft: true, createdAt: '2026-10-06' }),
    '/posts/2026-10-05-frost/post.md': '# First frost',
    '/posts/broken/post.json': '{nope',
  };
  const io = {
    readText: async (p) => {
      if (!(p in files)) throw new Error('missing ' + p);
      return files[p];
    },
    listKeys: async (dir) => Object.keys(files).filter((k) => k.startsWith(dir)),
  };

  it('loads a feed the way nomad://reader does', async () => {
    const feed = await loadFeedPosts(`${root}posts/`, io);
    expect(feed.url).toBe(root);
    expect(feed.title).toBe('Garden blog');
    expect(feed.posts.map((p) => p.title).sort()).toEqual(['First frost', 'New beds']); // no draft, no broken one
    expect(feed.posts.find((p) => p.title === 'New beds')).toEqual({
      title: 'New beds',
      summary: 'Built two',
      tags: ['build'],
      createdAt: '2026-10-01',
      url: `${root}posts/2026-10-01-beds/`,
      feedUrl: root,
      feedTitle: 'Garden blog',
    });
    await expect(loadFeedPosts('https://x.org/', io)).rejects.toThrow(/hyper/);
  });

  it('lists posts newest first, with read marks and filters', async () => {
    const feeds = [await loadFeedPosts(root, io), { url: 'hyper://other/', posts: [], error: 'offline' }];
    const read = [`${root}posts/2026-10-01-beds/`];
    expect(findPosts(feeds, read).map((p) => [p.title, p.read])).toEqual([
      ['First frost', false],
      ['New beds', true],
    ]);
    expect(findPosts(feeds, read, { unread: true }).map((p) => p.title)).toEqual(['First frost']);
    expect(findPosts(feeds, read, { query: 'build' }).map((p) => p.title)).toEqual(['New beds']);
    expect(findPosts(feeds, read, { feed: `${root}posts/x/` })).toHaveLength(2);
    expect(findPosts(feeds, read, { feed: 'hyper://other/' })).toEqual([]);
  });

  it('splits a post URL into its feed and folder', () => {
    expect(splitPostUrl(`${root}posts/2026-10-05-frost/`)).toEqual({ root, dir: '/posts/2026-10-05-frost/' });
    expect(splitPostUrl(`${root}posts/2026-10-05-frost/post.md#top`)).toEqual({ root, dir: '/posts/2026-10-05-frost/' });
    expect(splitPostUrl(`${root}posts/2026-10-05-frost`)).toEqual({ root, dir: '/posts/2026-10-05-frost/' });
    expect(splitPostUrl(root)).toBe(null);
    expect(splitPostUrl('https://x.org/a/')).toBe(null);
  });

  it('turns post HTML into text', () => {
    const html = '<style>p{}</style><h1>Frost</h1><p>Cold &amp; clear&#33;</p><script>x()</script><p>Next<br>line</p>';
    expect(htmlToText(html)).toBe('Frost\nCold & clear!\nNext\nline');
  });
});

describe('vault tools: limits', () => {
  it('cuts long text and keeps lists short', () => {
    expect(clip('abcdef', 3)).toMatch(/^abc\n\n\[Cut at 3 of 6 characters\.\]$/);
    expect(clip('abc', 3)).toBe('abc');
    expect(clampLimit()).toBe(20);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit(-1)).toBe(20);
    expect(clampLimit('5')).toBe(5);
  });
});

describe('vault tools: mods', () => {
  const NOW = '2026-10-29T12:00:00.000Z';
  const all = [
    makeMod({ id: 'b1', site: 'example.com', name: 'Dark', presets: ['dark'] }, null, NOW),
    makeMod({ id: 'b2', site: 'docs.example.com', name: 'Docs', hide: ['.ad'], js: 'x'.repeat(30000) }, null, NOW),
    makeMod({ id: 'b3', site: 'other.org', name: 'Other', css: 'body { color: red }' }, null, NOW),
  ];

  it('finds the Mods for a site and the sites around it, with the preset ids', () => {
    const res = findMods(all, { site: 'https://docs.example.com/page' });
    expect(res.mods.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(findMods(all, { site: 'example.com' }).mods.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(findMods(all, {}).mods).toHaveLength(3);
    expect(findMods(all, { query: 'color red' }).mods.map((b) => b.id)).toEqual(['b3']);
    expect(res.presets.map((p) => p.id)).toContain('dark');
  });

  it('gives the model a whole Mod, its code cut', () => {
    const b = modForModel(all[1]);
    expect(b).toMatchObject({ id: 'b2', site: 'docs.example.com', enabled: true, hide: ['.ad'], summary: '1 hidden, JS' });
    expect(b.js.length).toBeLessThan(30000);
    expect(b.js).toContain('[Cut at');
  });
});

describe('jobPermitFor', () => {
  const A = 'a'.repeat(64);
  it('says yes to the reads and exactly the writes a Job was given, and asks nobody', async () => {
    const permit = jobPermitFor({ drives: [{ url: `hyper://${A}/`, draft: false }], notes: true, reader: false });
    expect(await permit('notesRead')).toBe(true);
    expect(await permit('readerRead')).toBe(true);
    expect(await permit('notesWrite')).toBe(true);
    expect(await permit(`modifyDrive:${A}`)).toBe(true);
    expect(await permit('readerWrite')).toBe(false);
    expect(await permit(`modifyDrive:${'b'.repeat(64)}`)).toBe(false);
    expect(await permit('modsWrite')).toBe(false);
    const none = jobPermitFor(null);
    expect(await none('notesWrite')).toBe(false);
    expect(await none('notesRead')).toBe(true);
  });
});
