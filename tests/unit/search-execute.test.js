// search and execute. No Electron — the utility process is a thin parentPort loop
// around runModule, which is what these tests exercise.

import { describe, it, expect } from 'vitest';
import {
  search,
  buildCatalog,
  compileModule,
  runModule,
  splitGuides,
  capabilityCode,
  pageToolCode,
  assertCallAllowed,
} from '../../app/bg/ai/search-execute.mjs';

function catalog(overrides = {}) {
  return buildCatalog({
    allowWrite: true,
    allowVision: true,
    remote: false,
    pageTools: [
      { name: 'publishPost', description: 'Publish the open draft', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      { name: 'search', description: 'Search posts on this page', inputSchema: { type: 'object' } },
    ],
    ...overrides,
  });
}

describe('search', () => {
  it('lists domains when called with nothing', () => {
    const result = search({}, catalog());
    expect(result.kind).toBe('index');
    expect(result.domains.map((d) => d.domain)).toEqual(['capability', 'guide', 'page']);
    const caps = result.domains.find((d) => d.domain === 'capability');
    expect(caps.count).toBe(6);
    expect(caps.samples).toContain('readDriveFile');
  });

  it('ranks a capability and includes a module on the top hits', () => {
    const result = search({ query: 'write a file' }, catalog());
    expect(result.kind).toBe('hits');
    expect(result.hits[0].entity).toBe('capability:writeDriveFile');
    expect(result.hits[0].call.code).toBe(capabilityCode('writeDriveFile'));
    expect(result.hits[0].call.inputSchema.required).toEqual(['path', 'content']);
  });

  it('hides write and screenshot when those gates are closed', () => {
    const cat = catalog({ allowWrite: false, allowVision: false });
    const listed = search({ domain: 'capability' }, cat);
    const names = listed.hits.map((h) => h.entity);
    expect(names).toContain('capability:readDriveFile');
    expect(names).not.toContain('capability:writeDriveFile');
    expect(names).not.toContain('capability:screenshotCurrentPage');
    expect(() => search({ entity: 'capability:writeDriveFile' }, cat)).toThrow(/unknown capability/);
  });

  it('hides renderer capabilities and the page domain on a remote turn', () => {
    const cat = buildCatalog({ allowWrite: true, allowVision: true, remote: true, pageTools: null });
    const index = search({}, cat);
    expect(index.domains.map((d) => d.domain)).not.toContain('page');
    const names = search({ domain: 'capability' }, cat).hits.map((h) => h.entity);
    expect(names).not.toContain('capability:readCurrentPage');
    expect(names).not.toContain('capability:screenshotCurrentPage');
    expect(() => search({ domain: 'page' }, cat)).toThrow(/not available/);
  });

  it('opens a guide, a page tool, and several entities at once', () => {
    const cat = catalog();
    const guide = search({ entity: 'guide:nomad.fs' }, cat);
    expect(guide.details[0].type).toBe('guide');
    expect(guide.details[0].markdown).toContain('nomad.fs');

    const page = search({ entity: 'page:publishPost' }, cat);
    expect(page.details[0].code).toBe(pageToolCode('publishPost'));

    const both = search({ entity: ['capability:readDriveFile', 'page:search'] }, cat);
    expect(both.details.map((d) => d.entity)).toEqual(['capability:readDriveFile', 'page:search']);
    expect(both.details[1].code).toContain('nomad.page.search');
  });

  it('opens a guide heading and reports a missing one', () => {
    const cat = buildCatalog({
      pageTools: [],
    });
    // Real sections are long; the splitter is what fragment lookup uses.
    const guides = splitGuides('Intro\n\n## nomad.fs — files\n\n### Draft mode\n\nStage edits.\n\n### Publish\n\nFold them in.\n');
    cat.guides = guides;
    const hit = search({ entity: 'guide:nomad.fs#draft-mode' }, cat);
    expect(hit.details[0].markdown).toContain('Stage edits.');
    expect(hit.details[0].markdown).not.toContain('Fold them in.');
    const missing = search({ entity: 'guide:nomad.fs#nope' }, cat);
    expect(missing.details[0].fragmentNotFound).toBe(true);
  });
});

describe('guides from the API reference', () => {
  it('assigns stable ids to the shipped sections', () => {
    const ids = splitGuides().map((g) => g.id);
    expect(ids).toContain('nomad.fs');
    expect(ids).toContain('webmcp');
    expect(ids).toContain('spa');
  });
});

describe('execute modules', () => {
  it('runs a module that calls a capability and a page tool', async () => {
    const calls = [];
    const code = [
      "import { nomad } from 'nomad:runtime'",
      'export default async function main(params) {',
      '  const text = await nomad.readDriveFile(params)',
      '  const published = await nomad.page.publishPost({ path: params.path })',
      '  return { text, published }',
      '}',
    ].join('\n');
    const value = await runModule(code, { path: '/index.html' }, async (call) => {
      calls.push(call);
      if (call.target === 'readDriveFile') return 'hello';
      if (call.target === 'page') return 'ok';
      throw new Error('unexpected ' + call.target);
    });
    expect(JSON.parse(value)).toEqual({ text: 'hello', published: 'ok' });
    expect(calls[0]).toMatchObject({ target: 'readDriveFile', args: { path: '/index.html' } });
    expect(calls[1]).toMatchObject({ target: 'page', name: 'publishPost', args: { path: '/index.html' } });
  });

  it('rejects any import other than nomad:runtime', () => {
    expect(() => compileModule("import fs from 'fs'\nexport default async function main() { return 1 }")).toThrow(
      /nomad:runtime/
    );
    expect(() =>
      compileModule(
        "import { nomad } from 'nomad:runtime'\nexport default async function main() { return import('fs') }"
      )
    ).toThrow(/only the nomad:runtime import/);
  });

  it('blocks constructing a function from a string', async () => {
    const code = [
      "import { nomad } from 'nomad:runtime'",
      'export default async function main() {',
      "  const Fn = ({}).constructor.constructor;",
      "  return Fn('return 1')();",
      '}',
    ].join('\n');
    await expect(runModule(code, {}, async () => null)).rejects.toThrow(/eval|disabled|Code generation/i);
  });
});

describe('assertCallAllowed', () => {
  it('refuses a capability the catalog withheld and an unknown page tool', () => {
    const cat = catalog({ allowWrite: false });
    expect(() => assertCallAllowed('writeDriveFile', undefined, cat)).toThrow(/not available/);
    expect(() => assertCallAllowed('page', 'nope', cat)).toThrow(/unknown page tool/);
    expect(() => assertCallAllowed('page', 'publishPost', cat)).not.toThrow();
  });
});
