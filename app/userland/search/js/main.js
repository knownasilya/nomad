// nomad://search — the public-discovery search client (ADR-0016 §5).
//
// Queries a *configurable* index endpoint (a crawler super-peer's HTTP/JSON API, ADR-0014 §6) so no
// indexer is privileged — pointing at a different index is a settings change. Search is global by
// default; Topics are an optional filter and an emergent directory (whatever listed Drives declare).
// A result that is a Feed gets a "Subscribe in Reader" action; every result can be opened directly.
//
// The default endpoint is the crawler the browser runs itself (bg/hyper/crawler-host.js, the
// `crawler_enabled` setting). The index address and its status sit behind the cog in the header.
//
// Vanilla JS (served as-is, no bundle) like nomad://reader. Reaches the endpoint over fetch(), which
// the search page's dedicated CSP (bg/protocols/nomad.js SEARCH_CSP) permits via connect-src. Styled
// with the app-stdlib tokens, like My Library.

const ENDPOINT_KEY = 'nomad.search.endpoint';
const DEFAULT_ENDPOINT = 'http://localhost:8787'; // bg/hyper/crawler-host.js CRAWLER_PORT
const FEED_TYPE = 'walled.garden/feed';

const state = {
  endpoint: localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT,
  query: '',
  topic: '',
  topics: [],
  results: [],
  status: 'idle', // idle | loading | ok | error
  error: '',
  stats: null, // { drives, topics } from the index, or null when unreachable
  panelOpen: false,
};

// index API
// =

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
  renderMain();
}

async function loadStats() {
  try {
    state.stats = await api('/stats');
  } catch {
    state.stats = null;
  }
  renderPanel();
}

let searchSeq = 0;
async function runSearch() {
  const seq = ++searchSeq;
  state.status = 'loading';
  state.error = '';
  renderMain();
  try {
    const qs =
      '/search?q=' + encodeURIComponent(state.query) + '&topic=' + encodeURIComponent(state.topic);
    const data = await api(qs);
    if (seq !== searchSeq) return; // a newer search started while this one was in flight
    state.results = Array.isArray(data.results) ? data.results : [];
    state.status = 'ok';
  } catch (e) {
    if (seq !== searchSeq) return;
    state.status = 'error';
    state.error = e.message || String(e);
    state.results = [];
  }
  renderMain();
}

function refreshAll() {
  loadTopics();
  loadStats();
  runSearch();
}

function setEndpoint(url) {
  state.endpoint = url.trim() || DEFAULT_ENDPOINT;
  if (state.endpoint === DEFAULT_ENDPOINT) localStorage.removeItem(ENDPOINT_KEY);
  else localStorage.setItem(ENDPOINT_KEY, state.endpoint);
  refreshAll();
}

function selectTopic(topic) {
  state.topic = state.topic === topic ? '' : topic;
  runSearch();
}

function setPanelOpen(open) {
  state.panelOpen = open;
  if (open) loadStats();
  renderPanel();
}

// helpers
// =

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') node.className = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === true) node.setAttribute(k, '');
    else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c);
  return node;
}

function icon(name) {
  return el('span', { class: 'fas fa-fw fa-' + name, 'aria-hidden': 'true' });
}

function driveUrl(driveKey) {
  return 'hyper://' + driveKey + '/';
}

function shortUrl(driveKey) {
  return 'hyper://' + driveKey.slice(0, 6) + '…' + driveKey.slice(-4) + '/';
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
function tabLink(attrs, url, children) {
  return el(
    'a',
    {
      ...attrs,
      href: url,
      onclick: (e) => {
        e.preventDefault();
        openInTab(url);
      },
    },
    children
  );
}

// rendering
// =

const app = document.getElementById('app');
let mainEl, panelEl, cogBtn;

// The header is built once, so typing in the search box never loses focus to a re-render.
function renderShell() {
  let timer;
  const input = el('input', {
    type: 'search',
    placeholder: 'Search listed drives',
    'aria-label': 'Search listed drives',
    autofocus: true,
    oninput: (e) => {
      state.query = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(runSearch, 200); // the index is local and fast; search as you type
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        runSearch();
      }
    },
  });

  cogBtn = el(
    'button',
    {
      class: 'icon-btn',
      title: 'Search index',
      'aria-label': 'Search index settings',
      'aria-expanded': 'false',
      onclick: (e) => {
        e.stopPropagation();
        setPanelOpen(!state.panelOpen);
      },
    },
    [icon('cog')]
  );

  const header = el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://search/', alt: '' }), 'Search']),
    el('div', { class: 'search-ctrl' }, [icon('search'), input]),
    el('div', { class: 'header-actions' }, [cogBtn]),
  ]);

  panelEl = el('div', { class: 'index-panel', role: 'dialog', 'aria-label': 'Search index' });
  panelEl.addEventListener('click', (e) => e.stopPropagation());
  mainEl = el('main', {});

  app.append(header, panelEl, mainEl);

  document.addEventListener('click', () => state.panelOpen && setPanelOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.panelOpen) setPanelOpen(false);
  });
}

