// Formatting commands for the Notes editor: the keyboard shortcuts and the toolbar on desktop and
// on the phone. Each takes the EditorView and returns true, like a CodeMirror command.

import { EditorSelection } from '@codemirror/state';
import { startCompletion } from '@codemirror/autocomplete';

// Put `mark` around each selection, or take it off when it's already there. With nothing
// selected, insert a pair and put the cursor between.
function toggleWrap(markText) {
  return (view) => {
    const { state } = view;
    const n = markText.length;
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - n, range.from);
        const after = state.sliceDoc(range.to, range.to + n);
        if (before === markText && after === markText) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        return {
          changes: [
            { from: range.from, insert: markText },
            { from: range.to, insert: markText },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      })
    );
    view.focus();
    return true;
  };
}

// Change the start of every selected line. `re` matches the prefix a line may already have. A line
// whose prefix is of the same kind (`same`) loses it; any other gets `prefix` in place of it.
function toggleLinePrefix(prefix, same, re = LIST_PREFIX) {
  return (view) => {
    const { state } = view;
    const changes = [];
    const seen = new Set();
    for (const range of state.selection.ranges) {
      for (let pos = range.from; pos <= range.to; ) {
        const line = state.doc.lineAt(pos);
        pos = line.to + 1;
        if (seen.has(line.number)) continue;
        seen.add(line.number);
        const indent = /^\s*/.exec(line.text)[0];
        const rest = line.text.slice(indent.length);
        const m = re.exec(rest);
        const from = line.from + indent.length;
        if (m && same.test(m[0])) changes.push({ from, to: from + m[0].length });
        else changes.push({ from, to: from + (m ? m[0].length : 0), insert: prefix });
      }
    }
    view.dispatch({ changes });
    view.focus();
    return true;
  };
}

const LIST_PREFIX = /^([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/;

// The current line goes paragraph → H1 → H2 → H3 → paragraph.
function cycleHeading(view) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(#{1,6})\s+/.exec(line.text);
  const level = m ? m[1].length : 0;
  const next = level >= 3 ? '' : '#'.repeat(level + 1) + ' ';
  view.dispatch({ changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next } });
  view.focus();
  return true;
}

// [[selection]], or "[[" with the note list open.
function noteLink(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) {
    view.dispatch({
      changes: [
        { from: range.from, insert: '[[' },
        { from: range.to, insert: ']]' },
      ],
      selection: { anchor: range.to + 4 },
    });
  } else {
    view.dispatch({ changes: { from: range.from, insert: '[[]]' }, selection: { anchor: range.from + 2 } });
    startCompletion(view);
  }
  view.focus();
  return true;
}

export const commands = {
  bold: toggleWrap('**'),
  italic: toggleWrap('*'),
  strike: toggleWrap('~~'),
  code: toggleWrap('`'),
  heading: cycleHeading,
  bullet: toggleLinePrefix('- ', /^[-*+]\s+$/),
  task: toggleLinePrefix('- [ ] ', /^[-*+]\s+\[[ xX]\]\s+$/),
  quote: toggleLinePrefix('> ', /^>\s*$/),
  link: noteLink,
};

export const formattingKeymap = [
  { key: 'Mod-b', run: commands.bold },
  { key: 'Mod-i', run: commands.italic },
  { key: 'Mod-k', run: commands.link },
  { key: 'Mod-Shift-x', run: commands.strike },
  { key: 'Mod-e', run: commands.code },
  { key: 'Mod-l', run: commands.task },
];
