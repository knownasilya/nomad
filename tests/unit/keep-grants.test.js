// A phone's AI prompts lasting longer than one answer, as desktop's do (app/bg/ai/keep-grants.mjs,
// promptAnswer in shared/ai-bridge.mjs, the phone's prompt text in mobile/lib/aiPrompts.ts).

import { describe, it, expect, vi } from 'vitest';
import { keepSite, siteLabel, keepLabel, keepingPermit } from '../../app/bg/ai/keep-grants.mjs';
import { promptAnswer } from '../../shared/ai-bridge.mjs';
import { askOncePerTurn } from '../../app/bg/ai/vault-tools.mjs';
import { aiPromptText, requestLines } from '../../mobile/lib/aiPrompts.ts';

const KEY = 'a'.repeat(64);

function store(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    get: vi.fn(async (site, perm) => rows.get(`${site} ${perm}`)),
    set: vi.fn(async (site, perm) => {
      rows.set(`${site} ${perm}`, 1);
    }),
  };
}

const persists = (p) => ['notesRead', 'readerWrite'].includes(p) || p.startsWith('modifyDrive:');

describe('keepSite', () => {
  it('is the origin of a web site or a drive', () => {
    expect(keepSite('https://example.com/a/b?c')).toBe('https://example.com');
    expect(keepSite('http://localhost:8080/x')).toBe('http://localhost:8080');
    expect(keepSite(`hyper://${KEY}/posts/`)).toBe(`hyper://${KEY}`);
  });

  it('is null with no site to keep it for', () => {
    expect(keepSite('hyper://unknown/')).toBe(null);
    expect(keepSite('')).toBe(null);
    expect(keepSite(undefined)).toBe(null);
    expect(keepSite('nomad://notes/')).toBe(null);
    expect(keepSite('about:blank')).toBe(null);
    expect(keepSite('not a url')).toBe(null);
  });
});

describe('siteLabel', () => {
  it('names a web site by its host and a drive by its title', () => {
    expect(siteLabel('https://example.com')).toBe('example.com');
    expect(siteLabel(`hyper://${KEY}`, 'My blog')).toBe('My blog');
    expect(siteLabel(`hyper://${KEY}`, 'Loading…')).toBe('hyper://aaaaaa…');
    expect(siteLabel(`hyper://${KEY}`)).toBe('hyper://aaaaaa…');
    expect(siteLabel(`hyper://${KEY}`, 'x'.repeat(80))).toHaveLength(60);
  });
});

