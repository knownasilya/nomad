// nomad://notes — Markdown notes that follow the user to each of their Devices, edited the way
// Obsidian edits them: Live Preview, [[note links]], and linked mentions under each note.
//
// Notes come from nomad.vault (bg/web-apis/bg/vault-apps.ts, ADR-0017) and live in the Vault, so the
// user's other Devices (the phone too) read and edit the same notes. Another Device's edit arrives
// on watchAppData(). The record format and the link rules are in shared/vault-apps.mjs; the editor
// is ./editor/ (shared with the phone's Notes).
//
// A note is one Markdown body; its first line is its title. Edits save a moment after typing stops.
// Each save names the version it started from, so an edit made at the same time on another Device
// is never lost: the later one is saved as a conflict copy. A note left empty is never stored, and
// an emptied one is deleted when you leave it. Retitling a note updates the links to it.
//
// A note is the user's, in every Space, or kept only in this Space (ADR-0029). The list shows the
// Space's notes first, under the Space's name, then All Spaces; the toolbar's scope button moves the
// open note between them. A new note is kept in this Space.
//
// Each note has its own address, nomad://notes/<id>, so back and forward move between notes.
// The header's List / Canvas switch swaps the list and the editor for a canvas of every note and
// the links between them (./graph.js, drawn by app-stdlib's canvas); ?view=canvas in the address keeps it across back and
// forward, and the last choice is remembered for the next visit.
//
// A note can have topics (ADR-0035): the bar above its text shows them, adds and removes them, and
// asks the AI to suggest some. This Device's AI also sorts notes by itself once they settle
// (bg/web-apis/bg/note-topics.ts). The topic chips above the list show one topic's notes, and on
// the canvas every topic is a hub with its notes around it; clicking a hub lists its notes.
// Bundled (scripts/build.js → js/main.build.js), styled with the app-stdlib tokens like nomad://reader.

import { createNoteEditor } from './editor/index.js';
import { createGraphView } from '../../app-stdlib/js/graph/view.js';
import { noteGraph, noteTexts, noteGraphCounts, topicNodeId } from './graph.js';
import { noteTitle, noteSnippet, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

const SAVE_DELAY = 700;
const VIEW_KEY = 'nomad-notes-view';

const state = {
  notes: [], // stored notes, newest first
  query: '',
  loaded: false,
  writable: true, // false while a Device that just joined waits for the Vault
  linked: false, // another Device shares the Vault
  space: null, // this page's Space key, or null
  spaceName: null,
  shared: false, // this Space is shared with other people (ADR-0029)
  canWriteSpace: true, // false for a person who can only view the shared Space
  members: 0,
  topic: null, // the topic whose notes the list shows, or null for all
  // What the AI is doing with topics: { autoTopics, tagging: [noteId], noRuntime }.
  ai: { autoTopics: false, tagging: [], noRuntime: false },
};

// The note in the editor: { id: string | null, body, base, openedTitle, conflictOf, inSpace }. id
// is null until the first save; base is the updatedAt of the version the editor started from;
// inSpace says the note is kept only in this Space.
let draft = null;
let dirty = false; // the editor has text that isn't saved
let saving = null; // the save in flight
let saveTimer = null;
let saveMsg = { kind: 'idle', text: '' };
let banner = null; // { text, originalId } after a conflict copy was made
let mentionsOpen = false; // the user opened Linked mentions; it stays open from note to note
let editor = null;
let view = 'list'; // 'list' (the list and the open note) or 'canvas' (the notes and their links)
let graph = null; // the canvas, made the first time it's shown

const app = document.getElementById('app');
let listEl, topicsEl, mainEl, searchInput, newBtn, savedEl, layoutEl, graphPane, graphInfo, graphHint;
const viewBtns = new Map();

// ── Boot ─────────────────────────────────────────────────────────────────────

renderShell();
init().catch((err) => {
  mainEl.replaceChildren(notice('exclamation-triangle', 'Notes failed to start', [err.message || String(err)]));
  console.error('[notes] init error:', err);
});

async function init() {
  await loadNotes();
  state.loaded = true;
  const fromUrl = idFromUrl();
  const params = new URLSearchParams(location.search);
  // A link to a note opens that note; a bare nomad://notes opens the view used last.
  if (params.get('view') === 'canvas') view = 'canvas';
  else if (!fromUrl && !params.has('write') && storedView() === 'canvas') view = 'canvas';
  const first = state.notes.find((n) => n.id === fromUrl) || state.notes[0];
  if (first) await openNote(first.id, { push: false });
  else renderAll();
  // A note just made from a page Highlight opens with ?write: the cursor goes to its end, to type.
  if (first && first.id === fromUrl && new URLSearchParams(location.search).has('write')) {
    history.replaceState(null, '', location.pathname);
    writeAtEnd();
  }
  window.addEventListener('beforeunload', () => {
    save();
  });
  window.addEventListener('popstate', () => {
    const id = idFromUrl();
    const v = viewFromUrl();
    if (v !== view) {
      view = v;
      applyView();
    }
    if (id && (!draft || draft.id !== id)) openNote(id, { push: false });
  });
  watchOtherDevices();
}

function writeAtEnd() {
  if (!editor || !state.writable) return;
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length }, scrollIntoView: true });
  editor.focus();
}

