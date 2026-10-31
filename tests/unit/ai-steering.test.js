// Steering a running chat turn (app/bg/ai/steering.mjs) and the phone panel's transcript helpers
// (mobile/lib/aiSteer.ts).

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import {
  MAX_STEER_QUEUE,
  addSteerMessages,
  createSteering,
  deliverSteer,
  mergeUserTurns,
  withSteer,
} from '../../app/bg/ai/steering.mjs';
import {
  applySteer,
  mergeUserTurns as mergeMobile,
} from '../../mobile/lib/aiSteer.ts';

function recorder() {
  const emitter = new EventEmitter();
  const events = [];
  emitter.on('steer', (e) => events.push(e));
  return { emitter, events };
}

describe('createSteering', () => {
  it('queues messages until the loop takes them', () => {
    const s = createSteering();
    expect(s.push('a', ' make it shorter ')).toBe(true);
    expect(s.push('b', 'in French')).toBe(true);
    expect(s.size).toBe(2);
    expect(s.take()).toEqual([
      { id: 'a', text: 'make it shorter' },
      { id: 'b', text: 'in French' },
    ]);
    expect(s.size).toBe(0);
  });

  it('refuses empty text, bad ids, duplicates and a full queue', () => {
    const s = createSteering();
    expect(s.push('a', '   ')).toBe(false);
    expect(s.push('', 'x')).toBe(false);
    expect(s.push(42, 'x')).toBe(false);
    expect(s.push('a', 'x')).toBe(true);
    expect(s.push('a', 'again')).toBe(false);
    for (let i = 1; i < MAX_STEER_QUEUE; i++) s.push(`m${i}`, 'x');
    expect(s.push('one-too-many', 'x')).toBe(false);
  });

  it('takes back a message the loop has not read', () => {
    const s = createSteering();
    s.push('a', 'one');
    s.push('b', 'two');
    expect(s.remove('a')).toBe(true);
    expect(s.remove('a')).toBe(false);
    expect(s.take().map((m) => m.id)).toEqual(['b']);
  });

  it('closes on the last look when nothing waits, so a late message goes as the next turn', () => {
    const s = createSteering();
    s.push('a', 'one');
    expect(s.takeOrClose().map((m) => m.id)).toEqual(['a']);
    expect(s.closed).toBe(false); // the loop takes another step with it
    expect(s.takeOrClose()).toEqual([]);
    expect(s.closed).toBe(true);
    expect(s.push('b', 'too late')).toBe(false);
  });

  it('forwards to another Device once the turn runs there', () => {
    const s = createSteering();
    s.push('a', 'before the request');
    const sent = [];
    s.forward((m) => sent.push(m));
    expect(s.push('b', 'after')).toBe(true);
    expect(s.remove('b')).toBe(true);
    expect(sent).toEqual([
      { type: 'steer', id: 'a', text: 'before the request' },
      { type: 'steer', id: 'b', text: 'after' },
      { type: 'unsteer', id: 'b' },
    ]);
    expect(s.size).toBe(0);
    s.close();
    expect(s.push('c', 'ended')).toBe(false);
    expect(sent).toHaveLength(3);
  });
});

describe('deliverSteer', () => {
  it('tells the UI what the loop read', () => {
    const s = createSteering();
    const { emitter, events } = recorder();
    expect(deliverSteer(s, emitter)).toEqual([]);
    expect(events).toEqual([]);
    s.push('a', 'stop after the first file');
    expect(deliverSteer(s, emitter).map((m) => m.id)).toEqual(['a']);
    expect(events).toEqual([{ ids: ['a'], texts: ['stop after the first file'] }]);
  });

  it('is a no-op without steering (a page turn, a Job)', () => {
    expect(deliverSteer(null, new EventEmitter())).toEqual([]);
  });
});

describe('addSteerMessages', () => {
  it('adds a user message after tool results', () => {
    const history = [
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1' }] },
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
    ];
    addSteerMessages(history, [
      { id: 'a', text: 'use tabs' },
      { id: 'b', text: 'and add a test' },
    ]);
    expect(history.at(-1)).toEqual({ role: 'user', content: 'use tabs\n\nand add a test' });
  });

  it('joins the last user message when the model has not answered yet', () => {
    const history = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }];
    addSteerMessages(history, [{ id: 'a', text: 'in French' }]);
    expect(history).toHaveLength(2);
    expect(history[1].content).toBe('hi\n\nin French');

    const parts = [{ role: 'user', content: [{ type: 'text', text: 'look' }] }];
    addSteerMessages(parts, [{ id: 'b', text: 'closer' }]);
    expect(parts[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: 'closer' },
    ]);
  });
});

