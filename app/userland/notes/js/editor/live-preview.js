// Live Preview for Markdown notes, the way Obsidian edits them: the text stays Markdown, but
// headings, emphasis, lists, tasks, quotes, rules and links show formatted. The Markdown marks come
// back where the cursor is, so editing a line shows its source. Block marks (#, >, list bullets)
// show for the whole line the cursor is on; inline marks (**, `, links) for the element it's in.
// Without focus, all of it shows formatted.
//
// Note links ([[Title]], [[Title#Heading|text]], or a relative [text](Title.md)) render as links.
// A link to a note that doesn't exist yet renders faded; following it creates the note.

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { WIKILINK, hrefTarget, makeResolver } from '../../../../../shared/vault-apps.mjs';

// The notes links resolve against: set with setNotes, read through the resolver.
export const setNotes = StateEffect.define();

export const notesField = StateField.define({
  create: () => makeResolver([]),
  update(resolve, tr) {
    for (const e of tr.effects) if (e.is(setNotes)) return makeResolver(e.value || []);
    return resolve;
  },
});

const hide = Decoration.replace({});
const line = (cls) => Decoration.line({ class: cls });
const mark = (cls, attributes) => Decoration.mark({ class: cls, attributes });

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos;
  }
  eq(o) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-checkbox';
    box.dataset.pos = String(this.pos);
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do');
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-hr';
    return hr;
  }
}

class NoteLinkWidget extends WidgetType {
  constructor(text, target, heading, resolved) {
    super();
    this.text = text;
    this.target = target;
    this.heading = heading;
    this.resolved = resolved;
  }
  eq(o) {
    return o.text === this.text && o.target === this.target && o.heading === this.heading && o.resolved === this.resolved;
  }
  toDOM() {
    const a = document.createElement('span');
    a.className = 'cm-note-link' + (this.resolved ? '' : ' cm-note-link-unresolved');
    a.textContent = this.text;
    a.dataset.target = this.target;
    a.dataset.heading = this.heading;
    a.title = this.resolved ? this.target : `Create “${this.target}”`;
    return a;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view) {
  const { state } = view;
  const doc = state.doc;
  // Without focus nothing is being edited, so everything shows formatted.
  const ranges = view.hasFocus ? state.selection.ranges : [];
  const touches = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  const activeLines = new Set();
  for (const r of ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n);
  }
  const onActiveLine = (pos) => activeLines.has(doc.lineAt(pos).number);
  const resolve = state.field(notesField);
  const tree = syntaxTree(state);
  const decos = [];

  for (const { from, to } of view.visibleRanges) {
    // Wikilinks first: Markdown reads [[Title]] as holding a link [Title], so syntax inside a
    // wikilink is skipped below.
    const wiki = [];
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(new RegExp(WIKILINK.source, 'g'))) {
      const start = from + m.index;
      const end = start + m[0].length;
      const inner = tree.resolveInner(start, 1);
      if (/Code/.test(inner.name) || /Code/.test(inner.parent?.name || '')) continue;
      wiki.push([start, end]);
      const target = m[1].trim();
      const heading = m[2] || '';
      if (touches(start, end)) {
        decos.push(mark('cm-note-link-source').range(start, end));
      } else {
        const shown = m[3] || (heading ? `${target} › ${heading}` : target);
        decos.push(Decoration.replace({ widget: new NoteLinkWidget(shown, target, heading, !!resolve(target)) }).range(start, end));
      }
    }
    const inWiki = (a, b) => wiki.some(([s, e]) => a >= s && b <= e);

    tree.iterate({
      from,
      to,
      enter(node) {
        if (inWiki(node.from, node.to)) return false;
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name) || /^SetextHeading(\d)$/.exec(name);
        if (heading) {
          for (let pos = node.from; pos <= node.to; ) {
            const l = doc.lineAt(pos);
            decos.push(line('cm-h cm-h' + heading[1]).range(l.from));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'HeaderMark') {
          if (node.node.parent?.name.startsWith('ATXHeading') && !onActiveLine(node.from)) {
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            decos.push(hide.range(node.from, end));
          }
          return;
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          const p = node.node.parent;
          if (p && !touches(p.from, p.to)) decos.push(hide.range(node.from, node.to));
          return;
        }
        if (name === 'InlineCode') {
          decos.push(mark('cm-inline-code').range(node.from, node.to));
          if (!touches(node.from, node.to)) {
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'CodeMark') decos.push(hide.range(c.from, c.to));
            }
          }
          return false;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let pos = node.from; pos <= node.to; ) {
            const l = doc.lineAt(pos);
            decos.push(line('cm-codeblock').range(l.from));
            pos = l.to + 1;
          }
          return false;
        }
        if (name === 'Link') {
          const marks = [];
          let url = '';
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name === 'LinkMark') marks.push(c);
            if (c.name === 'URL') url = doc.sliceString(c.from, c.to);
          }
          if (!url || marks.length < 2 || touches(node.from, node.to)) return;
          const target = hrefTarget(url);
          decos.push(hide.range(marks[0].from, marks[0].to));
          decos.push(
            mark(
              target ? 'cm-note-link' + (resolve(target) ? '' : ' cm-note-link-unresolved') : 'cm-link',
              target ? { 'data-target': target, 'data-heading': '' } : { 'data-href': url }
            ).range(marks[0].to, marks[1].from)
          );
          decos.push(hide.range(marks[1].from, node.to));
          return false;
        }
        if (name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to; ) {
            const l = doc.lineAt(pos);
            decos.push(line('cm-quote').range(l.from));
            pos = l.to + 1;
          }
          return;
        }
        if (name === 'QuoteMark') {
          if (!onActiveLine(node.from)) {
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            decos.push(hide.range(node.from, end));
          }
          return;
        }
        if (name === 'ListMark') {
          const item = node.node.parent;
          if (item?.parent?.name === 'OrderedList' || onActiveLine(node.from)) return;
          const isTask = !!item?.getChild('Task');
          if (isTask) {
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            decos.push(hide.range(node.from, end));
          } else {
            decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }
        if (name === 'TaskMarker') {
          const checked = /x/i.test(doc.sliceString(node.from, node.to));
          const textFrom = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          const lineEnd = doc.lineAt(node.from).to;
          if (checked && textFrom < lineEnd) decos.push(mark('cm-task-done').range(textFrom, lineEnd));
          if (!touches(node.from, node.to)) {
            decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
          }
          return;
        }
        if (name === 'HorizontalRule') {
          if (!onActiveLine(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
          return;
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(u) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(setNotes)))
      ) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// Clicks on the rendered parts: tick a task, follow a link. `onOpenLink` gets
// { kind: 'note', target, heading } or { kind: 'url', href }.
export function previewClicks(onOpenLink) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return false;
      const box = el.closest('.cm-task-checkbox');
      if (box) {
        e.preventDefault();
        if (view.state.readOnly) return true;
        const pos = Number(box.dataset.pos);
        const cur = view.state.sliceDoc(pos + 1, pos + 2);
        view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: /x/i.test(cur) ? ' ' : 'x' } });
        return true;
      }
      const link = el.closest('.cm-note-link');
      if (link && link.dataset.target) {
        e.preventDefault();
        onOpenLink({ kind: 'note', target: link.dataset.target, heading: link.dataset.heading || '' });
        return true;
      }
      const ext = el.closest('.cm-link');
      if (ext && ext.dataset.href) {
        e.preventDefault();
        onOpenLink({ kind: 'url', href: ext.dataset.href });
        return true;
      }
      return false;
    },
  });
}
