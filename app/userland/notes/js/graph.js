// The Notes canvas: notes as dots, links as lines between them, laid out by a small force
// simulation (like d3-force, without the dependency). No DOM here; ./graph-view.js draws it.
//
// noteGraph(notes) gives the nodes and links. createLayout(graph, prev) places the nodes and moves
// them a step on each tick() until they settle. Linked notes pull together, every pair pushes
// apart, and a weak pull to the middle keeps notes without links close by.

import { noteTitle, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

// { nodes: [{ id, title, degree }], links: [{ source, target }] } with source/target as node
// indexes. A link is undirected and counted once, however many times or ways the notes link.
// A note's link to itself, and a link to a note that doesn't exist, are left out.
export function noteGraph(notes) {
  const list = (notes || []).filter((n) => n && n.id);
  const resolve = makeResolver(list);
  const index = new Map(list.map((n, i) => [n.id, i]));
  const nodes = list.map((n) => ({ id: n.id, title: noteTitle(n.body), degree: 0 }));
  const links = [];
  const seen = new Set();
  list.forEach((n, i) => {
    for (const id of linkedIds(n.body, resolve)) {
      const j = index.get(id);
      if (j == null || j === i) continue;
      const key = i < j ? i + ':' + j : j + ':' + i;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: i, target: j });
      nodes[i].degree++;
      nodes[j].degree++;
    }
  });
  return { nodes, links };
}

// The ids of the notes linked to `id`, in either direction.
export function neighborIds(graph, id) {
  const i = graph.nodes.findIndex((n) => n.id === id);
  const out = new Set();
  if (i < 0) return out;
  for (const l of graph.links) {
    if (l.source === i) out.add(graph.nodes[l.target].id);
    else if (l.target === i) out.add(graph.nodes[l.source].id);
  }
  return out;
}

const LINK_DISTANCE = 70;
const CHARGE = -220;
const GRAVITY = 0.04;
const VELOCITY_DECAY = 0.45;
const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300); // settles in about 300 ticks
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// A layout for `graph`. `prev` maps a note id to the { x, y } it had before, so a note keeps its
// place when the notes change. New notes start on a spiral around the middle.
export function createLayout(graph, prev = new Map(), { alpha = 1 } = {}) {
  const pts = graph.nodes.map((n, i) => {
    const p = prev.get(n.id);
    if (p) return { x: p.x, y: p.y, vx: 0, vy: 0, fixed: false };
    const r = 12 * Math.sqrt(0.5 + i);
    return { x: r * Math.cos(i * GOLDEN), y: r * Math.sin(i * GOLDEN), vx: 0, vy: 0, fixed: false };
  });
  // A link pulls weaker on a note with many links, so hubs don't collapse onto their leaves.
  const linkInfo = graph.links.map((l) => {
    const ds = graph.nodes[l.source].degree;
    const dt = graph.nodes[l.target].degree;
    return { ...l, strength: 1 / Math.max(1, Math.min(ds, dt)), bias: ds / (ds + dt || 1) };
  });

  const layout = {
    points: pts,
    alpha,
    // Whether the layout still moves.
    get running() {
      return layout.alpha >= ALPHA_MIN;
    },
    // Wake the layout up, after a drag or a change.
    reheat(a = 0.3) {
      layout.alpha = Math.max(layout.alpha, a);
    },
    tick() {
      if (!layout.running) return false;
      layout.alpha += (0 - layout.alpha) * ALPHA_DECAY;
      const a = layout.alpha;
      const n = pts.length;

      for (const l of linkInfo) {
        const s = pts[l.source];
        const t = pts[l.target];
        let dx = t.x + t.vx - (s.x + s.vx) || jiggle();
        let dy = t.y + t.vy - (s.y + s.vy) || jiggle();
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = ((d - LINK_DISTANCE) / d) * a * l.strength;
        dx *= k;
        dy *= k;
        t.vx -= dx * l.bias;
        t.vy -= dy * l.bias;
        s.vx += dx * (1 - l.bias);
        s.vy += dy * (1 - l.bias);
      }

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        for (let j = i + 1; j < n; j++) {
          const q = pts[j];
          let dx = q.x - p.x || jiggle();
          let dy = q.y - p.y || jiggle();
          const d2 = Math.max(dx * dx + dy * dy, 25);
          const f = (CHARGE * a) / d2;
          p.vx += dx * f;
          p.vy += dy * f;
          q.vx -= dx * f;
          q.vy -= dy * f;
        }
        p.vx -= p.x * GRAVITY * a;
        p.vy -= p.y * GRAVITY * a;
      }

      for (const p of pts) {
        if (p.fixed) {
          p.vx = p.vy = 0;
          continue;
        }
        p.vx *= 1 - VELOCITY_DECAY;
        p.vy *= 1 - VELOCITY_DECAY;
        p.x += p.vx;
        p.y += p.vy;
      }
      return true;
    },
    // The box around every note: { x, y, width, height }.
    bounds() {
      if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    },
  };
  return layout;
}

// A tiny nudge for two notes on the same spot, so they can push apart.
function jiggle() {
  return (Math.random() - 0.5) * 1e-6;
}
