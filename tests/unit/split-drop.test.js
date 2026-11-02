import { describe, it, expect } from 'vitest';
import {
  canSplitWith,
  isSplit,
  tabTooltip,
  tabDropZone,
  paneDropEdge,
  dropPreviewRect,
  splitCandidates,
  startTabDrag,
  endTabDrag,
  currentTabDrag,
  onTabDragChange,
} from '../../app/fg/shell-window/split-drop.js';
import { PaneLayout } from '../../app/bg/ui/tabs/pane-layout.js';

describe('canSplitWith', () => {
  it('splits two different unpinned tabs', () => {
    const a = { url: 'https://a.test/' };
    const b = { url: 'https://b.test/' };
    expect(canSplitWith(a, b)).toBe(true);
  });
  it('never with itself, a pinned tab or nothing', () => {
    const a = { url: 'https://a.test/' };
    expect(canSplitWith(a, a)).toBe(false);
    expect(canSplitWith(a, { isPinned: true })).toBe(false);
    expect(canSplitWith({ isPinned: true }, a)).toBe(false);
    expect(canSplitWith(a, undefined)).toBe(false);
  });
});

describe('isSplit and tabTooltip', () => {
  it('names every page of a split tab', () => {
    const tab = {
      title: 'A',
      url: 'https://a.test/',
      paneCount: 2,
      paneLayout: [{ title: 'A' }, { title: '', url: 'https://b.test/' }],
    };
    expect(isSplit(tab)).toBe(true);
    expect(tabTooltip(tab)).toBe('A  |  https://b.test/');
  });
  it('a tab with one page keeps its title', () => {
    const tab = { title: 'A', url: 'https://a.test/', paneCount: 1, paneLayout: [{ title: 'A' }] };
    expect(isSplit(tab)).toBe(false);
    expect(tabTooltip(tab)).toBe('A');
  });
});

describe('tabDropZone', () => {
  const rect = { left: 100, top: 0, width: 200, height: 30 };
  it('the leading quarter of a tab in the strip reorders, the rest splits', () => {
    expect(tabDropZone(rect, 110, 15)).toBe('before');
    expect(tabDropZone(rect, 149, 15)).toBe('before');
    expect(tabDropZone(rect, 151, 15)).toBe('split');
    expect(tabDropZone(rect, 290, 15)).toBe('split');
  });
  it('a sidebar row reorders on its top part', () => {
    const row = { left: 0, top: 100, width: 220, height: 30 };
    expect(tabDropZone(row, 100, 105, { vertical: true })).toBe('before');
    expect(tabDropZone(row, 100, 115, { vertical: true })).toBe('split');
  });
});

describe('paneDropEdge', () => {
  const b = { x: 0, y: 0, width: 1000, height: 800 };
  it('goes side by side over most of the page', () => {
    expect(paneDropEdge(b, 300, 400)).toBe('left');
    expect(paneDropEdge(b, 700, 400)).toBe('right');
    expect(paneDropEdge(b, 499, 790)).toBe('bottom');
  });
  it('goes above or below near the top or bottom edge', () => {
    expect(paneDropEdge(b, 500, 50)).toBe('top');
    expect(paneDropEdge(b, 500, 760)).toBe('bottom');
  });
  it('a corner goes to the nearer edge', () => {
    expect(paneDropEdge(b, 20, 100)).toBe('left');
    expect(paneDropEdge(b, 200, 20)).toBe('top');
  });
});

describe('dropPreviewRect', () => {
  const b = { x: 10, y: 20, width: 400, height: 300 };
  it('is the half the dropped tab takes', () => {
    expect(dropPreviewRect(b, 'left')).toEqual({ x: 10, y: 20, width: 200, height: 300 });
    expect(dropPreviewRect(b, 'right')).toEqual({ x: 210, y: 20, width: 200, height: 300 });
    expect(dropPreviewRect(b, 'top')).toEqual({ x: 10, y: 20, width: 400, height: 150 });
    expect(dropPreviewRect(b, 'bottom')).toEqual({ x: 10, y: 170, width: 400, height: 150 });
  });
});

describe('splitCandidates', () => {
  const tabs = [
    { title: 'Pinned', url: 'https://pin.test/', isPinned: true },
    { title: 'Current', url: 'https://cur.test/', isActive: true },
    { title: 'Nomad docs', url: 'https://nomad.dev/docs/' },
    { title: 'Weather', url: 'https://weather.test/today' },
  ];
  it('lists the other unpinned tabs with their index', () => {
    expect(splitCandidates(tabs).map((c) => c.index)).toEqual([2, 3]);
  });
  it('filters on every word, any order, ignoring case', () => {
    expect(splitCandidates(tabs, 'DOCS nomad').map((c) => c.index)).toEqual([2]);
    expect(splitCandidates(tabs, 'today').map((c) => c.index)).toEqual([3]);
    expect(splitCandidates(tabs, 'nothing here')).toEqual([]);
  });
});

describe('tab drag state', () => {
  it('tells listeners when a drag starts and ends, once', () => {
    let changes = 0;
    const off = onTabDragChange(() => changes++);
    startTabDrag(3, { url: 'https://a.test/' });
    expect(currentTabDrag()).toMatchObject({ index: 3 });
    endTabDrag();
    endTabDrag();
    expect(currentTabDrag()).toBe(null);
    expect(changes).toBe(2);
    off();
  });
});

describe('PaneLayout.insertPane', () => {
  const pane = (id) => ({ id });
  const columns = (layout) => layout.stacks.map((s) => s.panes.map((p) => p.id));

  it('puts a pane beside another on each edge', () => {
    const layout = new PaneLayout();
    const a = pane('a');
    layout.addPane(a);
    layout.insertPane(pane('r'), a, 'right');
    layout.insertPane(pane('l'), a, 'left');
    expect(columns(layout)).toEqual([['l'], ['a'], ['r']]);
    layout.insertPane(pane('b'), a, 'bottom');
    layout.insertPane(pane('t'), a, 'top');
    expect(columns(layout)).toEqual([['l'], ['t', 'a', 'b'], ['r']]);
  });

  it('keeps the columns and rows adding up to 100%', () => {
    const layout = new PaneLayout();
    const a = pane('a');
    layout.addPane(a);
    layout.insertPane(pane('b'), a, 'right');
    expect(layout.stacks.map((s) => s.layoutWidth)).toEqual([50, 50]);
    layout.insertPane(pane('c'), a, 'bottom');
    expect(layout.stacks[0].panes.map((p) => p.layoutHeight)).toEqual([50, 50]);
  });

  it('without an anchor it becomes the last column', () => {
    const layout = new PaneLayout();
    layout.addPane(pane('a'));
    layout.insertPane(pane('z'), undefined, 'left');
    expect(columns(layout)).toEqual([['a'], ['z']]);
  });
});
