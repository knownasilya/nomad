// The Notes canvas: notes as dots, links as lines between them. noteGraph(notes) gives the nodes
// and links; the layout and the drawing are app-stdlib's canvas (app-stdlib/js/graph/), shared with
// nomad://reader and the phone.

import { noteTitle, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

export { neighborIds, createLayout } from '../../app-stdlib/js/graph/layout.js';

// { nodes: [{ id, title, degree }], links: [{ source, target, both }] } with source/target as node
// indexes. A link points from the note that holds it (source) to the note it names (target); a
// pair of notes gets one link however many times or ways they link, with `both` true when each
// links to the other. A note's link to itself, and a link to a note that doesn't exist, are left out.
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
  return { nodes, links };
}
