// The Notes canvas, drawn in SVG: one dot per note, a line per link (./graph.js lays them out).
// Drag the background to pan, scroll or pinch to zoom, drag a note to move it. Clicking a note (or
// Enter on a focused one) calls onOpen(id). Hovering a note lights up its links. Colors come from
// the --nts-graph-* variables in css/main.css, so it follows light and dark.

import { noteGraph, neighborIds, createLayout } from './graph.js';

const SVG = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const LABEL_SCALE = 0.7; // below this zoom only the hovered and open notes keep a title
const CLICK_SLOP = 4; // px a press can move and still count as a click

export function createGraphView({ parent, onOpen }) {
  const svg = svgEl('svg', { class: 'graph-svg', role: 'group', 'aria-label': 'Notes and their links' });
  const world = svgEl('g', {});
  const linksG = svgEl('g', { class: 'graph-links' });
  const nodesG = svgEl('g', { class: 'graph-nodes' });
  world.append(linksG, nodesG);
  svg.append(world);
  parent.append(svg);

  let graph = { nodes: [], links: [] };
  let layout = createLayout(graph);
  let nodeEls = [];
  let linkEls = [];
  let currentId = null;
  let query = '';
  let hoverId = null;
  let view = { x: 0, y: 0, k: 1 }; // screen = world * k + (x, y)
  let fitted = false; // fit once the first layout has spread out
  let frame = 0;
  let visible = false;
  let bodies = new Map(); // id → lowercased text, so search matches a note's text like the list does
  let dragging = null; // { kind: 'pan'|'node', index, startX, startY, moved, vx, vy }

  // ── Data ──

  function update(notes, opts = {}) {
    currentId = opts.currentId ?? currentId;
    query = opts.query ?? query;
    const prev = new Map();
    graph.nodes.forEach((n, i) => prev.set(n.id, layout.points[i]));
    const next = noteGraph(notes);
    const same =
      next.nodes.length === graph.nodes.length &&
      next.links.length === graph.links.length &&
      next.nodes.every((n, i) => n.id === graph.nodes[i].id && n.title === graph.nodes[i].title) &&
      next.links.every((l, i) => l.source === graph.links[i].source && l.target === graph.links[i].target);
    if (!same) {
      const fresh = next.nodes.some((n) => !prev.has(n.id));
      graph = next;
      layout = createLayout(graph, prev, { alpha: prev.size && !fresh ? 0.25 : 1 });
      if (fresh && prev.size) layout.reheat(0.6);
      build();
    }
    paintState();
    start();
  }

  function setQuery(q) {
    query = q;
    paintState();
  }

  // ── Drawing ──

  function build() {
    linkEls = graph.links.map(() => svgEl('line', { class: 'graph-link' }));
    linksG.replaceChildren(...linkEls);
    nodeEls = graph.nodes.map((n) => {
      const r = 4 + Math.sqrt(n.degree) * 2.6;
      const g = svgEl('g', { class: 'graph-node', tabindex: '0', role: 'button', 'aria-label': n.title });
      g.append(svgEl('circle', { r: String(r) }), svgEl('text', { y: String(r + 13), 'text-anchor': 'middle' }));
      g.lastChild.textContent = n.title;
      g.dataset.id = n.id;
      g.addEventListener('pointerenter', () => setHover(n.id));
      g.addEventListener('pointerleave', () => setHover(null));
      g.addEventListener('focus', () => setHover(n.id));
      g.addEventListener('blur', () => setHover(null));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(n.id);
        }
      });
      return g;
    });
    nodesG.replaceChildren(...nodeEls);
    draw();
  }

  function draw() {
    const pts = layout.points;
    graph.links.forEach((l, i) => {
      const s = pts[l.source];
      const t = pts[l.target];
      const line = linkEls[i];
      line.setAttribute('x1', s.x.toFixed(1));
      line.setAttribute('y1', s.y.toFixed(1));
      line.setAttribute('x2', t.x.toFixed(1));
      line.setAttribute('y2', t.y.toFixed(1));
    });
    nodeEls.forEach((g, i) => g.setAttribute('transform', `translate(${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)})`));
  }

  // Classes for the open note, the hovered note and its links, and the search.
  function paintState() {
    const q = query.trim().toLowerCase();
    const near = hoverId ? neighborIds(graph, hoverId) : null;
    const hoverIndex = hoverId ? graph.nodes.findIndex((n) => n.id === hoverId) : -1;
    nodeEls.forEach((g, i) => {
      const n = graph.nodes[i];
      g.classList.toggle('current', n.id === currentId);
      g.classList.toggle('hover', n.id === hoverId);
      g.classList.toggle('near', !!near && near.has(n.id));
      g.classList.toggle('dim', (!!near && n.id !== hoverId && !near.has(n.id)) || (!!q && !matchesBody(n.id, q)));
    });
    linkEls.forEach((line, i) => {
      const l = graph.links[i];
      const on = hoverIndex >= 0 && (l.source === hoverIndex || l.target === hoverIndex);
      line.classList.toggle('hover', on);
      line.classList.toggle('dim', (hoverIndex >= 0 && !on) || !!q);
    });
    svg.classList.toggle('labels', view.k >= LABEL_SCALE);
  }

  function matchesBody(id, q) {
    return (bodies.get(id) || '').includes(q);
  }

  function setHover(id) {
    if (dragging) return;
    hoverId = id;
    paintState();
  }

  function applyView() {
    world.setAttribute('transform', `translate(${view.x.toFixed(1)},${view.y.toFixed(1)}) scale(${view.k.toFixed(4)})`);
    // The dot grid behind moves and scales with the canvas.
    const step = 24 * view.k;
    parent.style.backgroundSize = `${step}px ${step}px`;
    parent.style.backgroundPosition = `${view.x}px ${view.y}px`;
    svg.classList.toggle('labels', view.k >= LABEL_SCALE);
  }

  // Zoom and pan so every note fits, with a margin. Small graphs aren't blown up past 1.5×.
  function fit() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const b = layout.bounds();
    const pad = 60;
    const k = clamp(Math.min((rect.width - pad * 2) / (b.width || 1), (rect.height - pad * 2) / (b.height || 1)), MIN_SCALE, 1.5);
    view = { k, x: rect.width / 2 - (b.x + b.width / 2) * k, y: rect.height / 2 - (b.y + b.height / 2) * k };
    applyView();
  }

  function zoomBy(factor, cx, cy) {
    const rect = svg.getBoundingClientRect();
    if (cx == null) {
      cx = rect.width / 2;
      cy = rect.height / 2;
    }
    const k = clamp(view.k * factor, MIN_SCALE, MAX_SCALE);
    view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
    applyView();
  }

  // ── Animation ──

  function start() {
    if (!visible || frame) return;
    let ticks = 0;
    const loop = () => {
      frame = 0;
      // A few steps per frame while it's spreading out, so the first layout is quick.
      const steps = layout.alpha > 0.5 ? 3 : 1;
      let moved = false;
      for (let s = 0; s < steps; s++) moved = layout.tick() || moved;
      draw();
      if (!fitted && (layout.alpha < 0.3 || ++ticks > 90)) {
        fitted = true;
        fit();
      }
      if (moved && visible) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  // ── Pointer: pan the background, drag a note, click to open ──

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const nodeG = e.target.closest('.graph-node');
    const index = nodeG ? nodeEls.indexOf(nodeG) : -1;
    dragging = { kind: index >= 0 ? 'node' : 'pan', index, startX: e.clientX, startY: e.clientY, moved: false, vx: view.x, vy: view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add(index >= 0 ? 'dragging-node' : 'panning');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    if (!dragging.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    dragging.moved = true;
    if (dragging.kind === 'pan') {
      view = { ...view, x: dragging.vx + dx, y: dragging.vy + dy };
      applyView();
    } else {
      const rect = svg.getBoundingClientRect();
      const p = layout.points[dragging.index];
      p.fixed = true;
      p.x = (e.clientX - rect.left - view.x) / view.k;
      p.y = (e.clientY - rect.top - view.y) / view.k;
      layout.reheat(0.3);
      draw();
      start();
    }
  });

  const endDrag = (e) => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    svg.classList.remove('dragging-node', 'panning');
    if (d.kind === 'node') {
      layout.points[d.index].fixed = false;
      if (!d.moved && e.type === 'pointerup') onOpen(graph.nodes[d.index].id);
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      // As d3-zoom does: a pinch arrives as a wheel with ctrlKey and small deltas.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      zoomBy(Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 10 : 1)), e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false }
  );

  const resize = new ResizeObserver(() => {
    if (!fitted) return;
    applyView();
  });
  resize.observe(svg);

  applyView();

  return {
    // notes: the notes to show; opts: { currentId, query }.
    update(notes, opts) {
      bodies = new Map((notes || []).map((n) => [n.id, String(n.body || '').toLowerCase()]));
      update(notes, opts);
    },
    setQuery,
    fit,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    // The canvas is shown or hidden; it only animates while shown.
    setVisible(on) {
      visible = on;
      if (on) start();
      else stop();
    },
    get count() {
      return { notes: graph.nodes.length, links: graph.links.length };
    },
    destroy() {
      stop();
      resize.disconnect();
      svg.remove();
    },
  };
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
