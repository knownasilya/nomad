// The Document drive (a built-in drive template): one Live Doc at /doc, edited with the Notes
// editor (Markdown with Live Preview) and shared through Yjs. See ADR-0025 and ./live-doc.js.
// Bundled into ../app.js by scripts/build-drive-templates.mjs; that file is what new Drives get.

import { keymap } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { createNoteEditor } from '../../../userland/notes/js/editor/index.js';
import { openLiveDoc } from './live-doc.js';

const DOC = '/doc';
const COLORS = [
  '#e5484d',
  '#e2701b',
  '#2f9e44',
  '#0b8bd1',
  '#6e56cf',
  '#d6409f',
  '#0f9c8c',
  '#8d6e00',
];

const $ = (sel) => document.querySelector(sel);

function colorFor(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

async function myName(drive, writerKey) {
  if (!writerKey) return 'Viewer';
  try {
    const writers = await drive.listWriters();
    const me = writers.find((w) => w.writerKey === writerKey);
    if (me && me.profileUrl) {
      const info = await nomad.fs.drive(me.profileUrl).getInfo();
      if (info && info.title) return info.title;
    }
  } catch {}
  return 'Writer ' + writerKey.slice(0, 4);
}

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.dataset.kind = kind;
}

function renderPresence(awareness) {
  const el = $('#presence');
  el.textContent = '';
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !state.user) continue;
    const dot = document.createElement('span');
    dot.className = 'avatar' + (state.user.writer ? '' : ' viewer');
    dot.style.setProperty('--avatar', state.user.color);
    dot.textContent = initials(state.user.name);
    dot.title = state.user.writer ? state.user.name : state.user.name + ' (viewing)';
    el.append(dot);
  }
}

async function main() {
  const drive = nomad.fs.drive(nomad.page.origin);
  const info = await drive.getInfo();
  const writable = !!info.writable;
  const writerKey = info.writerKey || null;
  document.title = info.title || 'Document';
  $('#title').textContent = info.title || 'Untitled document';

  const name = await myName(drive, writable ? writerKey : null);
  const sockets = typeof nomad.peersockets === 'object' ? nomad.peersockets : null;
  const live = openLiveDoc({
    drive,
    path: DOC,
    writerKey,
    writable,
    sockets,
    user: {
      name,
      color: colorFor(writerKey || name),
      colorLight: colorFor(writerKey || name) + '33',
    },
    onStatus({ saving, unsaved, error, writers }) {
      if (!writable) return setStatus('Read only', 'muted');
      if (error) return setStatus('Not saved: ' + error, 'error');
      if (saving) return setStatus('Saving…', 'muted');
      if (unsaved) return setStatus('Edited', 'muted');
      setStatus(writers ? `Saved · ${writers + 1} editing` : 'Saved', 'muted');
    },
  });
  live.awareness.on('change', () => renderPresence(live.awareness));

  setStatus('Loading…', 'muted');
  await live.whenLoaded;

  const editor = createNoteEditor({
    parent: $('#editor'),
    // The editor starts from what's loaded; yCollab keeps the two in step from here.
    doc: live.ytext.toString(),
    readOnly: !writable,
    placeholder: writable
      ? 'Start writing. Everyone with write access sees it as you type.'
      : 'Nothing here yet.',
    // Undo only reverts this Device's own edits, never someone else's.
    collab: [yCollab(live.ytext, live.awareness), keymap.of(yUndoManagerKeymap)],
    onOpenLink(link) {
      if (link.kind === 'url') window.open(link.href, '_blank', 'noopener');
    },
  });
  if (!writable) setStatus('Read only', 'muted');
  else setStatus('Saved', 'muted');

  for (const btn of document.querySelectorAll('[data-cmd]')) {
    btn.hidden = !writable;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
    btn.addEventListener('click', () => editor.run(btn.dataset.cmd));
  }
  if (writable) editor.focus();
}

main().catch((err) => {
  console.error(err);
  setStatus('Could not open this document: ' + (err && err.message ? err.message : err), 'error');
});
