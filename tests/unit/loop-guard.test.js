// The AI's loop guard (app/bg/ai/loop-guard.mjs): a turn that makes the same call with the same
// result again and again is told, then stopped; a module that loops on its own is ended.

import { describe, it, expect } from 'vitest';
import {
  createLoopGuard,
  createModuleGuard,
  repeatNote,
  withNote,
  stoppedMessage,
  callKey,
  stableJson,
  LoopError,
  NUDGE_AT,
  STOP_AT,
  MODULE_REPEAT_STOP,
} from '../../app/bg/ai/loop-guard.mjs';
import { runModule } from '../../app/bg/ai/search-execute.mjs';
import { createScratch, runScratchTool } from '../../app/bg/ai/scratch.mjs';

describe('callKey', () => {
  it('is the same for the same call and result, whatever the key order', () => {
    expect(callKey('readScratch', { key: 'state', x: 1 }, 'a')).toBe(callKey('readScratch', { x: 1, key: 'state' }, 'a'));
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('differs when the result or the arguments differ', () => {
    const k = callKey('snapshotPage', {}, 'page one');
    expect(callKey('snapshotPage', {}, 'page two')).not.toBe(k);
    expect(callKey('snapshotPage', { ref: 1 }, 'page one')).not.toBe(k);
    expect(callKey('readScratch', {}, new Error('gone'))).toBe(callKey('readScratch', {}, new Error('gone')));
  });
});

describe('createLoopGuard', () => {
  it('nudges on the third same result and stops on the sixth', () => {
    const g = createLoopGuard();
    const verdicts = [];
    for (let i = 1; i <= STOP_AT; i++) verdicts.push(g.top(`c${i}`, 'search', { query: 'x' }, 'same').verdict);
    expect(verdicts.slice(0, NUDGE_AT - 1)).toEqual(Array(NUDGE_AT - 1).fill('ok'));
    expect(verdicts[NUDGE_AT - 1]).toBe('nudge');
    expect(verdicts[STOP_AT - 1]).toBe('stop');
    expect(g.stopped).toMatchObject({ name: 'search', repeats: STOP_AT });
  });

  it('never counts a call whose result changed', () => {
    const g = createLoopGuard();
    for (let i = 0; i < 20; i++) expect(g.top(`c${i}`, 'snapshotPage', {}, `controls ${i}`).verdict).toBe('ok');
    expect(g.stopped).toBe(null);
  });

  // The loop a watched Job got stuck in: every execute listed the scratch space and read "state"
  // back, with new code each time, and got the same thing.
  it('catches executes that keep making the same inner calls', () => {
    const g = createLoopGuard();
    let seen;
    for (let i = 1; i <= STOP_AT; i++) {
      const id = `exec${i}`;
      g.inner(id, 'listScratch', {}, '[{"key":"state"}]');
      g.inner(id, 'readScratch', { key: 'state' }, '{"key":"state","value":{"step":2}}');
      // A module that reads the same thing twice is one repeat, not two.
      g.inner(id, 'readScratch', { key: 'state' }, '{"key":"state","value":{"step":2}}');
      seen = g.top(id, 'execute', { code: `// try ${i}` }, 'step 2');
      if (i === NUDGE_AT) expect(seen.verdict).toBe('nudge');
    }
    expect(seen.verdict).toBe('stop');
    expect(['listScratch', 'readScratch']).toContain(seen.name);
    expect(repeatNote(seen)).toMatch(/Stopped/);
    expect(stoppedMessage(g.stopped)).toMatch(/kept repeating the same step/);
  });

  it('says which call repeated', () => {
    const note = repeatNote({ verdict: 'nudge', repeats: 3, name: 'readScratch', args: { key: 'state' } });
    expect(note).toContain('third');
    expect(note).toContain('readScratch({"key":"state"})');
    expect(repeatNote({ verdict: 'ok', repeats: 1, name: 'x', args: {} })).toBe('');
  });

  it('can stop for too many rounds', () => {
    const g = createLoopGuard();
    g.stop('rounds');
    expect(stoppedMessage(g.stopped)).toMatch(/steps without finishing/);
  });
});

describe('withNote', () => {
  it('adds the note to text, JSON and a screenshot', () => {
    expect(withNote('result', 'note')).toBe('result\n\nnote');
    expect(withNote('', 'note')).toBe('note');
    expect(withNote({ a: 1 }, 'note')).toBe('{"a":1}\n\nnote');
    expect(withNote({ text: 'shot', imageDataUrl: 'data:' }, 'note')).toEqual({ text: 'shot\n\nnote', imageDataUrl: 'data:' });
    expect(withNote('result', '')).toBe('result');
  });
});

describe('createModuleGuard', () => {
  it('ends a module that polls the scratch space for a change that never comes', async () => {
    const store = createScratch();
    store.set('state', { step: 2 });
    let trips = 0;
    const guard = createModuleGuard({ onTrip: () => trips++ });
    let calls = 0;
    const code = `import { nomad } from 'nomad:runtime'
export default async function main() {
  while (true) {
    const saved = await nomad.listScratch()
    if (!saved.length) break
    const s = await nomad.readScratch({ key: 'state' })
    if (s.value.done) return 'done'
  }
}`;
    await expect(
      runModule(code, {}, async (call) => {
        calls++;
        const value = runScratchTool(call.target, call.args, { store });
        guard.check(call.target, call.args, value);
        return value;
      })
    ).rejects.toThrow(/going round in a loop/);
    expect(trips).toBe(1);
    expect(calls).toBe(MODULE_REPEAT_STOP * 2 - 1);
  });

  it('keeps refusing once tripped, for a module that catches the error', () => {
    const guard = createModuleGuard({ repeatStop: 2 });
    guard.check('listScratch', {}, '[]');
    expect(() => guard.check('listScratch', {}, '[]')).toThrow(LoopError);
    expect(() => guard.check('readDriveFile', { path: '/a' }, 'new')).toThrow(LoopError);
  });

  it('lets a module make many different calls, up to its limit', () => {
    const guard = createModuleGuard({ maxCalls: 50 });
    for (let i = 0; i < 49; i++) guard.check('readDriveFile', { path: `/f${i}` }, `text ${i}`);
    expect(guard.tripped).toBe(null);
    expect(() => guard.check('readDriveFile', { path: '/last' }, 'x')).toThrow(/after 50 calls/);
  });
});
