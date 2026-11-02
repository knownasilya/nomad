// AI Jobs use web pages (ADR-0038): the page grants on a Job (shared/jobs.mjs), what a Job's turn
// is offered (search-execute.mjs), the URL a Job may open (open-tab.mjs) and its egress rules.
import { describe, it, expect } from 'vitest';
import {
  pageSite,
  pageGrant,
  grantPage,
  normalizeWrites,
  addedWrites,
  describeWrites,
  keepPageActions,
  normalizeNeeds,
  describeNeed,
  makeJob,
  makeRun,
  writeCaps,
  writePermissions,
  MAX_PAGE_SITES,
} from '../../shared/jobs.mjs';
import { visibleCapabilities, JOB_CAPS, JOB_PAGE_CAPS } from '../../app/bg/ai/search-execute.mjs';
import { jobPageUrl } from '../../app/bg/ai/open-tab.mjs';
import { createEgressGuard, readsPrivate } from '../../app/bg/ai/egress.mjs';
import { similarKey, similarLabel } from '../../app/bg/ai/page-control.mjs';

const KEY = 'a'.repeat(64);

describe('pageSite', () => {
  it('names a web site by its host, without www. or the scheme', () => {
    expect(pageSite('https://www.Example.com/account?x=1')).toBe('example.com');
    expect(pageSite('http://example.com')).toBe('example.com');
    expect(pageSite('example.com/news')).toBe('example.com');
    expect(pageSite('app.example.com')).toBe('app.example.com');
    expect(pageSite('example.com:8080')).toBe('example.com:8080');
    expect(pageSite('localhost:3000')).toBe('localhost:3000');
  });

  it('names a drive by its key, and nothing else', () => {
    expect(pageSite(`hyper://${KEY.toUpperCase()}/index.html`)).toBe(`hyper://${KEY}`);
    expect(pageSite('hyper://blog/')).toBe('');
    expect(pageSite('nomad://library/')).toBe('');
    expect(pageSite('file:///etc/passwd')).toBe('');
    expect(pageSite('')).toBe('');
    expect(pageSite(null)).toBe('');
  });
});