describe('keepingPermit', () => {
  const site = 'https://example.com';

  it('offers the box for a permission desktop keeps, and keeps a ticked yes', async () => {
    const s = store();
    const relay = vi.fn(async () => 'similar');
    const permit = keepingPermit(relay, { site, label: 'example.com', persists, ...s });
    expect(await permit('notesRead', null, { foo: 1 })).toBe(true);
    expect(relay).toHaveBeenCalledWith('notesRead', null, {
      foo: 1,
      similar: keepLabel('example.com'),
    });
    expect(s.set).toHaveBeenCalledWith(site, 'notesRead');

    // The next turn doesn't ask.
    relay.mockClear();
    expect(await permit('notesRead', null)).toBe(true);
    expect(relay).not.toHaveBeenCalled();
  });

  it('keeps nothing for a yes without the box', async () => {
    const s = store();
    const permit = keepingPermit(async () => true, { site, persists, ...s });
    expect(await permit('readerWrite', null)).toBe(true);
    expect(s.set).not.toHaveBeenCalled();
    const no = keepingPermit(async () => false, { site, persists, ...s });
    expect(await no('readerWrite', null)).toBe(false);
    expect(s.set).not.toHaveBeenCalled();
  });

  it('answers from what site-info holds: a yes, or a Deny', async () => {
    const relay = vi.fn(async () => true);
    const s = store({ [`${site} notesRead`]: 1, [`${site} readerWrite`]: 0 });
    const permit = keepingPermit(relay, { site, persists, ...s });
    expect(await permit('notesRead', null)).toBe(true);
    expect(await permit('readerWrite', null)).toBe(false);
    expect(relay).not.toHaveBeenCalled();
  });

  it('keeps a drive edit per drive', async () => {
    const s = store();
    const permit = keepingPermit(async () => 'similar', { site, persists, ...s });
    expect(await permit(`modifyDrive:${KEY}`, null)).toBe(true);
    expect(s.set).toHaveBeenCalledWith(site, `modifyDrive:${KEY}`);
  });

  it('leaves a permission desktop never keeps to the relay, box and answer as they are', async () => {
    const s = store();
    const relay = vi.fn(async () => 'similar');
    const permit = keepingPermit(relay, { site, persists, ...s });
    const opts = { similar: 'Allow x.com for 3 months, in every chat (AI page → Sites)' };
    // aiSendData's own box (the 3-month send grant): its caller keeps the yes.
    expect(await permit('aiSendData:x.com', null, opts)).toBe('similar');
    expect(relay).toHaveBeenCalledWith('aiSendData:x.com', null, opts);
    expect(await permit('aiSecretUse:KEY', null)).toBe('similar');
    expect(s.get).not.toHaveBeenCalled();
    expect(s.set).not.toHaveBeenCalled();
  });

  it('offers no box and reads nothing with no site', async () => {
    const s = store();
    const relay = vi.fn(async () => true);
    const permit = keepingPermit(relay, { site: null, persists, ...s });
    expect(await permit('notesRead', null)).toBe(true);
    expect(relay).toHaveBeenCalledWith('notesRead', null, undefined);
    expect(s.get).not.toHaveBeenCalled();
  });

  it('still asks when the store fails, and a failed keep still allows', async () => {
    const relay = vi.fn(async () => 'similar');
    const permit = keepingPermit(relay, {
      site,
      persists,
      get: async () => {
        throw new Error('db');
      },
      set: async () => {
        throw new Error('db');
      },
    });
    expect(await permit('notesRead', null)).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('asks once a turn under askOncePerTurn', async () => {
    const s = store();
    const relay = vi.fn(async () => true);
    const permit = askOncePerTurn(keepingPermit(relay, { site, persists, ...s }));
    const sender = { getURL: () => 'https://example.com/' };
    expect(await permit('notesRead', sender)).toBe(true);
    expect(await permit('notesRead', sender)).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
  });
});

describe('promptAnswer', () => {
  it("takes 'similar' only when the prompt offered the box", () => {
    expect(promptAnswer('similar', true)).toBe('similar');
    expect(promptAnswer('similar', false)).toBe(true);
    expect(promptAnswer(true, true)).toBe(true);
    expect(promptAnswer(false, true)).toBe(false);
    // Anything else is a no.
    expect(promptAnswer('yes', true)).toBe(false);
    expect(promptAnswer(1, true)).toBe(false);
    expect(promptAnswer(undefined, false)).toBe(false);
  });
});

describe("the phone's prompt text", () => {
  it('says what the AI wants, with desktop’s icon', () => {
    const p = aiPromptText('notesRead');
    expect(p.title).toBe('Allow AI to read your Notes?');
    expect(p.icon).toBe('sticky-note');
    expect(p.request).toEqual([]);
  });

  it('names the drive an edit is for', () => {
    const p = aiPromptText(`modifyDrive:${KEY}`, { name: 'Blog', url: `hyper://${KEY}` });
    expect(p.message).toContain('Blog');
    expect(p.message).toContain(`hyper://${KEY}`);
  });

  it('shows the request a send prompt is for, apart from the message', () => {
    const request = {
      kind: 'request',
      url: 'https://api.x.com/v1/items',
      method: 'POST',
      headers: [{ name: 'Authorization', value: '[secret API_KEY]' }],
      body: '{"a":1}',
      secrets: ['API_KEY'],
      secretDetails: [{ name: 'API_KEY', hosts: ['api.x.com'], sentAs: 'the Authorization header' }],
    };
    const p = aiPromptText('aiSendData:api.x.com', null, request);
    expect(p.title).toBe('Allow AI to contact api.x.com?');
    expect(p.message).not.toContain('POST');
    expect(p.request.map((l) => l.text)).toEqual([
      'POST https://api.x.com/v1/items',
      'With a body of 7 characters',
      'Headers: Authorization',
      'Sends your secret API_KEY',
      'API_KEY goes in the Authorization header, only to api.x.com',
    ]);
    expect(p.request.filter((l) => l.warn)).toHaveLength(2);
    expect(aiPromptText('aiSecretUse:API_KEY', null, request).title).toBe('Allow AI to use API_KEY?');
  });

  it('shows no request when the Provider sent none', () => {
    expect(requestLines(null)).toEqual([]);
    expect(aiPromptText('aiSendData:x.com').request).toEqual([]);
  });
});
