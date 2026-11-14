// The phone's version history and drive search (mobile/backend/lib/drive-history.mjs and
// drive-search.mjs) on a real DriveManager with no network: drives the phone made, written through
// the same methods the file explorer uses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import DriveManager from '../../mobile/backend/lib/drive-manager.mjs';
import { createDriveHistory } from '../../mobile/backend/lib/drive-history.mjs';
import { createDriveSearch } from '../../mobile/backend/lib/drive-search.mjs';

const rq = createRequire(path.join(process.cwd(), 'mobile', 'package.json'));
const Corestore = rq('corestore');
const b4a = rq('b4a');

// A swarm that never connects: every drive here is local.
const offline = () => ({
  connections: new Set(),
  on() {},
  join: () => ({ flushed: async () => {}, destroy() {} }),
  flush: async () => {},
  destroy: async () => {},
});

describe('phone drive history and search', () => {
  let store, manager, history, search;
  beforeEach(async () => {
    store = new Corestore(fs.mkdtempSync(path.join(os.tmpdir(), 'mdt-')));
    manager = new DriveManager(store, null, { swarm: offline() });
    history = createDriveHistory(manager);
    search = createDriveSearch(manager);
  });
  afterEach(async () => {
    await manager.close().catch(() => {});
    await store.close().catch(() => {});
  });

  const make = async (type, title) => {
    const d = await manager.createDrive(type, { title });
    const key = b4a.from(d.key, 'hex');
    const write = (p, s) => manager.writeFile(type, key, d.ns, p, b4a.from(s));
    const del = (p) => manager.deletePath(type, key, d.ns, p, false);
    return { ref: { key: d.key, type, ns: d.ns }, write, del };
  };

  it('lists a collaborative drive’s changes and restores a file and the whole drive', async () => {
    const d = await make('autobase', 'Garden');
    await d.write('/notes.md', 'tomatoes');
    await d.write('/notes.md', 'tomatoes and basil');
    await d.write('/plan.txt', 'water daily');
    await d.del('/plan.txt');

    const page = await history.history(d.ref);
    expect(page.title).toBe('Garden');
    expect(page.writable).toBe(true);
    expect(page.rows.slice(0, 4).map((r) => [r.path, r.kind])).toEqual([
      ['/plan.txt', 'deleted'],
      ['/plan.txt', 'added'],
      ['/notes.md', 'changed'],
      ['/notes.md', 'added'],
    ]);

    const firstNotes = page.rows[3];
    expect(await history.fileAt(d.ref, '/notes.md', firstNotes.restore)).toEqual({ exists: true, size: 8, text: 'tomatoes' });
    const deleted = page.rows[0];
    expect((await history.fileAt(d.ref, '/plan.txt', deleted.restore)).text).toBe('water daily');

    // One file back.
    expect(await history.restoreFile(d.ref, '/notes.md', firstNotes.restore)).toEqual({ changed: true });
    expect(await history.restoreFile(d.ref, '/notes.md', firstNotes.restore)).toEqual({ changed: false });
    const entry = await manager.open('autobase', b4a.from(d.ref.key, 'hex'), () => {}, d.ref.ns);
    expect(b4a.toString(await manager.readFileOf(entry.drive, '/notes.md'))).toBe('tomatoes');

    // The whole drive, to just after plan.txt was added: plan.txt comes back, notes.md goes back.
    const added = page.rows[1];
    const preview = await history.restorePreview(d.ref, added.seq + 1);
    expect(preview).toMatchObject({ total: 2, changed: 1, back: 1, removed: 0 });
    const done = await history.restoreDrive(d.ref, added.seq + 1);
    expect(done.total).toBe(2);
    expect(b4a.toString(await manager.readFileOf(entry.drive, '/plan.txt'))).toBe('water daily');
    expect(b4a.toString(await manager.readFileOf(entry.drive, '/notes.md'))).toBe('tomatoes and basil');

    // One file's changes only.
    const one = await history.history(d.ref, { path: '/plan.txt' });
    expect(one.rows.every((r) => r.path === '/plan.txt')).toBe(true);
  });

  it('answers null for a Hyperdrive, which keeps no history here', async () => {
    const d = await make('hyperdrive', 'Old');
    expect(await history.history(d.ref)).toBe(null);
    await expect(history.fileAt(d.ref, '/index.html', 1)).rejects.toThrow(/no version history/);
  });

  it('refuses to restore a drive this phone can’t write', async () => {
    const d = await make('autobase', 'Theirs');
    await d.write('/a.md', 'one');
    // The same drive opened by key alone in another phone's store: readable, not writable.
    const store2 = new Corestore(fs.mkdtempSync(path.join(os.tmpdir(), 'mdt2-')));
    const s1 = store.replicate(true);
    const s2 = store2.replicate(false);
    s1.pipe(s2).pipe(s1);
    const m2 = new DriveManager(store2, null, { swarm: offline() });
    try {
      const h2 = createDriveHistory(m2);
      const ref = { key: d.ref.key, type: 'autobase' };
      const page = await h2.history(ref);
      expect(page.writable).toBe(false);
      await expect(h2.restoreFile(ref, '/a.md', page.rows[0].restore)).rejects.toThrow(/Only a device that can edit/);
    } finally {
      s1.destroy();
      s2.destroy();
      await m2.close().catch(() => {});
      await store2.close().catch(() => {});
    }
  });

  it('searches the text files of collaborative drives and Hyperdrives, and sees an edit', async () => {
    const a = await make('autobase', 'Recipes');
    await a.write('/soups/tomato.md', '# Tomato soup\n\nRoast the tomatoes with garlic.');
    await a.write('/photo.jpg', 'not text, tomato');
    const h = await make('hyperdrive', 'Journal');
    await h.write('/2026/garden.txt', 'Picked the first tomatoes today.');

    const one = await search.search('TOMATO', [a.ref, h.ref]);
    expect(one.searched).toBe(2);
    expect(one.results.map((r) => [r.driveTitle, r.path, r.title])).toEqual(
      expect.arrayContaining([
        ['Recipes', '/soups/tomato.md', 'Tomato soup'],
        ['Journal', '/2026/garden.txt', 'garden.txt'],
      ]),
    );
    expect(one.results).toHaveLength(2);
    expect(one.results[0].url).toMatch(/^hyper:\/\/[0-9a-f]{64}\//);
    expect((await search.search('garlic roast', [a.ref, h.ref])).results.map((r) => r.path)).toEqual(['/soups/tomato.md']);

    // A Hyperdrive file changed to the same size is read again (its entry's seq changed).
    await h.write('/2026/garden.txt', 'Picked the first cucumbers today');
    expect((await search.search('cucumbers', [h.ref])).results.map((r) => r.path)).toEqual(['/2026/garden.txt']);
    expect((await search.search('tomatoes today', [h.ref])).results).toEqual([]);
    expect(await search.search('   ', [a.ref])).toEqual({ results: [], searched: 0, partial: false });
  });
});
