import { describe, it, expect } from 'vitest';
import {
  dashboard,
  notifications,
  waiting,
  dismiss,
  isDismissed,
  DISMISSED_TYPE,
  jobsOverview,
  upcomingEvents,
  latestNotes,
  latestAssets,
  dayLabel,
  greeting,
  addDays,
} from '../../shared/home-dashboard.mjs';

const NOW = Date.parse('2026-11-09T16:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

const run = (id, jobId, finishedAt, extra = {}) => ({
  type: 'nomad/job-run',
  id: 'run-' + id,
  jobId: 'job-' + jobId,
  title: 'Job ' + jobId,
  device: null,
  trigger: 'schedule',
  startedAt: finishedAt,
  finishedAt,
  status: 'ok',
  output: '',
  notification: null,
  ...extra,
});

describe('dayLabel and greeting', () => {
  it('names today, tomorrow and yesterday, and other days by date', () => {
    expect(dayLabel('2026-11-09', '2026-11-09')).toBe('Today');
    expect(dayLabel('2026-11-10', '2026-11-09')).toBe('Tomorrow');
    expect(dayLabel('2026-11-08', '2026-11-09')).toBe('Yesterday');
    expect(dayLabel('2026-11-12', '2026-11-09')).toBe('Thu 12 Nov');
    expect(dayLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow');
    expect(dayLabel('nope', '2026-11-09')).toBe('');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('greets by the hour of the wall time', () => {
    expect(greeting('2026-11-09T08:15')).toBe('Good morning');
    expect(greeting('2026-11-09T13:00')).toBe('Good afternoon');
    expect(greeting('2026-11-09T21:40')).toBe('Good evening');
    expect(greeting('2026-11-09T02:00')).toBe('Good evening');
    expect(greeting(undefined)).toBe('Hello');
  });
});

describe('notifications', () => {
  it('shows each Job’s newest result with a notification, and failures, newest first', () => {
    const runs = [
      run('r1', 'ja', hoursAgo(5), { notification: { title: 'Old', body: '' } }),
      run('r2', 'ja', hoursAgo(1), { notification: { title: 'Weather', body: 'Rain at 3' } }),
      run('r3', 'jb', hoursAgo(2), { status: 'error', error: 'No network' }),
      run('r4', 'jc', hoursAgo(3)), // no notification: nothing to show
      run('r5', 'jd', hoursAgo(24 * 8), { notification: { title: 'Too old', body: '' } }),
      run('r6', 'je', hoursAgo(4), { status: 'ok', stopped: true }),
    ];
    const list = notifications({ runs }, { now: NOW });
    expect(list.map((n) => [n.kind, n.title])).toEqual([
      ['job', 'Weather'],
      ['failed', 'Job jb'],
    ]);
    expect(list[0]).toMatchObject({ body: 'Rain at 3', jobId: 'job-ja', url: 'nomad://library/jobs?id=job-ja' });
    expect(list[1].body).toBe('No network');
  });

  it('shows other members’ notices, never this person’s own', () => {
    const notices = [
      { type: 'nomad/space-notice', id: 'n1', memberId: 'me', from: 'Me', title: 'Mine', body: '', at: hoursAgo(1) },
      { type: 'nomad/space-notice', id: 'n2', memberId: 'sam', from: 'Sam', title: '', body: 'Milk is low', at: hoursAgo(2) },
    ];
    const list = notifications({ notices, memberId: 'me', spaceName: 'Home' }, { now: NOW });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'space', title: 'Home', body: 'Milk is low', from: 'Sam' });
  });

  it('shows Conversations with unread Messages, not requests', () => {
    const conversations = [
      { personaId: 'p1', other: 'hyper://a/', unread: 2, request: false, title: 'Ana', last: { message: { createdAt: hoursAgo(0.5), text: 'Lunch?' } } },
      { personaId: 'p1', other: 'hyper://b/', unread: 0, request: false, title: 'Bo', last: { message: { createdAt: hoursAgo(0.2), text: 'ok' } } },
      { personaId: 'p1', other: 'hyper://c/', unread: 1, request: true, title: 'Cy', last: { message: { createdAt: hoursAgo(0.1), text: 'hi' } } },
    ];
    const list = notifications({ conversations }, { now: NOW });
    expect(list).toEqual([
      expect.objectContaining({
        kind: 'message',
        title: '2 new messages from Ana',
        body: 'Lunch?',
        personaId: 'p1',
        with: 'hyper://a/',
        url: 'nomad://messages/?persona=p1&with=hyper%3A%2F%2Fa%2F',
      }),
    ]);
  });

  it('keeps at most `max`', () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      run('r' + i, 'j' + i, hoursAgo(i + 1), { notification: { title: 'N' + i, body: '' } })
    );
    expect(notifications({ runs }, { now: NOW, max: 3 }).map((n) => n.title)).toEqual(['N0', 'N1', 'N2']);
  });
});