function idFromUrl() {
  return decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''));
}

function viewFromUrl() {
  return new URLSearchParams(location.search).get('view') === 'canvas' ? 'canvas' : 'list';
}

function setUrl(id, push) {
  const path = '/' + (id ? encodeURIComponent(id) : '') + (view === 'canvas' ? '?view=canvas' : '');
  if (location.pathname + location.search === path) return;
  if (push) history.pushState(null, '', path);
  else history.replaceState(null, '', path);
}

function storedView() {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

// The List / Canvas switch. The open note stays open behind the canvas.
function setView(v) {
  if (v === view) return;
  view = v;
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  setUrl(draft?.id || null, true);
  applyView();
  if (v === 'list') editor?.focus();
}

// ── Data (nomad.vault) ───────────────────────────────────────────────────────

async function loadNotes() {
  const res = await nomad.vault.listNotes();
  state.notes = res.notes || [];
  state.writable = res.writable !== false;
  state.linked = !!res.linked;
  state.space = res.space || null;
  state.spaceName = res.space ? res.spaceName || 'This Space' : null;
  // A shared Space (ADR-0029): its notes are seen by its members. A new note goes to this Space.
  state.shared = !!res.shared;
  state.canWriteSpace = res.canWriteSpace !== false;
  state.members = res.members || 0;
  state.ai = { autoTopics: false, tagging: [], noRuntime: false, ...(res.ai || {}) };
  // The topic shown may have gone (its last note lost it, on this Device or another).
  if (state.topic && !topicCounts().some((t) => t.topic.toLowerCase() === state.topic.toLowerCase())) state.topic = null;
  editor?.setNotes(state.notes);
}

// Another Device added, edited, or deleted a note. Our own saves land here too; they change nothing.
function watchOtherDevices() {
  let events;
  try {
    events = nomad.vault.watchAppData();
  } catch {
    return;
  }
  events.addEventListener('changed', async () => {
    try {
      await loadNotes();
    } catch {
      return;
    }
    if (draft && draft.id && !dirty && !saving) {
      const fresh = state.notes.find((n) => n.id === draft.id);
      if (!fresh) {
        // Deleted on another Device.
        draft = null;
        const next = state.notes[0];
        if (next) return openNote(next.id, { push: false });
      } else if (fresh.updatedAt !== draft.base) {
        draft.body = fresh.body;
        draft.base = fresh.updatedAt;
        editor?.setText(fresh.body);
      }
    }
    renderAll({ keepEditor: true });
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

async function save() {
  clearTimeout(saveTimer);
  if (saving) {
    await saving.catch(() => {});
    return save();
  }
  const target = draft;
  if (!target || !dirty) return;
  dirty = false;
  if (!target.id && !target.body.trim()) return; // an empty new note is never stored

  setSaveMsg('saving', 'Saving…');
  const wasId = target.id;
  saving = nomad.vault.saveNote({
    id: target.id || undefined,
    body: target.body,
    baseUpdatedAt: target.base || undefined,
    inSpace: !!target.inSpace,
  });
  try {
    const note = await saving;
    upsert(note);
    if (wasId && note.id !== wasId) {
      // Another Device saved this note while we edited it: our text is now a conflict copy.
      target.id = note.id;
      target.body = note.body;
      target.conflictOf = wasId;
      target.openedTitle = noteTitle(note.body);
      if (draft === target) {
        editor?.setText(note.body);
        setUrl(note.id, false);
        banner = { text: 'This note changed on another device while you edited it. Your version is saved here, as a copy.', originalId: wasId };
      }
      await loadNotes().catch(() => {});
      renderAll({ keepEditor: true });
    } else if (!wasId) {
      target.id = note.id;
      target.openedTitle = noteTitle(note.body);
      if (draft === target) {
        setUrl(note.id, false);
        renderAround(); // the topic bar, now that it has an id
      }
    }
    target.base = note.updatedAt;
    setSaveMsg('saved', 'Saved');
  } catch (e) {
    if (draft === target) dirty = true;
    setSaveMsg('error', 'Not saved: ' + (e.message || e));
  } finally {
    saving = null;
  }
  renderList();
  if (dirty && draft === target && saveMsg.kind !== 'error') scheduleSave();
}

function upsert(note) {
  state.notes = [note, ...state.notes.filter((n) => n.id !== note.id)];
  editor?.setNotes(state.notes);
}

// A note whose topics changed: its place in the list stays (its updatedAt didn't change).
function replaceNote(note) {
  state.notes = state.notes.map((n) => (n.id === note.id ? note : n));
}

async function newNote(body = '') {
  await leaveNote();
  view = 'list';
  // A new note is kept in this Space; the scope button shows it in every Space. A person who can
  // only view a shared Space keeps it to themselves.
  draft = { id: null, body, base: null, openedTitle: null, conflictOf: null, inSpace: !!(state.space && state.canWriteSpace) };
  dirty = !!body;
  banner = null;
  setUrl(null, true);
  setSaveMsg('idle', '');
  renderAll();
  editor?.focus();
  if (dirty) save();
}

async function openNote(id, { push = true, heading = '' } = {}) {
  if (draft && draft.id === id) {
    if (heading) editor?.goToHeading(heading);
    return;
  }
  await leaveNote();
  const note = state.notes.find((n) => n.id === id);
  if (!note) {
    renderAll();
    return;
  }
  draft = {
    id: note.id,
    body: note.body,
    base: note.updatedAt,
    openedTitle: noteTitle(note.body),
    conflictOf: note.conflictOf || null,
    inSpace: !!note.space,
  };
  dirty = false;
  banner = null;
  setUrl(note.id, push);
  setSaveMsg('idle', '');
  renderAll();
  if (heading) editor?.goToHeading(heading);
}

// Save the open note before showing another one. An emptied note is deleted, not kept blank. A note
// whose title changed gets the links to it updated (like a rename in Obsidian).
async function leaveNote() {
  const prev = draft;
  if (!prev) return;
  await save();
  if (!prev.id || !state.writable) return;
  if (!prev.body.trim()) {
    try {
      await nomad.vault.deleteNote(prev.id);
      state.notes = state.notes.filter((n) => n.id !== prev.id);
    } catch (e) {
      console.warn('[notes] could not delete an empty note', e);
    }
    return;
  }
  const title = noteTitle(prev.body);
  if (prev.openedTitle && title !== prev.openedTitle) {
    try {
      const changed = await nomad.vault.renameNoteLinks({ id: prev.id, from: prev.openedTitle, to: title });
      if (changed) await loadNotes();
    } catch (e) {
      console.warn('[notes] could not update links to a renamed note', e);
    }
  }
}

async function deleteCurrent() {
  if (!draft) return;
  if (draft.id) {
    const where = state.linked ? ' from all your linked devices' : '';
    if (!confirm(`Delete “${noteTitle(draft.body)}”${where}?`)) return;
    clearTimeout(saveTimer);
    if (saving) await saving.catch(() => {});
    try {
      await nomad.vault.deleteNote(draft.id);
    } catch (e) {
      setSaveMsg('error', 'Not deleted: ' + (e.message || e));
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== draft.id);
  }
  draft = null;
  dirty = false;
  banner = null;
  const next = visibleNotes()[0];
  if (next) openNote(next.id, { push: false });
  else {
    setUrl(null, false);
    renderAll();
  }
}

// The notes with the open note's unsaved text in place of its stored text.
function liveNotes() {
  if (!draft) return state.notes;
  const stored = draft.id ? state.notes.find((n) => n.id === draft.id) : null;
  const others = state.notes.filter((n) => n.id !== draft.id);
  return [{ ...(stored || {}), id: draft.id || '', body: draft.body, updatedAt: '￿' }, ...others];
}

// A note picked on the canvas opens in the list view; back returns to the canvas. A topic's hub
// lists that topic's notes.
async function openFromCanvas(id) {
  if (id.startsWith('topic:')) {
    const t = topicCounts().find((x) => topicNodeId(x.topic) === id);
    if (!t) return;
    state.topic = t.topic;
    view = 'list';
    setUrl(draft?.id || null, true);
    applyView();
    renderList();
    return;
  }
  view = 'list';
  if (draft && draft.id === id) {
    setUrl(id, true);
    applyView();
    editor?.focus();
    return;
  }
  await openNote(id);
}

// Follow a link from the editor. A link to a note that doesn't exist yet creates it.
async function openLink(link) {
  if (link.kind === 'url') {
    openInTab(link.href);
    return;
  }
  const target = makeResolver(liveNotes())(link.target);
  if (target && target.id) {
    openNote(target.id, { heading: link.heading });
    return;
  }
  if (!state.writable) return;
  await newNote(`# ${link.target}\n\n`);
}

// ── Render ───────────────────────────────────────────────────────────────────

// The header is built once, so typing in the search box never loses focus to a re-render.
function renderShell() {
  searchInput = el('input', {
    type: 'search',
    placeholder: 'Search notes',
    'aria-label': 'Search notes',
    oninput: (e) => {
      state.query = e.target.value;
      renderList();
      graph?.setQuery(state.query);
    },
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.query = '';
        renderList();
        graph?.setQuery('');
      }
    },
  });
  newBtn = el('button', { class: 'btn primary', onclick: () => newNote() }, [icon('plus'), ' New note']);
  const switcher = el('div', { class: 'view-switch', role: 'group', 'aria-label': 'View' }, [
    viewButton('list', 'list-ul', 'List'),
    viewButton('canvas', 'project-diagram', 'Canvas'),
  ]);

  const header = el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://notes/', alt: '' }), 'Notes']),
    el('div', { class: 'search-ctrl' }, [icon('search'), searchInput]),
    el('div', { class: 'header-actions' }, [switcher, newBtn]),
  ]);
  listEl = el('div', { class: 'notes' });
  topicsEl = el('div', { class: 'topic-filter', role: 'group', 'aria-label': 'Topics' });
  const nav = el('nav', {}, [topicsEl, listEl, el('footer', {}, [])]);
  mainEl = el('main', {});
  graphInfo = el('span', { class: 'graph-info' });
  graphHint = el('div', { class: 'graph-hint' });
  graphPane = el('section', { class: 'graph-pane graph-surface', 'aria-label': 'Canvas' }, [
    el('div', { class: 'graph-overlay top' }, [
      graphInfo,
      el('span', { class: 'graph-legend' }, [el('span', { class: 'key key-topic' }, ['Topic']), el('span', { class: 'key key-note' }, ['Note'])]),
    ]),
    graphHint,
    el('div', { class: 'graph-overlay bottom' }, [
      el('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => graph?.zoomIn() }, [icon('plus')]),
      el('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => graph?.zoomOut() }, [icon('minus')]),
      el('button', { class: 'icon-btn', title: 'Fit all notes', 'aria-label': 'Fit all notes', onclick: () => graph?.fit() }, [icon('compress-arrows-alt')]),
    ]),
  ]);
  layoutEl = el('div', { class: 'layout' }, [nav, mainEl, graphPane]);
  app.append(header, layoutEl);
}

function viewButton(v, ic, label) {
  const b = el('button', { class: 'view-btn', title: label, 'aria-pressed': 'false', onclick: () => setView(v) }, [icon(ic), el('span', {}, [label])]);
  viewBtns.set(v, b);
  return b;
}

// Show the list and the note, or the canvas.
function applyView() {
  const canvas = view === 'canvas';
  layoutEl.classList.toggle('canvas', canvas);
  for (const [v, b] of viewBtns) {
    b.classList.toggle('active', v === view);
    b.setAttribute('aria-pressed', String(v === view));
  }
  if (canvas) {
    const made = !graph;
    if (!graph) graph = createGraphView({ parent: graphPane, onOpen: openFromCanvas, label: 'Notes, their links and their topics' });
    renderGraph();
    graph.setVisible(true);
    // The topic the list showed lights up on the canvas.
    if (made || state.topic) graph.select(state.topic ? topicNodeId(state.topic) : null);
  } else {
    graph?.setVisible(false);
    editor?.view.requestMeasure();
  }
}

// The canvas shows what's typed in the open note, like the list does.
function renderGraph() {
  if (!graph || view !== 'canvas' || !state.loaded) return;
  const notes = liveNotes().filter((n) => n.id);
  const data = noteGraph(notes);
  graph.update(data, {
    currentId: draft?.id || null,
    query: state.query,
    // Search matches a note's text and topics, like the list does.
    texts: noteTexts(notes),
  });
  const { notes: count, links, topics } = noteGraphCounts(data);
  const parts = [plural(count, 'note'), plural(links, 'link')];
  if (topics) parts.push(plural(topics, 'topic'));
  graphInfo.textContent = parts.join(' · ');
  graphPane.classList.toggle('has-topics', topics > 0);
  if (!count) {
    const action = state.writable ? el('button', { class: 'btn primary', onclick: () => newNote() }, [icon('plus'), ' New note']) : null;
    graphHint.replaceChildren(notice('project-diagram', 'No notes yet', ['Your notes and the links between them appear here.'], action));
  } else if (!links && !topics) {
    graphHint.replaceChildren(el('p', { class: 'graph-tip' }, [icon('link'), 'No links yet. Link notes with [[ and a note’s title, or give them topics.']));
  } else graphHint.replaceChildren();
}

// keepEditor: leave the editor as it is (it already shows the right text), refresh the rest.
function renderAll({ keepEditor = false } = {}) {
  newBtn.disabled = !state.writable;
  renderList();
  if (keepEditor && editor && draft) renderAround();
  else renderEditor();
  app.querySelector('nav footer').replaceChildren(syncNote());
  applyView();
}

function visibleNotes() {
  const q = state.query.trim().toLowerCase();
  const topic = state.topic ? state.topic.toLowerCase() : null;
  return state.notes.filter(
    (n) =>
      (!q || n.body.toLowerCase().includes(q) || topicsOf(n).some((t) => t.toLowerCase().includes(q))) &&
      (!topic || topicsOf(n).some((t) => t.toLowerCase() === topic))
  );
}

const topicsOf = (n) => (n && Array.isArray(n.topics) ? n.topics : []);

// Every topic the notes use, most used first (shared/note-topics.mjs noteTopicCounts).
function topicCounts() {
  const counts = new Map();
  for (const n of state.notes) {
    for (const t of topicsOf(n)) {
      const c = counts.get(t.toLowerCase()) || { topic: t, count: 0 };
      c.count++;
      counts.set(t.toLowerCase(), c);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function setTopic(topic) {
  state.topic = topic && state.topic?.toLowerCase() === topic.toLowerCase() ? null : topic;
  if (view === 'canvas') graph?.select(state.topic ? topicNodeId(state.topic) : null, { center: !!state.topic });
  renderList();
}

// The chips above the list: all notes, or one topic's. The AI's offer to sort the notes that have
// no topic yet, when it doesn't do so by itself.
function renderTopicFilter() {
  const all = topicCounts();
  const untagged = state.notes.filter((n) => !n.topicsBy && n.body.trim() && !state.ai.tagging.includes(n.id));
  const offer = state.writable && !state.ai.autoTopics && untagged.length
    ? el('button', { class: 'topic-chip suggest', title: 'Ask this device’s AI to sort them into topics', onclick: () => suggestTopics(null) }, [
        icon('magic'),
        ` Sort ${plural(untagged.length, 'note')} into topics`,
      ])
    : null;
  if (!all.length && !offer) {
    topicsEl.replaceChildren();
    topicsEl.hidden = true;
    return;
  }
  topicsEl.hidden = false;
  const chip = (label, count, on, onclick, title) =>
    el('button', { class: 'topic-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), title, onclick }, [
      label,
      count != null ? el('span', { class: 'n' }, [String(count)]) : null,
    ]);
  topicsEl.replaceChildren(
    ...(all.length ? [chip('All', null, !state.topic, () => setTopic(null), 'Every note')] : []),
    ...all.map((t) => chip(t.topic, t.count, state.topic?.toLowerCase() === t.topic.toLowerCase(), () => setTopic(t.topic), `Notes about ${t.topic}`)),
    ...(offer ? [offer] : [])
  );
}

function renderList() {
  renderTopicFilter();
  if (!state.loaded) {
    listEl.replaceChildren(el('div', { class: 'list-msg' }, ['Loading…']));
    return;
  }
  const items = [];
  // A new note shows at the top until it's saved.
  if (draft && !draft.id) items.push(noteItem({ id: null, body: draft.body, updatedAt: null }));
  // The open note shows what's typed, not the last saved text.
  const item = (n) => noteItem(draft && draft.id === n.id ? { ...n, body: draft.body } : n);
  const notes = visibleNotes();
  const inSpace = notes.filter((n) => n.space);
  const everywhere = notes.filter((n) => !n.space);
  // Under headings only when this Space has notes of its own.
  if (state.spaceName && inSpace.length) {
    const head = state.shared ? `${state.spaceName} · ${sharedWith()}` : state.spaceName;
    items.push(el('div', { class: 'list-section' }, [icon(state.shared ? 'user-friends' : 'thumbtack'), head]), ...inSpace.map(item));
    if (everywhere.length) items.push(el('div', { class: 'list-section' }, [icon('globe'), 'All Spaces']));
  }
  items.push(...everywhere.map(item));
  if (!items.length) {
    items.push(el('div', { class: 'list-msg' }, [state.query || state.topic ? 'No notes match.' : 'No notes yet.']));
  }
  listEl.replaceChildren(...items);
}

function noteItem(n) {
  const current = draft && draft.id === n.id;
  const snippet = noteSnippet(n.body);
  return el(
    'button',
    { class: 'note-item' + (current ? ' current' : ''), onclick: () => n.id && openNote(n.id) },
    [
      el('div', { class: 'title' }, [noteTitle(n.body)]),
      el('div', { class: 'sub' }, [
        el('span', { class: 'date' }, [n.updatedAt ? relativeDate(n.updatedAt) : 'Now']),
        snippet ? el('span', { class: 'snippet' }, [snippet]) : null,
      ]),
      topicsOf(n).length ? el('div', { class: 'item-topics' }, topicsOf(n).map((t) => el('span', { class: 'tag' }, [t]))) : null,
    ]
  );
}

function renderEditor() {
  editor?.destroy();
  editor = null;
  savedEl = null;
  if (!state.loaded) return;
  if (!draft) {
    mainEl.replaceChildren(
      notice(
        'sticky-note',
        state.notes.length ? 'No note open' : 'No notes yet',
        [state.notes.length ? 'Pick a note on the left, or start a new one.' : 'Your notes appear here. Link them with [[ and a note’s title.'],
        state.writable ? el('button', { class: 'btn primary', onclick: () => newNote() }, [icon('plus'), ' New note']) : null
      )
    );
    return;
  }

  savedEl = el('span', { class: 'saved' });
  const host = el('div', { class: 'cm-host' });
  mainEl.replaceChildren(
    el('div', { class: 'toolbar' }, [
      ...toolbarButtons(),
      el('span', { class: 'spacer' }),
      savedEl,
      scopeButton(),
      el(
        'button',
        { class: 'icon-btn danger', title: 'Delete note', 'aria-label': 'Delete note', disabled: !state.writable, onclick: deleteCurrent },
        [icon('trash')]
      ),
    ]),
    el('div', { class: 'page' }, [el('div', { class: 'banner-slot' }), el('div', { class: 'topic-slot' }), host, el('div', { class: 'backlinks-slot' })])
  );
  editor = createNoteEditor({
    parent: host,
    doc: draft.body,
    notes: state.notes,
    readOnly: !state.writable,
    placeholder: 'Start typing. The first line is the title. Type [[ to link a note.',
    onChange: (text) => {
      draft.body = text;
      dirty = true;
      setSaveMsg('idle', '');
      renderList();
      scheduleSave();
    },
    onOpenLink: openLink,
  });
  if (!draft.id) editor.focus();
  renderAround();
  renderSaveMsg();
}

// Where the open note is: in every Space, or only in this one. A click moves it.
function scopeButton() {
  if (!state.spaceName || !draft) return null;
  if (state.shared) {
    // A shared Space: the note is seen by its members, or kept private (the user's own).
    const label = draft.inSpace ? sharedWith() : 'Private';
    const title = draft.inSpace
      ? `Seen by everyone in ${state.spaceName}. Click to keep it private`
      : `Only you see this note. Click to share it with ${state.spaceName}`;
    return el(
      'button',
      { class: 'btn scope', title, 'aria-label': title, disabled: !state.writable || !state.canWriteSpace, onclick: toggleScope },
      [icon(draft.inSpace ? 'user-friends' : 'lock'), label]
    );
  }
  const label = draft.inSpace ? `Only in ${state.spaceName}` : 'All Spaces';
  const title = draft.inSpace ? 'Kept only in this Space. Click to show it in every Space' : `Shown in every Space. Click to keep it only in ${state.spaceName}`;
  return el(
    'button',
    { class: 'btn scope', title, 'aria-label': title, disabled: !state.writable, onclick: toggleScope },
    [icon(draft.inSpace ? 'thumbtack' : 'globe'), label]
  );
}

// "Shared with 2 people": the Space's other members.
function sharedWith() {
  const others = Math.max(0, (state.members || 1) - 1);
  return others ? `Shared with ${others} ${others === 1 ? 'person' : 'people'}` : 'Shared';
}

async function toggleScope() {
  const target = draft;
  if (!target) return;
  const inSpace = !target.inSpace;
  if (!target.id) {
    target.inSpace = inSpace; // saved there when it's first saved
    renderEditorToolbar();
    return;
  }
  await save();
  try {
    const note = await nomad.vault.moveNote({ id: target.id, inSpace });
    target.inSpace = !!note.space;
    upsert(note);
  } catch (e) {
    setSaveMsg('error', 'Not moved: ' + (e.message || e));
    return;
  }
  renderList();
  renderEditorToolbar();
}

// Redraw the scope button after the note moved, keeping the editor.
function renderEditorToolbar() {
  const old = mainEl.querySelector('.toolbar .scope');
  const next = scopeButton();
  if (old && next) old.replaceWith(next);
}

const TOOLS = [
  ['heading', 'heading', 'Heading'],
  ['bold', 'bold', 'Bold (⌘B)'],
  ['italic', 'italic', 'Italic (⌘I)'],
  ['strike', 'strikethrough', 'Strikethrough'],
  ['bullet', 'list-ul', 'Bulleted list'],
  ['task', 'check-square', 'Task (⌘L)'],
  ['quote', 'quote-right', 'Quote'],
  ['code', 'code', 'Code (⌘E)'],
  ['link', 'link', 'Link to a note (⌘K)'],
];

function toolbarButtons() {
  return TOOLS.map(([cmd, ic, label]) =>
    el(
      'button',
      {
        class: 'icon-btn tool',
        title: label,
        'aria-label': label,
        disabled: !state.writable,
        // Keep the editor's selection: act on mousedown, before the click moves focus.
        onmousedown: (e) => {
          e.preventDefault();
          editor?.run(cmd);
        },
      },
      [icon(ic)]
    )
  );
}

// The parts around the editor that change while it stays: the conflict banner and linked mentions.
function renderAround() {
  const bannerSlot = mainEl.querySelector('.banner-slot');
  const backSlot = mainEl.querySelector('.backlinks-slot');
  if (!bannerSlot || !backSlot) return;

  const original = draft?.conflictOf && state.notes.find((n) => n.id === draft.conflictOf);
  if (banner || draft?.conflictOf) {
    bannerSlot.replaceChildren(
      el('div', { class: 'banner' }, [
        icon('code-branch'),
        el('span', {}, [
          banner?.text || 'This is a conflict copy, made when two devices edited the same note at once.',
          ' Merge what you need, then delete the copy.',
        ]),
        original ? el('button', { class: 'btn', onclick: () => openNote(original.id) }, ['Open original']) : null,
      ])
    );
  } else bannerSlot.replaceChildren();

  backSlot.replaceChildren(renderBacklinks());
  renderNoteTopics();
}

// The open note's topics, above its text: each one shows its notes, × takes it off; type to add
// one (Enter or a comma), or ask the AI to suggest some. Redrawn when the topics change, keeping a
// half-typed topic.
function renderNoteTopics() {
  const slot = mainEl.querySelector('.topic-slot');
  if (!slot) return;
  const stored = draft?.id ? state.notes.find((n) => n.id === draft.id) : null;
  if (!stored) return slot.replaceChildren();
  const topics = topicsOf(stored);
  const canEdit = state.writable && (!stored.space || state.canWriteSpace);
  const tagging = state.ai.tagging.includes(stored.id);
  const old = slot.querySelector('input');
  const typed = old ? old.value : '';
  const hadFocus = !!old && document.activeElement === old;
  const known = topicCounts().map((t) => t.topic).filter((t) => !topics.some((x) => x.toLowerCase() === t.toLowerCase()));
  const input = canEdit
    ? el('input', {
        type: 'text',
        class: 'topic-input',
        placeholder: topics.length || tagging ? 'Add a topic' : 'Add a topic, like Garden or Work',
        'aria-label': 'Add a topic',
        list: 'note-topics-known',
        value: typed,
        onkeydown: (e) => {
          const v = e.target.value.trim();
          if ((e.key === 'Enter' || e.key === ',') && v) {
            e.preventDefault();
            e.target.value = '';
            setNoteTopics(stored, [...topics, ...v.split(',')]);
          } else if (e.key === 'Backspace' && !e.target.value && topics.length) {
            setNoteTopics(stored, topics.slice(0, -1));
          } else if (e.key === 'Escape') {
            e.target.value = '';
            editor?.focus();
          }
        },
        onchange: (e) => {
          // A topic picked from the suggestions.
          const v = e.target.value.trim();
          if (v && known.some((t) => t.toLowerCase() === v.toLowerCase())) {
            e.target.value = '';
            setNoteTopics(stored, [...topics, v]);
          }
        },
      })
    : null;
  slot.replaceChildren(
    el('div', { class: 'note-topics' }, [
      el('span', { class: 'label', title: 'Topics' }, [icon('tag')]),
      ...topics.map((t) =>
        el('span', { class: 'tag' }, [
          el('button', { class: 'tag-name', title: `Show notes about ${t}`, onclick: () => setTopic(t) }, [t]),
          canEdit ? el('button', { class: 'tag-x', title: `Remove ${t}`, 'aria-label': `Remove ${t}`, onclick: () => setNoteTopics(stored, topics.filter((x) => x !== t)) }, [icon('times')]) : null,
        ])
      ),
      stored.topicsBy === 'ai' && topics.length ? el('span', { class: 'by-ai', title: 'Picked by the AI. Change them as you like' }, [icon('magic')]) : null,
      tagging ? el('span', { class: 'tag pending' }, [icon('circle-notch fa-spin'), ' Finding topics…']) : null,
      input,
      input ? el('datalist', { id: 'note-topics-known' }, known.map((t) => el('option', { value: t }))) : null,
      canEdit && !tagging && stored.body.trim()
        ? el('button', { class: 'topic-suggest', title: state.ai.noRuntime ? 'No AI is set up on this device' : 'Ask the AI to suggest topics', onclick: () => suggestTopics([stored.id]) }, [icon('magic'), ' Suggest'])
        : null,
      state.ai.noRuntime && !topics.length
        ? el('span', { class: 'no-ai' }, ['No AI is set up on this device. ', tabLink({}, 'nomad://ai/setup', ['Set one up'])])
        : null,
    ])
  );
  if (hadFocus) slot.querySelector('input')?.focus();
}

async function setNoteTopics(note, topics) {
  try {
    const next = await nomad.vault.setNoteTopics({ id: note.id, topics });
    replaceNote(next);
  } catch (e) {
    setSaveMsg('error', 'Topics not saved: ' + (e.message || e));
    return;
  }
  renderList();
  renderNoteTopics();
  renderGraph();
}

// Ask this Device's AI for topics: for these notes, or every note with none yet.
async function suggestTopics(ids) {
  try {
    await nomad.vault.suggestNoteTopics(ids);
    await loadNotes();
  } catch (e) {
    setSaveMsg('error', 'Couldn’t ask the AI: ' + (e.message || e));
    return;
  }
  renderList();
  renderNoteTopics();
}

// Linked mentions: the other notes that link to this one. Closed until the user opens it.
function renderBacklinks() {
  if (!draft || !draft.id) return el('div', {});
  const notes = liveNotes();
  const resolve = makeResolver(notes);
  const linking = notes.filter((n) => n.id && n.id !== draft.id && linkedIds(n.body, resolve).includes(draft.id));
  return el('details', { class: 'backlinks', open: mentionsOpen, ontoggle: (e) => (mentionsOpen = e.target.open) }, [
    el('summary', {}, [
      icon('chevron-right'),
      `Linked mentions`,
      el('span', { class: 'count' }, [String(linking.length)]),
    ]),
    linking.length
      ? el(
          'ul',
          {},
          linking.map((n) =>
            el('li', {}, [
              el('button', { class: 'mention', onclick: () => openNote(n.id) }, [
                el('span', { class: 'title' }, [noteTitle(n.body)]),
                noteSnippet(n.body) ? el('span', { class: 'snippet' }, [noteSnippet(n.body)]) : null,
              ]),
            ])
          )
        )
      : el('p', { class: 'none' }, ['No other note links here yet.']),
  ]);
}

function setSaveMsg(kind, text) {
  saveMsg = { kind, text };
  renderSaveMsg();
}

function renderSaveMsg() {
  if (!savedEl) return;
  let text = saveMsg.text;
  if (saveMsg.kind === 'idle') {
    const stored = draft && draft.id && state.notes.find((n) => n.id === draft.id);
    if (!state.writable) text = 'Read only until this device can write to your Vault';
    else if (stored && !dirty) text = 'Edited ' + relativeDate(stored.updatedAt);
    else text = '';
  }
  savedEl.textContent = text;
  savedEl.classList.toggle('err', saveMsg.kind === 'error');
}

// Whether the notes reach the user's other Devices.
function syncNote() {
  if (!state.writable) {
    return el('p', { class: 'sync-note' }, [icon('clock'), 'Waiting for your other device. Changes save once this device can write to your Vault.']);
  }
  if (state.linked) {
    return el('p', { class: 'sync-note' }, [icon('sync-alt'), 'Synced with your linked devices.']);
  }
  return el('p', { class: 'sync-note' }, [
    icon('laptop'),
    el('span', {}, ['On this device only. ', tabLink({}, 'nomad://settings/?view=devices', ['Link a device']), ' to sync.']),
  ]);
}

function notice(iconName, heading, body, action) {
  return el('div', { class: 'notice' }, [
    el('div', { class: 'notice-icon' }, [icon(iconName)]),
    el('h2', {}, [heading]),
    el('p', {}, body),
    action || null,
  ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;

function relativeDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

// Opens `url` in a new tab in this Space (see nomad://search for why not window.open).
function openInTab(url) {
  if (window.nomad?.browser?.openUrl) nomad.browser.openUrl(url, { setActive: true });
  else window.open(url);
}

function tabLink(attrs, url, children) {
  return el('a', { ...attrs, href: url, onclick: (e) => { e.preventDefault(); openInTab(url); } }, children);
}

function icon(name) {
  return el('span', { class: `fas fa-fw fa-${name}`, 'aria-hidden': 'true' });
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c);
  return node;
}
