/*
Highlights (webview preload, isolated world). ADR-0020.

Draws the user's Highlights on the page. bg/ui/highlights.js keeps them in the Vault and answers
'nomad-highlights:list' with this page's: [{ id, text, hasNote }], where `text` is a text directive
(the part of a link after '#:~:text='). Each is found with the matcher Chromium's text fragments
follow (text-fragments-polyfill) and marked with the CSS Custom Highlight API, so the page's DOM is
not changed. A Highlight with a Note gets a small button at its end; it opens the Note in a new tab.

bg calls into this world through `window.__nomadHighlights` (the page's scripts can't see it): to
learn what a right-click was on, to make a text directive for the selection, and to show a short
message. Main frame of http(s) and hyper pages only.
*/

import { ipcRenderer, webFrame } from 'electron';
import {
  parseFragmentDirectives,
  processTextFragmentDirective,
} from 'text-fragments-polyfill/text-fragment-utils';
import {
  generateFragmentFromRange,
  isValidRangeForFragmentGeneration,
  GenerateFragmentStatus,
} from 'text-fragments-polyfill/dist/fragment-generation-utils.js';
import { textDirective } from '../../../shared/highlights.mjs';

const HIGHLIGHT = 'nomad-highlight';
const HIGHLIGHT_CSS = `::highlight(${HIGHLIGHT}) { background-color: rgba(255, 208, 0, 0.42); }`;
const RECHECK_MS = 1000; // look again for missing Highlights at most this often while the page changes
const RECHECK_FOR_MS = 30000; // and for this long after they were listed or lost
const CONTEXT_MAX_AGE = 5000;
const BUTTON = 18;

function isEligible() {
  const proto = window.location.protocol;
  return (proto === 'http:' || proto === 'https:' || proto === 'hyper:') && window.top === window;
}

export function setupHighlights() {
  if (!isEligible()) return;

  let items = []; // [{ id, text, hasNote, range }]
  let recheckUntil = 0;
  let recheckTimer = null;
  let observer = null;
  let styled = false;
  let context = null; // { at, range, hit } from the last right-click
  let layer = null; // closed shadow root: the note buttons and the message
  const buttons = new Map(); // highlight id -> button
  let placeFrame = 0;
  let sayTimer = null;

  // Finding and marking
  // -

  async function refresh() {
    let list = [];
    try {
      list = await ipcRenderer.invoke('nomad-highlights:list');
    } catch {}
    items = (Array.isArray(list) ? list : []).map((h) => ({
      id: h.id,
      text: h.text,
      hasNote: !!h.hasNote,
      range: null,
    }));
    recheckUntil = Date.now() + RECHECK_FOR_MS;
    if (items.length) watchDom();
    findAll();
  }

  function find(text) {
    try {
      const parsed = parseFragmentDirectives({ text: [text] }).text[0];
      return processTextFragmentDirective(parsed, document, document.body)[0] || null;
    } catch {
      return null;
    }
  }

  const isLost = (it) => !it.range || it.range.collapsed;

  function findAll() {
    if (!document.body) return;
    for (const it of items) if (isLost(it)) it.range = find(it.text);
    paint();
  }

  function paint() {
    const ranges = items.filter((it) => !isLost(it)).map((it) => it.range);
    try {
      if (ranges.length) {
        if (!styled) {
          webFrame.insertCSS(HIGHLIGHT_CSS);
          styled = true;
        }
        CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
      } else {
        CSS.highlights.delete(HIGHLIGHT);
      }
    } catch {}
    placeButtons();
  }

  // Pages that draw their text late, or redraw it, get looked at again, a second after they change.
  function watchDom() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      if (recheckTimer) return;
      recheckTimer = setTimeout(() => {
        recheckTimer = null;
        if (items.some((it) => it.range && it.range.collapsed))
          recheckUntil = Date.now() + RECHECK_FOR_MS;
        if (items.some(isLost) && Date.now() < recheckUntil) findAll();
        else schedulePlace();
      }, RECHECK_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Note buttons and messages
  // -

  function ensureLayer() {
    if (layer && layer.host.isConnected) return layer;
    const host = document.createElement('nomad-highlights');
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; display: block !important;' +
      ' pointer-events: none !important; z-index: 2147483647 !important;';
    layer = host.attachShadow({ mode: 'closed' });
    try {
      // A constructed sheet, because a page's CSP may refuse a <style> element.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(LAYER_CSS);
      layer.adoptedStyleSheets = [sheet];
    } catch {}
    buttons.clear();
    document.documentElement.append(host);
    return layer;
  }

  function noteButton(id) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Open note';
    btn.setAttribute('aria-label', 'Open note');
    btn.append(noteIcon());
    // Keep the press from reaching the page (it could clear a selection or close a menu).
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) ipcRenderer.send('nomad-highlights:open-note', id);
    });
    return btn;
  }

  function placeButtons() {
    const withNotes = items.filter((it) => it.hasNote && !isLost(it));
    if (!withNotes.length && !layer) return;
    const root = ensureLayer();
    for (const [id, btn] of buttons) {
      if (!withNotes.some((it) => it.id === id)) {
        btn.remove();
        buttons.delete(id);
      }
    }
    for (const it of withNotes) {
      let btn = buttons.get(it.id);
      if (!btn) {
        btn = noteButton(it.id);
        buttons.set(it.id, btn);
        root.append(btn);
      }
      // At the top right of the Highlight's last line, like a footnote mark.
      const r = lastRect(it.range);
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        btn.hidden = true;
        continue;
      }
      const x = Math.max(0, Math.min(r.right + 2, window.innerWidth - BUTTON - 2));
      const y = Math.max(0, r.top - BUTTON + 5);
      btn.hidden = false;
      btn.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }

  function schedulePlace() {
    if (!buttons.size || placeFrame) return;
    placeFrame = requestAnimationFrame(() => {
      placeFrame = 0;
      placeButtons();
    });
  }

  function say(text) {
    const root = ensureLayer();
    let msg = root.querySelector('.msg');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'msg';
      msg.setAttribute('role', 'status');
      root.append(msg);
    }
    msg.textContent = String(text || '');
    msg.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => msg.classList.remove('show'), 2400);
  }

  // What bg asks for
  // -

  // Scroll events don't bubble, but a capturing listener on the window sees every scroller's.
  window.addEventListener('scroll', schedulePlace, { capture: true, passive: true });
  window.addEventListener('resize', schedulePlace, { passive: true });

  window.addEventListener(
    'contextmenu',
    (e) => {
      const range = selectedRange();
      const hit =
        items.find((it) => !isLost(it) && rangeHas(it.range, e.clientX, e.clientY)) || null;
      context = { at: Date.now(), range, hit };
    },
    true
  );

  Object.defineProperty(window, '__nomadHighlights', {
    value: Object.freeze({
      // What the last right-click was on: a selection a Highlight can be made from, and the
      // Highlight under the cursor.
      context() {
        if (!context || Date.now() - context.at > CONTEXT_MAX_AGE) return null;
        const { hit } = context;
        // On macOS a right-click selects the word under it, after the contextmenu event. On a
        // Highlight that word is not a selection to act on; elsewhere it is, as in Chrome.
        if (hit && !context.range)
          return { selection: false, hit: { id: hit.id, hasNote: hit.hasNote } };
        if (!context.range) context.range = selectedRange();
        let selection = false;
        try {
          selection = !!context.range && isValidRangeForFragmentGeneration(context.range);
        } catch {}
        return { selection, hit: null };
      },
      // A text directive for the selection of the last right-click: { text, quote } or { error }.
      makeFragment() {
        const range = context && context.range;
        if (!range) return { error: 'no-selection' };
        const res = generateFragmentFromRange(range);
        if (res.status !== GenerateFragmentStatus.SUCCESS || !res.fragment) {
          const reason = Object.keys(GenerateFragmentStatus).find(
            (k) => GenerateFragmentStatus[k] === res.status
          );
          return { error: String(reason || 'failed').toLowerCase() };
        }
        return { text: textDirective(res.fragment), quote: range.toString() };
      },
      say,
    }),
  });

  ipcRenderer.on('nomad-highlights:changed', (_e, opts) => {
    if (opts && opts.clearSelection) document.getSelection()?.removeAllRanges();
    refresh();
  });
  // A Note opened from here may have been deleted, or a Highlight added on another Device.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('load', () => items.length && findAll(), { once: true });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
}