describe('clearing notifications', () => {
  const runs = [
    run('r1', 'ja', hoursAgo(1), { notification: { title: 'Weather', body: '' } }),
    run('r2', 'jb', hoursAgo(2), { notification: { title: 'Digest', body: '' } }),
    run('r0', 'jb', hoursAgo(5), { notification: { title: 'Older digest', body: '' } }),
  ];
  const convo = (at) => ({ personaId: 'p1', other: 'hyper://a/', unread: 1, request: false, title: 'Ana', last: { message: { createdAt: at, text: 'hi' } } });

  it('hides a cleared one, and doesn’t bring back an older result of the same Job', () => {
    const rec = dismiss(null, [{ id: 'run:run-r2', at: hoursAgo(2) }], { now: NOW });
    expect(rec.type).toBe(DISMISSED_TYPE);
    const list = notifications({ runs }, { now: NOW, dismissed: rec });
    expect(list.map((n) => n.title)).toEqual(['Weather']);
  });

  it('shows a Conversation again when a newer Message comes', () => {
    const rec = dismiss(null, [{ id: 'message:p1:hyper://a/', at: hoursAgo(3) }], { now: NOW });
    expect(notifications({ conversations: [convo(hoursAgo(3))] }, { now: NOW, dismissed: rec })).toEqual([]);
    expect(notifications({ conversations: [convo(hoursAgo(1))] }, { now: NOW, dismissed: rec })).toHaveLength(1);
    expect(isDismissed({ id: 'x', at: hoursAgo(1) }, null)).toBe(false);
  });

  it('drops entries too old to show and ignores junk', () => {
    const old = { items: { 'run:old': hoursAgo(24 * 9), 'run:new': hoursAgo(1) } };
    const rec = dismiss(old, [{ id: 'run:x', at: hoursAgo(2) }, { id: 5 }, null], { now: NOW });
    expect(Object.keys(rec.items).sort()).toEqual(['run:new', 'run:x']);
  });

  it('Clear all uses every uncleared key, not only the ones shown', () => {
    const many = Array.from({ length: 9 }, (_, i) => run('m' + i, 'k' + i, hoursAgo(i + 1), { notification: { title: 'N' + i, body: '' } }));
    const d = dashboard({ runs: many }, { now: '2026-11-09T16:00', at: NOW });
    expect(d.notifications).toHaveLength(6);
    expect(d.notificationKeys).toHaveLength(9);
    const after = dashboard({ runs: many, dismissed: dismiss(null, d.notificationKeys, { now: NOW }) }, { now: '2026-11-09T16:00', at: NOW });
    expect(after.notifications).toEqual([]);
  });
});

