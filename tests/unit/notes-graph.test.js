// The Notes canvas (app/userland/notes/js/graph.js): which notes link, and a layout that pulls
// linked notes together.
import { describe, it, expect } from 'vitest';
import { noteGraph, neighborIds, createLayout } from '../../app/userland/notes/js/graph.js';

const note = (id, body, updatedAt = '2026-01-01T00:00:00.000Z') => ({ id, body, updatedAt });

describe('noteGraph', () => {
  it('links notes by [[title]] and by Markdown link, each pair once, both ways', () => {
    const g = noteGraph([
      note('a', '# Garden\n\nSee [[Seeds]] and [[seeds|the seeds]].'),
      note('b', '# Seeds\n\nBack to [Garden](Garden.md).'),
      note('c', '# Tools'),
    ]);
    expect(g.nodes.map((n) => [n.id, n.title, n.degree])).toEqual([
      ['a', 'Garden', 1],
      ['b', 'Seeds', 1],
      ['c', 'Tools', 0],
    ]);
    expect(g.links).toEqual([{ source: 0, target: 1, both: true }]);
  });

  it('points a link from the note that holds it to the note it names', () => {
    const g = noteGraph([note('a', '# A'), note('b', '# B\n\n[[A]] and [[A|again]]'), note('c', '# C\n\n[[B]]')]);
    expect(g.links).toEqual([
      { source: 1, target: 0, both: false },
      { source: 2, target: 1, both: false },
    ]);
    expect(g.nodes.map((n) => n.degree)).toEqual([1, 2, 1]);
  });

  it('leaves out links to itself, to missing notes, and notes without an id', () => {
    const g = noteGraph([note('a', '# A\n\n[[A]] [[Nowhere]]'), note('', '# Unsaved\n\n[[A]]')]);
    expect(g.nodes.map((n) => n.id)).toEqual(['a']);
    expect(g.links).toEqual([]);
  });

  it('resolves a link by id too', () => {
    const g = noteGraph([note('a', '# A\n\n[[b]]'), note('b', '# B')]);
    expect(g.links).toEqual([{ source: 0, target: 1, both: false }]);
    expect([...neighborIds(g, 'b')]).toEqual(['a']);
    expect([...neighborIds(g, 'missing')]).toEqual([]);
  });
});

describe('createLayout', () => {
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  it('settles, with linked notes closer than unlinked ones', () => {
    const notes = [
      note('a', '# A\n\n[[B]] [[C]]'),
      note('b', '# B\n\n[[C]]'),
      note('c', '# C'),
      note('d', '# D\n\n[[E]]'),
      note('e', '# E'),
      note('f', '# F'),
    ];
    const g = noteGraph(notes);
    const layout = createLayout(g);
    let ticks = 0;
    while (layout.tick()) ticks++;
    expect(layout.running).toBe(false);
    expect(ticks).toBeLessThan(400);
    const [a, b, , d, e] = layout.points;
    for (const p of layout.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(dist(a, b)).toBeLessThan(dist(a, d));
    expect(dist(d, e)).toBeLessThan(dist(a, e));
  });

  it('keeps the places notes had before', () => {
    const g = noteGraph([note('a', '# A'), note('b', '# B')]);
    const layout = createLayout(g, new Map([['a', { x: 100, y: -40 }]]), { alpha: 0 });
    expect(layout.points[0]).toMatchObject({ x: 100, y: -40 });
    expect(layout.tick()).toBe(false);
    layout.reheat(0.5);
    expect(layout.running).toBe(true);
  });
});

describe('noteGraph topics (ADR-0035)', () => {
  it('makes a hub for each topic, tied to its notes by a plain line', async () => {
    const { noteTexts, noteGraphCounts, topicNodeId } = await import('../../app/userland/notes/js/graph.js');
    const notes = [
      { ...note('a', '# Beds\n\n[[Seeds]]'), topics: ['Garden', 'garden'] },
      { ...note('b', '# Seeds'), topics: ['Garden', 'Shopping'] },
      note('c', '# Tools'),
    ];
    const g = noteGraph(notes);
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'topic:garden', 'topic:shopping']);
    expect(g.nodes[3]).toMatchObject({ title: 'Garden', kind: 'topic', hub: true, degree: 2 });
    expect(g.links).toEqual([
      { source: 0, target: 1, both: false },
      { source: 0, target: 3, directed: false, kind: 'topic', distance: 60 },
      { source: 1, target: 3, directed: false, kind: 'topic', distance: 60 },
      { source: 1, target: 4, directed: false, kind: 'topic', distance: 60 },
    ]);
    expect(noteGraphCounts(g)).toEqual({ notes: 3, links: 1, topics: 2 });
    expect(topicNodeId('Home Projects')).toBe('topic:home projects');
    const texts = noteTexts(notes);
    expect(texts.get('b')).toContain('shopping');
    expect(texts.get('topic:shopping')).toBe('shopping');
  });
});
