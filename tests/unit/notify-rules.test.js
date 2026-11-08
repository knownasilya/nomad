import { describe, it, expect } from 'vitest';
import {
  jobAlerts,
  spaceAlerts,
  promptNeedsAlert,
  promptAlert,
  promptText,
  textTag,
  siteOf,
  parseMarks,
  MAX_AT_ONCE,
} from '../../app/bg/ui/notify-rules.mjs';
import { renderPermDesc } from '../../app/lib/permissions.ts';
import { makeNotice } from '../../shared/space-library.mjs';

const JOB = 'j0000000001';
const run = (id, finishedAt, notification, extra = {}) => ({
  type: 'nomad/job-run',
  id,
  jobId: JOB,
  finishedAt,
  notification,
  ...extra,
});

describe('jobAlerts', () => {
  const runs = [
    run('r0000000001', '2026-11-01T08:00:00.000Z', { title: 'Morning', body: 'Three posts' }),
    run('r0000000002', '2026-11-02T08:00:00.000Z', null),
    run('r0000000003', '2026-11-03T08:00:00.000Z', { title: 'Morning', body: 'Two posts' }),
  ];

  it('shows nothing the first time and keeps the newest as the mark', () => {
    for (const since of [null, '', undefined]) {
      const res = jobAlerts(runs, since);
      expect(res.alerts).toEqual([]);
      expect(res.since).toBe('2026-11-03T08:00:00.000Z');
    }
  });

  it('shows runs with a notification after the mark, oldest first', () => {
    const res = jobAlerts(runs, '2026-10-31T00:00:00.000Z');
    expect(res.alerts).toEqual([
      { title: 'Morning', body: 'Three posts', jobId: JOB },
      { title: 'Morning', body: 'Two posts', jobId: JOB },
    ]);
    expect(res.since).toBe('2026-11-03T08:00:00.000Z');
    expect(jobAlerts(runs, res.since).alerts).toEqual([]);
  });

  it('leaves out a watched run while Nomad is in front', () => {
    const watched = [run('r0000000004', '2026-11-04T08:00:00.000Z', { title: 'Watched', body: 'x' }, { chat: 'c1' })];
    expect(jobAlerts(watched, '2026-11-01T00:00:00.000Z', { appFocused: true }).alerts).toEqual([]);
    expect(jobAlerts(watched, '2026-11-01T00:00:00.000Z', { appFocused: false }).alerts).toHaveLength(1);
  });

  it('folds many into one', () => {
    const many = Array.from({ length: MAX_AT_ONCE + 1 }, (_, i) =>
      run(`r00000000${10 + i}`, `2026-11-0${i + 1}T08:00:00.000Z`, { title: `Job ${i}`, body: 'b' })
    );
    const { alerts } = jobAlerts(many, '2026-10-01T00:00:00.000Z');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe(`${MAX_AT_ONCE + 1} Job results`);
    expect(alerts[0].jobId).toBe(null);
  });
});

describe('spaceAlerts', () => {
  const MEMBER_A = 'a'.repeat(32);
  const MEMBER_B = 'b'.repeat(32);
  const n1 = makeNotice({ id: '00000000a-00000001', memberId: MEMBER_A, from: 'Ada', title: 'Bins', body: 'Out tonight' });
  const n2 = makeNotice({ id: '00000000b-00000002', memberId: MEMBER_B, from: 'Me', title: 'Mine', body: 'x' });

  it('starts from the newest the first time', () => {
    const res = spaceAlerts([n1, n2], null, { spaceName: 'Home', memberId: MEMBER_B });
    expect(res.alerts).toEqual([]);
    expect(res.since).toBe(n2.id);
  });

  it('shows other members’ notices with the Space’s name, never this member’s own', () => {
    const res = spaceAlerts([n1, n2], '000000000-00000000', { spaceName: 'Home', memberId: MEMBER_B });
    expect(res.alerts).toEqual([{ title: 'Home · Bins', body: 'Out tonight · from Ada' }]);
  });
});

describe('promptNeedsAlert', () => {
  it('alerts unless the window is in front with the tab showing', () => {
    expect(promptNeedsAlert({ winFocused: true, tabActive: true })).toBe(false);
    expect(promptNeedsAlert({ winFocused: false, tabActive: true })).toBe(true);
    expect(promptNeedsAlert({ winFocused: true, tabActive: false })).toBe(true);
    expect(promptNeedsAlert({ winFocused: true, winMinimized: true, tabActive: true })).toBe(true);
    expect(promptNeedsAlert({ winFocused: true, winVisible: false, tabActive: true })).toBe(true);
  });
});

describe('prompt text', () => {
  const desc = (permission, permOpts = {}) =>
    renderPermDesc({
      html: textTag,
      bg: null,
      url: 'https://example.com/',
      permId: permission.split(':')[0],
      permParam: permission.split(':').slice(1).join(':'),
      permOpts,
    });

  it('turns the prompt’s description into one line of text', () => {
    expect(promptText(desc('notifications'))).toBe('Create desktop notifications');
    expect(promptText(desc('aiSendData:api.example.com'))).toMatch(/^Send a request to api\.example\.com\. It has read/);
    const plan = promptText(desc('aiPagePlan', { goal: 'Book a table', steps: [{ what: 'Click “Book”' }, { what: 'Type 2' }] }));
    expect(plan).toMatch(/^Let the AI assistant do this plan: Book a table · Click “Book” · Type 2/);
    expect(plan).not.toMatch(/</);
    expect(promptText(desc('modifyDrive:hyper://abc/', { title: 'My site' }))).toBe('Write files to My site');
  });

  it('names the site, and says when the AI asks', () => {
    expect(promptAlert({ url: 'https://news.example.com/x', desc: 'Know your location' })).toEqual({
      title: 'news.example.com is asking for permission',
      body: 'Know your location',
    });
    expect(promptAlert({ url: 'https://shop.example/', desc: 'Let the AI assistant click “Buy”', ai: true })).toEqual({
      title: 'The AI is waiting for your answer',
      body: 'Let the AI assistant click “Buy” (shop.example)',
    });
    expect(promptAlert({ url: 'nope', desc: '' }).title).toBe('A site is asking for permission');
  });

  it('siteOf', () => {
    expect(siteOf('nomad://library/jobs')).toBe('nomad://library');
    expect(siteOf('hyper://private/x')).toBe('your private drive');
    expect(siteOf('hyper://' + 'a'.repeat(64) + '/')).toBe('hyper://aaaaaa…');
  });
});

describe('parseMarks', () => {
  it('reads the JSON setting, and anything else as none', () => {
    expect(parseMarks('{"lib":"x"}')).toEqual({ lib: 'x' });
    expect(parseMarks('')).toEqual({});
    expect(parseMarks('[1]')).toEqual({});
    expect(parseMarks('{')).toEqual({});
  });
});
