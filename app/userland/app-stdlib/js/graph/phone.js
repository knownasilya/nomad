// The phone's canvas page: the same canvas as nomad://notes and nomad://reader (./view.js), run in a
// React Native WebView. scripts/build-canvas.mjs bundles this file into one HTML page,
// mobile/lib/canvasHtml.ts, which mobile/components/Canvas.tsx loads for Notes and for Reader.
//
// React Native → page: window.__canvas(msg), sent with injectJavaScript.
//   { type: 'load', theme, kind, data, query, snapshot }  show a canvas
//        kind 'notes': data is the notes (with their topics); kind 'reader': data is { articles, posts }
//   { type: 'data', data }           what to show changed
//   { type: 'query', query }         dim what doesn't match
//   { type: 'select', id, center }   light up a node (null clears), and pan to it
//   { type: 'fit' } · { type: 'zoomIn' } · { type: 'zoomOut' }
// Page → React Native: window.ReactNativeWebView.postMessage(JSON)
//   { type: 'ready' } · { type: 'count', nodes, links, topics? } (notes: notes, links between them, topics)
//   { type: 'select', id } (null when cleared) · { type: 'open', id }
//   { type: 'matches', count }: how many notes, articles or posts match the search (null without one)
//   { type: 'snapshot', snapshot }: where everything is, to give back in the next 'load'

import { createGraphView } from './view.js';
import { noteGraph, noteTexts, noteGraphCounts } from '../../../notes/js/graph.js';
import { readerGraph, readerTexts } from '../../../reader/js/graph.js';

const post = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

let view = null;
let kind = 'notes';
let snapTimer = 0;

// The graph and the text the search matches, for each kind of canvas.
const KINDS = {
  notes: {
    label: 'Notes, their links and their topics',
    graph: (notes) => noteGraph(notes || []),
    texts: (notes) => noteTexts(notes || []),
    count: (graph) => {
      const c = noteGraphCounts(graph);
      return { nodes: c.notes, links: c.links, topics: c.topics };
    },
  },
  reader: {
    label: 'Articles by topic',
    graph: (data) => readerGraph(data || {}),
    texts: (data) => readerTexts(data || {}),
  },
};

// The theme comes from mobile/lib/theme.ts, so the canvas matches the rest of the app.
function applyTheme(t = {}) {
  const dark = t.scheme === 'dark';
  const vars = {
    '--graph-bg': t.bg,
    '--graph-node-ring': t.bg,
    '--graph-label': t.textDim,
    '--graph-label-strong': t.text,
    '--graph-accent': t.accent,
    '--graph-grid': dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    '--graph-node': dark ? '#8a8aa0' : '#8e8ea6',
    '--graph-link': dark ? 'rgba(200,200,230,0.22)' : 'rgba(60,60,90,0.22)',
    '--graph-arrow': dark ? 'rgba(200,200,230,0.42)' : 'rgba(60,60,90,0.45)',
    '--graph-hub': dark ? '#3cc4b9' : '#0f8a83',
    '--graph-feed': dark ? '#f0a060' : '#c2621a',
  };
  for (const [k, v] of Object.entries(vars)) if (v) document.documentElement.style.setProperty(k, v);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function show(data, opts = {}) {
  const k = KINDS[kind];
  const graph = k.graph(data);
  view.update(graph, { texts: k.texts(data), ...opts });
  post({ type: 'count', ...(k.count ? k.count(graph) : view.count) });
}

// Tell React Native where everything is a moment after it last moved, so the canvas comes back the
// same after a note is opened and closed.
function saveSoon() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => view && post({ type: 'snapshot', snapshot: view.snapshot() }), 800);
}

window.__canvas = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'load') {
    applyTheme(msg.theme);
    kind = KINDS[msg.kind] ? msg.kind : 'notes';
    view?.destroy();
    const surface = document.getElementById('canvas');
    view = createGraphView({
      parent: surface,
      label: KINDS[kind].label,
      onOpen: (id) => {
        post({ type: 'snapshot', snapshot: view.snapshot() });
        post({ type: 'open', id });
      },
      onSelect: (id) => post({ type: 'select', id }),
      onMatches: (count) => post({ type: 'matches', count }),
    });
    view.setVisible(true);
    const snap = msg.snapshot || {};
    show(msg.data, { query: msg.query || '', positions: snap.positions, view: snap.view });
  } else if (!view) {
    return;
  } else if (msg.type === 'data') {
    show(msg.data);
  } else if (msg.type === 'query') {
    view.setQuery(msg.query || '');
  } else if (msg.type === 'select') {
    view.select(msg.id || null, { center: !!msg.center });
  } else if (msg.type === 'fit') {
    view.fit();
  } else if (msg.type === 'zoomIn') {
    view.zoomIn();
  } else if (msg.type === 'zoomOut') {
    view.zoomOut();
  }
  saveSoon();
};

for (const ev of ['pointerup', 'wheel']) document.addEventListener(ev, saveSoon, { passive: true });

post({ type: 'ready' });
