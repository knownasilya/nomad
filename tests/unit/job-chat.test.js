// A Job run the user watches is a chat in the AI Sidebar (app/bg/ai/job-chat-messages.mjs): the
// session it starts as, how the run's events add to it, how it ends, and the run record naming it.
import { describe, it, expect } from 'vitest';
import { jobOf, jobChatStart, applyJobEvent, jobChatEnd } from '../../app/bg/ai/job-chat-messages.mjs';
import { makeRun } from '../../shared/jobs.mjs';

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
