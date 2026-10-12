import { describe, it, expect } from 'vitest';
import { closeTurn, handleMcpHttp, isLoopback, mcpToolList, openTurn, TURN_HEADER } from '../../app/bg/ai/localhost-mcp.mjs';
import { mcpConfig } from '../../app/bg/ai/agent-cli.mjs';

function request(overrides = {}) {
  return handleMcpHttp({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    remoteAddress: '127.0.0.1',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    callTool: async () => 'ok',
    ...overrides,
  });
}

describe('localhost mcp', () => {
  it('accepts loopback addresses and refuses others', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('10.0.0.4')).toBe(false);
  });

  it('lists search and execute', async () => {
    const names = mcpToolList().map((tool) => tool.name);
    expect(names).toEqual(['search', 'execute']);
    const res = await request({
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.tools.map((tool) => tool.name)).toEqual(['search', 'execute']);
  });

  it('runs search and execute through the injected call', async () => {
    const seen = [];
    const res = await request({
      callTool: async (name, args) => {
        seen.push({ name, args });
        if (name === 'execute') return { text: 'shot', imageDataUrl: 'data:image/png;base64,aGVsbG8=' };
        return '{"kind":"index"}';
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'write a file' } },
      }),
    });
    expect(JSON.parse(res.body).result.content[0].text).toBe('{"kind":"index"}');
    const shot = await request({
      callTool: async () => ({ text: 'shot', imageDataUrl: 'data:image/png;base64,aGVsbG8=' }),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'execute', arguments: { code: 'x' } },
      }),
    });
    const content = JSON.parse(shot.body).result.content;
    expect(content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' });
    expect(seen[0]).toEqual({ name: 'search', args: { query: 'write a file' } });
  });

  it('returns a tool error without failing the http call', async () => {
    const res = await request({
      callTool: async () => {
        throw new Error('No active tab');
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'execute', arguments: { code: 'x' } },
      }),
    });
    const body = JSON.parse(res.body);
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('No active tab');
  });

  it('refuses a non-loopback socket and a foreign origin', async () => {
    expect((await request({ remoteAddress: '8.8.8.8' })).status).toBe(403);
    expect((await request({ headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('answers initialize and ignores notifications', async () => {
    const init = await request({
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    expect(JSON.parse(init.body).result.protocolVersion).toBe('2024-11-05');
    const note = await request({
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(note.status).toBe(202);
    expect(note.body).toBe('');
  });

  describe('chat turns', () => {
    const call = (headers, callTool) =>
      request({
        headers: { 'content-type': 'application/json', ...headers },
        callTool,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'execute', arguments: { code: 'x' } },
        }),
      });

    it('runs a call in the context of the turn its token names', async () => {
      const context = { toolOpts: { driveUrl: 'hyper://phone-drive/' } };
      const token = openTurn(context);
      let seen;
      await call({ [TURN_HEADER]: token }, async (name, args, turn) => {
        seen = turn;
        return 'ok';
      });
      closeTurn(token);
      expect(seen).toBe(context);
    });

    it('refuses an ended or unknown turn, and never falls back to the focused tab', async () => {
      const token = openTurn({});
      closeTurn(token);
      let called = false;
      const res = await call({ [TURN_HEADER]: token }, async () => {
        called = true;
        return 'ok';
      });
      const body = JSON.parse(res.body);
      expect(called).toBe(false);
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toBe('This chat turn has ended.');
    });

    it('gives a call with no token no turn', async () => {
      let seen = 'unset';
      await call({}, async (name, args, turn) => {
        seen = turn;
        return 'ok';
      });
      expect(seen).toBe(null);
    });

    it('makes a different token for each turn', () => {
      const a = openTurn({});
      const b = openTurn({});
      closeTurn(a);
      closeTurn(b);
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('gives the CLI the token as a header', () => {
      expect(mcpConfig('http://127.0.0.1:47655/mcp', 'abc')).toEqual({
        mcpServers: {
          nomad: { type: 'http', url: 'http://127.0.0.1:47655/mcp', headers: { [TURN_HEADER]: 'abc' } },
        },
      });
      expect(mcpConfig('http://127.0.0.1:47655/mcp', null).mcpServers.nomad.headers).toBeUndefined();
    });
  });

  it('rejects the wrong path, method, and body', async () => {
    expect((await request({ url: '/search' })).status).toBe(404);
    expect((await request({ method: 'GET' })).status).toBe(405);
    expect((await request({ headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    const bad = await request({ body: '{' });
    expect(JSON.parse(bad.body).error.code).toBe(-32700);
  });
});
