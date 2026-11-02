// Split view by drag and drop: the shared drag state, and where a dragged tab would land.
//
// A tab dragged in the tab strip (tabs.js) or the sidebar (sidebar.js) can be dropped onto another
// tab, or onto the page (panes.js), to open the two side by side. Both lists tell this module when a
// drag starts and ends, so the panes can show their drop zones while one is under way. The
// functions below are pure (tests/unit/split-drop.test.js).

const events = new EventTarget();
let current = null; // { index, tab } while a tab is dragged

export function startTabDrag(index, tab) {
  current = { index, tab };
  events.dispatchEvent(new Event('change'));
}

// Called on dragend and again on drop: Chromium fires no dragend when the dragged tab's element left
// the page during the drop, as it does when the tab moves into a split.
export function endTabDrag() {
  if (!current) return;
  current = null;
  events.dispatchEvent(new Event('change'));
}

export function currentTabDrag() {
  return current;
}

export function onTabDragChange(fn) {
  events.addEventListener('change', fn);
  return () => events.removeEventListener('change', fn);
}

// A mousemove with no button down means a drag ended without telling us (its element went away).
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    if (current && (e.buttons & 1) === 0) endTabDrag();
  });
}

// Can the tab `from` be opened in a split with `to`? Tabs are tab state objects (bg tab.state).
// Pinned tabs stay as they are: a pin is one page.
export function canSplitWith(from, to) {
  return Boolean(from && to && from !== to && !from.isPinned && !to.isPinned);
}

// A tab holding a split view (more than one pane), and its tooltip: every page in it.
export function isSplit(tab) {
  return (tab?.paneCount || 0) > 1;
}

export function tabTooltip(tab) {
  const panes = tab?.paneLayout || [];
  if (!isSplit(tab) || panes.length < 2) return tab?.title || tab?.url || '';
  return panes.map((p) => p.title || p.url).join('  |  ');
}

// Where on a tab a dragged tab is: 'before' (its leading edge: reorder, as before) or 'split' (the
// rest of it: open both in a split). `rect` is the tab's client rect; `vertical` for the sidebar's
// rows, which are short, so their leading part is a smaller share.
export function tabDropZone(rect, x, y, { vertical = false } = {}) {
  const f = vertical ? (y - rect.top) / (rect.height || 1) : (x - rect.left) / (rect.width || 1);
  return f < (vertical ? 0.3 : 0.25) ? 'before' : 'split';
}

// The edge of a pane a tab dropped at (x, y) goes on: 'left' or 'right', unless the cursor is near
// the top or bottom (the outer quarter, and nearer it than the sides), then 'top' or 'bottom'.
export function paneDropEdge(bounds, x, y) {
  const fx = (x - bounds.x) / (bounds.width || 1);
  const fy = (y - bounds.y) / (bounds.height || 1);
  const dh = Math.min(fx, 1 - fx);
  const dv = Math.min(fy, 1 - fy);
  if (dv < 0.25 && dv < dh) return fy < 0.5 ? 'top' : 'bottom';
  return fx < 0.5 ? 'left' : 'right';
}

// The half of the pane the dropped tab will take, to show before the drop.
export function dropPreviewRect(bounds, edge) {
  const { x, y, width, height } = bounds;
  const halfW = Math.round(width / 2);
  const halfH = Math.round(height / 2);
  switch (edge) {
    case 'left':
      return { x, y, width: halfW, height };
    case 'right':
      return { x: x + width - halfW, y, width: halfW, height };
    case 'top':
      return { x, y, width, height: halfH };
    case 'bottom':
      return { x, y: y + height - halfH, width, height: halfH };
  }
  return { x, y, width, height };
}
