// The desktop's OS notifications (app/bg/ui/desktop-notifications.js): Job results from the Vault, a
// shared Space's notices, and a permission prompt nobody sees. Electron is faked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const shown = [];
const settings = new Map();
const bounces = { started: 0, cancelled: 0 };
let focusedWindow = null;
let runs = [];
let notices = null;
let hook = null;
const activated = [];

class FakeNotification extends EventEmitter {
  static isSupported() {
    return true;
  }
  constructor(opts) {
    super();
    this.opts = opts;
    this.closed = false;
  }
  show() {
    shown.push(this);
  }
  close() {
    this.closed = true;
  }
}

vi.mock('electron', () => ({
  Notification: FakeNotification,
  BrowserWindow: { getFocusedWindow: () => focusedWindow },
  app: {
    dock: {
      bounce: () => ++bounces.started,
      cancelBounce: () => bounces.cancelled++,
    },
  },
}));
vi.mock('../../app/bg/logger', () => ({ get: () => ({ child: () => ({ warn: () => {} }) }) }));
vi.mock('../../app/bg/dbs/settings', () => ({
  get: async (k) => settings.get(k),
  set: async (k, v) => void settings.set(k, v),
}));
const jobEvents = new EventEmitter();
vi.mock('../../app/bg/ai/jobs', () => ({ events: jobEvents, allRuns: () => runs }));
const spaceEvents = new EventEmitter();
vi.mock('../../app/bg/hyper/space-library', () => ({ events: spaceEvents, notices: async () => notices }));
vi.mock('../../app/bg/ui/permissions', () => ({ setPromptHook: (fn) => (hook = fn) }));
vi.mock('../../app/bg/ui/tabs/manager', () => ({ setActive: (win, tab) => activated.push([win.id, tab.id]) }));
// Whether the user is on another of their Devices right now (bg/ui/device-activity.js).
let here = true;
vi.mock('../../app/bg/ui/device-activity', () => ({ notifyHere: () => here }));

const dn = await import('../../app/bg/ui/desktop-notifications.js');
const opened = [];
dn.setup({ openUrl: (url) => opened.push(url) });

const run = (id, finishedAt, title) => ({
  type: 'nomad/job-run',
  id,
  jobId: 'job-0001',
  finishedAt,
  notification: title ? { title, body: 'Body' } : null,
});
const fakeWin = (o = {}) =>
  Object.assign(new EventEmitter(), {
    id: 3,
    focused: false,
    isDestroyed: () => false,
    isFocused() {
      return this.focused;
    },
    isVisible: () => true,
    isMinimized: () => false,
    restore() {},
    show() {},
    focus() {},
    flashing: false,
    flashFrame(on) {
      this.flashing = on;
    },
    ...o,
  });
const settle = () => new Promise((r) => setTimeout(r, 650));

beforeEach(() => {
  shown.length = 0;
  opened.length = 0;
  activated.length = 0;
  focusedWindow = null;
});