function renderPanel() {
  cogBtn.classList.toggle('active', state.panelOpen);
  cogBtn.setAttribute('aria-expanded', String(state.panelOpen));
  panelEl.hidden = !state.panelOpen;
  panelEl.textContent = '';
  if (!state.panelOpen) return;

  const builtIn = state.endpoint === DEFAULT_ENDPOINT;
  const s = state.stats;
  const status = s
    ? el('div', { class: 'index-status ok' }, [
        el('span', { class: 'dot' }),
        `${builtIn ? 'Built-in crawler' : 'Connected'} · ${plural(s.drives, 'drive')} · ${plural(s.topics, 'topic')}`,
      ])
    : el('div', { class: 'index-status err' }, [el('span', { class: 'dot' }), 'Not reachable']);

  const endpointInput = el('input', {
    type: 'url',
    value: state.endpoint,
    'aria-label': 'Index address',
    onkeydown: (e) => {
      if (e.key === 'Enter') setEndpoint(endpointInput.value);
    },
  });

  panelEl.append(
    el('h3', {}, ['Search index']),
    status,
    el('label', { class: 'field-label' }, ['Index address']),
    el('div', { class: 'endpoint' }, [
      endpointInput,
      el('button', { class: 'btn primary', onclick: () => setEndpoint(endpointInput.value) }, ['Use']),
      builtIn ? null : el('button', { class: 'btn', onclick: () => setEndpoint(DEFAULT_ENDPOINT) }, ['Reset']),
    ]),
    el('p', { class: 'hint' }, [
      'Nomad runs its own crawler while ',
      tabLink({}, 'nomad://settings/', ['Run the search crawler']),
      ' is on in Settings. To use another index, enter its address.',
    ])
  );
}

function renderMain() {
  mainEl.textContent = '';
  const wrap = el('div', { class: 'wrap' });

  if (state.topics.length) {
    wrap.append(
      el('div', { class: 'topics' }, [
        el('span', { class: 'topics-label' }, ['Topics']),
        ...state.topics.map((t) =>
          el(
            'button',
            {
              class: 'chip' + (state.topic === t.topic ? ' active' : ''),
              'aria-pressed': String(state.topic === t.topic),
              onclick: () => selectTopic(t.topic),
            },
            [t.topic, el('span', { class: 'count' }, [String(t.count)])]
          )
        ),
      ])
    );
  }

  if (state.status === 'loading' && !state.results.length) {
    wrap.append(el('div', { class: 'status' }, ['Searching…']));
  } else if (state.status === 'error') {
    wrap.append(
      el('div', { class: 'notice' }, [
        el('div', { class: 'notice-icon' }, [icon('plug')]),
        el('h2', {}, ['Can’t reach the search index']),
        el('p', {}, [
          state.endpoint === DEFAULT_ENDPOINT
            ? 'Is the search crawler on? It runs while “Run the search crawler” is on in Settings.'
            : `Nothing answered at ${state.endpoint}.`,
        ]),
        el('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); setPanelOpen(true); } }, [
          icon('cog'),
          ' Index settings',
        ]),
      ])
    );
  } else if (!state.results.length) {
    wrap.append(
      el('div', { class: 'notice' }, [
        el('div', { class: 'notice-icon' }, [icon('search')]),
        state.query || state.topic
          ? el('h2', {}, ['No listed drives match'])
          : el('h2', {}, ['No drives are listed yet']),
        el('p', {}, [
          'Only drives their owners listed appear here. List your own in ',
          tabLink({}, 'nomad://library/listings', ['My Library → Listings']),
          '.',
        ]),
      ])
    );
  } else {
    wrap.append(
      el('div', { class: 'result-count' }, [plural(state.results.length, 'drive')]),
      el('div', { class: 'results' }, state.results.map(renderResult))
    );
  }

  mainEl.append(wrap);
}

function renderResult(r) {
  const url = driveUrl(r.driveKey);
  const isFeed = r.type === FEED_TYPE;
  return el('div', { class: 'result' }, [
    el('img', {
      class: 'favicon',
      src: 'asset:favicon:' + url,
      alt: '',
      // No icon for this drive: show the generic drive glyph instead of a broken image.
      onerror: (e) => e.target.replaceWith(el('span', { class: 'favicon placeholder' }, [icon('hdd')])),
    }),
    el('div', { class: 'body' }, [
      el('div', { class: 'title-line' }, [
        tabLink({ class: 'title' }, url, [r.title || 'Untitled drive']),
        isFeed ? el('span', { class: 'badge' }, ['Feed']) : null,
      ]),
      r.description ? el('div', { class: 'desc' }, [r.description]) : null,
      el('div', { class: 'meta' }, [
        el('span', { class: 'url' }, [shortUrl(r.driveKey)]),
        ...(r.topics || []).map((t) =>
          el('button', { class: 'topic' + (state.topic === t ? ' active' : ''), onclick: () => selectTopic(t) }, [
            '#' + t,
          ])
        ),
      ]),
    ]),
    el('div', { class: 'actions' }, [
      isFeed
        ? tabLink({ class: 'btn' }, 'nomad://reader/?subscribe=' + encodeURIComponent(url), [
            icon('rss'),
            ' Subscribe',
          ])
        : null,
      tabLink({ class: 'btn primary' }, url, ['Open']),
    ]),
  ]);
}

function plural(n, word) {
  n = Number(n) || 0;
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// boot
// =
renderShell();
renderPanel();
renderMain();
refreshAll();
