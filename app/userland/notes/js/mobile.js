// The phone's Notes editor: the same editor as nomad://notes (./editor/), run in a React Native
// WebView. scripts/build-note-editor.mjs bundles this file into one HTML page,
// mobile/lib/noteEditorHtml.ts, which mobile/components/Notes.tsx loads.
//
// React Native → page: window.__noteEditor(msg), sent with injectJavaScript.
//   { type: 'load', theme, id, body, notes, readOnly, focus, live }   show a note
//   { type: 'notes', notes }        the notes changed (links, the [[ picker, linked mentions)
//   { type: 'setText', body }       replace the text (a conflict copy, another Device's edit)
//   { type: 'setId', id }           the new note got its id
//   { type: 'command', name }       a toolbar button (commands in ./editor/commands.js)
//   { type: 'liveEvent', conn, kind: 'message' | 'status' | 'failed', data?, status?, message? }
//   { type: 'liveMe', conn, me: { name, key } }   this phone, for the cursor the others see
// Page → React Native: window.ReactNativeWebView.postMessage(JSON)
//   { type: 'ready' } · { type: 'change', body, title, live? } · { type: 'openNote', id, heading }
//   { type: 'createNote', title } · { type: 'openUrl', href }
//   { type: 'liveOpen' | 'liveClose', id, conn } · { type: 'liveSend', id, conn, data }
//   { type: 'liveSynced', id } · { type: 'liveOff', id, message } · { type: 'liveStatus', id, status }
//   { type: 'livePeers', id, others: [{ name, color, ai }] }
//
// An open note is edited live (ADR-0041): with `live` on load, the page joins the note's session
// in the phone's backend (mobile/backend/lib/live-notes.mjs) through React Native, the same client
// nomad://notes uses (./live.js), and binds the editor to it with yCollab. The session joins the same
// note open on the user's computers, and the AI on a computer types into it with its own cursor.
// React Native stops saving the note itself once the page says liveSynced: the session saves.