describe('desktop notifications', () => {
  it('wires itself into permission prompts', () => {
    expect(typeof hook).toBe('function');
  });

  it('shows a Job’s new runs once, starting from the newest, and a click opens the Job', async () => {
    runs = [run('run-0001', '2026-11-01T08:00:00.000Z', 'Old')];
    jobEvents.emit('changed');
    await settle();
    expect(shown).toEqual([]); // the first look only sets the mark
    runs = [...runs, run('run-0002', '2026-11-02T08:00:00.000Z', 'Digest')];
    jobEvents.emit('changed');
    jobEvents.emit('changed');
    await settle();
    expect(shown.map((n) => n.opts.title)).toEqual(['Digest']);
    shown[0].emit('click');
    expect(opened).toEqual(['nomad://library/jobs?id=job-0001']);
    jobEvents.emit('changed');
    await settle();
    expect(shown).toHaveLength(1);
  });

  it('keeps the mark but shows nothing with Job notifications off', async () => {
    settings.set('notify_jobs', 0);
    runs = [...runs, run('run-0003', '2026-11-03T08:00:00.000Z', 'Quiet')];
    jobEvents.emit('changed');
    await settle();
    expect(shown).toEqual([]);
    expect(settings.get('job_notify_since')).toBe('2026-11-03T08:00:00.000Z');
    settings.delete('notify_jobs');
  });

  it('keeps the mark but shows nothing while the user is on another Device', async () => {
    here = false;
    runs = [...runs, run('run-0004', '2026-11-04T08:00:00.000Z', 'On the phone')];
    jobEvents.emit('changed');
    await settle();
    expect(shown).toEqual([]);
    expect(settings.get('job_notify_since')).toBe('2026-11-04T08:00:00.000Z');
    here = true;
    jobEvents.emit('changed');
    await settle();
    expect(shown).toEqual([]); // it isn't shown later either
  });

  it('shows another member’s Space notice', async () => {
    const A = 'a'.repeat(32);
    const notice = (id, title) => ({ type: 'nomad/space-notice', id, memberId: A, from: 'Ada', title, body: 'x', at: 'now' });
    notices = { library: 'lib1', memberId: 'b'.repeat(32), name: 'Home', list: [notice('00000000a-00000001', 'Old')] };
    spaceEvents.emit('changed', { space: 's1' });
    await settle();
    expect(shown).toEqual([]);
    notices.list.push(notice('00000000b-00000002', 'Bins'));
    spaceEvents.emit('changed', { space: 's1' });
    await settle();
    expect(shown.map((n) => n.opts.title)).toEqual(['Home · Bins']);
  });

  it('says nothing for a prompt the user can see', async () => {
    const win = fakeWin({ focused: true });
    const alert = await dn.promptWaiting({ win, tab: { id: 1, isActive: true }, url: 'https://x.test/', desc: 'Do it', ai: true });
    expect(shown).toEqual([]);
    alert.done();
  });

  it('notifies and asks for attention for a prompt behind another app, until it’s answered', async () => {
    const win = fakeWin();
    const tab = { id: 9, isActive: false };
    const alert = await dn.promptWaiting({ win, tab, url: 'https://shop.test/', desc: 'Let the AI assistant click “Buy”', ai: true });
    expect(shown).toHaveLength(1);
    expect(shown[0].opts).toMatchObject({ title: 'The AI is waiting for your answer', body: 'Let the AI assistant click “Buy” (shop.test)' });
    // The dock bounces on macOS; elsewhere the taskbar flashes.
    if (process.platform === 'darwin') expect(bounces.started).toBeGreaterThan(0);
    else expect(win.flashing).toBe(true);
    shown[0].emit('click');
    expect(activated).toEqual([[3, 9]]);
    alert.done();
    expect(shown[0].closed).toBe(true);
    if (process.platform === 'darwin') expect(bounces.cancelled).toBe(1);
    else expect(win.flashing).toBe(false);
  });

  it('stays quiet for prompts with the setting off', async () => {
    settings.set('notify_prompts', 0);
    const alert = await dn.promptWaiting({ win: fakeWin(), tab: { id: 1, isActive: false }, url: 'https://x.test/', desc: 'd' });
    expect(shown).toEqual([]);
    alert.done();
    settings.delete('notify_prompts');
  });

  it('shows a calendar reminder that is due once, and opens its day', async () => {
    const asked = [];
    const due = [{ key: 'e1@2026-11-10T17:00', id: 'e1', title: 'Swim', start: '2026-11-10T17:00', allDay: false, location: 'Pool', at: '2026-11-10T16:00', spaceName: 'Home' }];
    const source = async (from, to) => {
      asked.push([from, to]);
      return asked.length === 1 ? due : [];
    };
    await dn.checkReminders(source);
    expect(shown.map((n) => n.opts.title)).toEqual(['Swim']);
    expect(shown[0].opts.body).toMatch(/5:00 PM · Pool · Home$/);
    shown[0].emit('click');
    expect(opened.at(-1)).toBe('nomad://calendar/?day=2026-11-10');
    // The next look starts where the last one ended, so the same minute isn't asked twice.
    expect(settings.get('calendar_remind_since')).toBe(asked[0][1]);
    await dn.checkReminders(source);
    expect(asked.length === 1 || asked[1][0] === asked[0][1]).toBe(true);
    expect(shown).toHaveLength(1);
    settings.delete('calendar_remind_since');
  });

  it('keeps calendar reminders quiet with the setting off', async () => {
    settings.set('notify_calendar', 0);
    await dn.checkReminders(async () => [{ key: 'k', id: 'e', title: 'T', start: '2026-11-10T17:00', allDay: false, at: '2026-11-10T16:00' }]);
    expect(shown).toEqual([]);
    settings.delete('notify_calendar');
    settings.delete('calendar_remind_since');
  });
});
