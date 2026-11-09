// The live side of a Job run's chat (app/bg/ai/job-chat.js): saved and opened only once someone
// watches, replayed whole to a sidebar that follows late, and named on the run when it was saved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const saved = [];
const opened = [];
vi.mock('../../app/bg/logger', () => ({ get: () => ({ child: () => ({ warn: () => {} }) }) }));
vi.mock('../../app/bg/ai/chat-store', () => ({
  newSessionId: () => `s${saved.length + opened.length}x${Math.random().toString(36).slice(2, 6)}`,
  saveSession: async (sender, id, data) => saved.push({ sender: sender.id, id, data }),
}));
vi.mock('../../app/bg/ui/tabs/manager', () => ({
  openAiSidebarChat: (win, id) => opened.push({ win: win.id, id }),
  emitAiChatsChanged: () => {},
}));

const jobChat = await import('../../app/bg/ai/job-chat.js');
const win = (id) => ({ id, webContents: { id, isDestroyed: () => false } });
const JOB = { id: 'j1', title: 'Digest' };

beforeEach(() => {
  saved.length = 0;
  opened.length = 0;
});

function collect(emitter) {
  const got = [];
  for (const t of ['chunk', 'reasoning', 'tool', 'done']) emitter.on(t, (e) => got.push([t, e]));
  return got;
}

describe('job-chat', () => {
  it('saves nothing for a run nobody watches', async () => {
    const turn = new EventEmitter();
    const chat = await jobChat.open({ job: JOB, prompt: 'Go', emitter: turn, stop: () => {} });
    turn.emit('chunk', { text: 'Hi' });
    expect(await chat.end({})).toBe(null);
    expect(saved).toEqual([]);
    expect(jobChat.isLive(chat.sessionId)).toBe(false);
  });

  it('opens Run with me’s window to the chat, and saves the end before followers finish', async () => {
    const turn = new EventEmitter();
    const chat = await jobChat.open({ job: JOB, prompt: 'Go', emitter: turn, stop: () => {}, watchWin: win(7) });
    expect(opened).toEqual([{ win: 7, id: chat.sessionId }]);
    expect(saved[0].data.job).toEqual({ id: 'j1', title: 'Digest' });
    turn.emit('chunk', { text: 'Three ' });
    // A sidebar that follows late gets everything so far.
    const out = new EventEmitter();
    const got = collect(out);
    const following = jobChat.follow(chat.sessionId, out, null);
    turn.emit('chunk', { text: 'posts.' });
    expect(await chat.end({})).toBe(chat.sessionId);
    await following;
    expect(got.map(([t, e]) => (t === 'chunk' ? e.text : t))).toEqual(['Three ', 'posts.', 'done']);
    expect(saved.at(-1).data.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Three posts.' });
  });

  it('lets the Jobs page watch a run already going, and its Stop ends the run', async () => {
    const turn = new EventEmitter();
    const stop = vi.fn();
    const page = { show: vi.fn(() => true) };
    const chat = await jobChat.open({ job: JOB, prompt: 'Go', emitter: turn, stop, page });
    expect(saved).toEqual([]);
    expect(await jobChat.view('j1', win(3))).toEqual({ running: true, chat: true, page: true });
    expect(opened).toEqual([{ win: 3, id: chat.sessionId }]);
    expect(saved).toHaveLength(1);
    expect(jobChat.stop(chat.sessionId)).toBe(true);
    expect(stop).toHaveBeenCalled();
    await chat.end({ error: 'aborted' });
    expect(saved.at(-1).data.messages.at(-1)).toMatchObject({ content: '_Stopped._' });
    // After it ended, Watch opens the last run's chat and its page.
    opened.length = 0;
    expect(await jobChat.view('j1', win(3))).toEqual({ running: false, chat: true, page: true });
    expect(opened).toEqual([{ win: 3, id: chat.sessionId }]);
  });

  it('shows the Jobs page a live run’s progress, and its Stop says it stopped', async () => {
    const turn = new EventEmitter();
    const stop = vi.fn();
    const seen = [];
    const onProgress = (id) => seen.push(id);
    jobChat.progressEvents.on('progress', onProgress);
    const chat = await jobChat.open({ job: { id: 'j2', title: 'Watch me' }, prompt: 'Go', emitter: turn, stop });
    turn.emit('tool', { phase: 'start', id: 'a', summary: 'Fetching a page' });
    turn.emit('chunk', { text: 'Found it' });
    expect(jobChat.progress('j2')).toMatchObject({
      items: [
        { kind: 'step', summary: 'Fetching a page', state: 'running' },
        { kind: 'text', text: 'Found it' },
      ],
      stopping: false,
      watched: false,
      page: false,
    });
    expect(jobChat.stopJob('j2')).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(jobChat.progress('j2').stopping).toBe(true);
    await chat.end({});
    expect(jobChat.progress('j2')).toBe(null);
    expect(jobChat.stopJob('j2')).toBe(false);
    expect(seen.filter((id) => id === 'j2').length).toBeGreaterThanOrEqual(4);
    jobChat.progressEvents.removeListener('progress', onProgress);
  });

  it('gives a follower the run’s failure', async () => {
    const turn = new EventEmitter();
    const chat = await jobChat.open({ job: JOB, prompt: 'Go', emitter: turn, stop: () => {}, watchWin: win(1) });
    const following = jobChat.follow(chat.sessionId, new EventEmitter(), null);
    await chat.end({ error: 'No runtime' });
    await expect(following).rejects.toThrow('No runtime');
  });

  it('says when someone starts watching, and when the last window following it closes', async () => {
    const turn = new EventEmitter();
    const calls = [];
    const closeable = (id) => {
      const wc = new EventEmitter();
      let gone = false;
      Object.assign(wc, { id, isDestroyed: () => gone });
      return { id, webContents: wc, close: () => ((gone = true), wc.emit('destroyed')) };
    };
    const chat = await jobChat.open({ job: { id: 'j3', title: 'Long' }, prompt: 'Go', emitter: turn, stop: () => {}, onWatch: (on) => calls.push(on) });
    expect(calls).toEqual([]);
    expect(jobChat.progress('j3').watched).toBe(false);
    const a = closeable(21);
    const b = closeable(22);
    await jobChat.view('j3', a);
    await jobChat.view('j3', b);
    // One call for the first window; the second watches too.
    expect(calls).toEqual([true]);
    expect(jobChat.progress('j3').watched).toBe(true);
    a.close();
    expect(calls).toEqual([true]);
    b.close();
    expect(calls).toEqual([true, false]);
    expect(jobChat.progress('j3').watched).toBe(false);
    // Watching again after everyone left holds the limit off again.
    await jobChat.view('j3', closeable(23));
    expect(calls).toEqual([true, false, true]);
    await chat.end({});
  });

  it('calls the watch hook at once for Run with me, and not after the run ends', async () => {
    const turn = new EventEmitter();
    const calls = [];
    const wc = new EventEmitter();
    let gone = false;
    Object.assign(wc, { id: 31, isDestroyed: () => gone });
    const chat = await jobChat.open({ job: { id: 'j4', title: 'Mine' }, prompt: 'Go', emitter: turn, stop: () => {}, watchWin: { id: 31, webContents: wc }, onWatch: (on) => calls.push(on) });
    expect(calls).toEqual([true]);
    await chat.end({});
    gone = true;
    wc.emit('destroyed');
    expect(calls).toEqual([true]);
    expect(wc.listenerCount('destroyed')).toBe(0);
  });
});
