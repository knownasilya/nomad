/*
Page control (webview preload, isolated world). ADR-0028.

The AI Sidebar can click, type and scroll on the page in the user's tab. bg/ui/page-control.js runs
each action; this world does the parts that need the page: it lists the page's controls with a
number (a ref) for each, finds a ref's spot on screen, and draws the AI's cursor, the border and the
"Nomad AI is using this page" bar with its Stop button. The clicks and keys themselves are real
input events that bg sends, so the page sees them as the user's own.

bg calls into this world through `window.__nomadPageControl` (the page's scripts can't see it). Refs
and everything drawn here stay out of the page's reach: the elements are kept in this world's maps,
and the drawing is in a closed shadow root. Main frame of http(s) and hyper pages only.

While the bar shows, a click or a key press of the user's own tells bg the user took over, and Esc or
Stop ends the AI's turn. `acting` marks the moments bg's own input is on its way, so it isn't
mistaken for the user's.
*/

import { ipcRenderer } from 'electron';

const MAX_CONTROLS = 200;
const MAX_WALK = 8000;
const MAX_HEADINGS = 20;
const GLIDE_MS = 260;

const ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

function isEligible() {
  const proto = window.location.protocol;
  return (proto === 'http:' || proto === 'https:' || proto === 'hyper:') && window.top === window;
}

