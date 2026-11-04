// The AI's scratch space (app/bg/ai/scratch.mjs): what a chat saved to use again, the whole text of a
// long read, and the private-data flag that keeps the egress guard honest.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createScratch,
  scratchFor,
  dropScratch,
  _resetScopes,
  runScratchTool,
  readPageText,
  saveWhole,
  scratchKey,
  SCOPE_IDLE_MS,
  MAX_SCOPES,
} from '../../app/bg/ai/scratch.mjs';
import { createEgressGuard } from '../../app/bg/ai/egress.mjs';
import { noteForModel } from '../../app/bg/ai/vault-tools.mjs';
import { CAPABILITIES, buildCatalog, runModule } from '../../app/bg/ai/search-execute.mjs';
import { toolSummary } from '../../app/bg/ai/tool-summary.mjs';

describe('scratch store', () => {
  it('saves text and JSON values, and gives them back as saved', () => {
    const s = createScratch({ now: () => Date.parse('2026-11-04T00:00:00Z') });
    expect(s.set('page', 'hello', { note: 'a page' })).toMatchObject({ key: 'page', type: 'text', chars: 5, note: 'a page' });
    s.set('list', [{ a: 1 }, { a: 2 }]);
    expect(s.get('page').value).toBe('hello');
    expect(s.get('list').value).toEqual([{ a: 1 }, { a: 2 }]);
    expect(s.list().map((e) => e.key)).toEqual(['list', 'page']);
    expect(s.get('nope')).toBe(null);
  });

  it('keeps a copy, so changing the saved object later changes nothing', () => {
    const s = createScratch();
    const v = { n: 1 };
    s.set('v', v);
    v.n = 2;
    expect(s.get('v').value).toEqual({ n: 1 });
  });

  it('replaces a key, and drops what was used longest ago past its size', () => {
    const s = createScratch({ maxChars: 10 });
    s.set('a', '1234');
    s.set('b', '1234');
    s.get('a'); // used now: b is the oldest
    s.set('c', '1234');
    expect(s.list().map((e) => e.key).sort()).toEqual(['a', 'c']);
    s.set('a', '12');
    expect(s.chars).toBe(6);
  });

  it('refuses a value too big for one entry, a missing key and a value JSON cannot hold', () => {
    const s = createScratch({ maxEntryChars: 5 });
    expect(() => s.set('a', '123456')).toThrow(/at most 5/);
    expect(() => s.set('', 'x')).toThrow(/key/);
    expect(() => s.set('a', undefined)).toThrow(/value/);
    expect(() => s.set('a', () => 1)).toThrow(/JSON/);
  });
});

describe('scratch per chat', () => {
  beforeEach(() => _resetScopes());

  it('gives the same chat the same store, until it has been idle too long', () => {
    const a = scratchFor('sidebar:1:x', { now: 0 });
    a.set('k', 'v');
    expect(scratchFor('sidebar:1:x', { now: 1000 }).get('k').value).toBe('v');
    expect(scratchFor('sidebar:1:y', { now: 1000 })).not.toBe(a);
    expect(scratchFor('sidebar:1:x', { now: 1000 + SCOPE_IDLE_MS + 1 }).get('k')).toBe(null);
  });

  it('keeps at most MAX_SCOPES chats, and drops one on request', () => {
    const first = scratchFor('c0', { now: 0 });
    for (let i = 1; i <= MAX_SCOPES; i++) scratchFor('c' + i, { now: i });
    expect(scratchFor('c0', { now: MAX_SCOPES + 1 })).not.toBe(first);
    const b = scratchFor('gone', { now: 100 });
    dropScratch('gone');
    expect(scratchFor('gone', { now: 101 })).not.toBe(b);
  });
});

