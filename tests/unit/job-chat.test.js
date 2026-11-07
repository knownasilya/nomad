// A Job run the user watches is a chat in the AI Sidebar (app/bg/ai/job-chat-messages.mjs): the
// session it starts as, how the run's events add to it, how it ends, and the run record naming it.
import { describe, it, expect } from 'vitest';
import {
  jobOf,
  jobChatStart,
  applyJobEvent,
  jobChatEnd,
  jobProgressStart,
  applyJobProgress,
} from '../../app/bg/ai/job-chat-messages.mjs';
import { makeRun, finalNotification, runPreview } from '../../shared/jobs.mjs';

const JOB = { id: 'j1', title: 'Morning digest' };

describe('jobChatStart', () => {
  it('starts with the Job’s prompt, marked as the Job’s, and the Job on the session', () => {
    const s = jobChatStart(JOB, '  Sum up my unread posts  ');
    expect(s.title).toBe('Morning digest');
    expect(s.job).toEqual({ id: 'j1', title: 'Morning digest' });
    expect(s.messages).toEqual([{ role: 'user', content: 'Sum up my unread posts', fromJob: true }]);
  });

  it('names the Job when it has no prompt (only job.js)', () => {
    expect(jobChatStart(JOB, '').messages[0].content).toBe('Run the Job “Morning digest”');
    expect(jobChatStart({ id: 'j2', title: '' }, null).title).toBe('Job');
  });
});

describe('jobOf', () => {
  it('reads a session’s Job, or null', () => {
    expect(jobOf({ job: { id: 'j1', title: 'X', extra: 1 } })).toEqual({ id: 'j1', title: 'X' });
    expect(jobOf({ job: { id: '' } })).toBe(null);
    expect(jobOf({ job: 'j1' })).toBe(null);
    expect(jobOf({})).toBe(null);
    expect(jobOf(null)).toBe(null);
  });
});

describe('applyJobEvent', () => {
  const start = jobChatStart(JOB, 'Go').messages;

  it('writes the answer and its reasoning into one assistant message', () => {
    let m = applyJobEvent(start, 'reasoning', { text: 'Let me ' });
    m = applyJobEvent(m, 'reasoning', { text: 'look.' });
    m = applyJobEvent(m, 'chunk', { text: 'Three ' });
    m = applyJobEvent(m, 'chunk', { text: 'posts.' });
    expect(m).toHaveLength(2);
    expect(m[1]).toEqual({ role: 'assistant', content: 'Three posts.', reasoning: 'Let me look.' });
    expect(start).toHaveLength(1); // never changes what it was given
  });

  it('keeps screenshots and a private read on the answer, and ignores other tool events', () => {
    let m = applyJobEvent(start, 'tool', { phase: 'start', name: 'openPage', summary: 'Opening' });
    expect(m).toBe(start);
    m = applyJobEvent(m, 'tool', { phase: 'screenshot', imageDataUrl: 'data:image/png;base64,AA' });
    m = applyJobEvent(m, 'tool', { phase: 'private' });
    const again = applyJobEvent(m, 'tool', { phase: 'private' });
    expect(again).toBe(m);
    expect(m[1].images).toEqual(['data:image/png;base64,AA']);
    expect(m[1].privateData).toBe(true);
    // A Job's writes are on its run, not a Checkpoint the sidebar could revert.
    expect(applyJobEvent(m, 'tool', { phase: 'write', path: '/a.md', drive: 'hyper://x/' })).toBe(m);
  });
});

describe('jobChatEnd', () => {
  const start = jobChatStart(JOB, 'Go').messages;
  const answered = applyJobEvent(start, 'chunk', { text: 'Done.' });

  it('keeps the answer', () => {
    expect(jobChatEnd(answered, {})).toEqual(answered);
  });

  it('puts a failure in the answer’s place', () => {
    expect(jobChatEnd(answered, { error: 'No runtime' })).toEqual([
      start[0],
      { role: 'error', content: 'Error: No runtime' },
    ]);
  });

  it('says a stopped run stopped, and doesn’t call it a failure', () => {
    expect(jobChatEnd(start, { stopped: true, error: 'aborted' })[1].content).toBe('_Stopped._');
  });

  it('answers with job.js’s result when no AI ran', () => {
    expect(jobChatEnd(start, { output: '{"n":3}' })[1].content).toBe('{"n":3}');
    expect(jobChatEnd(start, {})).toEqual(start);
  });
});