function selectedRange() {
  const sel = document.getSelection();
  return sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
}

function lastRect(range) {
  const rects = range.getClientRects();
  for (let i = rects.length - 1; i >= 0; i--) {
    if (rects[i].width > 0 && rects[i].height > 0) return rects[i];
  }
  return null;
}

function rangeHas(range, x, y) {
  for (const r of range.getClientRects()) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

// A note with a folded corner, drawn with DOM calls (a page's Trusted Types may refuse innerHTML).
function noteIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M3 2.5h10a.5.5 0 0 1 .5.5v6.5l-4 4H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z' +
      'M9.5 13.5V10a.5.5 0 0 1 .5-.5h3.5M5 5.5h6M5 8h3.5'
  );
  svg.append(path);
  return svg;
}

const LAYER_CSS = `
button {
  position: absolute; top: 0; left: 0;
  width: ${BUTTON}px; height: ${BUTTON}px; margin: 0; padding: 0;
  display: grid; place-items: center;
  border: 1px solid rgba(120, 90, 0, 0.35); border-radius: 5px;
  background: #fff4b8; color: #6b5200;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  cursor: pointer; pointer-events: auto;
}
button[hidden] { display: none; }
button:hover { background: #ffe76a; }
button:focus-visible { outline: 2px solid #2864dc; outline-offset: 1px; }
svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.msg {
  position: absolute; left: 50%; bottom: 24px;
  transform: translate(-50%, 8px); opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px; border-radius: 8px;
  background: #24292f; color: #fff;
  font: 13px/1.4 system-ui, -apple-system, sans-serif;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.msg.show { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-color-scheme: dark) {
  button { background: #4d3f0a; color: #ffe48a; border-color: rgba(255, 228, 138, 0.35); }
  button:hover { background: #64520e; }
  .msg { background: #e9e9ec; color: #111; }
}
`;
