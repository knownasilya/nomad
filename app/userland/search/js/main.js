// nomad://search — the public-discovery search client (ADR-0016 §5).
//
// Asks every search source the user has (a crawler super-peer's HTTP/JSON API, ADR-0014 §6) and
// shows one list, so no indexer is privileged: adding or dropping an index is a settings change.
// Search is global by default; Topics are an optional filter and an emergent directory (whatever
// listed Drives declare). A result that is a Feed gets a "Subscribe in Reader" action.
//
// The first source is the crawler the browser runs itself (bg/hyper/crawler-host.js, the
// `crawler_enabled` setting). It is usually on port 8787, but when another program holds that port
// the crawler takes a free one, so the page asks bg for the address (nomad.browser.getCrawlerEndpoint).
// The others are the `search_sources` setting, each with a name (js/sources.js). They are managed
// behind the cog in the header. With more than one source, each result names the ones that found it.
//
// Vanilla JS modules (served as-is, no bundle) like nomad://reader. Reaches the sources over
// fetch(), which the search page's dedicated CSP (bg/protocols/nomad.js SEARCH_CSP) permits via
// connect-src. Styled with the shell's own tokens (nomad://assets/design-tokens.css), so the page
// reads as part of the browser.

import {
  BUILT_IN_ID,
  BUILT_IN_NAME,
  normalizeSources,
  newSource,
  cleanUrl,
  mergeResults,
  mergeTopics,
} from './sources.js';

const SOURCES_SETTING = 'search_sources';
// Before named sources, the page kept one custom address here. Moved into the setting on load.
const LEGACY_ENDPOINT_KEY = 'nomad.search.endpoint';
// bg/hyper/crawler-host.js CRAWLER_PORT; used when the page runs outside the browser.
const FALLBACK_ENDPOINT = 'http://localhost:8787';
const FEED_TYPE = 'walled.garden/feed';

// nomad://search/?q=…&topic=… opens with that search run: the URL bar's "Search Nomad" entry links
// here (bg/dbs/settings.js search_engines, fg/location-bar).
const params = new URLSearchParams(location.search);

const state = {
  builtIn: { id: BUILT_IN_ID, name: BUILT_IN_NAME, url: FALLBACK_ENDPOINT, on: true },
  sources: [], // the user's own: [{ id, name, url, enabled }]
  health: {}, // source id -> { ok, stats } from the last /stats, for the panel
  query: params.get('q') || '',
  topic: params.get('topic') || '',
  topics: [],
  results: [],
  unreachable: [], // names of sources that didn't answer the last search
  status: 'idle', // idle | loading | ok | error | none
  panelOpen: false,
  addError: '',
};

// sources
// =

// The sources a search asks right now.
function activeSources() {
  const list = state.builtIn.on ? [state.builtIn] : [];
  return list.concat(state.sources.filter((s) => s.enabled));
}

async function api(source, pathAndQuery) {
  const res = await fetch(source.url + pathAndQuery, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Ask every active source; resolve with the ones that answered and the ones that didn't.
async function askAll(pathAndQuery) {
  const sources = activeSources();
  const settled = await Promise.allSettled(sources.map((s) => api(s, pathAndQuery)));
  const answers = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') answers.push({ source: sources[i], ...r.value });
    else failed.push(sources[i]);
  });
  return { answers, failed };
}

async function loadTopics() {
  const { answers } = await askAll('/topics');
  state.topics = mergeTopics(answers);
  renderMain();
}

async function loadHealth() {
  const sources = [state.builtIn, ...state.sources];
  await Promise.all(
    sources.map(async (s) => {
      if (s.id === BUILT_IN_ID && !s.on) return (state.health[s.id] = { off: true });
      try {
        state.health[s.id] = { ok: true, stats: await api(s, '/stats') };
      } catch {
        state.health[s.id] = { ok: false };
      }
    })
  );
  renderPanel();
}

let searchSeq = 0;
async function runSearch() {
  const seq = ++searchSeq;
  syncUrl();
  if (!activeSources().length) {
    state.status = 'none';
    state.results = [];
    return renderMain();
  }
  state.status = 'loading';
  renderMain();
  const qs = '/search?q=' + encodeURIComponent(state.query) + '&topic=' + encodeURIComponent(state.topic);
  const { answers, failed } = await askAll(qs);
  if (seq !== searchSeq) return; // a newer search started while this one was in flight
  state.results = mergeResults(answers);
  state.unreachable = failed.map((s) => s.name);
  state.status = answers.length ? 'ok' : 'error';
  renderMain();
}

// Keep the current search in the URL, so a reload or a copied link runs it again.
function syncUrl() {
  const qs = new URLSearchParams();
  if (state.query) qs.set('q', state.query);
  if (state.topic) qs.set('topic', state.topic);
  const search = qs.toString() ? '?' + qs : '';
  if (search !== location.search) history.replaceState(null, '', location.pathname + search);
}