import { keymap, ViewPlugin } from '@codemirror/view';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { createNoteEditor } from './editor/index.js';
import { connectLiveNote, colorFor, setYText } from './live.js';
import { noteTitle, noteSnippet, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

const HINT = 'Start typing. The first line is the title. Type [[ to link a note.';
// The phone's backend may wait for a computer that has the note open before it answers.
const LIVE_TIMEOUT_MS = 10000;

let editor = null;
let current = { id: null, body: '' };
let notes = [];
let mentionsOpen = false; // the user opened Linked mentions; it stays open from note to note
let readOnly = false;
let liveWanted = false; // React Native asked for live editing of this note
// The open note's live session: { id, conn, synced }. Null while the note is new, read only, or
// live editing isn't available.
let live = null;
let me = { name: 'Phone', key: '' };
const liveHandlers = new Map(); // conn -> the transport's { status, failed, message }

const post = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

// The notes with the open note's current text in place of its stored text.
function withOpenNote() {
  const others = notes.filter((n) => n.id !== current.id);
  return [{ id: current.id || '', body: current.body, updatedAt: '￿' }, ...others];
}

function openLink(link) {
  if (link.kind === 'url') return post({ type: 'openUrl', href: link.href });
  const note = makeResolver(withOpenNote())(link.target);
  if (note && note.id) post({ type: 'openNote', id: note.id, heading: link.heading });
  else post({ type: 'createNote', title: link.target });
}

// The theme comes from mobile/lib/theme.ts, so the editor matches the rest of the app.
function applyTheme(t = {}) {
  const vars = {
    '--note-page': t.surface,
    '--note-bg': t.surface,
    '--note-text': t.text,
    '--note-muted': t.textMuted,
    '--note-accent': t.accent,
    '--note-accent-soft': t.trustBg,
    '--note-border': t.border,
    '--note-code-bg': t.scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    '--note-selection': t.scheme === 'dark' ? 'rgba(91,140,255,0.32)' : 'rgba(29,89,199,0.18)',
  };
  for (const [k, v] of Object.entries(vars)) if (v) document.documentElement.style.setProperty(k, v);
  document.documentElement.style.colorScheme = t.scheme === 'dark' ? 'dark' : 'light';
}

// Linked mentions: the other notes that link to this one. Closed until the user opens it.
// Tapping one opens that note.
function renderMentions() {
  const box = document.getElementById('mentions');
  box.replaceChildren();
  if (!current.id) return;
  const all = withOpenNote();
  const resolve = makeResolver(all);
  const linking = all.filter((n) => n.id && n.id !== current.id && linkedIds(n.body, resolve).includes(current.id));
  const details = document.createElement('details');
  details.open = mentionsOpen;
  details.addEventListener('toggle', () => (mentionsOpen = details.open));
  const summary = document.createElement('summary');
  summary.textContent = `Linked mentions · ${linking.length}`;
  details.append(summary);
  box.append(details);
  if (!linking.length) {
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = 'No other note links here yet.';
    details.append(p);
    return;
  }
  const list = document.createElement('div');
  list.className = 'list';
  details.append(list);
  for (const n of linking) {
    const b = document.createElement('button');
    b.className = 'mention';
    const t = document.createElement('span');
    t.className = 'title';
    t.textContent = noteTitle(n.body);
    b.append(t);
    const snip = noteSnippet(n.body);
    if (snip) {
      const s = document.createElement('span');
      s.className = 'snippet';
      s.textContent = snip;
      b.append(s);
    }
    b.addEventListener('click', () => post({ type: 'openNote', id: n.id, heading: '' }));
    list.append(b);
  }
}

function makeEditor(doc, collab = null) {
  editor = createNoteEditor({
    parent: document.getElementById('editor'),
    doc,
    notes,
    readOnly,
    placeholder: HINT,
    onChange: (text) => {
      current.body = text;
      // Bound to the session, a change can be anyone's (another device, the AI): the session
      // saves it, React Native only updates the title.
      post({ type: 'change', body: text, title: noteTitle(text), live: !!collab });
      renderMentions();
    },
    onOpenLink: openLink,
    collab,
  });
}

// ── Live editing (ADR-0041) ─────────────────────────────────────────────────

// The page's way to the session: through React Native to the phone's backend.
function rnTransport(id) {
  return (conn, on) => {
    liveHandlers.set(conn, on);
    post({ type: 'liveOpen', id, conn });
    return {
      send: (data) => post({ type: 'liveSend', id, conn, data }),
      close() {
        liveHandlers.delete(conn);
        post({ type: 'liveClose', id, conn });
      },
    };
  };
}

const userFor = (m) => ({ name: m.name, color: colorFor(m.key || m.name), colorLight: colorFor(m.key || m.name) + '33' });

// Join the open note's session. The editor waits (read only) until it's in step with it, then is
// swapped for one bound to it. `keepLocal`: the note was just saved for the first time, and what's
// typed since goes into the session.
function startLive({ keepLocal = false } = {}) {
  const target = current;
  if (!liveWanted || !target.id || !editor || readOnly || (live && live.id === target.id)) return;
  stopLive();
  const conn = connectLiveNote({
    id: target.id,
    user: userFor(me),
    transport: rnTransport(target.id),
    timeoutMs: LIVE_TIMEOUT_MS,
    onStatus: (status) => {
      if (live && live.conn === conn) post({ type: 'liveStatus', id: target.id, status });
    },
    onPeers: () => {
      if (live && live.conn === conn && live.synced) postPeers();
    },
    // The session joined a computer's copy of this note: connect again to it.
    onReset: () => {
      if (current === target && live && live.conn === conn) {
        stopLive();
        startLive({ keepLocal: true });
      }
    },
  });
  const mine = { id: target.id, conn, synced: false };
  live = mine;
  if (!keepLocal) editor.setReadOnly(true);
  conn.whenSynced.then(
    () => {
      if (live !== mine || current !== target || !editor) return;
      if (keepLocal) setYText(conn.ytext, editor.getText());
      mine.synced = true;
      bindLive(conn);
      post({ type: 'liveSynced', id: target.id });
      postPeers();
    },
    (err) => {
      // No live editing (an older backend, or it failed): edit and save the note as before.
      console.warn('[notes] live editing unavailable', err);
      if (live !== mine) return;
      conn.destroy();
      live = null;
      editor?.setReadOnly(readOnly);
      post({ type: 'liveOff', id: target.id, message: String((err && err.message) || err) });
    }
  );
}

function stopLive() {
  if (!live) return;
  const was = live;
  live = null;
  was.conn.destroy();
  post({ type: 'livePeers', id: was.id, others: [] });
}

// This phone's cursor and selection, for the others. yCollab sends them only while
// view.hasFocus, which asks document.hasFocus(), and Android's WebView often says false while the
// editor has focus and the keyboard is up: the computer showed the phone's cursor only now and
// then. Send them whenever the editor is the focused element.
const shareCursor = (ytext, awareness) =>
  ViewPlugin.define(() => ({
    update(u) {
      if (u.view.root.activeElement !== u.view.contentDOM) return;
      if (!(u.selectionSet || u.docChanged || u.focusChanged)) return;
      const state = awareness.getLocalState();
      if (!state) return;
      const { anchor, head } = u.state.selection.main;
      const a = Y.createRelativePositionFromTypeIndex(ytext, anchor);
      const h = Y.createRelativePositionFromTypeIndex(ytext, head);
      const was = state.cursor;
      if (
        was &&
        Y.compareRelativePositions(Y.createRelativePositionFromJSON(was.anchor), a) &&
        Y.compareRelativePositions(Y.createRelativePositionFromJSON(was.head), h)
      )
        return;
      awareness.setLocalStateField('cursor', { anchor: a, head: h });
    },
  }));

// Swap the editor for one bound to the session, keeping the cursor and focus.
function bindLive(conn) {
  if (!editor) return;
  const hadFocus = editor.view.hasFocus;
  const { anchor, head } = editor.view.state.selection.main;
  editor.destroy();
  document.getElementById('editor').replaceChildren();
  const text = conn.ytext.toString();
  // Undo takes back this phone's own edits, never the AI's or a computer's.
  makeEditor(text, [
    yCollab(conn.ytext, conn.awareness),
    shareCursor(conn.ytext, conn.awareness),
    keymap.of(yUndoManagerKeymap),
  ]);
  const clamp = (n) => Math.min(n, text.length);
  editor.view.dispatch({ selection: { anchor: clamp(anchor), head: clamp(head) } });
  if (hadFocus) editor.focus();
  if (current.body !== text) {
    current.body = text;
    post({ type: 'change', body: text, title: noteTitle(text), live: true });
    renderMentions();
  }
}

// Who else has the note open, for React Native's header: the AI while it edits, and the user's
// computers. One each.
function postPeers() {
  if (!live) return;
  const seen = new Set();
  const others = [];
  for (const o of live.conn.others().sort((a, b) => Number(b.ai) - Number(a.ai))) {
    const k = (o.ai ? 'ai:' : 'dev:') + o.name;
    if (seen.has(k)) continue;
    seen.add(k);
    others.push({ name: o.name, color: o.color, ai: o.ai });
  }
  post({ type: 'livePeers', id: live.id, others });
}

window.__noteEditor = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'load') {
    applyTheme(msg.theme);
    stopLive();
    current = { id: msg.id || null, body: msg.body || '' };
    notes = msg.notes || [];
    readOnly = !!msg.readOnly;
    liveWanted = !!msg.live;
    editor?.destroy();
    document.getElementById('editor').replaceChildren();
    makeEditor(current.body);
    if (msg.heading) editor.goToHeading(msg.heading);
    if (msg.focus) editor.focus();
    renderMentions();
    startLive();
  } else if (msg.type === 'notes') {
    notes = msg.notes || [];
    editor?.setNotes(notes);
    renderMentions();
  } else if (msg.type === 'setText') {
    if (live && live.synced) return; // the session has the text
    current.body = msg.body || '';
    editor?.setText(current.body);
    renderMentions();
  } else if (msg.type === 'setId') {
    const was = current.id;
    current.id = msg.id;
    renderMentions();
    // Stored now, so it can be edited live from here on. A conflict copy is a new note: start again.
    if (was !== msg.id) {
      stopLive();
      startLive({ keepLocal: true });
    }
  } else if (msg.type === 'command') {
    editor?.run(msg.name);
  } else if (msg.type === 'liveEvent') {
    const on = liveHandlers.get(msg.conn);
    if (!on) return;
    if (msg.kind === 'message') on.message({ data: msg.data });
    else if (msg.kind === 'status') on.status(msg.status || {});
    else if (msg.kind === 'failed') on.failed({ message: msg.message });
  } else if (msg.type === 'liveMe') {
    me = { name: (msg.me && msg.me.name) || me.name, key: (msg.me && msg.me.key) || me.key };
    if (live && live.conn.conn === msg.conn) live.conn.setUser(userFor(me));
  }
};

post({ type: 'ready' });
