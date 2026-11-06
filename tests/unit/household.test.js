// Household features: Set up a home (shared/home-setup.mjs), and Jobs that notify everyone in a
// shared Space (shared/jobs.mjs audience, shared/space-library.mjs notices).
import { describe, it, expect } from 'vitest';
import * as home from '../../shared/home-setup.mjs';
import * as sl from '../../shared/space-library.mjs';
import * as jl from '../../shared/jobs.mjs';
import { parseTask } from '../../shared/note-lists.mjs';
import { noteTitle } from '../../shared/vault-apps.mjs';

const ME = 'a'.repeat(32);
const SAM = 'b'.repeat(32);
const SPACE = 'c'.repeat(64);
const T0 = new Date('2026-11-05T18:00:00.000Z');

describe('set up a home', () => {
  it('starts with a Groceries list and House info, titled by their first line', () => {
    const notes = home.starterNotes();
    expect(notes.map((n) => n.key)).toEqual(['groceries', 'house']);
    for (const n of notes) expect(noteTitle(n.body)).toBe(n.title);
    // The list starts with an empty item to type into.
    expect(parseTask(notes[0].body.split('\n')[2])).toEqual({ indent: 0, checked: false, text: '' });
  });

  it('pins each starter Note it made', () => {
    expect(home.starterPins({ groceries: 'n-1', house: 'n-2' })).toEqual([
      { url: 'nomad://notes/n-1', title: 'Groceries' },
      { url: 'nomad://notes/n-2', title: 'House info' },
    ]);
    expect(home.starterPins({ house: 'n-2' })).toEqual([{ url: 'nomad://notes/n-2', title: 'House info' }]);
    expect(() => home.noteUrl('../x')).toThrow();
  });

  it('tidies the names, with Home and the computer’s user as fallbacks', () => {
    expect(home.homeNames({ name: '  The   Flat ', ownName: ' Ilya ' })).toEqual({ name: 'The Flat', ownName: 'Ilya' });
    expect(home.homeNames({}, 'Sam')).toEqual({ name: 'Home', ownName: 'Sam' });
    expect(() => home.homeNames({ name: 'x'.repeat(101) })).toThrow();
  });
});

describe('a Job that notifies its shared Space', () => {
  const base = { id: jl.newJobId(), prompt: 'Remind us that the bins go out tonight', space: SPACE };

  it('is the user’s choice, kept across saves that leave it out', () => {
    const j = jl.makeJob({ ...base, audience: 'space' }, null, T0);
    expect(j.audience).toBe('space');
    expect(jl.makeJob({ title: 'Bins' }, j, T0).audience).toBe('space'); // the AI's saveJob passes no audience
    expect(jl.makeJob({ audience: 'me' }, j, T0).audience).toBeUndefined();
    expect(jl.makeJob(base, null, T0).audience).toBeUndefined();
    expect(() => jl.makeJob({ ...base, audience: 'everyone' }, null, T0)).toThrow();
  });

  it('sends a good run’s notification to the Space, never a failure', () => {
    const job = jl.makeJob({ ...base, audience: 'space' }, null, T0);
    const note = { title: 'Bins', body: 'Green bin tonight' };
    expect(jl.spaceNotification(job, { status: 'ok', notification: note })).toEqual(note);
    expect(jl.spaceNotification(job, { status: 'error', notification: { title: 'Bins failed', body: 'x' } })).toBeNull();
    expect(jl.spaceNotification(job, { status: 'ok', notification: null })).toBeNull();
    expect(jl.spaceNotification({ ...job, audience: undefined }, { status: 'ok', notification: note })).toBeNull();
    expect(jl.spaceNotification({ ...job, space: null }, { status: 'ok', notification: note })).toBeNull();
  });
});

describe('Space notices', () => {
  const notice = (memberId, ms, title = 'Bins') =>
    sl.makeNotice(
      { id: sl.newNoticeId(T0.getTime() + ms, () => 'abcd1234'), memberId, from: memberId === ME ? 'Ilya' : 'Sam', title, body: 'Green bin tonight' },
      new Date(T0.getTime() + ms).toISOString()
    );

  it('makes a tidy record at a time-sorted path', () => {
    const n = notice(SAM, 0);
    expect(sl.isNotice(n)).toBe(true);
    expect(sl.noticePath(n.id)).toBe(`/.space/notices/${n.id}.json`);
    expect(sl.newNoticeId(T0.getTime() + 1000) > sl.newNoticeId(T0.getTime())).toBe(true);
    expect(() => sl.makeNotice({ id: n.id, memberId: SAM, title: '', body: '' })).toThrow();
    expect(() => sl.noticePath('../x')).toThrow();
    expect(sl.makeNotice({ id: n.id, memberId: SAM, title: 'x'.repeat(200), body: 'b' }).title).toHaveLength(sl.MAX_NOTICE_TITLE);
  });

  it('shows other members’ new notices, oldest first, and never your own', () => {
    const a = notice(SAM, 0, 'A');
    const b = notice(ME, 1000, 'B');
    const c = notice(SAM, 2000, 'C');
    // The first look shows nothing, and starts from the newest.
    expect(sl.pendingNotices([c, a, b], null, ME)).toEqual({ notify: [], since: c.id });
    const { notify, since } = sl.pendingNotices([c, a, b], a.id, ME);
    expect(notify.map((n) => n.title)).toEqual(['C']);
    expect(since).toBe(c.id);
    expect(sl.pendingNotices([], c.id, ME)).toEqual({ notify: [], since: c.id });
  });

  it('keeps each member’s newest notices', () => {
    const list = [...Array(sl.KEEP_NOTICES + 3)].map((_, i) => notice(ME, i * 1000));
    const prune = sl.noticesToPrune([...list, notice(SAM, 0)], ME);
    expect(prune).toHaveLength(3);
    expect(prune.every((n) => n.memberId === ME)).toBe(true);
    expect(prune.map((n) => n.id)).toEqual(list.slice(0, 3).map((n) => n.id).reverse());
  });
});