// Ask bg where the built-in crawler serves. It answers null when the crawler is off.
async function loadBuiltIn() {
  if (!window.nomad?.browser?.getCrawlerEndpoint) return; // outside the browser: try the default port
  try {
    const url = await nomad.browser.getCrawlerEndpoint();
    state.builtIn.on = !!url;
    if (url) state.builtIn.url = cleanUrl(url);
  } catch {}
}

async function loadSources() {
  let saved = [];
  try {
    saved = (await window.nomad?.browser?.getSetting?.(SOURCES_SETTING)) || [];
  } catch {}
  state.sources = normalizeSources(saved);

  // Bring over the one custom address older versions kept in this page's storage.
  const legacy = localStorage.getItem(LEGACY_ENDPOINT_KEY);
  if (legacy) {
    localStorage.removeItem(LEGACY_ENDPOINT_KEY);
    try {
      state.sources.push(newSource('', legacy, state.sources));
      await saveSources();
    } catch {}
  }
}

async function saveSources() {
  try {
    await window.nomad?.browser?.setSetting?.(SOURCES_SETTING, state.sources);
  } catch (e) {
    console.warn('Could not save search sources', e);
  }
}

async function refreshAll() {
  state.status = 'loading';
  renderMain();
  await Promise.all([loadBuiltIn(), loadSources()]);
  loadTopics();
  if (state.panelOpen) loadHealth();
  runSearch();
}

// Any change to the list: save it, then search again with the new set.
async function changeSources(next) {
  state.sources = next;
  renderPanel();
  await saveSources();
  loadTopics();
  loadHealth();
  runSearch();
}

function addSource(name, url) {
  try {
    const source = newSource(name, url, [state.builtIn, ...state.sources]);
    state.addError = '';
    changeSources([...state.sources, source]);
    return true;
  } catch (e) {
    state.addError = e.message;
    renderPanel();
    return false;
  }
}

function updateSource(id, patch) {
  changeSources(state.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

function removeSource(id) {
  delete state.health[id];
  changeSources(state.sources.filter((s) => s.id !== id));
}

function selectTopic(topic) {
  state.topic = state.topic === topic ? '' : topic;
  runSearch();
}

function setPanelOpen(open) {
  state.panelOpen = open;
  if (open) loadHealth();
  else state.addError = '';
  renderPanel();
}

// helpers
// =

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'class') node.className = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'value' || k === 'checked') node[k] = attrs[k];
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
        e.stopPropagation();
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
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(runSearch, 200); // the indexes are fast; search as you type
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
      title: 'Search sources',
      'aria-label': 'Search sources',
      'aria-expanded': 'false',
      onclick: (e) => {
        e.stopPropagation();
        setPanelOpen(!state.panelOpen);
      },
    },
    [icon('sliders-h')]
  );

  const header = el('header', {}, [
    el('div', { class: 'search-ctrl' }, [icon('search'), input]),
    el('div', { class: 'header-actions' }, [cogBtn]),
  ]);

  panelEl = el('div', { class: 'sources-panel', role: 'dialog', 'aria-label': 'Search sources' });
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
  if (!state.panelOpen) return (panelEl.textContent = '');

  // Rebuilding the panel would drop what the user is typing into the add form; keep its values.
  const prevName = panelEl.querySelector('.add-name')?.value || '';
  const prevUrl = panelEl.querySelector('.add-url')?.value || '';
  panelEl.textContent = '';

  const nameInput = el('input', { class: 'add-name', type: 'text', placeholder: 'Name', value: prevName });
  const urlInput = el('input', {
    class: 'add-url',
    type: 'url',
    placeholder: 'https://index.example',
    value: prevUrl,
    'aria-label': 'Index address',
  });
  const submit = (e) => {
    e.preventDefault();
    if (addSource(nameInput.value, urlInput.value)) {
      nameInput.value = '';
      urlInput.value = '';
    }
  };

  panelEl.append(
    el('div', { class: 'panel-title' }, ['Search sources']),
    el('ul', { class: 'source-list' }, [renderBuiltInRow(), ...state.sources.map(renderSourceRow)]),
    el('form', { class: 'add-source', onsubmit: submit }, [
      nameInput,
      urlInput,
      el('button', { class: 'btn', type: 'submit' }, ['Add']),
    ]),
    state.addError ? el('div', { class: 'add-error' }, [state.addError]) : '',
    el('p', { class: 'hint' }, [
      'Add any index that serves the Nomad crawler API. Your sources are kept on all your devices.',
    ])
  );
}

function statusText(id) {
  const h = state.health[id];
  if (!h) return ['', 'Checking…'];
  if (h.off) return ['off', 'Off'];
  if (!h.ok) return ['err', 'Not reachable'];
  return ['ok', plural(h.stats?.drives, 'drive')];
}

function renderBuiltInRow() {
  const [cls, text] = statusText(BUILT_IN_ID);
  return el('li', { class: 'source' }, [
    el('span', { class: 'dot ' + cls, title: text }),
    el('div', { class: 'source-body' }, [
      el('div', { class: 'source-name static' }, [BUILT_IN_NAME]),
      el('div', { class: 'source-sub' }, [
        state.builtIn.on ? `This device’s crawler · ${text}` : 'Turned off in ',
        state.builtIn.on ? null : tabLink({}, 'nomad://settings/', ['Settings']),
      ]),
    ]),
  ]);
}

