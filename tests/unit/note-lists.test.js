// Lists in Notes (shared/note-lists.mjs): ticking moves an item down to the done items, unticking
// moves it back up, Clear done removes ticked items, and a shared Space's Note keeps who ticked what.
import { describe, it, expect } from 'vitest';
import * as nl from '../../shared/note-lists.mjs';
import { makeNote, planNoteSave, NOTE_TYPE } from '../../shared/vault-apps.mjs';

const T0 = '2026-11-05T10:00:00.000Z';
const lineFrom = (doc, n) => doc.split('\n').slice(0, n).reduce((a, l) => a + l.length + 1, 0);
const tick = (doc, n) => {
  const plan = nl.planTick(doc, lineFrom(doc, n));
  return plan && nl.applyChanges(doc, plan.changes);
};

describe('parseTask', () => {
  it('reads task lines and nothing else', () => {
    expect(nl.parseTask('- [ ] milk')).toEqual({ indent: 0, checked: false, text: 'milk' });
    expect(nl.parseTask('  * [x] Eggs  ')).toEqual({ indent: 2, checked: true, text: 'Eggs' });
    expect(nl.parseTask('+ [X] ')).toEqual({ indent: 0, checked: true, text: '' });
    expect(nl.parseTask('- milk')).toBeNull();
    expect(nl.parseTask('1. [ ] milk')).toBeNull();
    expect(nl.parseTask('[ ] milk')).toBeNull();
  });
});

describe('planTick', () => {
  const list = '# Groceries\n\n- [ ] milk\n- [ ] eggs\n- [ ] bread\n- [x] coffee';

  it('moves a ticked item to the top of the done items', () => {
    expect(tick(list, 2)).toBe('# Groceries\n\n- [ ] eggs\n- [ ] bread\n- [x] milk\n- [x] coffee');
    expect(tick(list, 4)).toBe('# Groceries\n\n- [ ] milk\n- [ ] eggs\n- [x] bread\n- [x] coffee');
  });

  it('moves an unticked item to the end of the open items', () => {
    expect(tick(list, 5)).toBe('# Groceries\n\n- [ ] milk\n- [ ] eggs\n- [ ] bread\n- [ ] coffee');
    const two = '- [ ] milk\n- [x] eggs\n- [x] bread';
    expect(tick(two, 2)).toBe('- [ ] milk\n- [ ] bread\n- [x] eggs');
  });

  it('moves to the end of a list that ends the text, and from the last line up', () => {
    expect(tick('- [ ] a\n- [ ] b', 0)).toBe('- [ ] b\n- [x] a');
    expect(tick('- [ ] a\n- [x] b\n- [x] c', 2)).toBe('- [ ] a\n- [ ] c\n- [x] b');
    expect(tick('- [ ] a\n- [ ] b\n', 0)).toBe('- [ ] b\n- [x] a\n');
  });

  it('only ticks when the item is already where it goes', () => {
    expect(nl.planTick('- [ ] a\n- [ ] b', 0).changes).toHaveLength(2); // a moves below b
    expect(nl.planTick('- [ ] a\n- [x] b', 0).changes).toHaveLength(1); // the top of the done items already
    const stay = nl.planTick('- [ ] a\n- [ ] b\n- [x] c', lineFrom('- [ ] a\n- [ ] b\n- [x] c', 1));
    expect(stay.changes).toEqual([{ from: 11, to: 12, insert: 'x' }]);
    expect(nl.planTick('- [ ] alone', 0).changes).toHaveLength(1);
  });

  it('keeps to its own list and carries the lines under it', () => {
    const doc = '- [ ] a\n  note on a\n- [ ] b\n\n- [ ] other';
    expect(tick(doc, 0)).toBe('- [ ] b\n- [x] a\n  note on a\n\n- [ ] other');
    const nested = '- [ ] parent\n  - [ ] x\n  - [ ] y\n- [ ] next';
    expect(tick(nested, 1)).toBe('- [ ] parent\n  - [ ] y\n  - [x] x\n- [ ] next');
  });

  it('says what it ticked, and ignores lines that aren’t tasks', () => {
    expect(nl.planTick(list, lineFrom(list, 2))).toMatchObject({ checked: true, text: 'milk' });
    expect(nl.planTick(list, 0)).toBeNull();
    expect(nl.planTick(list, 3)).toBeNull(); // not the start of a line
  });

  it('never changes the same text twice (the changes don’t overlap)', () => {
    for (let n = 2; n <= 5; n++) {
      const { changes } = nl.planTick(list, lineFrom(list, n));
      const sorted = [...changes].sort((a, b) => a.from - b.from);
      for (let k = 1; k < sorted.length; k++) expect(sorted[k].from).toBeGreaterThanOrEqual(sorted[k - 1].to);
    }
  });
});

