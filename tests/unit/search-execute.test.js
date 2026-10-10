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
  needsListedDrives,
  withListedDrives,
} from '../../app/bg/ai/search-execute.mjs';
import { timeoutMessage, unwrapMessage } from '../../app/bg/ai/execute-messages.mjs';

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

describe('utility-process messages', () => {
  const run = { type: 'run', code: 'x', params: {} };

  it('reads the child parentPort event, which has data and ports and no type', () => {
    expect(unwrapMessage({ data: run, ports: [] })).toEqual(run);
  });

  it('reads a payload the parent receives directly', () => {
    expect(unwrapMessage({ type: 'call', callId: 1, target: 'writeDriveFile', args: {} })).toMatchObject({
      type: 'call',
      callId: 1,
    });
  });

  it('reads a message wrapper whose type is message', () => {
    expect(unwrapMessage({ type: 'message', data: { type: 'done', ok: true, value: 'ping' } })).toEqual({
      type: 'done',
      ok: true,
      value: 'ping',
    });
  });

  it('says when the module never reported back', () => {
    expect(timeoutMessage(false, '')).toMatch(/before the module reported back/);
    expect(timeoutMessage(true, 'boom')).toMatch(/waiting for the module to finish: boom/);
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

describe('search: drives listed for public search', () => {
  const blogKey = 'a'.repeat(64);
  // What the search crawler returns for a query (listed-drives.mjs), best first.
  const listed = [
    {
      driveKey: blogKey,
      type: 'walled.garden/feed',
      title: 'My Blog',
      description: 'A peer-to-peer blog.',
      topics: ['blog'],
      keywords: ['personal'],
      score: 3,
    },
  ];

  it('hides the drive domain unless the host supplied listed drives', () => {
    expect(search({}, catalog()).domains.map((d) => d.domain)).not.toContain('drive');
    expect(() => search({ domain: 'drive' }, catalog())).toThrow(/not available/);
  });

  it('lists the domain with a count, 0 when the crawler is off', () => {
    const on = search({}, withListedDrives(catalog(), listed)).domains.find((d) => d.domain === 'drive');
    expect(on).toMatchObject({ count: 1, samples: [blogKey] });
    const off = search({}, withListedDrives(catalog(), [])).domains.find((d) => d.domain === 'drive');
    expect(off.count).toBe(0);
  });

  it('returns a listed drive as a hit with its URL and nothing to execute', () => {
    const { hits } = search({ query: 'pee', domain: 'drive' }, withListedDrives(catalog(), listed));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entity: `drive:${blogKey}`,
      type: 'drive',
      title: 'My Blog',
      url: `hyper://${blogKey}/`,
      topics: ['blog'],
    });
    expect(hits[0]).not.toHaveProperty('call');
    expect(hits[0]).not.toHaveProperty('score');
  });

  it('ranks drive hits among the other domains', () => {
    const { hits } = search({ query: 'blog' }, withListedDrives(catalog(), listed));
    expect(hits.map((h) => h.entity)).toContain(`drive:${blogKey}`);
  });

  it('opens a drive entity', () => {
    const [d] = search({ entity: `drive:${blogKey}` }, withListedDrives(catalog(), listed)).details;
    expect(d).toMatchObject({ entity: `drive:${blogKey}`, title: 'My Blog', keywords: ['personal'] });
    expect(() => search({ entity: 'drive:nope' }, withListedDrives(catalog(), listed))).toThrow(/unknown listed drive/);
  });

  it('tells the host which searches need listed drives', () => {
    expect(needsListedDrives({})).toBe(''); // the domain index counts them
    expect(needsListedDrives({ query: ' gardening ' })).toBe('gardening');
    expect(needsListedDrives({ query: 'x', domain: 'drive' })).toBe('x');
    expect(needsListedDrives({ domain: 'drive' })).toBe('');
    expect(needsListedDrives({ query: 'x', domain: 'guide' })).toBeNull();
    expect(needsListedDrives({ entity: 'guide:nomad.fs' })).toBeNull();
    expect(needsListedDrives({ entity: ['guide:nomad.fs', `drive:${blogKey}`] })).toBe('');
  });
});

describe('search: the user\'s names', () => {
  const key = 'b'.repeat(64);
  const names = [
    { name: 'blog', url: `hyper://${key}/`, title: 'My Blog' },
    { name: 'todo', url: 'hyper://private/apps/todo/', title: 'Todo app' },
    { name: 'gh', url: 'https://github.com/knownasilya', title: 'GitHub' },
  ];

  it('hides the name domain unless the host supplied names', () => {
    expect(search({}, catalog()).domains.map((d) => d.domain)).not.toContain('name');
    expect(() => search({ domain: 'name' }, catalog())).toThrow(/not available/);
    const row = search({}, catalog({ names })).domains.find((d) => d.domain === 'name');
    expect(row).toMatchObject({ count: 3, samples: ['blog', 'todo', 'gh'] });
  });

  it('returns a name with what it points to and its short address', () => {
    const { hits } = search({ query: 'blog', domain: 'name' }, catalog({ names }));
    expect(hits[0]).toMatchObject({ entity: 'name:blog', type: 'name', title: 'My Blog', url: `hyper://${key}/`, shortcut: 'hyper://blog/', kind: 'drive' });
    const [todo] = search({ entity: 'name:todo' }, catalog({ names })).details;
    expect(todo).toMatchObject({ kind: 'app', url: 'hyper://private/apps/todo/' });
    const [gh] = search({ entity: 'name:gh' }, catalog({ names })).details;
    expect(gh.kind).toBe('page');
    expect(() => search({ entity: 'name:nope' }, catalog({ names }))).toThrow(/unknown name/);
  });

  it('lets the drive tools take a drive', () => {
    const caps = catalog().capabilities;
    for (const n of ['readDriveFile', 'listDriveFiles', 'writeDriveFile']) {
      expect(caps.find((c) => c.name === n).inputSchema.properties).toHaveProperty('drive');
    }
  });
});