describe('waiting', () => {
  it('lists what waits on the person, oldest first', () => {
    const list = waiting({
      prompts: [{ id: 7, title: 'The AI is waiting for your answer', body: 'Read your notes?', ai: true, at: hoursAgo(0.1), tabTitle: 'Inbox' }],
      driveRequests: [{ drive: 'ab'.repeat(32), title: 'Recipes', writerKey: 'w1', requestedAt: hoursAgo(3) }],
      spaceRequests: [{ drive: 'cd'.repeat(32), writerKey: 'w2', name: 'Sam', title: 'Budget', note: 'to fix a typo', canApprove: true, requestedAt: hoursAgo(2) }],
      joins: [{ memberId: 'm1', name: 'Kim', role: 'editor', requestedAt: hoursAgo(1) }],
      devices: [{ deviceKey: 'dk', name: 'Pixel', platform: 'android', requestedAt: hoursAgo(0.5) }],
      conversations: [
        { personaId: 'p1', other: 'hyper://c/', unread: 1, request: true, title: 'Cy', last: { message: { createdAt: hoursAgo(0.2), text: 'hi' } } },
        { personaId: 'p1', other: 'hyper://a/', unread: 2, request: false, title: 'Ana', last: { message: { createdAt: hoursAgo(0.3), text: 'x' } } },
      ],
      spaceName: 'Home',
    });
    expect(list.map((w) => [w.kind, w.title])).toEqual([
      ['drive', 'Someone asks to write to Recipes'],
      ['edit', 'Sam asks to edit Budget'],
      ['join', 'Kim asks to join Home'],
      ['device', 'Pixel asks to join your devices'],
      ['message-request', 'Cy wants to message you'],
      ['prompt', 'The AI is waiting for your answer'],
    ]);
    expect(list[0]).toMatchObject({ drive: 'ab'.repeat(32), writerKey: 'w1', url: 'hyper://' + 'ab'.repeat(32) + '/' });
    expect(list[1]).toMatchObject({ body: '“to fix a typo”', canApprove: true, url: 'nomad://library/sharing' });
    expect(list[2]).toMatchObject({ memberId: 'm1', body: 'As someone who can edit.' });
    expect(list[3].url).toBe('nomad://settings/?view=devices');
    expect(list[5]).toMatchObject({ promptId: 7, ai: true, tabTitle: 'Inbox' });
  });

  it('shows a Job whose newest run wanted sites, until a later run doesn’t', () => {
    const runs = [
      run('a1', 'ja', hoursAgo(2), { needs: [{ site: 'example.com' }, { site: 'shop.com', control: true }] }),
      run('b1', 'jb', hoursAgo(3), { needs: [{ site: 'old.com' }] }),
      run('b2', 'jb', hoursAgo(1)),
      run('c1', 'gone', hoursAgo(1), { needs: [{ site: 'x.com' }] }),
    ];
    const jobs = [{ id: 'job-ja' }, { id: 'job-jb' }];
    const list = waiting({ runs, jobs });
    expect(list).toEqual([
      expect.objectContaining({ kind: 'job-needs', title: 'Job ja wants to open example.com and 1 more', jobId: 'job-ja', url: 'nomad://library/jobs?id=job-ja' }),
    ]);
  });
});

describe('jobsOverview', () => {
  const jobs = [
    { id: 'j1', title: 'Digest', enabled: true, nextRunAt: '2026-11-10T08:00:00.000Z' },
    { id: 'j2', title: 'Backup', enabled: true, nextRunAt: '2026-11-09T18:00:00.000Z', running: true },
    { id: 'j3', title: 'Prices', enabled: true, nextRunAt: '2026-11-09T17:00:00.000Z' },
    { id: 'j4', title: 'Paused', enabled: false, nextRunAt: null },
    { id: 'j5', title: 'Waiting', enabled: true, nextRunAt: '2026-11-09T16:00:00.000Z', queued: true },
    { id: 'j6', title: 'By hand', enabled: true, nextRunAt: null },
  ];

  it('lists running Jobs first, then queued ones, then the next ones soonest first', () => {
    const o = jobsOverview(jobs);
    expect(o.running.map((j) => [j.id, j.queued])).toEqual([
      ['j2', false],
      ['j5', true],
    ]);
    expect(o.next.map((j) => j.id)).toEqual(['j3', 'j1']);
    expect(o.next[0]).toMatchObject({ at: '2026-11-09T17:00:00.000Z', url: 'nomad://library/jobs?id=j3' });
    expect(o.total).toBe(6);
    expect(o.paused).toBe(1);
  });
});