describe('withSteer (a CLI turn over the loopback MCP)', () => {
  it('adds what waits to the next tool result', () => {
    const s = createSteering();
    const { emitter, events } = recorder();
    expect(withSteer('{"ok":true}', s, emitter)).toBe('{"ok":true}');
    s.push('a', 'only the README');
    const out = withSteer('{"ok":true}', s, emitter);
    expect(out.startsWith('{"ok":true}')).toBe(true);
    expect(out).toContain('<user-message>');
    expect(out).toContain('only the README');
    expect(events).toHaveLength(1);
    expect(withSteer('again', s, emitter)).toBe('again');
  });

  it('keeps a screenshot a screenshot', () => {
    const s = createSteering();
    s.push('a', 'zoom in');
    const out = withSteer({ text: 'Screenshot captured.', imageDataUrl: 'data:image/png;base64,aGk=' }, s, null);
    expect(out.imageDataUrl).toBe('data:image/png;base64,aGk=');
    expect(out.text).toContain('zoom in');
  });

  it('serializes an object result', () => {
    const s = createSteering();
    s.push('a', 'x');
    expect(withSteer({ files: 2 }, s, null).startsWith('{"files":2}')).toBe(true);
  });
});

// The loop in runChat (app/bg/web-apis/bg/ai.ts), with a scripted model: steer before each model
// call, and look once more before the turn would end.
async function runLoop(steering, emitter, script) {
  const history = [{ role: 'user', content: 'start' }];
  const calls = [];
  for (;;) {
    addSteerMessages(history, deliverSteer(steering, emitter));
    calls.push(history.map((m) => `${m.role}:${m.content}`).join(' | '));
    const step = script.shift();
    await step.during?.();
    if (step.tool) {
      history.push({ role: 'assistant', content: '', tool_calls: [{ id: step.tool }] });
      history.push({ role: 'tool', tool_call_id: step.tool, content: 'done' });
      continue;
    }
    const late = deliverSteer(steering, emitter, { final: true });
    if (!late.length) break;
    history.push({ role: 'assistant', content: step.text });
    addSteerMessages(history, late);
  }
  steering.close();
  return calls;
}

describe('the agent loop', () => {
  it('reads a message sent during a tool call before its next model call', async () => {
    const s = createSteering();
    const { emitter, events } = recorder();
    const calls = await runLoop(s, emitter, [
      { tool: 't1', during: () => s.push('a', 'skip the tests') },
      { text: 'Done.' },
    ]);
    expect(calls[1]).toBe('user:start | assistant: | tool:done | user:skip the tests');
    expect(events.map((e) => e.ids)).toEqual([['a']]);
  });

  it('takes one more step when a message arrives as the model finishes', async () => {
    const s = createSteering();
    const { emitter } = recorder();
    const calls = await runLoop(s, emitter, [
      { text: 'Here is a summary.', during: () => s.push('a', 'shorter please') },
      { text: 'Short.' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('user:start | assistant:Here is a summary. | user:shorter please');
    expect(s.push('b', 'after the end')).toBe(false);
  });
});

describe('mergeUserTurns', () => {
  it('joins user messages in a row and leaves the rest', () => {
    expect(
      mergeUserTurns([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
        { role: 'user', content: 'd' },
      ])
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('keeps the phone’s photos when it joins', () => {
    expect(
      mergeMobile([
        { role: 'user', content: 'what is this', images: ['data:image/png;base64,aA=='] },
        { role: 'user', content: 'the left one' },
      ])
    ).toEqual([
      { role: 'user', content: 'what is this\n\nthe left one', images: ['data:image/png;base64,aA=='] },
    ]);
  });
});

describe('applySteer (phone transcript)', () => {
  it('ends the answer so far, adds the messages and starts a new answer', () => {
    const out = applySteer(
      [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: 'Working on it' },
      ],
      ['make it blue']
    );
    expect(out).toEqual([
      { role: 'user', content: 'start' },
      { role: 'assistant', content: 'Working on it' },
      { role: 'user', content: 'make it blue' },
      { role: 'assistant', content: '' },
    ]);
  });

  it('drops an answer that has nothing in it yet', () => {
    const out = applySteer(
      [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: '' },
      ],
      ['wait', 'also this']
    );
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:start',
      'user:wait',
      'user:also this',
      'assistant:',
    ]);
  });

  it('keeps an answer that only has thoughts', () => {
    const out = applySteer([{ role: 'assistant', content: '', reasoning: 'hmm' }], ['go']);
    expect(out[0]).toEqual({ role: 'assistant', content: '', reasoning: 'hmm' });
  });
});
