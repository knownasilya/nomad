import { describe, it, expect } from 'vitest';
import {
  driveRoot,
  followPath,
  followsPrefix,
  readPath,
  followRecord,
  followUrls,
  mergeReadState,
  newNoteId,
  isNoteId,
  notePath,
  makeNote,
  isNote,
  isConflict,
  conflictBody,
  planNoteSave,
  noteTitle,
  noteSnippet,
  sortNotes,
  hrefTarget,
  findLinks,
  makeResolver,
  linkedIds,
  renameLinks,
  linkRenames,
  NOTE_TYPE,
  MAX_NOTE_LENGTH,
} from '../../shared/vault-apps.mjs';

const KEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const SPACE = 'c'.repeat(64);

describe('driveRoot', () => {
  it('reduces a URL to its drive root', () => {
    expect(driveRoot(`hyper://${KEY}/posts/hello/`)).toBe(`hyper://${KEY}/`);
    expect(driveRoot(`HYPER://${KEY.toUpperCase()}`)).toBe(`hyper://${KEY}/`);
  });
  it('accepts a bare key', () => {
    expect(driveRoot(KEY)).toBe(`hyper://${KEY}/`);
  });
  it('rejects anything else', () => {
    expect(driveRoot('https://example.com/')).toBe(null);
    expect(driveRoot('not a url')).toBe(null);
    expect(driveRoot('')).toBe(null);
    expect(driveRoot(null)).toBe(null);
  });
});