describe('upcomingEvents', () => {
  const occ = [
    { id: 'e1', title: 'Breakfast', start: '2026-11-09T08:00', end: '2026-11-09T09:00', allDay: false, feed: null },
    { id: 'e2', title: 'Standup', start: '2026-11-09T15:30', end: '2026-11-09T16:30', allDay: false, feed: null },
    { id: 'e3', title: 'Dinner', start: '2026-11-09T19:00', end: '2026-11-09T21:00', allDay: false, location: 'Home', feed: null },
    { id: 'e4', title: 'Trip', start: '2026-11-08', end: '2026-11-10', allDay: true, feed: null },
    { id: 'e5', title: 'School play', start: '2026-11-11T18:00', allDay: false, feed: { name: 'School', color: '#f00' } },
    { id: 'e6', title: 'Holiday', start: '2026-11-07', end: '2026-11-07', allDay: true, feed: null },
  ];

  it('leaves out what ended, marks what is on now, and puts all-day first in a day', () => {
    const list = upcomingEvents(occ, '2026-11-09T16:00');
    expect(list.map((e) => [e.id, e.dayLabel, e.ongoing])).toEqual([
      ['e4', 'Today', true],
      ['e2', 'Today', true],
      ['e3', 'Today', false],
      ['e5', 'Wed 11 Nov', false],
    ]);
    expect(list[0]).toMatchObject({ day: '2026-11-09', url: 'nomad://calendar/?day=2026-11-09' });
    expect(list[2].location).toBe('Home');
    expect(list[3]).toMatchObject({ feed: 'School', color: '#f00' });
  });

  it('shows nothing without a wall time', () => {
    expect(upcomingEvents(occ, null)).toEqual([]);
  });
});

describe('latest Notes and Assets', () => {
  it('lists Notes newest first with a title and a snippet', () => {
    const notes = [
      { id: 'n1', body: '# Groceries\n- milk\n- eggs', updatedAt: '2026-11-08T10:00:00Z' },
      { id: 'n2', body: 'Ideas\nA dashboard', updatedAt: '2026-11-09T10:00:00Z' },
      { id: 'n3', title: 'From the phone', snippet: 'already worked out', body: '', updatedAt: '2026-11-07T10:00:00Z' },
    ];
    const list = latestNotes(notes);
    expect(list.map((n) => [n.id, n.title])).toEqual([
      ['n2', 'Ideas'],
      ['n1', 'Groceries'],
      ['n3', 'From the phone'],
    ]);
    expect(list[0].snippet).toBe('A dashboard');
    expect(list[0].url).toBe('nomad://notes/n2');
  });

  it('lists Assets newest first', () => {
    const assets = [
      { id: 'aold1234-abcd', name: 'a.jpg', kind: 'image', addedAt: '2026-11-01T00:00:00Z', thumb: true },
      { id: 'anew1234-abcd', name: 'b.pdf', kind: 'pdf', addedAt: '2026-11-09T00:00:00Z' },
    ];
    const list = latestAssets(assets);
    expect(list.map((a) => a.id)).toEqual(['anew1234-abcd', 'aold1234-abcd']);
    expect(list[1]).toMatchObject({ thumb: true, url: 'nomad://assets/?id=aold1234-abcd' });
  });
});

describe('dashboard', () => {
  it('builds every section, and copes with nothing', () => {
    const empty = dashboard({}, { now: '2026-11-09T16:00', at: NOW });
    expect(empty).toMatchObject({
      greeting: 'Good afternoon',
      waiting: [],
      notifications: [],
      notificationKeys: [],
      jobs: { running: [], next: [], total: 0, paused: 0 },
      events: [],
      notes: [],
      assets: [],
      unreadMessages: 0,
    });
    const d = dashboard(
      {
        conversations: [
          { personaId: 'p', other: 'hyper://a/', unread: 3, title: 'A', last: { message: { createdAt: hoursAgo(1), text: '' } } },
          { personaId: 'p', other: 'hyper://b/', unread: 2, request: true, title: 'B', last: { message: { createdAt: hoursAgo(1), text: '' } } },
        ],
      },
      { now: '2026-11-09T16:00', at: NOW }
    );
    expect(d.unreadMessages).toBe(3);
    expect(d.notifications).toHaveLength(1);
    expect(d.waiting.map((w) => w.kind)).toEqual(['message-request']);
  });
});