describe('scratch capabilities', () => {
  it('saves and reads back through the tools', () => {
    const store = createScratch();
    expect(JSON.parse(runScratchTool('saveScratch', { key: 'k', value: { x: 1 }, note: 'n' }, { store }))).toMatchObject({
      saved: true,
      key: 'k',
    });
    expect(JSON.parse(runScratchTool('readScratch', { key: 'k' }, { store }))).toMatchObject({ key: 'k', value: { x: 1 }, note: 'n' });
    expect(JSON.parse(runScratchTool('listScratch', {}, { store }))[0]).toMatchObject({ key: 'k', type: 'object' });
    expect(runScratchTool('deleteScratch', { key: 'k' }, { store })).toBe('Deleted "k"');
    expect(() => runScratchTool('readScratch', { key: 'k' }, { store })).toThrow(/Nothing is saved under "k"/);
    expect(() => runScratchTool('readScratch', { key: 'k' }, { store: null })).toThrow(/not available/);
  });

  it('marks what was saved after a private read, and reading it back holds private data again', () => {
    const store = createScratch();
    const before = createEgressGuard();
    runScratchTool('saveScratch', { key: 'public', value: 'weather' }, { store, egress: before });
    before.noteCall('readNote');
    runScratchTool('saveScratch', { key: 'private', value: 'note text' }, { store, egress: before });

    // A later turn of the chat, with a fresh guard.
    const later = createEgressGuard();
    runScratchTool('readScratch', { key: 'public' }, { store, egress: later });
    expect(later.holdsPrivate).toBe(false);
    runScratchTool('readScratch', { key: 'private' }, { store, egress: later });
    expect(later.holdsPrivate).toBe(true);

    const listing = createEgressGuard();
    runScratchTool('listScratch', {}, { store, egress: listing });
    expect(listing.holdsPrivate).toBe(true);
  });

  it('saves a long read whole as private, and a long note says where', () => {
    const store = createScratch();
    expect(saveWhole(store, 'note:a', 'text', 'readNote')).toBe('note:a');
    expect(store.get('note:a')).toMatchObject({ private: true, source: 'readNote' });
    expect(saveWhole(null, 'note:a', 'text', 'readNote')).toBe(null);

    const body = Array.from({ length: 3000 }, (_, i) => `Line ${i}`).join('\n') + 'x'.repeat(10000);
    const note = { id: 'n1', body, createdAt: '', updatedAt: '' };
    const save = (key, text) => saveWhole(store, key, text, 'readNote');
    const first = noteForModel(note, { save });
    expect(first.scratch).toBe(scratchKey('note', 'n1'));
    expect(first.part).toContain('readScratch({ key: "note:n1" })');
    expect(store.get('note:n1').value).toBe(body);
    // A short note isn't saved.
    expect(noteForModel({ id: 's', body: 'short' }, { save }).scratch).toBeUndefined();
    expect(store.get('note:s')).toBe(null);
  });
});

describe('reading a long page', () => {
  it('reads later parts from the saved copy, even when the page changed', async () => {
    const store = createScratch();
    let live = 'a'.repeat(25000);
    const load = async () => live;
    const first = await readPageText(store, { url: 'https://x.test/', offset: 0, load, source: 'readCurrentPage' });
    expect(first.saved).toBe('page:https://x.test/');
    expect(first.part.more).toBe(true);
    live = 'b'.repeat(25000);
    const next = await readPageText(store, { url: 'https://x.test/', offset: first.part.end, load, source: 'readCurrentPage' });
    expect(next.part.text).toBe('a'.repeat(25000 - first.part.end));
    expect(next.saved).toBe('page:https://x.test/');
    // Starting over reads the page again.
    const again = await readPageText(store, { url: 'https://x.test/', offset: 0, load, source: 'readCurrentPage' });
    expect(again.part.text.startsWith('b')).toBe(true);
  });

  it('reads live with no store, and saves nothing for a short page', async () => {
    const short = await readPageText(createScratch(), { url: 'u', load: async () => 'hi', source: 's' });
    expect(short).toEqual({ part: expect.objectContaining({ text: 'hi', more: false }), saved: null });
    const none = await readPageText(null, { url: 'u', offset: 0, load: async () => 'z'.repeat(30000), source: 's' });
    expect(none.saved).toBe(null);
  });
});

describe('scratch in the catalog', () => {
  const names = ['saveScratch', 'readScratch', 'listScratch', 'deleteScratch'];

  it('is offered to a chat turn and a Job, never without a scratch space', () => {
    const has = (c) => names.every((n) => c.capabilities.some((x) => x.name === n));
    expect(has(buildCatalog({ scratch: true }))).toBe(true);
    expect(has(buildCatalog({ scratch: true, personal: true, job: { extra: [] } }))).toBe(true);
    const none = buildCatalog({ personal: true });
    expect(none.capabilities.some((x) => names.includes(x.name))).toBe(false);
    for (const n of names) expect(CAPABILITIES.find((c) => c.name === n).gates).toEqual({ scratch: true });
  });

  it('gives a module the saved value with its own type', async () => {
    const store = createScratch();
    store.set('page', '{"looks":"like json"}');
    store.set('obj', { n: 41 });
    const code = [
      "import { nomad } from 'nomad:runtime'",
      'export default async function main() {',
      '  const page = await nomad.readScratch({ key: "page" })',
      '  const obj = await nomad.readScratch({ key: "obj" })',
      '  return { pageType: typeof page.value, n: obj.value.n + 1 }',
      '}',
    ].join('\n');
    const value = await runModule(code, {}, async (call) => runScratchTool(call.target, call.args, { store }));
    expect(JSON.parse(value)).toEqual({ pageType: 'string', n: 42 });
  });

  it('says what each call does', () => {
    expect(toolSummary('saveScratch', { key: 'flights' })).toBe('Saving “flights” for later');
    expect(toolSummary('readScratch', { key: 'flights' })).toBe('Using what it saved as “flights”');
    expect(toolSummary('listScratch', {})).toBe('Looking at what it saved');
  });
});
