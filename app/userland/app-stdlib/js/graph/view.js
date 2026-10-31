// A canvas of dots and lines, drawn in SVG and laid out by ./layout.js. nomad://notes draws its
// notes and their links with it, nomad://reader its articles grouped by topic, and the phone draws
// both in a WebView (scripts/build-canvas.mjs). Colors come from the --graph-* variables in
// app-stdlib/css/graph.css, so it follows light and dark.
//
// update(graph, opts) shows a graph: { nodes: [{ id, title, degree, kind?, hub?, muted?, size? }],
// links: [{ source, target, both?, directed? }] }.
//   kind   a class on the node (kind-<kind>), for its color
//   hub    always labelled and drawn larger: a Reader topic or feed
//   muted  drawn faint: an article already read
//   size   the dot's radius; by default it grows with the node's links
// A link is a line from source to target with an arrowhead at the target (and at the source too
// when `both`, for two notes that link to each other); `directed: false` draws a plain line.
//
// Drag the background to pan; scroll, pinch on a trackpad or with two fingers to zoom; drag a node to
// move it. A click on a node (or Enter on a focused one) calls onOpen(id). Hovering a node lights up
// its links. With onSelect (the phone, which has no hover), a tap selects a node instead, lighting up
// its links until another tap; onSelect(id) is told, onSelect(null) when a tap on the background
// clears it, and a second tap on the selected node opens it.

import { neighborIds, createLayout } from './layout.js';

const SVG = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const LABEL_SCALE = 0.7; // below this zoom only hubs and the hovered, selected and open nodes keep a title
const CLICK_SLOP = 6; // px a press can move and still count as a click
const ARROW_LENGTH = 8; // the arrowhead, in canvas units (it zooms with the nodes)
const ARROW_HALF_WIDTH = 3.6;
const ARROW_GAP = 1.5; // between the tip and the node's dot