function renderSourceRow(s) {
  const [cls, text] = s.enabled ? statusText(s.id) : ['off', 'Paused'];
  return el('li', { class: 'source' + (s.enabled ? '' : ' paused') }, [
    el('span', { class: 'dot ' + cls, title: text }),
    el('div', { class: 'source-body' }, [
      el('input', {
        class: 'source-name',
        type: 'text',
        value: s.name,
        'aria-label': 'Source name',
        title: 'Rename',
        onchange: (e) => {
          const name = e.target.value.trim();
          if (name && name !== s.name) updateSource(s.id, { name });
          else e.target.value = s.name;
        },
        onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
      }),
      el('div', { class: 'source-sub', title: s.url }, [s.url + ' · ' + text]),
    ]),
    el('input', {
      class: 'toggle',
      type: 'checkbox',
      checked: s.enabled,
      title: s.enabled ? 'Pause this source' : 'Use this source',
      'aria-label': 'Use ' + s.name,
      onchange: (e) => updateSource(s.id, { enabled: e.target.checked }),
    }),
    el(
      'button',
      { class: 'icon-btn small', title: 'Remove', 'aria-label': 'Remove ' + s.name, onclick: () => removeSource(s.id) },
      [icon('times')]
    ),
  ]);
}

function openPanel(e) {
  e.stopPropagation();
  setPanelOpen(true);
}

function renderMain() {
  mainEl.textContent = '';
  const wrap = el('div', { class: 'wrap' });

  if (state.topics.length) {
    wrap.append(
      el('div', { class: 'topics' }, [
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
  } else if (state.status === 'none') {
    wrap.append(
      notice('search', 'No search sources', [
        'The built-in crawler is off and you have no other sources. Turn it on in ',
        tabLink({}, 'nomad://settings/', ['Settings']),
        ', or add an index.',
      ]),
      el('div', { class: 'notice-actions' }, [el('button', { class: 'btn', onclick: openPanel }, ['Search sources'])])
    );
  } else if (state.status === 'error') {
    wrap.append(
      notice('plug', 'Can’t reach your search sources', [
        `${state.unreachable.join(', ')} didn’t answer.`,
        state.builtIn.on ? ' The built-in crawler may still be starting.' : '',
      ]),
      el('div', { class: 'notice-actions' }, [el('button', { class: 'btn', onclick: openPanel }, ['Search sources'])])
    );
  } else if (!state.results.length) {
    wrap.append(
      notice('search', state.query || state.topic ? 'No listed drives match' : 'No drives are listed yet', [
        'Only drives their owners listed appear here. List your own in ',
        tabLink({}, 'nomad://library/listings', ['My Library → Listings']),
        '.',
      ])
    );
  } else {
    wrap.append(
      el('div', { class: 'result-count' }, [
        plural(state.results.length, 'drive'),
        state.unreachable.length ? el('span', { class: 'warn' }, [` · ${state.unreachable.join(', ')} didn’t answer`]) : null,
      ]),
      el('ol', { class: 'results' }, state.results.map(renderResult))
    );
  }

  mainEl.append(wrap);
}

function notice(iconName, title, body) {
  return el('div', { class: 'notice' }, [
    el('div', { class: 'notice-icon' }, [icon(iconName)]),
    el('h2', {}, [title]),
    el('p', {}, body),
  ]);
}

function renderResult(r) {
  const url = driveUrl(r.driveKey);
  const isFeed = r.type === FEED_TYPE;
  // Name the sources only when there is more than one to tell apart.
  const sources = activeSources().length > 1 && r.sources?.length ? r.sources.map((s) => s.name).join(', ') : '';
  return el('li', { class: 'result', onclick: () => openInTab(url) }, [
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
      el('div', { class: 'url-line' }, [
        el('span', { class: 'url' }, [shortUrl(r.driveKey)]),
        sources ? el('span', { class: 'via', title: 'Found by ' + sources }, ['· ' + sources]) : null,
      ]),
      r.description ? el('div', { class: 'desc' }, [r.description]) : null,
      r.topics?.length
        ? el(
            'div',
            { class: 'meta' },
            r.topics.map((t) =>
              el(
                'button',
                {
                  class: 'topic' + (state.topic === t ? ' active' : ''),
                  onclick: (e) => {
                    e.stopPropagation();
                    selectTopic(t);
                  },
                },
                ['#' + t]
              )
            )
          )
        : null,
    ]),
    isFeed
      ? el('div', { class: 'actions' }, [
          tabLink({ class: 'btn', title: 'Subscribe in Reader' }, 'nomad://reader/?subscribe=' + encodeURIComponent(url), [
            icon('rss'),
            ' Subscribe',
          ]),
        ])
      : null,
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