describe('clearDoneChanges', () => {
  it('removes ticked items and the lines under them', () => {
    const doc = '# Groceries\n\n- [ ] milk\n- [x] eggs\n  the big box\n- [ ] bread\n- [x] coffee\n- [x] tea';
    expect(nl.applyChanges(doc, nl.clearDoneChanges(doc))).toBe('# Groceries\n\n- [ ] milk\n- [ ] bread');
    expect(nl.clearDoneChanges('- [ ] a\n- [ ] b')).toEqual([]);
    expect(nl.applyChanges('- [x] a', nl.clearDoneChanges('- [x] a'))).toBe('');
    expect(nl.applyChanges('- [x] a\n- [ ] b\n', nl.clearDoneChanges('- [x] a\n- [ ] b\n'))).toBe('- [ ] b\n');
  });

  it('counts what it would clear', () => {
    expect(nl.doneCount('- [x] a\n- [ ] b\n  - [X] c\nplain [x]')).toBe(2);
  });
});

describe('ticks on the Note record', () => {
  const note = (body, extra = {}) => ({ type: NOTE_TYPE, id: 'n1', body, createdAt: T0, updatedAt: T0, ...extra });

  it('records who ticked an item, and forgets it when unticked', () => {
    const a = nl.withTick(note('- [x] Milk'), { text: '  Milk ', checked: true, by: 'Sam' }, T0);
    expect(a.ticks).toEqual({ milk: { by: 'Sam', at: T0 } });
    expect(a.updatedAt).toBe(T0); // not an edit
    expect(nl.tickFor(a.ticks, 'MILK')).toEqual({ by: 'Sam', at: T0 });
    expect(nl.withTick(a, { text: 'milk', checked: false, by: 'Sam' }).ticks).toBeUndefined();
  });

  it('keeps the ticks of items still ticked on every save', () => {
    const prev = note('- [x] milk\n- [x] eggs', { ticks: { milk: { by: 'Sam', at: T0 }, eggs: { by: 'Ilya', at: T0 } } });
    const saved = makeNote({ id: 'n1', body: '- [x] milk\n- [ ] eggs\n- [ ] bread' }, prev);
    expect(saved.ticks).toEqual({ milk: { by: 'Sam', at: T0 } });
    expect(makeNote({ id: 'n1', body: '- [ ] milk' }, prev).ticks).toBeUndefined();
    expect(nl.keepTicks({ milk: { by: 'x' } }, '- [x] milk')).toBeNull(); // not a tick
  });

  it('leaves the ticks off a conflict copy', () => {
    const prev = note('- [x] milk', { ticks: { milk: { by: 'Sam', at: T0 } }, updatedAt: '2026-11-05T11:00:00.000Z' });
    const { note: copy } = planNoteSave({ id: 'n1', body: '- [x] milk\n- [ ] eggs', baseUpdatedAt: T0 }, prev);
    expect(copy.conflictOf).toBe('n1');
    expect(copy.ticks).toBeUndefined();
  });

  it('keeps a bounded, newest-first list', () => {
    let n = note('');
    for (let i = 0; i < nl.MAX_TICKS + 5; i++) {
      n = nl.withTick(n, { text: 'item ' + i, checked: true, by: 'Sam' }, new Date(Date.parse(T0) + i * 1000).toISOString());
    }
    expect(Object.keys(n.ticks)).toHaveLength(nl.MAX_TICKS);
    expect(n.ticks['item 0']).toBeUndefined();
    expect(n.ticks['item ' + (nl.MAX_TICKS + 4)]).toBeDefined();
  });
});
