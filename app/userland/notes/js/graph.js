// The Notes canvas: notes as dots, links as lines between them, and each topic (ADR-0035) a hub
// with its notes around it. noteGraph(notes) gives the nodes and links; the layout and the drawing
// are app-stdlib's canvas (app-stdlib/js/graph/), shared with nomad://reader and the phone.

import { noteTitle, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

export { neighborIds, createLayout } from '../../app-stdlib/js/graph/layout.js';

// A topic hub's node id. A note id is [a-z0-9-], so it can't look like one.
export const topicNodeId = (topic) => 'topic:' + String(topic).toLowerCase();

// { nodes: [{ id, title, degree, kind?, hub? }], links: [{ source, target, both?, directed?, kind? }] }
// with source/target as node indexes. The notes come first, in the order given, then a hub per
// topic. A link points from the note that holds it (source) to the note it names (target); a pair
// of notes gets one link however many times or ways they link, with `both` true when each links to
// the other. A note's link to itself, and a link to a note that doesn't exist, are left out. A note
// with topics is tied to each topic's hub by a plain line (kind 'topic'), so notes on one topic
// gather around it as Reader's articles do.
export function noteGraph(notes) {
  const list = (notes || []).filter((n) => n && n.id);
  const resolve = makeResolver(list);
  const index = new Map(list.map((n, i) => [n.id, i]));
  const nodes = list.map((n) => ({ id: n.id, title: noteTitle(n.body), degree: 0 }));
  const links = [];
  const seen = new Map(); // 'i:j' with i < j → the pair's link
  list.forEach((n, i) => {
    for (const id of linkedIds(n.body, resolve)) {
      const j = index.get(id);
      if (j == null || j === i) continue;
      const key = i < j ? i + ':' + j : j + ':' + i;
      const had = seen.get(key);
      if (had) {
        if (had.source === j) had.both = true;
        continue;
      }
      const link = { source: i, target: j, both: false };
      seen.set(key, link);
      links.push(link);
      nodes[i].degree++;
      nodes[j].degree++;
    }
  });
  const hubs = new Map(); // topic node id → index
  list.forEach((n, i) => {
    const mine = new Set();
    for (const t of Array.isArray(n.topics) ? n.topics : []) {
      const id = topicNodeId(t);
      if (!String(t).trim() || mine.has(id)) continue;
      mine.add(id);
      if (!hubs.has(id)) {
        hubs.set(id, nodes.length);
        nodes.push({ id, title: String(t), degree: 0, kind: 'topic', hub: true, charge: 2.5 });
      }
      const h = hubs.get(id);
      links.push({ source: i, target: h, directed: false, kind: 'topic', distance: 60 });
      nodes[i].degree++;
      nodes[h].degree++;
    }
  });
  return { nodes, links };
}

// What the search matches for each node: a note's text and its topics, a hub's topic.
export function noteTexts(notes) {
  const out = new Map();
  for (const n of notes || []) {
    if (!n || !n.id) continue;
    const topics = Array.isArray(n.topics) ? n.topics : [];
    out.set(n.id, [n.body || '', ...topics].join(' ').toLowerCase());
    for (const t of topics) out.set(topicNodeId(t), String(t).toLowerCase());
  }
  return out;
}

// How much the canvas shows: notes, links between notes, and topics.
export function noteGraphCounts(graph) {
  return {
    notes: graph.nodes.filter((n) => !n.hub).length,
    links: graph.links.filter((l) => l.kind !== 'topic').length,
    topics: graph.nodes.filter((n) => n.hub).length,
  };
}
