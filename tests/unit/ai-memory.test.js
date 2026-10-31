import { describe, it, expect } from 'vitest';
import {
  MEMORY_PREFIX,
  MAX_MEMORY_TEXT,
  newMemoryId,
  isMemoryId,
  memoryPath,
  cleanMemoryText,
  makeMemory,
  isMemory,
  sortMemories,
  findSameMemory,
  searchMemories,
  memoryPrompt,
} from '../../shared/ai-memory.mjs';
import { previewOf, matchSession, searchWords } from '../../app/bg/ai/chat-search.mjs';
import { visibleCapabilities, buildCatalog, JOB_CAPS } from '../../app/bg/ai/search-execute.mjs';
import { VAULT_TOOL_PERMS } from '../../app/bg/ai/vault-tools.mjs';

const at = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
const mem = (id, text, n, by = 'ai') => makeMemory({ id, text, by }, null, at(n));

describe('AI memory records', () => {
  it('makes ids that are paths in the Vault', () => {
    const id = newMemoryId(Date.UTC(2026, 9, 31), () => 0.5);
    expect(isMemoryId(id)).toBe(true);
    expect(memoryPath(id)).toBe(`${MEMORY_PREFIX}${id}.json`);
    expect(() => memoryPath('../x')).toThrow(/Not a memory id/);
  });

  it('keeps one line of text, and refuses empty or long text', () => {
    expect(cleanMemoryText('  Prefers\n metric   units ')).toBe('Prefers metric units');
    expect(() => cleanMemoryText('   ')).toThrow(/needs some text/);
    expect(() => cleanMemoryText('x'.repeat(MAX_MEMORY_TEXT + 1))).toThrow(/at most/);
  });

  it('keeps createdAt on an edit and says who wrote it last', () => {
    const a = mem('m1', 'Lives in Lisbon', 1);
    expect(a).toMatchObject({ type: 'nomad/ai-memory', id: 'm1', by: 'ai', createdAt: at(1), updatedAt: at(1) });
    const b = makeMemory({ id: 'm1', text: 'Lives in Porto', by: 'user' }, a, at(5));
    expect(b).toMatchObject({ text: 'Lives in Porto', by: 'user', createdAt: at(1), updatedAt: at(5) });
    expect(isMemory(b)).toBe(true);
    expect(isMemory({ ...b, text: ' ' })).toBe(false);
    expect(isMemory({ ...b, type: 'nomad/mod' })).toBe(false);
  });

  it('lists newest change first, finds repeats and searches', () => {
    const list = [mem('m1', 'Prefers metric units.', 1), mem('m2', 'Their blog is the drive named blog', 3)];
    expect(sortMemories(list).map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(findSameMemory(list, 'prefers METRIC units')?.id).toBe('m1');
    expect(findSameMemory(list, 'prefers imperial units')).toBe(null);
    expect(searchMemories(list, 'blog drive').map((m) => m.id)).toEqual(['m2']);
    expect(searchMemories(list, '').map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});

describe('AI memory in the prompt', () => {
  it('is empty with no memories', () => {
    expect(memoryPrompt([])).toBe('');
  });

  it('lists each memory with its id, newest first', () => {
    const text = memoryPrompt([mem('m1', 'Prefers metric units', 1), mem('m2', 'Writes in British English', 2)]);
    expect(text).toMatch(/What you remember about the user/);
    expect(text.indexOf('[m2] Writes in British English')).toBeLessThan(text.indexOf('[m1] Prefers metric units'));
  });

  it('stops at its size and says how many are left out', () => {
    const list = Array.from({ length: 10 }, (_, i) => mem(`m${i}`, `Fact number ${i} ${'x'.repeat(40)}`, i + 1));
    const text = memoryPrompt(list, { maxChars: 200 });
    expect(text).toMatch(/\[m9\]/);
    expect(text).not.toMatch(/\[m0\]/);
    expect(text).toMatch(/older memories are not shown/);
  });
});

describe('AI memory capabilities', () => {
  const names = (o) => visibleCapabilities(o).map((c) => c.name);

  it('offers remember and forget on a personal turn with memory on', () => {
    expect(names({ personal: true, memory: true })).toEqual(expect.arrayContaining(['remember', 'forget']));
    expect(names({ personal: true, memory: false })).not.toContain('remember');
    expect(names({ personal: false, memory: true })).not.toContain('remember');
  });

  it("keeps them from a Job's turn", () => {
    expect(JOB_CAPS.has('remember')).toBe(false);
    expect(names({ personal: true, job: true, memory: true })).not.toContain('remember');
  });

  it('needs a personal turn in the catalog too', () => {
    const caps = (o) => buildCatalog(o).capabilities.map((c) => c.name);
    expect(caps({ personal: true, memory: true })).toContain('forget');
    expect(caps({ personal: false, memory: true })).not.toContain('forget');
  });

  it('asks the memoryWrite permission', () => {
    expect(VAULT_TOOL_PERMS.remember).toBe('memoryWrite');
    expect(VAULT_TOOL_PERMS.forget).toBe('memoryWrite');
  });
});

describe('chat search (nomad://ai/chats)', () => {
  const messages = [
    { role: 'user', content: 'Plan a trip to   Lisbon in May' },
    { role: 'assistant', content: 'Here is a plan for four days in Lisbon, with trams and pastel de nata.' },
    { role: 'tool', content: 'ignored lisbon' },
  ];

  it('previews the last thing said', () => {
    expect(previewOf(messages)).toMatch(/^Here is a plan/);
    expect(previewOf([])).toBe('');
  });

  it('matches every word across the title and the messages', () => {
    expect(matchSession('Trip', messages, searchWords('lisbon trams'))).toMatch(/Lisbon/);
    expect(matchSession('Trip', messages, searchWords('lisbon paris'))).toBe(null);
    // The title alone matches: no snippet.
    expect(matchSession('Holiday ideas', messages, searchWords('holiday'))).toBe('');
  });

  it('cuts a snippet around the first match', () => {
    const long = [{ role: 'assistant', content: 'a '.repeat(100) + 'needle ' + 'b '.repeat(100) }];
    const s = matchSession('', long, ['needle']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('needle');
  });
});
