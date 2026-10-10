// The Notes editor: Markdown with Obsidian-style Live Preview (live-preview.js), [[ note links with
// a picker, and formatting shortcuts (commands.js). Used by nomad://notes (../main.js) and by the
// phone's Notes, which loads it in a WebView (../mobile.js).
//
// The host supplies the colors as CSS variables (--note-text, --note-muted, --note-accent,
// --note-accent-soft, --note-border, --note-code-bg, --note-selection, --note-bg, --note-font,
// --note-code-font), so the editor follows the host's light and dark themes.

import { EditorState, Compartment, Annotation } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { noteTitle, sortNotes } from '../../../../../shared/vault-apps.mjs';
import { livePreview, previewClicks, notesField, setNotes } from './live-preview.js';
import { commands, formattingKeymap } from './commands.js';

export { commands };

// Marks a change the host made (setText), so it isn't reported back through onChange.
const fromHost = Annotation.define();

const highlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--note-accent)' },
  { tag: tags.url, color: 'var(--note-muted)' },
  { tag: tags.monospace, fontFamily: 'var(--note-code-font)' },
  { tag: tags.processingInstruction, color: 'var(--note-muted)' }, // the Markdown marks, when shown
  { tag: tags.quote, color: 'var(--note-muted)' },
  { tag: tags.contentSeparator, color: 'var(--note-muted)' },
]);

const theme = EditorView.theme({
  // The editor grows with its text; the host's page scrolls (so it can put linked mentions below).
  '&': { color: 'var(--note-text)', backgroundColor: 'transparent', fontSize: 'var(--note-font-size, 15px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--note-font)', lineHeight: '1.65' },
  '.cm-content': { maxWidth: 'var(--note-width, 760px)', margin: '0 auto', padding: 'var(--note-padding, 24px 28px 40px)', caretColor: 'var(--note-text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--note-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'var(--note-selection)',
  },
  '.cm-line.cm-h': { fontWeight: '700', lineHeight: '1.3' },
  '.cm-line.cm-h1': { fontSize: '1.75em', paddingTop: '0.35em' },
  '.cm-line.cm-h2': { fontSize: '1.45em', paddingTop: '0.3em' },
  '.cm-line.cm-h3': { fontSize: '1.2em', paddingTop: '0.25em' },
  '.cm-line.cm-h4, .cm-line.cm-h5, .cm-line.cm-h6': { fontSize: '1.05em' },
  '.cm-note-link, .cm-link': { color: 'var(--note-accent)', cursor: 'pointer' },
  '.cm-note-link:hover, .cm-link:hover': { textDecoration: 'underline' },
  '.cm-note-link-unresolved': { opacity: '0.65', textDecoration: 'underline dotted' },
  '.cm-note-link-source': { color: 'var(--note-accent)' },
  '.cm-inline-code': {
    fontFamily: 'var(--note-code-font)',
    fontSize: '0.88em',
    background: 'var(--note-code-bg)',
    borderRadius: '4px',
    padding: '1px 4px',
  },
  '.cm-line.cm-codeblock': { fontFamily: 'var(--note-code-font)', fontSize: '0.88em', background: 'var(--note-code-bg)' },
  '.cm-line.cm-quote': { borderLeft: '3px solid var(--note-border)', paddingLeft: '12px', color: 'var(--note-muted)' },
  '.cm-bullet': { color: 'var(--note-muted)', display: 'inline-block', width: '0.9em' },
  '.cm-task-checkbox': { margin: '0 7px 0 0', verticalAlign: '-2px', cursor: 'pointer', accentColor: 'var(--note-accent)' },
  '.cm-task-done': { color: 'var(--note-muted)', textDecoration: 'line-through' },
  '.cm-hr': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--note-border)', verticalAlign: 'middle' },
  '.cm-placeholder': { color: 'var(--note-muted)' },
  '.cm-tooltip': { background: 'var(--note-bg)', color: 'var(--note-text)', border: '1px solid var(--note-border)', borderRadius: '8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--note-font)', maxHeight: '14em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--note-accent-soft)', color: 'var(--note-text)' },
  '.cm-completionDetail': { color: 'var(--note-muted)', fontStyle: 'normal', marginLeft: '8px' },
});

// Typing [[ offers the other notes; picking one finishes the link.
function noteCompletions(getNotes) {
  return (context) => {
    const m = context.matchBefore(/\[\[[^[\]|#\n]*/);
    if (!m) return null;
    const own = noteTitle(context.state.doc.toString()).toLowerCase();
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]';
    const seen = new Set();
    const options = [];
    for (const n of sortNotes(getNotes())) {
      const title = noteTitle(n.body);
      const key = title.toLowerCase();
      if (key === own || seen.has(key)) continue;
      seen.add(key);
      options.push({
        label: title,
        type: 'text',
        apply: (view, completion, from, to) => {
          const insert = completion.label + ']]';
          view.dispatch({
            changes: { from, to: closed ? to + 2 : to, insert },
            selection: { anchor: from + insert.length },
          });
        },
      });
    }
    return { from: m.from + 2, options, validFor: /^[^[\]|#\n]*$/ };
  };
}

// Make an editor in `parent`. Returns { view, getText, setText, setNotes, setReadOnly, focus, run,
// goToHeading, destroy }. `onChange(text)` fires on the user's edits; `onOpenLink(link)` when the
// user follows a link: { kind: 'note', target, heading } or { kind: 'url', href }.
export function createNoteEditor({ parent, doc = '', notes = [], readOnly = false, placeholder: hint = '', onChange, onOpenLink }) {
  let currentNotes = notes;
  const editable = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        // The language alone, not markdown(): that also loads HTML, CSS and JavaScript support
        // (HTML tag completion, highlighting inside code blocks), which notes don't use.
        markdownLanguage,
        // Pair ( and [ only: quotes would get in the way of prose.
        markdownLanguage.data.of({ closeBrackets: { brackets: ['(', '['] } }),
        closeBrackets(),
        syntaxHighlighting(highlight),
        notesField,
        livePreview,
        previewClicks((link) => onOpenLink && onOpenLink(link)),
        autocompletion({ override: [noteCompletions(() => currentNotes)], icons: false }),
        keymap.of([...formattingKeymap, ...closeBracketsKeymap, ...completionKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        placeholder(hint),
        theme,
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChange && !u.transactions.some((tr) => tr.annotation(fromHost))) {
            onChange(u.state.doc.toString());
          }
        }),
      ],
    }),
  });
  view.dispatch({ effects: setNotes.of(notes) });

  return {
    view,
    getText: () => view.state.doc.toString(),
    // Replace the text (another Device's edit), keeping the cursor where it was.
    setText(text) {
      if (text === view.state.doc.toString()) return;
      const { anchor, head } = view.state.selection.main;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(anchor, text.length), head: Math.min(head, text.length) },
        annotations: fromHost.of(true),
      });
    },
    // The notes that links resolve against and the [[ picker offers: [{ id, body, updatedAt }].
    setNotes(list) {
      currentNotes = list || [];
      view.dispatch({ effects: setNotes.of(currentNotes) });
    },
    setReadOnly(ro) {
      view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]) });
    },
    focus: () => view.focus(),
    run: (name) => (commands[name] ? commands[name](view) : false),
    // Put the cursor on the heading a link like [[Note#Heading]] points at.
    goToHeading(heading) {
      const want = String(heading || '').trim().toLowerCase();
      if (!want) return;
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        const m = /^#{1,6}\s+(.*)$/.exec(line.text);
        if (m && m[1].trim().toLowerCase() === want) {
          view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          return;
        }
      }
    },
    destroy: () => view.destroy(),
  };
}