describe('page grants', () => {
  it('tidies pages to one per site, and keeps writes that only open pages', () => {
    const w = normalizeWrites({
      pages: ['example.com', { site: 'https://www.example.com/x', control: true }, { site: `hyper://${KEY}/` }],
    });
    expect(w).toEqual({
      drives: [],
      notes: false,
      reader: false,
      pages: [
        { site: 'example.com', control: true },
        { site: `hyper://${KEY}`, control: false },
      ],
    });
    expect(normalizeWrites({ pages: [] })).toBe(null);
    expect(normalizeWrites({ notes: true })).not.toHaveProperty('pages');
  });

  it('refuses what isn’t a site, and too many', () => {
    expect(() => normalizeWrites({ pages: ['nomad://library/'] })).toThrow(/isn’t a site/);
    expect(() => normalizeWrites({ pages: 'example.com' })).toThrow(/is a list/);
    const many = Array.from({ length: MAX_PAGE_SITES + 1 }, (_, i) => `site${i}.example.com`);
    expect(() => normalizeWrites({ pages: many })).toThrow(/at most/);
  });

  it('adds no capability or permission: the page checks its own grants', () => {
    const w = normalizeWrites({ pages: [{ site: 'example.com', control: true }] });
    expect(writeCaps(w)).toEqual([]);
    expect(writePermissions(w)).toEqual([]);
  });

  it('finds the grant for a URL', () => {
    const w = normalizeWrites({ pages: [{ site: 'example.com', control: true }] });
    expect(pageGrant(w, 'https://www.example.com/inbox')?.control).toBe(true);
    expect(pageGrant(w, 'https://example.org/')).toBe(null);
    expect(pageGrant(null, 'https://example.com/')).toBe(null);
  });

  it('grants what the user said yes to on a watched run', () => {
    let w = grantPage(null, 'https://example.com/a');
    expect(w.pages).toEqual([{ site: 'example.com', control: false }]);
    w = grantPage(w, 'https://example.com/b', { control: true });
    expect(w.pages).toEqual([{ site: 'example.com', control: true }]);
    const action = { key: 'k1', label: 'click button “Send”' };
    w = grantPage(w, 'https://example.com/c', { action });
    expect(w.pages).toEqual([{ site: 'example.com', control: true, actions: [action] }]);
    // Other grants stay as they are.
    w = grantPage(normalizeWrites({ notes: true }), 'news.example.org');
    expect(w).toMatchObject({ notes: true, pages: [{ site: 'news.example.org', control: false }] });
  });

  it('an allowed click implies control', () => {
    const w = normalizeWrites({ pages: [{ site: 'example.com', actions: [{ key: 'k', label: 'send' }] }] });
    expect(w.pages[0].control).toBe(true);
  });

  it('finds the pages a change adds: a site, control, or a click', () => {
    const prev = normalizeWrites({ pages: [{ site: 'example.com' }] });
    expect(addedWrites(prev, prev)).toBe(null);
    expect(addedWrites(prev, normalizeWrites({ pages: [{ site: 'example.com', control: true }] }))).toEqual({
      drives: [],
      notes: false,
      reader: false,
      pages: [{ site: 'example.com', control: true }],
    });
    expect(addedWrites(prev, normalizeWrites({ pages: ['example.com', 'other.org'] }))?.pages).toEqual([
      { site: 'other.org', control: false },
    ]);
    // Taking a site away adds nothing.
    expect(addedWrites(prev, normalizeWrites({ notes: false }))).toBe(null);
  });

  it('keeps only the clicks the user already allowed when the AI saves a Job', () => {
    const action = { key: 'k1', label: 'click button “Send”' };
    const prev = normalizeWrites({ pages: [{ site: 'example.com', control: true, actions: [action] }] });
    const forged = normalizeWrites({
      pages: [
        { site: 'example.com', control: true, actions: [action, { key: 'k2', label: 'click “Buy”' }] },
        { site: 'shop.example', control: true, actions: [{ key: 'k3', label: 'click “Pay”' }] },
      ],
    });
    expect(keepPageActions(prev, forged).pages).toEqual([
      { site: 'example.com', control: true, actions: [action] },
      { site: 'shop.example', control: true },
    ]);
    expect(keepPageActions(prev, null)).toBe(null);
  });

  it('says what a Job may do on a site in words', () => {
    const w = normalizeWrites({
      pages: ['news.example.org', { site: 'example.com', actions: [{ key: 'k', label: 'click button “Send”' }] }],
    });
    expect(describeWrites(w)).toEqual([
      'open pages on news.example.org',
      'click and type on example.com, and a click you allowed (click button “Send”)',
    ]);
  });

  it('keeps page grants on the Job record', () => {
    const job = makeJob({ id: 'job-p-1', title: 'Inbox', prompt: 'Read it', writes: { pages: ['mail.example.com'] } });
    expect(job.writes.pages).toEqual([{ site: 'mail.example.com', control: false }]);
    expect(makeJob({ title: 'Inbox 2' }, job).writes).toEqual(job.writes);
  });
});

describe('what a run wanted', () => {
  it('records needs once each, by site', () => {
    const job = makeJob({ id: 'job-p-2', title: 'Inbox', prompt: 'Read it' });
    const run = makeRun({
      id: 'r1',
      job,
      startedAt: 0,
      finishedAt: 1,
      status: 'ok',
      output: 'Could not open it',
      needs: [
        { site: 'example.com', control: false },
        { site: 'https://www.example.com/x', control: false },
        { site: 'example.com', control: true, action: 'click button “Send”' },
        { site: 'nomad://library' },
      ],
    });
    expect(run.needs).toEqual([
      { site: 'example.com' },
      { site: 'example.com', control: true, action: 'click button “Send”' },
    ]);
    expect(makeRun({ id: 'r2', job, startedAt: 0, finishedAt: 1, status: 'ok', output: '' })).not.toHaveProperty('needs');
    expect(normalizeNeeds('nope')).toEqual([]);
  });

  it('says a need in words', () => {
    expect(describeNeed({ site: 'example.com' })).toBe('open example.com');
    expect(describeNeed({ site: 'example.com', control: true })).toBe('click and type on example.com');
    expect(describeNeed({ site: 'example.com', control: true, action: 'click button “Send”' })).toBe(
      'click button “Send” on example.com'
    );
  });
});

