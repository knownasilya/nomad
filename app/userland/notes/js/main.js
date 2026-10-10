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
// Each note has its own address, nomad://notes/<id>, so back and forward move between notes.
// Bundled (scripts/build.js → js/main.build.js), styled with the app-stdlib tokens like nomad://reader.

import { createNoteEditor } from './editor/index.js';
import { noteTitle, noteSnippet, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

const SAVE_DELAY = 700;

const state = {
  notes: [], // stored notes, newest first
  query: '',
  loaded: false,
  writable: true, // false while a Device that just joined waits for the Vault
  linked: false, // another Device shares the Vault
};

// The note in the editor: { id: string | null, body, base, openedTitle, conflictOf }. id is null
// until the first save; base is the updatedAt of the version the editor started from.
let draft = null;
let dirty = false; // the editor has text that isn't saved
let saving = null; // the save in flight
let saveTimer = null;
let saveMsg = { kind: 'idle', text: '' };
let banner = null; // { text, originalId } after a conflict copy was made
let editor = null;

const app = document.getElementById('app');
let listEl, mainEl, searchInput, newBtn, savedEl;

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
  const first = state.notes.find((n) => n.id === fromUrl) || state.notes[0];
  if (first) await openNote(first.id, { push: false });
  else renderAll();
  window.addEventListener('beforeunload', () => {
    save();
  });
  window.addEventListener('popstate', () => {
    const id = idFromUrl();
    if (id && (!draft || draft.id !== id)) openNote(id, { push: false });
  });
  watchOtherDevices();
}

function idFromUrl() {
  return decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''));
}

function setUrl(id, push) {
  const path = '/' + (id ? encodeURIComponent(id) : '');
  if (location.pathname === path) return;
  if (push) history.pushState(null, '', path);
  else history.replaceState(null, '', path);
}

// ── Data (nomad.vault) ───────────────────────────────────────────────────────

async function loadNotes() {
  const res = await nomad.vault.listNotes();
  state.notes = res.notes || [];
  state.writable = res.writable !== false;
  state.linked = !!res.linked;
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
  saving = nomad.vault.saveNote({ id: target.id || undefined, body: target.body, baseUpdatedAt: target.base || undefined });
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
      if (draft === target) setUrl(note.id, false);
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

async function newNote(body = '') {
  await leaveNote();
  draft = { id: null, body, base: null, openedTitle: null, conflictOf: null };
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
  draft = { id: note.id, body: note.body, base: note.updatedAt, openedTitle: noteTitle(note.body), conflictOf: note.conflictOf || null };
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
  const others = state.notes.filter((n) => n.id !== draft.id);
  return [{ id: draft.id || '', body: draft.body, updatedAt: '￿' }, ...others];
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
    },
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.query = '';
        renderList();
      }
    },
  });
  newBtn = el('button', { class: 'btn primary', onclick: () => newNote() }, [icon('plus'), ' New note']);

  const header = el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://notes/', alt: '' }), 'Notes']),
    el('div', { class: 'search-ctrl' }, [icon('search'), searchInput]),
    el('div', { class: 'header-actions' }, [newBtn]),
  ]);
  listEl = el('div', { class: 'notes' });
  const nav = el('nav', {}, [listEl, el('footer', {}, [])]);
  mainEl = el('main', {});
  app.append(header, el('div', { class: 'layout' }, [nav, mainEl]));
}

// keepEditor: leave the editor as it is (it already shows the right text), refresh the rest.
function renderAll({ keepEditor = false } = {}) {
  newBtn.disabled = !state.writable;
  renderList();
  if (keepEditor && editor && draft) renderAround();
  else renderEditor();
  app.querySelector('nav footer').replaceChildren(syncNote());
}

function visibleNotes() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.notes;
  return state.notes.filter((n) => n.body.toLowerCase().includes(q));
}

function renderList() {
  if (!state.loaded) {
    listEl.replaceChildren(el('div', { class: 'list-msg' }, ['Loading…']));
    return;
  }
  const items = [];
  // A new note shows at the top until it's saved.
  if (draft && !draft.id) items.push(noteItem({ id: null, body: draft.body, updatedAt: null }));
  for (const n of visibleNotes()) {
    // The open note shows what's typed, not the last saved text.
    items.push(noteItem(draft && draft.id === n.id ? { ...n, body: draft.body } : n));
  }
  if (!items.length) {
    items.push(el('div', { class: 'list-msg' }, [state.query ? 'No notes match.' : 'No notes yet.']));
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
      el(
        'button',
        { class: 'icon-btn danger', title: 'Delete note', 'aria-label': 'Delete note', disabled: !state.writable, onclick: deleteCurrent },
        [icon('trash')]
      ),
    ]),
    el('div', { class: 'page' }, [el('div', { class: 'banner-slot' }), host, el('div', { class: 'backlinks-slot' })])
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
}

// Linked mentions: the other notes that link to this one.
function renderBacklinks() {
  if (!draft || !draft.id) return el('div', {});
  const notes = liveNotes();
  const resolve = makeResolver(notes);
  const linking = notes.filter((n) => n.id && n.id !== draft.id && linkedIds(n.body, resolve).includes(draft.id));
  return el('section', { class: 'backlinks' }, [
    el('h3', {}, [`Linked mentions`, el('span', { class: 'count' }, [String(linking.length)])]),
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