export function createGraphView({ parent, onOpen, onSelect = null, label = 'Canvas' }) {
  const svg = svgEl('svg', { class: 'graph-svg', role: 'group', 'aria-label': label });
  const world = svgEl('g', {});
  const linksG = svgEl('g', { class: 'graph-links' });
  const nodesG = svgEl('g', { class: 'graph-nodes' });
  world.append(linksG, nodesG);
  svg.append(world);
  parent.append(svg);

  let graph = { nodes: [], links: [] };
  let layout = createLayout(graph);
  let nodeEls = [];
  let linkEls = []; // per link: { g, line, arrows: [at target, at source?] }
  let radii = [];
  let currentId = null;
  let selectedId = null;
  let query = '';
  let texts = new Map(); // id → lowercased text the search matches; the title when missing
  let hoverId = null;
  let view = { x: 0, y: 0, k: 1 }; // screen = world * k + (x, y)
  let fitted = false; // fit once the first layout has spread out
  let frame = 0;
  let visible = false;
  let dragging = null; // { kind: 'pan'|'node'|'pinch', index, startX, startY, moved, vx, vy }
  const pointers = new Map(); // pointerId → { x, y }, for a two-finger pinch

  // ── Data ──

  function update(next, opts = {}) {
    if ('currentId' in opts) currentId = opts.currentId;
    if ('query' in opts) query = opts.query || '';
    if (opts.texts) texts = opts.texts instanceof Map ? opts.texts : new Map(Object.entries(opts.texts));
    const prev = new Map();
    graph.nodes.forEach((n, i) => prev.set(n.id, layout.points[i]));
    // Places kept from before this view was made (the phone keeps them while a note is open).
    if (opts.positions) for (const [id, p] of Object.entries(opts.positions)) if (!prev.has(id)) prev.set(id, { x: p[0], y: p[1] });
    const same =
      next.nodes.length === graph.nodes.length &&
      next.links.length === graph.links.length &&
      next.nodes.every((n, i) => sameNode(n, graph.nodes[i])) &&
      next.links.every((l, i) => sameLink(l, graph.links[i]));
    if (!same) {
      const fresh = next.nodes.some((n) => !prev.has(n.id));
      const restored = !!opts.positions && !graph.nodes.length;
      graph = next;
      layout = createLayout(graph, prev, { alpha: restored ? 0.05 : prev.size && !fresh ? 0.25 : 1 });
      if (fresh && prev.size) layout.reheat(restored ? 0.3 : 0.6);
      build();
    }
    if (opts.view && !fitted) {
      fitted = true;
      view = { x: +opts.view.x || 0, y: +opts.view.y || 0, k: clamp(+opts.view.k || 1, MIN_SCALE, MAX_SCALE) };
      applyView();
    }
    if (selectedId && !graph.nodes.some((n) => n.id === selectedId)) selectedId = null;
    paintState();
    start();
  }

  function sameNode(a, b) {
    return a.id === b.id && a.title === b.title && a.kind === b.kind && !!a.hub === !!b.hub && !!a.muted === !!b.muted && a.size === b.size;
  }

  function sameLink(a, b) {
    return a.source === b.source && a.target === b.target && !!a.both === !!b.both && a.directed === b.directed;
  }

  function setQuery(q) {
    query = q || '';
    paintState();
  }

  // ── Drawing ──

  function radius(n) {
    if (n.size) return n.size;
    return (n.hub ? 7 : 4) + Math.sqrt(n.degree || 0) * (n.hub ? 1.6 : 2.6);
  }

  function build() {
    linkEls = graph.links.map((l) => {
      const g = svgEl('g', { class: 'graph-link' });
      const line = svgEl('line', {});
      const arrows = l.directed === false ? [] : (l.both ? [0, 1] : [0]).map(() => svgEl('path', { class: 'graph-arrow' }));
      g.append(line, ...arrows);
      return { g, line, arrows };
    });
    linksG.replaceChildren(...linkEls.map((el) => el.g));
    radii = graph.nodes.map(radius);
    nodeEls = graph.nodes.map((n, i) => {
      const r = radii[i];
      const cls = ['graph-node', n.kind ? 'kind-' + n.kind : '', n.hub ? 'hub' : '', n.muted ? 'muted' : ''].filter(Boolean).join(' ');
      const g = svgEl('g', { class: cls, tabindex: '0', role: 'button', 'aria-label': n.title });
      g.append(svgEl('circle', { r: String(r) }), svgEl('text', { y: String(r + 13), 'text-anchor': 'middle' }));
      g.lastChild.textContent = n.title;
      g.dataset.id = n.id;
      g.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && setHover(n.id));
      g.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && setHover(null));
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
    graph.links.forEach((l, i) => drawLink(linkEls[i], pts[l.source], pts[l.target], radii[l.source], radii[l.target]));
    nodeEls.forEach((g, i) => g.setAttribute('transform', `translate(${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)})`));
  }

  // The line from s to t, with its arrowhead touching t's dot (and s's, when it points both ways).
  // The line stops at the base of an arrowhead so the two don't overlap. Nodes too close for an
  // arrowhead get the plain line.
  function drawLink({ line, arrows }, s, t, rs, rt) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.hypot(dx, dy);
    const both = arrows.length > 1;
    const room = d - rt - rs - ARROW_GAP * 2;
    const fits = arrows.length > 0 && d > 0 && room > ARROW_LENGTH * arrows.length + 2;
    const ux = fits ? dx / d : 0;
    const uy = fits ? dy / d : 0;
    const back = ARROW_GAP + ARROW_LENGTH - 0.5;
    const x1 = fits && both ? s.x + ux * (rs + back) : s.x;
    const y1 = fits && both ? s.y + uy * (rs + back) : s.y;
    const x2 = fits ? t.x - ux * (rt + back) : t.x;
    const y2 = fits ? t.y - uy * (rt + back) : t.y;
    line.setAttribute('x1', x1.toFixed(1));
    line.setAttribute('y1', y1.toFixed(1));
    line.setAttribute('x2', x2.toFixed(1));
    line.setAttribute('y2', y2.toFixed(1));
    arrows.forEach((arrow, k) => {
      if (!fits) return arrow.setAttribute('d', '');
      // k 0 points at t, k 1 back at s.
      const sign = k ? -1 : 1;
      const end = k ? s : t;
      const r = k ? rs : rt;
      const vx = ux * sign;
      const vy = uy * sign;
      arrow.setAttribute('d', arrowPath(end.x - vx * (r + ARROW_GAP), end.y - vy * (r + ARROW_GAP), vx, vy));
    });
  }

  // Classes for the open node, the hovered or selected node and its links, and the search.
  function paintState() {
    const q = query.trim().toLowerCase();
    const focusId = hoverId || selectedId;
    const near = focusId ? neighborIds(graph, focusId) : null;
    const focusIndex = focusId ? graph.nodes.findIndex((n) => n.id === focusId) : -1;
    nodeEls.forEach((g, i) => {
      const n = graph.nodes[i];
      g.classList.toggle('current', n.id === currentId);
      g.classList.toggle('selected', n.id === selectedId);
      g.classList.toggle('hover', n.id === focusId);
      g.classList.toggle('near', !!near && near.has(n.id));
      g.classList.toggle('dim', (!!near && n.id !== focusId && !near.has(n.id)) || (!!q && !matches(n, q)));
    });
    linkEls.forEach(({ g }, i) => {
      const l = graph.links[i];
      const on = focusIndex >= 0 && (l.source === focusIndex || l.target === focusIndex);
      g.classList.toggle('hover', on);
      g.classList.toggle('dim', (focusIndex >= 0 && !on) || !!q);
    });
    svg.classList.toggle('labels', view.k >= LABEL_SCALE);
  }

  function matches(n, q) {
    return (texts.get(n.id) ?? String(n.title || '').toLowerCase()).includes(q);
  }

  function setHover(id) {
    if (dragging) return;
    hoverId = id;
    paintState();
  }

  function select(id, { center = false } = {}) {
    selectedId = id && graph.nodes.some((n) => n.id === id) ? id : null;
    paintState();
    if (center && selectedId) centerOn(selectedId);
  }

  // Pan so the node is in the middle, at the zoom it has.
  function centerOn(id) {
    const i = graph.nodes.findIndex((n) => n.id === id);
    const rect = svg.getBoundingClientRect();
    if (i < 0 || !rect.width) return;
    const p = layout.points[i];
    view = { ...view, x: rect.width / 2 - p.x * view.k, y: rect.height / 2 - p.y * view.k };
    applyView();
  }

  function applyView() {
    world.setAttribute('transform', `translate(${view.x.toFixed(1)},${view.y.toFixed(1)}) scale(${view.k.toFixed(4)})`);
    // The dot grid behind moves and scales with the canvas.
    const step = 24 * view.k;
    parent.style.backgroundSize = `${step}px ${step}px`;
    parent.style.backgroundPosition = `${view.x}px ${view.y}px`;
    svg.classList.toggle('labels', view.k >= LABEL_SCALE);
  }

  // Zoom and pan so every node fits, with a margin. Small graphs aren't blown up past 1.5×.
  function fit() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const b = layout.bounds();
    const pad = Math.min(60, rect.width / 8);
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
    zoomTo(view.k * factor, cx, cy, view);
  }

  // Zoom to k around the screen point (cx, cy), starting from the view `from`.
  function zoomTo(k, cx, cy, from) {
    k = clamp(k, MIN_SCALE, MAX_SCALE);
    view = { k, x: cx - ((cx - from.x) * k) / from.k, y: cy - ((cy - from.y) * k) / from.k };
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

  // ── Pointer: pan the background, drag a node, pinch to zoom, click to open ──

  const local = (e) => {
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, local(e));
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    if (pointers.size === 2) {
      // A second finger: stop dragging and pinch instead.
      if (dragging?.kind === 'node') layout.points[dragging.index].fixed = false;
      svg.classList.remove('dragging-node', 'panning');
      dragging = { kind: 'pinch', moved: true, start: pinchInfo(), from: view };
      return;
    }
    if (pointers.size > 2) return;
    const nodeG = e.target.closest('.graph-node');
    const index = nodeG ? nodeEls.indexOf(nodeG) : -1;
    dragging = { kind: index >= 0 ? 'node' : 'pan', index, startX: e.clientX, startY: e.clientY, moved: false, vx: view.x, vy: view.y };
    svg.classList.add(index >= 0 ? 'dragging-node' : 'panning');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (!dragging) return;
    if (dragging.kind === 'pinch') {
      if (pointers.size < 2) return;
      const { dist, mid } = pinchInfo();
      const s = dragging.start;
      // Zoom around where the pinch started, then follow the fingers' midpoint.
      const k = clamp((dragging.from.k * dist) / s.dist, MIN_SCALE, MAX_SCALE);
      const wx = (s.mid.x - dragging.from.x) / dragging.from.k;
      const wy = (s.mid.y - dragging.from.y) / dragging.from.k;
      view = { k, x: mid.x - wx * k, y: mid.y - wy * k };
      applyView();
      return;
    }
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    if (!dragging.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    dragging.moved = true;
    if (dragging.kind === 'pan') {
      view = { ...view, x: dragging.vx + dx, y: dragging.vy + dy };
      applyView();
    } else {
      const p = layout.points[dragging.index];
      const at = local(e);
      p.fixed = true;
      p.x = (at.x - view.x) / view.k;
      p.y = (at.y - view.y) / view.k;
      layout.reheat(0.3);
      draw();
      start();
    }
  });

  const endDrag = (e) => {
    pointers.delete(e.pointerId);
    if (!dragging) return;
    const d = dragging;
    if (d.kind === 'pinch') {
      // One finger left on the glass carries on as a pan, from where it is.
      if (pointers.size === 1) {
        const [p] = pointers.values();
        const rect = svg.getBoundingClientRect();
        dragging = { kind: 'pan', index: -1, startX: p.x + rect.left, startY: p.y + rect.top, moved: true, vx: view.x, vy: view.y };
      } else if (!pointers.size) dragging = null;
      return;
    }
    if (pointers.size) return;
    dragging = null;
    svg.classList.remove('dragging-node', 'panning');
    const click = !d.moved && e.type === 'pointerup';
    if (d.kind === 'node') {
      layout.points[d.index].fixed = false;
      if (!click) return;
      const id = graph.nodes[d.index].id;
      if (!onSelect || selectedId === id) onOpen(id);
      else {
        select(id);
        onSelect(id);
      }
    } else if (click && onSelect && selectedId) {
      select(null);
      onSelect(null);
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const at = local(e);
      // As d3-zoom does: a pinch arrives as a wheel with ctrlKey and small deltas.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      zoomBy(Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 10 : 1)), at.x, at.y);
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
    // graph: what to show; opts: { currentId, query, texts, positions, view }.
    update,
    setQuery,
    // Light up a node and its links, as a hover does, until select(null). center pans to it.
    select,
    get selected() {
      return selectedId;
    },
    fit,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    // Where every node is and the zoom, to give back to update() in a new view: { positions, view }.
    snapshot() {
      const positions = {};
      graph.nodes.forEach((n, i) => (positions[n.id] = [Math.round(layout.points[i].x), Math.round(layout.points[i].y)]));
      return { positions, view: { ...view } };
    },
    // The canvas is shown or hidden; it only animates while shown.
    setVisible(on) {
      visible = on;
      if (on) start();
      else stop();
    },
    get count() {
      return { nodes: graph.nodes.length, links: graph.links.length };
    },
    destroy() {
      stop();
      resize.disconnect();
      svg.remove();
    },
  };
}

// An arrowhead with its tip at (x, y), pointing along the unit vector (vx, vy), notched at the back.
function arrowPath(x, y, vx, vy) {
  const bx = x - vx * ARROW_LENGTH;
  const by = y - vy * ARROW_LENGTH;
  const nx = -vy * ARROW_HALF_WIDTH;
  const ny = vx * ARROW_HALF_WIDTH;
  const notch = ARROW_LENGTH * 0.22;
  const f = (v) => v.toFixed(1);
  return `M${f(x)},${f(y)}L${f(bx + nx)},${f(by + ny)}L${f(bx + vx * notch)},${f(by + vy * notch)}L${f(bx - nx)},${f(by - ny)}Z`;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
