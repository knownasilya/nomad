// shared/drive-history.mjs on a real Autobase drive (the phone backend's openAutobaseDrive, the same
// fs-core reducer desktop uses): the change list, one file restored, the whole drive restored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { openAutobaseDrive } from '../../mobile/backend/lib/drive-manager.mjs';
import {
  historyPage,
  fillTimes,
  restoreFile,
  restoreDrive,
  restoreDiff,
  restoreSummary,
  isHiddenPath,
} from '../../shared/drive-history.mjs';

const rq = createRequire(path.join(process.cwd(), 'mobile', 'package.json'));
const Corestore = rq('corestore');
const b4a = rq('b4a');

const put = (p, s, t) => ({
  op: 'put',
  path: p,
  metadata: { mtime: t, ctime: t },
  value: b4a.toString(b4a.from(s), 'base64'),
});
const text = (rec) => (rec ? b4a.toString(b4a.from(rec.value.value, 'base64')) : null);

describe('drive history', () => {
  let store, base, append;
  beforeEach(async () => {
    store = new Corestore(fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')));
    base = openAutobaseDrive(store.namespace('d'), null);
    await base.ready();
    append = async (ops) => {
      for (const op of ops) await base.append(op);
      await base.update();
    };
    await append([put('/index.html', 'v1', 1000)]); // seq 1
    await append([put('/notes.md', 'first', 2000)]); // seq 2
    await append([put('/index.html', 'v2', 3000)]); // seq 3
    await append([put('/.data/walled.garden/writers/' + 'a'.repeat(64) + '.json', '{}', 3500)]); // hidden
    await append([{ op: 'del', path: '/notes.md' }]); // seq 5
    await append([put('/index.html', 'v2', 6000)]); // same content: not a change
  });
  afterEach(async () => {
    await base.close();
    await store.close();
  });

  it('lists the changes newest first, without hidden records or same-content saves', async () => {
    const { rows, before } = await historyPage(base.view);
    expect(rows.map((r) => [r.path, r.kind])).toEqual([
      ['/notes.md', 'deleted'],
      ['/index.html', 'changed'],
      ['/notes.md', 'added'],
      ['/index.html', 'added'],
    ]);
    expect(before).toBe(null);
    // the delete takes the time of the change after it… here there is none, so the one before
    expect(rows[0]).toMatchObject({ at: 3000, approx: true });
    expect(rows[1].at).toBe(3000);
  });

  it('pages, and filters to one file', async () => {
    const first = await historyPage(base.view, { limit: 2 });
    expect(first.rows.length).toBe(2);
    expect(first.before).toBeGreaterThan(1);
    const next = await historyPage(base.view, { limit: 2, before: first.before });
    expect(next.rows.map((r) => r.path)).toEqual(['/notes.md', '/index.html']);
    const one = await historyPage(base.view, { path: '/index.html' });
    expect(one.rows.map((r) => r.kind)).toEqual(['changed', 'added']);
  });

  it('restores one file to a version, and brings back a deleted one', async () => {
    const { rows } = await historyPage(base.view);
    const added = rows.find((r) => r.path === '/index.html' && r.kind === 'added');
    await restoreFile(base.view, append, '/index.html', added.restore, 9000);
    expect(text(await base.view.get('/index.html'))).toBe('v1');
    expect((await base.view.get('/index.html')).value.metadata.mtime).toBe(9000);

    const deleted = rows.find((r) => r.kind === 'deleted');
    await restoreFile(base.view, append, '/notes.md', deleted.restore, 9100);
    expect(text(await base.view.get('/notes.md'))).toBe('first');

    // already that way: nothing appended
    const len = base.view.version;
    expect(await restoreFile(base.view, append, '/notes.md', deleted.restore)).toBe(null);
    expect(base.view.version).toBe(len);
  });

  it('restores the whole drive to a point, and leaves hidden records alone', async () => {
    const at = 2; // just after the first change: only /index.html v1
    const diff = await restoreDiff(base.view, at);
    expect(restoreSummary(diff)).toMatchObject({ total: 1, changed: 1, back: 0, removed: 0 });
    const sum = await restoreDrive(base.view, append, at);
    expect(sum.total).toBe(1);
    expect(text(await base.view.get('/index.html'))).toBe('v1');
    expect(await base.view.get('/notes.md')).toBe(null);
    expect(await base.view.get('/.data/walled.garden/writers/' + 'a'.repeat(64) + '.json')).not.toBe(null);

    // to just after /notes.md was added: it comes back
    const sum2 = await restoreDrive(base.view, append, 3);
    expect(sum2).toMatchObject({ back: 1 });
    expect(text(await base.view.get('/notes.md'))).toBe('first');
  });

  it('refuses to restore a hidden record', async () => {
    expect(isHiddenPath('/.data/nomad/invites/x.json')).toBe(true);
    await expect(restoreFile(base.view, append, '/.data/nomad/invites/x.json', 1)).rejects.toThrow();
  });
});

describe('fillTimes', () => {
  it('uses the newer neighbour first', () => {
    const rows = fillTimes([{ at: 5 }, { at: null }, { at: 3 }]);
    expect(rows[1]).toEqual({ at: 5, approx: true });
  });
});