export function setupPageControl() {
  if (!isEligible()) return;

  const refs = new Map(); // ref -> WeakRef(element)
  const refOf = new WeakMap(); // element -> ref
  let nextRef = 1;
  let layer = null; // closed shadow root: cursor, border, bar
  let parts = null;
  let shown = false;
  let actingUntil = 0;
  let cursorAt = null;

  // Controls
  // -

  function refFor(el) {
    let ref = refOf.get(el);
    if (!ref) {
      ref = nextRef++;
      refOf.set(el, ref);
      refs.set(ref, new WeakRef(el));
    }
    return ref;
  }

  function byRef(ref) {
    const el = refs.get(Number(ref))?.deref();
    return el && el.isConnected ? el : null;
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit) return ROLES.has(explicit) ? explicit : null;
    switch (el.localName) {
      case 'a':
        return el.hasAttribute('href') ? 'link' : null;
      case 'button':
      case 'summary':
        return 'button';
      case 'select':
        return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'textarea':
        return 'textbox';
      case 'input':
        switch ((el.type || 'text').toLowerCase()) {
          case 'hidden':
            return null;
          case 'button':
          case 'submit':
          case 'reset':
          case 'image':
            return 'button';
          case 'checkbox':
            return 'checkbox';
          case 'radio':
            return 'radio';
          case 'range':
            return 'slider';
          case 'number':
            return 'spinbutton';
          case 'search':
            return 'searchbox';
          default:
            return 'textbox';
        }
    }
    if (el.isContentEditable && !el.parentElement?.isContentEditable) return 'textbox';
    return null;
  }

  // An element that acts like a button without saying so: a click handler in the markup, a tab
  // stop, or a pointer cursor its parent doesn't have (many apps draw buttons from plain divs).
  function looksClickable(el, style) {
    if (el.hasAttribute('onclick')) return true;
    if (el.hasAttribute('tabindex') && el.tabIndex >= 0) return true;
    if (style.cursor !== 'pointer') return false;
    const parent = el.parentElement;
    return !parent || getComputedStyle(parent).cursor !== 'pointer';
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function nameOf(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(textOf)
        .join(' ')
        .trim();
      if (text) return text;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select') {
      const labels = el.labels ? [...el.labels].map(textOf).join(' ').trim() : '';
      if (labels) return labels;
      const type = (el.type || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') return el.value || type;
      if (type === 'image') return el.alt || 'image button';
      if (el.placeholder) return el.placeholder;
      // A dropdown's text is all its options; its value says which one is chosen.
      if (el.localName === 'select')
        return el.getAttribute('title') || el.getAttribute('name') || '';
    }
    const text = textOf(el);
    if (text) return text.slice(0, 200);
    const img = el.querySelector && el.querySelector('img[alt], svg[aria-label]');
    if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || '';
    return el.getAttribute('title') || el.getAttribute('name') || '';
  }

  function valueOf(el, role) {
    if (
      role !== 'textbox' &&
      role !== 'searchbox' &&
      role !== 'combobox' &&
      role !== 'spinbutton' &&
      role !== 'slider'
    )
      return null;
    if (el.localName === 'select') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? textOf(opt) : '';
    }
    if ('value' in el && typeof el.value === 'string') return el.value;
    if (el.isContentEditable) return textOf(el);
    return el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow');
  }

  function visibleRect(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    if (
      el.checkVisibility &&
      !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    )
      return null;
    return rect;
  }

  function inView(rect) {
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  // What bg needs to know about a control. bg keeps the rules (page-control.mjs): `type`,
  // `autocomplete`, `nameAttr` and `id` tell it a password or payment field.
  function describe(el, role = roleOf(el) || 'generic', rect = el.getBoundingClientRect()) {
    const out = {
      ref: refFor(el),
      role,
      name: nameOf(el),
      tag: el.localName,
      type: el.localName === 'input' ? (el.type || 'text').toLowerCase() : null,
      autocomplete: el.getAttribute('autocomplete') || '',
      nameAttr: el.getAttribute('name') || '',
      id: el.id || '',
      inView: inView(rect),
    };
    const value = valueOf(el, role);
    if (value != null) out.value = String(value);
    if (el.localName === 'a' && el.href) out.href = el.href;
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      out.checked = 'checked' in el ? !!el.checked : el.getAttribute('aria-checked') === 'true';
    }
    const expanded = el.getAttribute('aria-expanded');
    if (expanded === 'true' || expanded === 'false') out.expanded = expanded === 'true';
    if (el.getAttribute('aria-selected') === 'true') out.selected = true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.disabled = true;
    if (deepActive() === el) out.focused = true;
    return out;
  }

  function deepActive() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  // The closest control at or above `el`, crossing open shadow roots.
  function controlAt(el) {
    for (let node = el; node; node = node.parentElement || node.getRootNode()?.host || null) {
      if (node.nodeType !== 1) continue;
      if (roleOf(node)) return node;
      if (looksClickable(node, getComputedStyle(node))) return node;
    }
    return null;
  }

  function snapshot() {
    const found = [];
    const headings = [];
    let walked = 0;
    const visit = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.nextNode(); el && walked < MAX_WALK; el = walker.nextNode()) {
        walked++;
        if (el.localName === 'nomad-page-control' || el.localName === 'nomad-highlights') continue;
        if (/^h[1-3]$/.test(el.localName) && headings.length < MAX_HEADINGS) {
          const text = textOf(el);
          if (text && visibleRect(el)) headings.push(text);
        }
        let role = roleOf(el);
        if (!role) {
          // A pointer-cursor div inside a control is part of that control.
          if (found.length && found[found.length - 1].el.contains(el)) {
            if (el.shadowRoot) visit(el.shadowRoot);
            continue;
          }
          if (looksClickable(el, getComputedStyle(el))) role = 'generic';
        }
        if (role) {
          const rect = visibleRect(el);
          if (rect && el.getAttribute('aria-hidden') !== 'true') found.push({ el, role, rect });
        }
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document.body || document.documentElement);

    // Too many: the ones on screen first, in reading order.
    let keep = found;
    if (found.length > MAX_CONTROLS) {
      const on = found.filter((f) => inView(f.rect));
      const off = found.filter((f) => !inView(f.rect));
      const chosen = new Set([...on, ...off].slice(0, MAX_CONTROLS));
      keep = found.filter((f) => chosen.has(f));
    }
    const scroller = document.scrollingElement || document.documentElement;
    return {
      url: location.href,
      title: document.title,
      controls: keep.map((f) => describe(f.el, f.role, f.rect)),
      headings,
      more: found.length - keep.length,
      scroll: {
        y: Math.round(scroller.scrollTop),
        height: Math.round(scroller.scrollHeight),
        viewport: window.innerHeight,
      },
    };
  }

  // A control's spot to click: the middle of the part on screen, after scrolling it into view.
  function target(ref) {
    const el = byRef(ref);
    if (!el) return { error: 'stale' };
    let rect = el.getBoundingClientRect();
    if (!inView(rect) || rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      rect = el.getBoundingClientRect();
    }
    if (rect.width < 1 || rect.height < 1) return { error: 'hidden' };
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (right <= left || bottom <= top) return { error: 'hidden' };
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    // Something else on top (a dialog, a cookie banner) would get the click instead.
    // Nomad's own layers don't count: the bar lets clicks through while bg acts.
    const hit = document.elementFromPoint(x, y);
    const ours =
      hit && (hit.localName === 'nomad-page-control' || hit.localName === 'nomad-highlights');
    const covered =
      hit && !ours && hit !== el && !el.contains(hit) && !hit.contains(el)
        ? controlAt(hit) || hit
        : null;
    return {
      x,
      y,
      control: describe(el),
      ...(covered ? { coveredBy: describe(covered) } : {}),
    };
  }

  function pointInfo(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { error: 'nothing' };
    const el = controlAt(hit) || hit;
    return { control: describe(el) };
  }

  function form(el) {
    const f = el && (el.form || el.closest?.('form'));
    if (!f) return null;
    const submit =
      f.querySelector(
        'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]'
      ) || null;
    return { submit: submit ? describe(submit) : null, action: f.action || '' };
  }

  function editable(el) {
    if (el.isContentEditable) return true;
    if (el.localName === 'textarea') return !el.readOnly && !el.disabled;
    if (el.localName === 'input') {
      const type = (el.type || 'text').toLowerCase();
      const typing = [
        'text',
        'search',
        'email',
        'url',
        'tel',
        'number',
        'password',
        'date',
        'time',
        'datetime-local',
        'month',
        'week',
      ];
      return typing.includes(type) && !el.readOnly && !el.disabled;
    }
    return false;
  }

  // Select what a field holds, so the text bg inserts next replaces it, or with `toEnd` put the
  // caret after it, so the text is added at the end.
  function selectContents(ref, toEnd = false) {
    const el = byRef(ref);
    if (!el) return { error: 'stale' };
    if (!editable(el)) return { error: 'not-editable', control: describe(el) };
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      if (toEnd) range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return { ok: true };
    }
    try {
      if (toEnd) el.setSelectionRange(el.value.length, el.value.length);
      else el.select();
    } catch {
      // number and date inputs have no selection; typing over them needs them empty.
      if (!toEnd) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return { ok: true };
  }

  function selectOption(ref, wanted) {
    const el = byRef(ref);
    if (!el) return { error: 'stale' };
    if (el.localName !== 'select') return { error: 'not-select', control: describe(el) };
    const w = String(wanted).trim().toLowerCase();
    const opts = [...el.options];
    const opt =
      opts.find((o) => o.value.toLowerCase() === w) ||
      opts.find((o) => textOf(o).toLowerCase() === w) ||
      opts.find((o) => textOf(o).toLowerCase().includes(w));
    if (!opt) return { error: 'no-option', options: opts.slice(0, 50).map(textOf) };
    if (opt.disabled) return { error: 'disabled-option' };
    // Set from this world, so a framework that tracks the value in the page's world sees a change.
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, chosen: textOf(opt) };
  }

  function scrollable(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const y = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
      const x = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
      if (x || y) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scroll(ref, direction) {
    const el = ref ? byRef(ref) : null;
    if (ref && !el) return { error: 'stale' };
    const box = el ? scrollable(el) : document.scrollingElement || document.documentElement;
    const page = box === document.scrollingElement || box === document.documentElement;
    const h = (page ? window.innerHeight : box.clientHeight) * 0.85;
    const w = (page ? window.innerWidth : box.clientWidth) * 0.85;
    const before = { x: box.scrollLeft, y: box.scrollTop };
    const to = {
      down: { top: before.y + h, left: before.x },
      up: { top: before.y - h, left: before.x },
      right: { top: before.y, left: before.x + w },
      left: { top: before.y, left: before.x - w },
      top: { top: 0, left: before.x },
      bottom: { top: box.scrollHeight, left: before.x },
    }[direction];
    box.scrollTo({ ...to, behavior: 'instant' });
    const r = page ? null : box.getBoundingClientRect();
    return {
      ok: true,
      moved: box.scrollTop !== before.y || box.scrollLeft !== before.x,
      atEnd: box.scrollTop + box.clientHeight >= box.scrollHeight - 2,
      atTop: box.scrollTop <= 0,
      // Where the cursor shows the scroll.
      x: r ? r.left + r.width / 2 : window.innerWidth / 2,
      y: r ? r.top + r.height / 2 : window.innerHeight / 2,
    };
  }

  // Resolves once the page's DOM has been still for `stillMs`, or after `maxMs`.
  function quiet(stillMs = 350, maxMs = 2500) {
    return new Promise((resolve) => {
      let last = Date.now();
      const started = last;
      const observer = new MutationObserver(() => {
        last = Date.now();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      const tick = () => {
        const now = Date.now();
        if (now - last >= stillMs || now - started >= maxMs) {
          observer.disconnect();
          resolve(true);
        } else setTimeout(tick, 80);
      };
      setTimeout(tick, 80);
    });
  }

  // Drawing
  // -

  function ensureLayer() {
    if (layer && layer.host.isConnected) return parts;
    const host = document.createElement('nomad-page-control');
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

    const edge = document.createElement('div');
    edge.className = 'edge';

    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.append(pointerIcon());
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Nomad AI';
    cursor.append(tag);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'status');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = 'Nomad AI is using this page';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = 'Stop';
    stop.title = 'Stop the AI (Esc)';
    stop.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    stop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) ipcRenderer.send('nomad-page-control:user', 'stop');
    });
    bar.append(dot, label, stop);

    // The layer goes in the top layer (a manual popover), so it draws over the page's modals,
    // popovers and menus, whatever their z-index. `raise()` puts it back on top when the page
    // opens one of its own later.
    const top = document.createElement('div');
    top.className = 'top';
    top.setAttribute('popover', 'manual');
    top.append(edge, cursor, bar);
    layer.append(top);
    document.documentElement.append(host);
    parts = { top, edge, cursor, bar, label, stop };
    raise();
    if (cursorAt) placeCursor(cursorAt.x, cursorAt.y, false);
    return parts;
  }

  // The top layer draws in the order its elements opened: show ours again to be last.
  function raise() {
    const top = parts?.top;
    if (!top || typeof top.showPopover !== 'function') return;
    try {
      if (top.matches(':popover-open')) top.hidePopover();
      top.showPopover();
    } catch {}
  }

  // A modal or popover the page opens goes over ours. `toggle` doesn't bubble, but it does pass
  // through the capture phase.
  function onPageToggle(e) {
    if (!layer || !parts || e.newState !== 'open') return;
    const host = layer.host;
    if (e.composedPath().includes(host)) return;
    raise();
  }

  function placeCursor(x, y, glide = true) {
    const p = ensureLayer();
    p.cursor.style.transition = glide
      ? `transform ${GLIDE_MS}ms cubic-bezier(0.3, 0.7, 0.4, 1)`
      : 'none';
    p.cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    p.cursor.classList.add('on');
    cursorAt = { x, y };
  }

  function moveCursor(x, y) {
    const from = cursorAt;
    if (!shown) show();
    // A menu opened by hover or by a script fires no toggle.
    raise();
    // The first move starts from the middle of the page, so the user sees where it goes.
    if (!from) placeCursor(window.innerWidth / 2, window.innerHeight / 2, false);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        placeCursor(x, y, true);
        setTimeout(() => resolve(true), GLIDE_MS + 20);
      });
    });
  }

  function ripple() {
    if (!cursorAt || !layer) return true;
    const dot = document.createElement('div');
    dot.className = 'ripple';
    dot.style.transform = `translate(${Math.round(cursorAt.x)}px, ${Math.round(cursorAt.y)}px)`;
    (parts?.top || layer).append(dot);
    setTimeout(() => dot.remove(), 600);
    return true;
  }

  function show() {
    const p = ensureLayer();
    p.edge.classList.add('on');
    p.bar.classList.add('on');
    shown = true;
    return true;
  }

  function hide() {
    shown = false;
    cursorAt = null;
    if (layer && layer.host.isConnected) layer.host.remove();
    layer = null;
    parts = null;
    return true;
  }

  // bg's own input is on its way: until `ms` from now, a click or key isn't the user's. The bar
  // stops catching clicks too, so a click on a control under it reaches the control.
  function acting(ms) {
    actingUntil = ms > 0 ? Date.now() + ms : 0;
    if (parts) parts.bar.style.pointerEvents = ms > 0 ? 'none' : '';
    return true;
  }

  // A modal dialog the page opens makes everything else inert, the bar too, so a click on the
  // bar reaches the page. It's drawn over the page, so the click was meant for the bar.
  let swallowClick = false;
  function onBar(e) {
    if (!parts || e.type !== 'pointerdown') return false;
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      return (
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      );
    };
    if (!inside(parts.bar)) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowClick = true;
    if (inside(parts.stop)) ipcRenderer.send('nomad-page-control:user', 'stop');
    return true;
  }
  function onClick(e) {
    if (!swallowClick) return;
    swallowClick = false;
    if (layer && e.composedPath().includes(layer.host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onUserInput(e) {
    if (!shown || !e.isTrusted || Date.now() < actingUntil) return;
    // The Stop button is the user's too, and says so itself.
    if (layer && e.composedPath().includes(layer.host)) return;
    if (onBar(e)) return;
    if (e.type === 'keydown' && e.key === 'Escape') {
      ipcRenderer.send('nomad-page-control:user', 'stop');
      return;
    }
    ipcRenderer.send('nomad-page-control:user', 'input');
    hide();
  }
  window.addEventListener('pointerdown', onUserInput, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('toggle', onPageToggle, true);
  window.addEventListener('keydown', onUserInput, true);

  Object.defineProperty(window, '__nomadPageControl', {
    value: Object.freeze({
      snapshot,
      target,
      pointInfo,
      focused() {
        const el = deepActive();
        return el && el !== document.body && el !== document.documentElement
          ? { control: describe(el) }
          : { control: null };
      },
      formOf(ref) {
        const el = ref ? byRef(ref) : deepActive();
        return { form: form(el) };
      },
      selectContents,
      selectOption,
      scroll,
      quiet,
      viewport() {
        return { width: window.innerWidth, height: window.innerHeight };
      },
      moveCursor,
      ripple,
      show,
      hide,
      acting,
    }),
  });
}

// An arrow pointer, drawn with DOM calls (a page's Trusted Types may refuse innerHTML).
function pointerIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M2 1.5v18.2l4.9-4.6 3.1 7.1 3.2-1.4-3.1-7h6.7z');
  svg.append(path);
  return svg;
}

const LAYER_CSS = `
:host { --accent: #2864dc; --accent-soft: rgba(40, 100, 220, 0.35); --bar-bg: #ffffff; --bar-fg: #1f2328; --bar-border: rgba(31, 35, 40, 0.15); }
@media (prefers-color-scheme: dark) {
  :host { --accent: #5b8def; --accent-soft: rgba(91, 141, 239, 0.4); --bar-bg: #2b2d31; --bar-fg: #e9e9ec; --bar-border: rgba(233, 233, 236, 0.18); }
}
.top {
  all: initial; display: block; position: fixed; inset: 0; width: 100%; height: 100%;
  margin: 0; padding: 0; border: 0; background: transparent; overflow: visible;
  pointer-events: none;
}
.top::backdrop { display: none; }
.edge {
  position: absolute; inset: 0; display: none;
  box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 18px var(--accent-soft);
}
.edge.on { display: block; }
.cursor {
  position: absolute; top: 0; left: 0; display: none;
  will-change: transform;
}
.cursor.on { display: block; }
.cursor svg {
  position: absolute; top: 0; left: 0; width: 24px; height: 29px; margin: -2px 0 0 -2px; overflow: visible;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
}
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 1.6; stroke-linejoin: round; }
.tag {
  position: absolute; top: 24px; left: 16px; white-space: nowrap;
  padding: 2px 7px; border-radius: 9px;
  background: var(--accent); color: #fff;
  font: 600 11px/16px system-ui, -apple-system, sans-serif;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.ripple {
  position: absolute; top: 0; left: 0; width: 0; height: 0;
}
.ripple::after {
  content: ''; position: absolute; left: -14px; top: -14px; width: 28px; height: 28px;
  border-radius: 50%; border: 2px solid var(--accent);
  animation: ripple 0.55s ease-out forwards;
}
@keyframes ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
.bar {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: none; align-items: center; gap: 10px;
  padding: 6px 6px 6px 12px; border-radius: 10px;
  background: var(--bar-bg); color: var(--bar-fg); border: 1px solid var(--bar-border);
  font: 13px/1.4 system-ui, -apple-system, sans-serif; white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}
.bar.on { display: flex; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
button {
  margin: 0; padding: 3px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--bar-border); background: transparent; color: inherit;
  font: 600 12px/18px system-ui, -apple-system, sans-serif;
}
button:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
`;
