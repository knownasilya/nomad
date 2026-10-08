// nomad://search — the public-discovery search client (ADR-0016 §5).
//
// Queries a *configurable* index endpoint (a crawler super-peer's HTTP/JSON API, ADR-0014 §6) so no
// indexer is privileged — pointing at a different index is a settings change. Search is global by
// default; Topics are an optional filter and an emergent directory (whatever listed Drives declare).
// A result that is a Feed gets a "Subscribe in Reader" action; every result can be opened directly.
//
// Vanilla JS (served as-is, no bundle) like nomad://reader. Reaches the endpoint over fetch(), which
// the search page's dedicated CSP (bg/protocols/nomad.js SEARCH_CSP) permits via connect-src.

const ENDPOINT_KEY = 'nomad.search.endpoint';
const DEFAULT_ENDPOINT = 'http://localhost:8787';

const state = {
  endpoint: localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT,
  query: '',
  topic: '',
  topics: [],
  results: [],
  status: 'idle', // idle | loading | ok | error
  error: '',
};

const app = document.getElementById('app');

function driveUrl(driveKey) {
  return 'hyper://' + driveKey + '/';
}

async function api(pathAndQuery) {
  const base = state.endpoint.replace(/\/$/, '');
  const res = await fetch(base + pathAndQuery, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadTopics() {
  try {
    const { topics } = await api('/topics');
    state.topics = Array.isArray(topics) ? topics : [];
  } catch {
    state.topics = [];
  }
  render();
}

async function runSearch() {
  state.status = 'loading';
  state.error = '';
  render();
  try {
    const qs =
      '/search?q=' + encodeURIComponent(state.query) + '&topic=' + encodeURIComponent(state.topic);
    const data = await api(qs);
    state.results = Array.isArray(data.results) ? data.results : [];
    state.status = 'ok';
  } catch (e) {
    state.status = 'error';
    state.error =
      'Could not reach the index at ' + state.endpoint + ' (' + (e.message || e) + '). Is a crawler running?';
    state.results = [];
  }
  render();
}

function setEndpoint(url) {
  state.endpoint = url.trim() || DEFAULT_ENDPOINT;
  localStorage.setItem(ENDPOINT_KEY, state.endpoint);
  loadTopics();
  runSearch();
}

function selectTopic(topic) {
  state.topic = state.topic === topic ? '' : topic;
  runSearch();
}

// rendering
// =

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') node.className = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
  }
  for (const c of children || []) node.append(c);
  return node;
}

// A link that opens `url` in a NEW TAB in the current Space. Prefers nomad.browser.openUrl — the
// canonical "open a tab" API the shell exposes to nomad apps — which guarantees a real tab (with the
// nomad bridge) regardless of the launching context. Falls back to window.open only when the API is
// absent (e.g. a static preview outside the app). A bare window.open from some contexts opens a
// standalone OS window with no bridge, which is why the plain-link path is avoided.
function openInTab(url) {
  if (window.nomad?.browser?.openUrl) nomad.browser.openUrl(url, { setActive: true });
  else window.open(url);
}
function openLink(label, url) {
  return el(
    'a',
    { class: 'action', href: url, onclick: (e) => { e.preventDefault(); openInTab(url); } },
    [label]
  );
}

function renderResult(r) {
  const url = driveUrl(r.driveKey);
  const meta = el('div', { class: 'meta' }, [
    ...(r.topics || []).map((t) => el('span', { class: 'topic' }, ['#' + t])),
    // Open in a TAB via openInTab (nomad.browser.openUrl), never a standalone window — see openLink.
    openLink('Open ↗', url),
    ...(r.type === 'walled.garden/feed'
      ? [openLink('Subscribe in Reader', 'nomad://reader/?subscribe=' + encodeURIComponent(url))]
      : []),
  ]);
  return el('div', { class: 'result' }, [
    el('h3', {}, [r.title || '(untitled drive)']),
    r.description ? el('p', { class: 'desc' }, [r.description]) : '',
    meta,
  ]);
}

function render() {
  app.textContent = '';

  const input = el('input', {
    type: 'search',
    placeholder: 'Search listed drives…',
    value: state.query,
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        state.query = e.target.value;
        runSearch();
      }
    },
    oninput: (e) => {
      state.query = e.target.value;
    },
  });
  const searchbar = el('div', { class: 'searchbar' }, [
    input,
    el('button', { onclick: () => runSearch() }, ['Search']),
  ]);

  const endpointInput = el('input', { type: 'text', value: state.endpoint });
  const endpoint = el('div', { class: 'endpoint' }, [
    el('span', {}, ['Index:']),
    endpointInput,
    el('button', { onclick: () => setEndpoint(endpointInput.value) }, ['Use']),
  ]);

  const chips = el(
    'div',
    { class: 'chips' },
    state.topics.map((t) =>
      el('span', { class: 'chip' + (state.topic === t.topic ? ' active' : ''), onclick: () => selectTopic(t.topic) }, [
        t.topic,
        el('span', { class: 'count' }, [String(t.count)]),
      ])
    )
  );

  const header = el('header', {}, [
    el('h1', {}, ['🔍 Search']),
    el('div', { class: 'sub' }, ['Find drives that have opted into public discovery.']),
  ]);

  const wrap = el('div', { class: 'wrap' }, [header, searchbar, endpoint, chips]);

  if (state.status === 'loading') wrap.append(el('div', { class: 'status' }, ['Searching…']));
  else if (state.status === 'error') wrap.append(el('div', { class: 'status error' }, [state.error]));
  else if (state.results.length === 0)
    wrap.append(
      el('div', { class: 'empty' }, [
        state.query || state.topic
          ? 'No listed drives matched.'
          : 'Type a query, or pick a topic below. Only drives listed for search appear here.',
      ])
    );
  else state.results.forEach((r) => wrap.append(renderResult(r)));

  app.append(wrap);
}

// boot
// =
render();
loadTopics();
runSearch();
