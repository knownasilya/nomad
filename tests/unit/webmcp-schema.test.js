// Pure helpers for the WebMCP bridge (app/bg/web-apis/bg/webmcp-schema.ts). No Electron /
// emit-stream deps, so it imports directly like lib-strings.test.js.

import { describe, it, expect } from 'vitest';
import {
  sanitizeToolDescriptors,
  jsonSchemaToParameters,
  pageToolResultToText,
} from '../../app/bg/web-apis/bg/webmcp-schema.js';

describe('sanitizeToolDescriptors', () => {
  it('keeps a well-formed tool', () => {
    const out = sanitizeToolDescriptors([
      { name: 'search', description: 'Search the catalog', inputSchema: { type: 'object' } },
    ]);
    expect(out).toEqual([
      { name: 'search', description: 'Search the catalog', inputSchema: { type: 'object' } },
    ]);
  });

  it('drops tools with invalid or missing names', () => {
    const out = sanitizeToolDescriptors([
      { name: 'has space', description: 'x' },
      { name: 'ok_tool', description: 'x' },
      { description: 'no name' },
      { name: 'a'.repeat(65), description: 'too long' },
    ]);
    expect(out.map((t) => t.name)).toEqual(['ok_tool']);
  });

  it('strips control characters from the description and clamps its length', () => {
    const out = sanitizeToolDescriptors([
      { name: 't', description: 'line1\n\tline2\x07\x00', inputSchema: null },
    ]);
    expect(out[0].description).toBe('line1  line2  ');

    const long = sanitizeToolDescriptors([{ name: 't', description: 'x'.repeat(5000) }]);
    expect(long[0].description.length).toBe(1024);
  });

  it('drops an unserialisable or oversized schema but keeps the tool', () => {
    const circular = {};
    circular.self = circular;
    const out = sanitizeToolDescriptors([{ name: 't', description: 'd', inputSchema: circular }]);
    expect(out).toEqual([{ name: 't', description: 'd', inputSchema: null }]);

    const huge = { type: 'object', blob: 'x'.repeat(20000) };
    const out2 = sanitizeToolDescriptors([{ name: 't', description: 'd', inputSchema: huge }]);
    expect(out2[0].inputSchema).toBeNull();
  });

  it('caps the list at 32 tools', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: 't' + i, description: 'd' }));
    expect(sanitizeToolDescriptors(many)).toHaveLength(32);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeToolDescriptors(null)).toEqual([]);
    expect(sanitizeToolDescriptors({})).toEqual([]);
  });
});

describe('jsonSchemaToParameters', () => {
  it('passes through a nested object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'query' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['q'],
    };
    expect(jsonSchemaToParameters(schema)).toEqual(schema);
  });

  it('drops $schema / $id / $ref / $defs / definitions', () => {
    const out = jsonSchemaToParameters({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'x',
      $defs: { Foo: { type: 'string' } },
      definitions: { Bar: { type: 'number' } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/Foo', type: 'string' } },
    });
    expect(out).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });

  it('normalises empty / non-object schemas to an empty object schema', () => {
    const EMPTY = { type: 'object', properties: {} };
    expect(jsonSchemaToParameters(undefined)).toEqual(EMPTY);
    expect(jsonSchemaToParameters(null)).toEqual(EMPTY);
    expect(jsonSchemaToParameters('nope')).toEqual(EMPTY);
    expect(jsonSchemaToParameters({})).toEqual(EMPTY);
  });

  it('defaults a schema with properties but no type to type:object', () => {
    expect(jsonSchemaToParameters({ properties: { a: { type: 'string' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });
});

describe('pageToolResultToText', () => {
  it('passes a bare string through', () => {
    expect(pageToolResultToText('hello')).toBe('hello');
  });

  it('joins text parts of a { content } result', () => {
    expect(
      pageToolResultToText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })
    ).toBe('a\nb');
  });

  it('prefixes Error: when isError is set', () => {
    expect(pageToolResultToText({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toBe(
      'Error: boom'
    );
  });

  it('stringifies an arbitrary object with no text content', () => {
    expect(pageToolResultToText({ ok: 1 })).toBe('{"ok":1}');
  });

  it('returns "" for null / undefined', () => {
    expect(pageToolResultToText(null)).toBe('');
    expect(pageToolResultToText(undefined)).toBe('');
  });
});
