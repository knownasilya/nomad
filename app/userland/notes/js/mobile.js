// The phone's Notes editor: the same editor as nomad://notes (./editor/), run in a React Native
// WebView. scripts/build-note-editor.mjs bundles this file into one HTML page,
// mobile/lib/noteEditorHtml.ts, which mobile/components/Notes.tsx loads.
//
// React Native → page: window.__noteEditor(msg), sent with injectJavaScript.
//   { type: 'load', theme, id, body, notes, readOnly, focus }   show a note
//   { type: 'notes', notes }        the notes changed (links, the [[ picker, linked mentions)
//   { type: 'setText', body }       replace the text (a conflict copy, another Device's edit)
//   { type: 'setId', id }           the new note got its id
//   { type: 'command', name }       a toolbar button (commands in ./editor/commands.js)
// Page → React Native: window.ReactNativeWebView.postMessage(JSON)
//   { type: 'ready' } · { type: 'change', body, title } · { type: 'openNote', id, heading }
//   { type: 'createNote', title } · { type: 'openUrl', href }

import { createNoteEditor } from './editor/index.js';
import { noteTitle, noteSnippet, makeResolver, linkedIds } from '../../../../shared/vault-apps.mjs';

let editor = null;
let current = { id: null, body: '' };
let notes = [];

const post = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

// The notes with the open note's current text in place of its stored text.
function live() {
  const others = notes.filter((n) => n.id !== current.id);
  return [{ id: current.id || '', body: current.body, updatedAt: '￿' }, ...others];
}

function openLink(link) {
  if (link.kind === 'url') return post({ type: 'openUrl', href: link.href });
  const note = makeResolver(live())(link.target);
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

// Linked mentions: the other notes that link to this one. Tapping one opens it.
function renderMentions() {
  const box = document.getElementById('mentions');
  box.replaceChildren();
  if (!current.id) return;
  const all = live();
  const resolve = makeResolver(all);
  const linking = all.filter((n) => n.id && n.id !== current.id && linkedIds(n.body, resolve).includes(current.id));
  const h = document.createElement('h3');
  h.textContent = `Linked mentions · ${linking.length}`;
  box.append(h);
  if (!linking.length) {
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = 'No other note links here yet.';
    box.append(p);
    return;
  }
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
    box.append(b);
  }
}

window.__noteEditor = (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'load') {
    applyTheme(msg.theme);
    current = { id: msg.id || null, body: msg.body || '' };
    notes = msg.notes || [];
    editor?.destroy();
    editor = createNoteEditor({
      parent: document.getElementById('editor'),
      doc: current.body,
      notes,
      readOnly: !!msg.readOnly,
      placeholder: 'Start typing. The first line is the title. Type [[ to link a note.',
      onChange: (text) => {
        current.body = text;
        post({ type: 'change', body: text, title: noteTitle(text) });
        renderMentions();
      },
      onOpenLink: openLink,
    });
    if (msg.heading) editor.goToHeading(msg.heading);
    if (msg.focus) editor.focus();
    renderMentions();
  } else if (msg.type === 'notes') {
    notes = msg.notes || [];
    editor?.setNotes(notes);
    renderMentions();
  } else if (msg.type === 'setText') {
    current.body = msg.body || '';
    editor?.setText(current.body);
    renderMentions();
  } else if (msg.type === 'setId') {
    current.id = msg.id;
    renderMentions();
  } else if (msg.type === 'command') {
    editor?.run(msg.name);
  }
};

post({ type: 'ready' });
