import { describe, it, expect } from 'vitest';
import {
  migrateServers,
  normalizeServers,
  pickActive,
  resolveServers,
  sameBaseUrl,
  nameForBaseUrl,
  OLLAMA_URL,
} from '../../app/bg/ai/runtimes.mjs';
import {
  createAgentReducer,
  parseCursorModels,
  promptFromMessages,
} from '../../app/bg/ai/agent-stream.mjs';

describe('AI runtimes', () => {
  it('turns the legacy single URL into one named server', () => {
    const { servers, changed } = migrateServers([], 'http://localhost:11434/v1', 'secret');
    expect(changed).toBe(true);
    expect(servers).toEqual([
      {
        id: 'srv_default',
        name: 'Ollama',
        kind: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        accessToken: 'secret',
      },
    ]);
    expect(nameForBaseUrl(OLLAMA_URL)).toBe('Ollama');
  });

  it('keeps saved servers and drops reserved ids', () => {
    const servers = normalizeServers([
      { id: 'claude', name: 'Nope', baseUrl: 'http://example.test/v1' },
      { id: 'srv_a', name: ' Work ', baseUrl: ' https://api.example/v1 ' },
      { id: 'srv_a', name: 'Dupe', baseUrl: 'https://other.example/v1' },
    ]);
    expect(servers).toEqual([
      {
        id: 'srv_a',
        name: 'Work',
        kind: 'openai',
        baseUrl: 'https://api.example/v1',
        accessToken: '',
      },
    ]);
  });

  it('keeps an explicit choice that is not currently detected', () => {
    const active = pickActive([], [], 'claude');
    expect(active).toMatchObject({ id: 'claude', available: false });
  });

  it('defaults to a saved server before a detected app', () => {
    const saved = [
      {
        id: 'srv_a',
        name: 'Mine',
        kind: 'openai',
        baseUrl: 'http://127.0.0.1:9/v1',
        accessToken: '',
      },
    ];
    const detected = [{ id: 'cursor', name: 'Cursor', kind: 'cursor', available: true }];
    expect(pickActive(saved, detected, '').id).toBe('srv_a');
    expect(pickActive(saved, detected, 'cursor').id).toBe('cursor');
  });

  it('leaves an empty list empty after migration has already run', () => {
    const { servers, changed } = resolveServers([], 'http://localhost:11434/v1', 'secret', true);
    expect(changed).toBe(false);
    expect(servers).toEqual([]);
  });

  it('treats localhost and 127.0.0.1 as the same server', () => {
    expect(sameBaseUrl('http://localhost:11434/v1/', 'http://127.0.0.1:11434/v1')).toBe(true);
  });
});

describe('agent stream', () => {
  it('emits only the new suffix when a later line repeats the answer', () => {
    const reduce = createAgentReducer();
    const first = reduce(
      JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: 'Hello' } },
      })
    );
    const again = reduce(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      })
    );
    const done = reduce(JSON.stringify({ type: 'result', result: 'Hello world' }));
    expect(first).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(again).toEqual([{ type: 'text', text: ' world' }]);
    expect(done).toEqual([]);
  });

  it('splits the system text out of the transcript', () => {
    const { system, prompt } = promptFromMessages([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'search', arguments: '{}' } }],
      },
    ]);
    expect(system).toBe('Be brief');
    expect(prompt).toContain('User: Hi');
    expect(prompt).toContain('search {}');
  });

  it('does not replace a photo with an [image] placeholder', () => {
    const { prompt } = promptFromMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Food in the photo.' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aa' } },
          { type: 'text', text: 'Photo file: photo-1.jpg' },
        ],
      },
    ]);
    expect(prompt).not.toContain('[image]');
    expect(prompt).toContain('Photo file: photo-1.jpg');
  });

  it('parses a cursor model catalogue', () => {
    expect(
      parseCursorModels('gpt-5\nsonnet-4-thinking - thinking\nFailed to load models: no')
    ).toEqual(['gpt-5', 'sonnet-4-thinking']);
  });
});