describe('makeRun chat', () => {
  const base = {
    id: 'r1',
    job: JOB,
    startedAt: new Date(0),
    finishedAt: new Date(1000),
    status: 'ok',
    output: 'x',
  };

  it('names the run’s chat when someone watched it', () => {
    expect(makeRun({ ...base, chat: 'mh3abc12345' }).chat).toBe('mh3abc12345');
  });

  it('has no chat otherwise, or for anything that isn’t a chat id', () => {
    expect('chat' in makeRun(base)).toBe(false);
    expect('chat' in makeRun({ ...base, chat: '../x' })).toBe(false);
  });
});

describe('makeRun stopped', () => {
  const base = { id: 'r1', job: JOB, startedAt: new Date(0), finishedAt: new Date(1000), status: 'ok', output: '' };

  it('marks a run the user stopped, which isn’t a failure', () => {
    const run = makeRun({ ...base, stopped: true });
    expect(run).toMatchObject({ status: 'ok', stopped: true });
    expect(runPreview(run)).toBe('You stopped it');
    expect(runPreview(makeRun({ ...base, output: 'Two of three', stopped: true }))).toBe('Two of three');
  });

  it('isn’t marked otherwise', () => {
    expect('stopped' in makeRun(base)).toBe(false);
    expect('stopped' in makeRun({ ...base, status: 'error', error: 'x', stopped: true })).toBe(false);
  });

  it('sends no notification', () => {
    const job = { title: 'Digest', notify: 'always' };
    expect(finalNotification(job, { status: 'ok', output: 'x', stopped: true })).toBe(null);
    expect(finalNotification(job, { status: 'ok', output: 'x', notified: { body: 'Hi' }, stopped: true })).toBe(null);
  });
});

describe('applyJobProgress', () => {
  const run = (events) => events.reduce((p, [t, e]) => applyJobProgress(p, t, e), jobProgressStart());

  it('lists what the run said and each step, in order', () => {
    const p = run([
      ['chunk', { text: 'Looking ' }],
      ['chunk', { text: 'now.' }],
      ['tool', { phase: 'start', id: 'a', name: 'execute', summary: 'Running code' }],
      ['tool', { phase: 'start', id: 'b', parentId: 'a', name: 'listNotes', summary: 'Looking through your Notes' }],
      ['tool', { phase: 'end', id: 'b', name: 'listNotes' }],
      ['tool', { phase: 'end', id: 'a', name: 'execute', error: 'Boom' }],
      ['chunk', { text: 'Done.' }],
    ]);
    expect(p.items).toEqual([
      { kind: 'text', text: 'Looking now.' },
      { kind: 'step', id: 'a', summary: 'Running code', child: false, state: 'error', error: 'Boom' },
      { kind: 'step', id: 'b', summary: 'Looking through your Notes', child: true, state: 'done' },
      { kind: 'text', text: 'Done.' },
    ]);
    expect(p.thinking).toBe(false);
  });

  it('says it’s thinking until it says or does something', () => {
    let p = run([['reasoning', { text: 'Hmm' }]]);
    expect(p.thinking).toBe(true);
    p = applyJobProgress(p, 'tool', { phase: 'start', id: 'x', summary: 'Fetching' });
    expect(p.thinking).toBe(false);
  });

  it('marks an older Provider’s step done once the next starts', () => {
    const p = run([
      ['tool', { phase: 'start', summary: 'One' }],
      ['tool', { phase: 'start', summary: 'Two' }],
    ]);
    expect(p.items.map((i) => i.state)).toEqual(['done', 'running']);
  });

  it('keeps the newest steps and the end of long text, and ignores the rest', () => {
    const many = Array.from({ length: 80 }, (_, i) => ['tool', { phase: 'start', id: `c${i}`, summary: `S${i}` }]);
    const p = run([...many, ['chunk', { text: 'x'.repeat(5000) }]]);
    expect(p.items).toHaveLength(60);
    expect(p.items.at(-2).summary).toBe('S79');
    expect(p.items.at(-1).text.length).toBe(2001);
    const same = applyJobProgress(p, 'tool', { phase: 'write', drive: 'd', path: '/a' });
    expect(same).toBe(p);
  });
});