describe('follow records', () => {
  it('keys one record per drive, under the Space', () => {
    expect(followPath(SPACE, `hyper://${KEY}/posts/x/`)).toBe(`/.vault/reader/${SPACE}/follows/${KEY}.json`);
    expect(followsPrefix(SPACE)).toBe(`/.vault/reader/${SPACE}/follows/`);
    expect(readPath(SPACE)).toBe(`/.vault/reader/${SPACE}/read.json`);
    expect(followRecord(KEY, 'T')).toEqual({ url: `hyper://${KEY}/`, addedAt: 'T' });
  });
  it('refuses a bad Space key or a non-hyper address', () => {
    expect(() => followPath('../x', KEY)).toThrow(/Space/);
    expect(() => followPath(SPACE, 'https://example.com')).toThrow(/hyper:\/\//);
  });
  it('lists unique, valid feed URLs, oldest first', () => {
    expect(
      followUrls([{ url: OTHER, addedAt: '2' }, { url: KEY, addedAt: '1' }, { url: `hyper://${KEY}/` }, { url: 'nope' }, null])
    ).toEqual([`hyper://${KEY}/`, `hyper://${OTHER}/`]);
  });
});

describe('mergeReadState', () => {
  const a1 = `hyper://${KEY}/posts/1/`;
  const a2 = `hyper://${KEY}/posts/2/`;
  const b1 = `hyper://${OTHER}/posts/1/`;
  const follows = [`hyper://${KEY}/`, `hyper://${OTHER}/`];

  it('unions what another Device marked with what this one adds', () => {
    expect(mergeReadState([a1], [b1], follows)).toEqual([a1, b1]);
  });
  it('drops marks for feeds no longer followed', () => {
    expect(mergeReadState([a1, b1], [], [`hyper://${KEY}/`])).toEqual([a1]);
  });
  it('drops marks for posts gone from a feed that loaded', () => {
    expect(mergeReadState([a1, a2], [], follows, { [`hyper://${KEY}/`]: [a2] })).toEqual([a2]);
  });
  it('keeps every mark of a feed that did not load', () => {
    expect(mergeReadState([a1, b1], [], follows, { [`hyper://${KEY}/`]: [a1] })).toEqual([a1, b1]);
  });
  it('ignores junk', () => {
    expect(mergeReadState([null, 3, 'nope'], undefined, follows)).toEqual([]);
  });
});

describe('notes', () => {
  it('makes path-safe ids that sort by time', () => {
    const early = newNoteId(1000, () => 0.5);
    const late = newNoteId(2000000, () => 0.1);
    expect(isNoteId(early)).toBe(true);
    expect(early < late).toBe(true);
    expect(notePath(early)).toBe(`/.vault/notes/${early}.json`);
  });
  it('refuses ids that could escape the notes folder', () => {
    expect(isNoteId('../x')).toBe(false);
    expect(isNoteId('a/b')).toBe(false);
    expect(() => notePath('../x')).toThrow();
  });
  it('keeps createdAt across saves and stamps updatedAt', () => {
    const first = makeNote({ id: 'n1', body: 'Hi' }, null, 'T1');
    expect(first).toEqual({ type: NOTE_TYPE, id: 'n1', body: 'Hi', createdAt: 'T1', updatedAt: 'T1' });
    const second = makeNote({ id: 'n1', body: 'Hi there' }, first, 'T2');
    expect(second.createdAt).toBe('T1');
    expect(second.updatedAt).toBe('T2');
    expect(isNote(second)).toBe(true);
  });
  it('refuses a note that is too long', () => {
    expect(() => makeNote({ id: 'n1', body: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).toThrow(/too long/);
  });
  it('titles a note by its first line with text', () => {
    expect(noteTitle('\n\n# Groceries\n- milk')).toBe('Groceries');
    expect(noteTitle('- [ ] call mum')).toBe('call mum');
    expect(noteTitle('   ')).toBe('New note');
  });
  it('previews the rest of the note on one line, without Markdown marks', () => {
    expect(noteSnippet('Title\nline one\n\nline   two')).toBe('line one · line two');
    expect(noteSnippet('Seeds\n- kale\n* tomato')).toBe('kale · tomato');
    expect(noteSnippet('Plan\nSee [[Seed order|the order]] and [[Fence]]')).toBe('See the order and Fence');
    expect(noteSnippet('Plan\n**raised beds**, *tomatoes*, ~~lawn~~, `soil.pdf`\n---\n[the almanac](https://x.org)')).toBe(
      'raised beds, tomatoes, lawn, soil.pdf · the almanac'
    );
    expect(noteSnippet('Only a title')).toBe('');
  });
  it('sorts newest first', () => {
    const notes = [
      { id: 'a', updatedAt: '2026-01-01' },
      { id: 'b', updatedAt: '2026-03-01' },
      { id: 'c', updatedAt: '2026-02-01' },
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('conflicts', () => {
  const stored = { id: 'n1', updatedAt: 'T2' };
  it('is a conflict only when the stored note moved past the loaded version', () => {
    expect(isConflict(stored, 'T1')).toBe(true);
    expect(isConflict(stored, 'T2')).toBe(false);
    expect(isConflict(stored, undefined)).toBe(false); // a client that sends no base
    expect(isConflict(null, 'T1')).toBe(false); // deleted elsewhere: saving brings it back
  });
  it('marks the copy on its title line', () => {
    expect(conflictBody('\n# Plan\nbody')).toBe('\n# Plan (conflict copy)\nbody');
    expect(noteTitle(conflictBody('Plan'))).toBe('Plan (conflict copy)');
    expect(conflictBody('')).toBe('(conflict copy)');
  });
  it('plans a save: new, update, no-op, or conflict copy', () => {
    const fresh = planNoteSave({ body: 'New' }, null, 'T');
    expect(fresh.write).toBe(true);
    expect(isNoteId(fresh.note.id)).toBe(true);
    const prev = makeNote({ id: 'n1', body: 'v1' }, null, 'T1');
    expect(planNoteSave({ id: 'n1', body: 'v2', baseUpdatedAt: 'T1' }, prev, 'T2')).toMatchObject({ write: true, note: { id: 'n1', body: 'v2' } });
    expect(planNoteSave({ id: 'n1', body: 'v1', baseUpdatedAt: 'T1' }, prev, 'T2')).toEqual({ note: prev, write: false });
    const clash = planNoteSave({ id: 'n1', body: 'mine', baseUpdatedAt: 'T0' }, prev, 'T2');
    expect(clash.write).toBe(true);
    expect(clash.note.id).not.toBe('n1');
    expect(clash.note).toMatchObject({ body: 'mine (conflict copy)', conflictOf: 'n1' });
  });
  it('keeps conflictOf on later saves of the copy', () => {
    const copy = makeNote({ id: 'n2', body: 'x', conflictOf: 'n1' }, null, 'T');
    expect(makeNote({ id: 'n2', body: 'y' }, copy, 'U').conflictOf).toBe('n1');
  });
});

describe('links', () => {
  const notes = [
    { id: 'n1', body: '# Seed order\n- kale', updatedAt: '1' },
    { id: 'n2', body: 'Fence repair\nSee [[Seed order]] and [[seed order#Kale|kale list]]', updatedAt: '2' },
    { id: 'n3', body: 'Plan\n[order](Seed%20order.md) and [web](https://x.org) and [[Missing note]]', updatedAt: '3' },
  ];
  const resolve = makeResolver(notes);

  it('reads relative Markdown hrefs as note names', () => {
    expect(hrefTarget('Seed%20order.md')).toBe('Seed order');
    expect(hrefTarget('./Seed order.md#Kale')).toBe('Seed order');
    expect(hrefTarget('https://x.org')).toBe(null);
    expect(hrefTarget('#top')).toBe(null);
    expect(hrefTarget('/abs/path.md')).toBe(null);
    expect(hrefTarget('a/b.md')).toBe(null);
  });
  it('finds wikilinks and relative links, with heading and shown text', () => {
    expect(findLinks(notes[1].body).map(({ target, heading, text }) => [target, heading, text])).toEqual([
      ['Seed order', '', ''],
      ['seed order', 'Kale', 'kale list'],
    ]);
    expect(findLinks(notes[2].body).map((l) => l.target)).toEqual(['Seed order', 'Missing note']);
  });
  it('resolves by title ignoring case, then by id', () => {
    expect(resolve('SEED ORDER').id).toBe('n1');
    expect(resolve('n2').id).toBe('n2');
    expect(resolve('Missing note')).toBe(null);
  });
  it('lists the notes a body links to, once each', () => {
    expect(linkedIds(notes[1].body, resolve)).toEqual(['n1']);
    expect(linkedIds(notes[2].body, resolve)).toEqual(['n1']);
  });
  it('renames links and keeps heading and shown text', () => {
    expect(renameLinks(notes[1].body, 'Seed order', 'Seeds 2027')).toBe(
      'Fence repair\nSee [[Seeds 2027]] and [[Seeds 2027#Kale|kale list]]'
    );
    expect(renameLinks(notes[2].body, 'Seed order', 'Seeds 2027')).toContain('[order](Seeds%202027.md)');
    expect(renameLinks('[[A]]', 'A', 'bad|name')).toBe('[[A]]');
  });
  it('rewrites every other note that linked to the old title', () => {
    const changes = linkRenames(notes, 'n1', 'Seed order', 'Seeds');
    expect(changes.map((c) => c.note.id)).toEqual(['n2', 'n3']);
  });
  it('leaves links alone when another note still has the old title', () => {
    const twin = [...notes, { id: 'n4', body: 'Seed order', updatedAt: '0' }];
    expect(linkRenames(twin, 'n1', 'Seed order', 'Seeds')).toEqual([]);
  });
});
