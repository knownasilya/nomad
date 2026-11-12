import { describe, it, expect } from 'vitest';
import {
  SOURCES,
  SOURCE_NAMES,
  liveArgs,
  refreshSeconds,
  MIN_REFRESH,
  MAX_REFRESH,
  hyperUrl,
  eventsResult,
  jobsResult,
  jobRunsResult,
  findJob,
  notesResult,
  fileResult,
  folderResult,
  parseCsv,
  urlsIn,
  agoText,
  untilText,
  time12,
  isFolderStat,
  sourcesGuide,
} from '../../shared/home-live.mjs';
import { parseGenUi, parseProgram, evaluateProgram } from '../../app/lib/genui/parse.mjs';
import { programError } from '../../app/bg/ai/genui-page.js';
import { genuiLivePrompt } from '../../app/lib/genui/library.mjs';
import { dashboardGuide, CAPABILITIES } from '../../app/bg/ai/search-execute.mjs';
import { VAULT_TOOL_PERMS, LIVE_SOURCE_PERMS } from '../../app/bg/ai/vault-tools.mjs';
import { readsPrivate } from '../../app/bg/ai/egress.mjs';

const NOW = Date.parse('2026-11-12T15:00:00Z');

describe('liveArgs', () => {
  it('fills defaults, rounds and clamps numbers, and drops unknown arguments', () => {
    expect(liveArgs('events', {})).toEqual({ days: 1, limit: 8 });
    expect(liveArgs('events', { days: 99, limit: 2.6, color: 'red' })).toEqual({ days: 42, limit: 3 });
    expect(liveArgs('events', { days: 0 })).toEqual({ days: 1, limit: 8 });
    expect(liveArgs('jobRuns', { job: '  Morning briefing ' })).toEqual({ job: 'Morning briefing', limit: 5 });
    expect(liveArgs('notes', null)).toEqual({ limit: 5 });
  });

  it('needs a hyper:// address for a drive', () => {
    expect(() => liveArgs('driveFile', {})).toThrow(/needs `url`/);
    expect(() => liveArgs('driveFile', { url: 'https://example.com/a.json' })).toThrow(/hyper:\/\//);
    expect(liveArgs('driveFolder', { url: 'hyper://abc' })).toEqual({ url: 'hyper://abc/', limit: 10 });
    expect(hyperUrl('hyper://private/notes/list.csv')).toBe('hyper://private/notes/list.csv');
    expect(hyperUrl('hyper://a b/')).toBe(null);
  });

  it('names the sources when one is unknown', () => {
    expect(() => liveArgs('weather', {})).toThrow(/events, jobs, jobRuns, notes, driveFile, driveFolder/);
    expect(() => liveArgs('toString', {})).toThrow(/no live source/);
  });
});

describe('refreshSeconds', () => {
  it("keeps a Query's interval in range, or gives the source's own", () => {
    expect(refreshSeconds('events', 5)).toBe(MIN_REFRESH);
    expect(refreshSeconds('events', 10 ** 9)).toBe(MAX_REFRESH);
    expect(refreshSeconds('events', 900)).toBe(900);
    expect(refreshSeconds('events', undefined)).toBe(SOURCES.events.refresh);
    expect(refreshSeconds('driveFile', null)).toBe(SOURCES.driveFile.refresh);
    expect(refreshSeconds('nope', undefined)).toBe(0);
  });
});

describe('words', () => {
  it('reads times on a 12-hour clock and ages in words', () => {
    expect(time12('09:05')).toBe('9:05 AM');
    expect(time12('00:30')).toBe('12:30 AM');
    expect(time12('12:00')).toBe('12:00 PM');
    expect(time12('18:45')).toBe('6:45 PM');
    expect(agoText('2026-11-12T14:59:10Z', NOW)).toBe('just now');
    expect(agoText('2026-11-12T14:58:30Z', NOW)).toBe('1 min ago');
    expect(agoText('2026-11-12T14:55:00Z', NOW)).toBe('5 min ago');
    expect(agoText('2026-11-12T12:00:00Z', NOW)).toBe('3 h ago');
    expect(agoText('2026-11-10T15:00:00Z', NOW)).toBe('2 days ago');
    expect(agoText('2026-10-01T15:00:00Z', NOW)).toBe('2026-10-01');
    expect(untilText('2026-11-12T17:00:00Z', NOW)).toBe('in 2 h');
    expect(untilText('2026-11-12T14:00:00Z', NOW)).toBe('');
  });
});

describe('eventsResult', () => {
  const occ = [
    { id: 'a', title: 'Standup', start: '2026-11-12T09:00', end: '2026-11-12T09:15', allDay: false },
    { id: 'b', title: 'Dentist', start: '2026-11-12T16:30', end: '2026-11-12T17:00', allDay: false, location: 'Main St' },
    { id: 'c', title: 'Recycling day', start: '2026-11-12', end: '2026-11-12', allDay: true },
    { id: 'd', title: 'Book club', start: '2026-11-13T19:00', end: '2026-11-13T21:00', allDay: false, feed: { name: 'Library' } },
  ];

  it("today's events that haven't ended, the all-day ones first", () => {
    const r = eventsResult(occ, '2026-11-12T10:00', { days: 1, limit: 8 });
    expect(r.label).toBe('Today');
    expect(r.count).toBe(2);
    expect(r.items.map((e) => e.title)).toEqual(['Recycling day', 'Dentist']);
    expect(r.items[0]).toMatchObject({ time: 'All day', when: 'Today, all day', allDay: true });
    expect(r.items[1]).toMatchObject({
      time: '4:30 PM',
      end: '5:00 PM',
      when: 'Today, 4:30 PM–5:00 PM',
      location: 'Main St',
      url: 'nomad://calendar/?day=2026-11-12',
    });
  });

  it('more days, and a limit', () => {
    const r = eventsResult(occ, '2026-11-12T10:00', { days: 7, limit: 8 });
    expect(r.label).toBe('Next 7 days');
    expect(r.items.map((e) => e.title)).toEqual(['Recycling day', 'Dentist', 'Book club']);
    expect(r.items[2]).toMatchObject({ dayLabel: 'Tomorrow', calendar: 'Library' });
    expect(eventsResult(occ, '2026-11-12T10:00', { days: 7, limit: 1 }).count).toBe(1);
  });
});

describe('Jobs', () => {
  const jobs = [
    { id: 'job1aaaaaa', title: 'Morning briefing', enabled: true, schedule: { kind: 'daily', times: ['07:00'] }, nextRunAt: '2026-11-13T07:00:00Z', lastRun: { status: 'ok', output: 'Sunny, 18°.', finishedAt: '2026-11-12T07:01:00Z' } },
    { id: 'job2bbbbbb', title: 'Price watch', enabled: true, schedule: { kind: 'interval', minutes: 60 }, nextRunAt: '2026-11-12T16:00:00Z', running: true, lastRun: null },
    { id: 'job3cccccc', title: 'Paused one', enabled: false, schedule: null, nextRunAt: null, lastRun: { status: 'error', error: 'No network', finishedAt: '2026-11-11T07:00:00Z' } },
  ];
  const runs = [
    { jobId: 'job1aaaaaa', title: 'Morning briefing', status: 'ok', output: 'Sunny, 18°.\n\nThree meetings.', startedAt: '2026-11-12T07:00:00Z', finishedAt: '2026-11-12T07:01:00Z' },
    { jobId: 'job1aaaaaa', title: 'Morning briefing', status: 'ok', output: 'Rain.', startedAt: '2026-11-11T07:00:00Z', finishedAt: '2026-11-11T07:01:00Z' },
    { jobId: 'job3cccccc', title: 'Paused one', status: 'error', error: 'No network', startedAt: '2026-11-11T06:59:00Z', finishedAt: '2026-11-11T07:00:00Z' },
  ];

  it('lists Jobs running first, then by their next time', () => {
    const r = jobsResult(jobs, { limit: 5 }, NOW);
    expect(r.items.map((j) => j.title)).toEqual(['Price watch', 'Morning briefing', 'Paused one']);
    expect(r.running).toBe(1);
    expect(r.items[1]).toMatchObject({ next: 'in 16 h', lastStatus: 'ok', lastAgo: '7 h ago', url: 'nomad://library/jobs?id=job1aaaaaa' });
    expect(r.items[2]).toMatchObject({ enabled: false, next: '', lastStatus: 'error', when: 'By hand' });
  });

  it("finds a Job by id or title, and gives its runs newest first with `last`", () => {
    expect(findJob(jobs, 'job2bbbbbb').title).toBe('Price watch');
    expect(findJob(jobs, 'morning BRIEFING').id).toBe('job1aaaaaa');
    const r = jobRunsResult(jobs, runs, { job: 'Morning briefing', limit: 5 }, NOW);
    expect(r.job).toMatchObject({ id: 'job1aaaaaa', title: 'Morning briefing' });
    expect(r.count).toBe(2);
    expect(r.last).toMatchObject({ status: 'ok', ok: true, ago: '7 h ago', text: 'Sunny, 18°.\n\nThree meetings.' });
    const all = jobRunsResult(jobs, runs, { limit: 5 }, NOW);
    expect(all.job.title).toBe('All Jobs');
    expect(all.items.map((x) => x.status)).toEqual(['ok', 'ok', 'error']);
    expect(all.items[2].text).toBe('No network');
  });

  it('gives an empty `last` for a Job with no runs or no such Job', () => {
    const r = jobRunsResult(jobs, runs, { job: 'nope', limit: 5 }, NOW);
    expect(r.count).toBe(0);
    expect(r.last).toMatchObject({ status: '', text: '' });
  });
});

describe('notesResult', () => {
  it('the newest Notes, by topic if asked', () => {
    const notes = [
      { id: 'n1aaaaaa', body: '# Groceries\nmilk, eggs', updatedAt: '2026-11-12T14:00:00Z', topics: ['home'] },
      { id: 'n2bbbbbb', body: '# Trip\nLisbon', updatedAt: '2026-11-12T10:00:00Z', topics: ['Travel'] },
    ];
    const r = notesResult(notes, { limit: 5 }, NOW);
    expect(r.items.map((n) => n.title)).toEqual(['Groceries', 'Trip']);
    expect(r.items[0]).toMatchObject({ ago: '1 h ago', topics: ['home'], url: 'nomad://notes/n1aaaaaa' });
    expect(notesResult(notes, { limit: 5, topic: 'travel' }, NOW).items.map((n) => n.title)).toEqual(['Trip']);
  });
});

describe('files', () => {
  it('reads JSON, with its first list as items', () => {
    const r = fileResult('hyper://abc/data/prices.json', JSON.stringify({ updated: 'today', rows: [{ a: 1 }, { a: 2 }] }));
    expect(r).toMatchObject({ name: 'prices.json', kind: 'json', count: 2 });
    expect(r.data.updated).toBe('today');
    expect(fileResult('hyper://abc/x.json', '[1,2,3]').items).toEqual([1, 2, 3]);
    expect(() => fileResult('hyper://abc/x.json', '{oops')).toThrow(/valid JSON/);
  });

  it('reads CSV into rows keyed by its header, numbers as numbers', () => {
    const r = fileResult('hyper://abc/books.csv', 'title,pages\n"Dune, Part 1",412\nEmma,"300"\n');
    expect(r.columns).toEqual(['title', 'pages']);
    expect(r.items).toEqual([
      { title: 'Dune, Part 1', pages: 412 },
      { title: 'Emma', pages: 300 },
    ]);
    expect(parseCsv('a,"b ""c"""\r\n1,2')).toEqual([
      ['a', 'b "c"'],
      ['1', '2'],
    ]);
  });

  it('reads text, with its lines as items', () => {
    const r = fileResult('hyper://abc/todo.md', '# Todo\n\n- milk\n- eggs\n');
    expect(r.kind).toBe('text');
    expect(r.items).toEqual(['# Todo', '- milk', '- eggs']);
  });

  it('lists a folder newest first, hidden files left out', () => {
    const entries = [
      { name: 'old.md', stat: { mode: 32768, size: 2048, mtime: Date.parse('2026-11-01T00:00:00Z') } },
      { name: 'photos', stat: { mode: 16384, size: 0, mtime: 0 } },
      { name: 'new file.md', stat: { mode: 32768, size: 10, mtime: Date.parse('2026-11-12T14:00:00Z') } },
      { name: '.hidden', stat: { mode: 32768, size: 1, mtime: NOW } },
    ];
    const r = folderResult('hyper://abc/notes', entries, { limit: 10 }, NOW);
    expect(r.items.map((e) => e.name)).toEqual(['new file.md', 'old.md', 'photos']);
    expect(r.items[0]).toMatchObject({ folder: false, size: '10 B', ago: '1 h ago', url: 'hyper://abc/notes/new%20file.md' });
    expect(r.items[2]).toMatchObject({ folder: true, url: 'hyper://abc/notes/photos/' });
    expect(isFolderStat({ isDirectory: () => true })).toBe(true);
  });
});

describe('urlsIn', () => {
  it("collects the data's own links", () => {
    const urls = urlsIn([{ items: [{ url: 'nomad://notes/a' }, { url: 'hyper://x/y' }], last: { url: 'z' } }]);
    expect([...urls].sort()).toEqual(['hyper://x/y', 'nomad://notes/a', 'z']);
  });
});

const CARD = `root = Stack([head, list], "column", "s")
today = Query("events", {days: 1, limit: 5}, {items: [], count: 0}, 300)
head = CardHeader("Today", today.count == 0 ? "Nothing on" : today.count + " events", "calendar-day")
list = List(@Each(today.items, "e", ListItem(e.title, e.time, null, null, e.url)), "divided")`;

describe('a live program', () => {
  it('parses its Queries, and draws their defaults with no answer', () => {
    const p = parseProgram(CARD);
    expect(p.queries).toEqual([
      { id: 'today', tool: 'events', args: { days: 1, limit: 5 }, defaults: { items: [], count: 0 }, refresh: 300, complete: true },
    ]);
    const root = evaluateProgram(p);
    expect(root.props.children[0].props.subtitle).toBe('Nothing on');
    expect(root.props.children[1].props.items).toEqual([]);
    expect(parseGenUi(CARD).root.props.children[0].props.subtitle).toBe('Nothing on');
  });

  it('draws the data when a Query is answered', () => {
    const p = parseProgram(CARD);
    const data = { items: [{ title: 'Dentist', time: '4:30 PM', url: 'nomad://calendar/?day=2026-11-12' }], count: 1 };
    const root = evaluateProgram(p, (id) => (id === 'today' ? data : undefined));
    expect(root.props.children[0].props.subtitle).toBe('1 events');
    expect(root.props.children[1].props.items[0].props).toMatchObject({ title: 'Dentist', description: '4:30 PM', url: 'nomad://calendar/?day=2026-11-12' });
  });

  it('is kept only when every Query names a source', () => {
    expect(programError(CARD)).toBe('');
    expect(programError(CARD.replace('"events"', '"weather"'))).toMatch(/Query today: There is no live source "weather"/);
    expect(programError(CARD.replace('{days: 1, limit: 5}', '{}').replace('"events"', '"driveFile"'))).toMatch(/needs `url`/);
  });
});

describe('the model', () => {
  it('reads about live cards in guide:dashboard', () => {
    const g = dashboardGuide().markdown;
    expect(g).toContain('### Live cards — Query');
    for (const name of SOURCE_NAMES) expect(g).toContain('`' + name + '`');
    expect(g).toContain('@Each(');
    expect(sourcesGuide()).toContain('Returns {items:');
    expect(genuiLivePrompt()).toContain('Ternary');
  });

  it('previews a source with dashboardRead and the source\'s own permission, as a private read', () => {
    const cap = CAPABILITIES.find((c) => c.name === 'previewLiveData');
    expect(cap.gates).toEqual({ personal: true });
    expect(VAULT_TOOL_PERMS.previewLiveData).toBe('dashboardRead');
    expect(LIVE_SOURCE_PERMS).toEqual({ events: 'calendarRead', jobs: 'jobsRead', jobRuns: 'jobsRead', notes: 'notesRead' });
    expect(readsPrivate('previewLiveData')).toBe(true);
  });

  it('every example in the guide is a program the page keeps', () => {
    const g = dashboardGuide().markdown;
    const blocks = [...g.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]).filter((b) => b.includes('Query('));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) expect(programError(b)).toBe('');
  });
});
