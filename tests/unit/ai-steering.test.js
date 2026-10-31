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
    expect(events).toEqual([
      { ids: ['a'], texts: ['stop after the first file'] },
    ]);
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
    expect(history.at(-1)).toEqual({
      role: 'user',
      content: 'use tabs\n\nand add a test',
    });
  });

  it('joins the last user message when the model has not answered yet', () => {
    const history = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'hi' },
    ];
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
    const out = withSteer(
      {
        text: 'Screenshot captured.',
        imageDataUrl: 'data:image/png;base64,aGk=',
      },
      s,
      null,
    );
    expect(out.imageDataUrl).toBe('data:image/png;base64,aGk=');
    expect(out.text).toContain('zoom in');
  });

  it('serializes an object result', () => {
    const s = createSteering();
    s.push('a', 'x');
    expect(withSteer({ files: 2 }, s, null).startsWith('{"files":2}')).toBe(
      true,
    );
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
      history.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: step.tool }],
      });
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
    expect(calls[1]).toBe(
      'user:start | assistant: | tool:done | user:skip the tests',
    );
    expect(events.map((e) => e.ids)).toEqual([['a']]);
  });

  it('takes one more step when a message arrives as the model finishes', async () => {
    const s = createSteering();
    const { emitter } = recorder();
    const calls = await runLoop(s, emitter, [
      {
        text: 'Here is a summary.',
        during: () => s.push('a', 'shorter please'),
      },
      { text: 'Short.' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(
      'user:start | assistant:Here is a summary. | user:shorter please',
    );
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
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('keeps the phone’s photos when it joins', () => {
    expect(
      mergeMobile([
        {
          role: 'user',
          content: 'what is this',
          images: ['data:image/png;base64,aA=='],
        },
        { role: 'user', content: 'the left one' },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: 'what is this\n\nthe left one',
        images: ['data:image/png;base64,aA=='],
      },
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
      ['make it blue'],
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
      ['wait', 'also this'],
    );
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:start',
      'user:wait',
      'user:also this',
      'assistant:',
    ]);
  });

  it('keeps an answer that only has thoughts', () => {
    const out = applySteer(
      [{ role: 'assistant', content: '', reasoning: 'hmm' }],
      ['go'],
    );
    expect(out[0]).toEqual({
      role: 'assistant',
      content: '',
      reasoning: 'hmm',
    });
  });
});

// "Send now": stop the model call in flight so the loop reads the message at once.
import { runStep, SKIPPED_FOR_STEER } from '../../app/bg/ai/steering.mjs';
import { FRAME, steerFrame } from '../../shared/ai-bridge.mjs';

// A model call that streams `words` one per tick and rejects on abort, like streamCompletion.
function fakeModel(emitter, words, result) {
  return (signal) =>
    new Promise((resolve, reject) => {
      let i = 0;
      const tick = setInterval(() => {
        if (i < words.length) emitter.emit('chunk', { text: words[i++] });
        else {
          clearInterval(tick);
          resolve(result);
        }
      }, 5);
      signal.addEventListener('abort', () => {
        clearInterval(tick);
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

describe('send now', () => {
  it('stops the model call in flight and keeps what it wrote', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    s.push('a', 'stop, use Python');
    const pending = runStep(
      s,
      null,
      emitter,
      fakeModel(emitter, ['Writing ', 'the ', 'Go ', 'code'], {
        finishReason: 'stop',
      }),
    );
    await new Promise((r) => setTimeout(r, 12));
    expect(s.now('a')).toBe(true);
    const out = await pending;
    expect(out.interrupted).toBe(true);
    expect(out.textContent.startsWith('Writing ')).toBe(true);
    expect(out.textContent).not.toContain('code');
    expect(s.size).toBe(1); // the loop reads it next
  });

  it('still throws when the whole turn is cancelled', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    const turn = new AbortController();
    const pending = runStep(
      s,
      turn.signal,
      emitter,
      fakeModel(emitter, ['a', 'b', 'c'], {}),
    );
    turn.abort();
    await expect(pending).rejects.toThrow('Aborted');
  });

  it('returns the result as usual when nobody sends now', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    const out = await runStep(
      s,
      null,
      emitter,
      fakeModel(emitter, ['ok'], { finishReason: 'stop', textContent: 'ok' }),
    );
    expect(out).toEqual({ finishReason: 'stop', textContent: 'ok' });
  });

  it('marks the queue urgent while tools run, until the loop reads it', () => {
    const s = createSteering();
    s.push('a', 'one');
    expect(s.urgent).toBe(false);
    expect(s.now('missing')).toBe(false);
    expect(s.now('a')).toBe(true);
    expect(s.urgent).toBe(true);
    s.take();
    expect(s.urgent).toBe(false);
    expect(s.now('a')).toBe(false); // already read
  });

  it('stops a call that starts while a sent-now message waits', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    s.push('a', 'x');
    s.now('a');
    const out = await runStep(
      s,
      null,
      emitter,
      fakeModel(emitter, ['never'], {}),
    );
    expect(out).toEqual({ interrupted: true, textContent: '' });
  });

  it('keeps a stopping CLI from taking the message on a tool result', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    s.push('a', 'now please');
    let seen;
    const pending = runStep(s, null, emitter, (signal) => {
      s.now('a');
      seen = withSteer('result', s, emitter);
      return new Promise((_, reject) => {
        const fail = () =>
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail);
      });
    });
    await pending;
    expect(seen).toBe('result');
    expect(s.size).toBe(1);
  });

  it('forwards to the other Device as a STEER_NOW frame', () => {
    const s = createSteering();
    const sent = [];
    s.forward((m) => sent.push(steerFrame('r1', m)));
    s.push('a', 'hi');
    expect(s.now('a')).toBe(true);
    s.remove('a');
    expect(sent).toEqual([
      { t: FRAME.STEER, id: 'r1', steerId: 'a', text: 'hi' },
      { t: FRAME.STEER_NOW, id: 'r1', steerId: 'a' },
      { t: FRAME.UNSTEER, id: 'r1', steerId: 'a' },
    ]);
  });
});

// The loop in runChat with Send now: the model call stops, the tools still to run are skipped, and
// the message goes in before the next call.
async function runLoopNow(steering, emitter, script) {
  const history = [{ role: 'user', content: 'start' }];
  for (;;) {
    addSteerMessages(history, deliverSteer(steering, emitter));
    const step = script.shift();
    if (!step) break;
    const res = await runStep(steering, null, emitter, async (signal) => {
      await step.during?.();
      if (signal.aborted)
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      return step.result;
    });
    if (res.interrupted) {
      if (res.textContent)
        history.push({ role: 'assistant', content: res.textContent });
      continue;
    }
    if (res.finishReason !== 'tool_calls') break;
    history.push({ role: 'assistant', content: '', tool_calls: res.toolCalls });
    for (const tc of res.toolCalls) {
      if (steering.urgent) {
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: SKIPPED_FOR_STEER,
        });
        continue;
      }
      await tc.run?.();
      history.push({ role: 'tool', tool_call_id: tc.id, content: 'done' });
    }
  }
  return history;
}

describe('the agent loop with Send now', () => {
  it('skips the rest of a tool round and reads the message next', async () => {
    const s = createSteering();
    const emitter = new EventEmitter();
    const history = await runLoopNow(s, emitter, [
      {
        result: {
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 't1',
              run: () => {
                s.push('a', 'wrong file');
                s.now('a');
              },
            },
            { id: 't2' },
          ],
        },
      },
      { result: { finishReason: 'stop' } },
    ]);
    expect(history.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:start',
      'assistant:',
      'tool:done',
      `tool:${SKIPPED_FOR_STEER}`,
      'user:wrong file',
    ]);
  });
});