describe('a Job’s page capabilities', () => {
  const names = (o) => visibleCapabilities(o).map((c) => c.name);

  it('offers openPage and the page actions on a Job with its own page, without a tab', () => {
    const got = names({ personal: true, remote: true, job: { extra: [], pages: true }, secrets: true });
    for (const n of JOB_PAGE_CAPS) expect(got).toContain(n);
    expect(got).not.toContain('planPageActions');
    expect(got).not.toContain('clickAt');
    expect(got).not.toContain('openTab');
    expect(got).not.toContain('currentTab');
    expect(got).not.toContain('screenshotCurrentPage');
  });

  it('offers none of them to a Job without a page', () => {
    const got = names({ personal: true, remote: true, job: { extra: [] }, secrets: true });
    for (const n of JOB_PAGE_CAPS) expect(got).not.toContain(n);
  });

  it('never offers openPage outside a Job', () => {
    expect(names({ personal: true, tab: true })).not.toContain('openPage');
    expect(names({ personal: true, remote: true })).not.toContain('openPage');
    expect(names({})).not.toContain('openPage');
    // The sidebar keeps its page control as before.
    expect(names({ personal: true, tab: true })).toContain('clickElement');
    expect(names({ personal: true, remote: true })).not.toContain('clickElement');
  });

  it('lists the page capabilities among a Job’s', () => {
    for (const n of JOB_PAGE_CAPS) expect(JOB_CAPS.has(n)).toBe(true);
  });
});

describe('jobPageUrl', () => {
  it('opens web pages and drives', () => {
    expect(jobPageUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(jobPageUrl('example.com/news')).toBe('https://example.com/news');
    expect(jobPageUrl(`hyper://${KEY}/`)).toBe(`hyper://${KEY}/`);
    expect(jobPageUrl('hyper://blog/')).toBe('hyper://blog/');
  });

  it('refuses Nomad’s own pages, the private drive and other schemes', () => {
    expect(() => jobPageUrl('nomad://library/')).toThrow(/http, https and hyper/);
    expect(() => jobPageUrl('hyper://private/notes.md')).toThrow(/private drive/);
    expect(() => jobPageUrl('file:///etc/passwd')).toThrow(/http, https and hyper/);
    expect(() => jobPageUrl('javascript:alert(1)')).toThrow();
    expect(() => jobPageUrl('')).toThrow(/Pass `url`/);
  });
});

describe('a Job’s page and private data', () => {
  it('counts openPage as a private read: the page is signed in as the user', () => {
    expect(readsPrivate('openPage')).toBe(true);
  });

  it('lets a Job that read private data reach the sites it may open, and nothing else', async () => {
    const guard = createEgressGuard({ interactive: false, trustedHosts: ['example.com'] });
    guard.noteCall('openPage');
    await expect(guard.check('https://www.example.com/next')).resolves.toBe(undefined);
    await expect(guard.check('https://evil.example.net/?q=secret')).rejects.toThrow(/can now reach only/);
    // A site the user allowed on a watched run, mid-run.
    guard.trust(['evil.example.net']);
    await expect(guard.check('https://evil.example.net/')).resolves.toBe(undefined);
  });
});

describe('repeatable clicks', () => {
  it('says how long an allowed click lasts', () => {
    const control = { role: 'button', name: 'Send 3' };
    expect(similarLabel('https://mail.example.com/', control)).toBe(
      'Also allow buttons like “Send …” on mail.example.com for the rest of this chat'
    );
    expect(similarLabel('https://mail.example.com/', control, 'on this Job’s later runs')).toBe(
      'Also allow buttons like “Send …” on mail.example.com on this Job’s later runs'
    );
    // The key a Job keeps matches the same click on a later page of the site.
    expect(similarKey('https://mail.example.com/a', 'click', control)).toBe(
      similarKey('https://mail.example.com/b', 'click', { role: 'button', name: 'Send 4' })
    );
  });
});
