/*
Boosts (webview preload, isolated world). ADR-0023.

Applies the user's Boosts for this site. bg/ui/boosts.js keeps them in the Vault and answers
'nomad-boosts:page' with this page's { css, scripts }. The CSS (presets, hidden elements, the
user's own) goes in with webFrame.insertCSS as the page starts, before it paints, and is swapped in
place when a Boost changes ('nomad-boosts:changed'). Each script runs once in the page's main world
when the DOM is ready, like a bookmarklet; a script that is turned off or edited can't be taken
back, so the page reloads (when it is next shown).

The zapper picks elements to hide: bg starts it through `window.__nomadBoosts.startZap()` (the
page's scripts can't see it), from the Boosts menu or the page's context menu. It draws in a closed
shadow root and saves each pick with 'nomad-boosts:zap'. Main frame of http(s) and hyper pages only.
*/

import { ipcRenderer, webFrame } from 'electron';
import { selectorFor, similarSelectorFor, hideCss } from '../../../shared/boosts.mjs';

function isEligible() {
  const { protocol, hostname } = window.location;
  if (window.top !== window) return false;
  if (protocol === 'hyper:') return hostname !== 'private';
  return protocol === 'http:' || protocol === 'https:';
}

export function setupBoosts() {
  if (!isEligible()) return;

  let cssKey = null;
  let cssText = '';
  const ran = new Map(); // boost id -> rev of the script this page ran
  let reloadWhenShown = false;

  function applyCss(css) {
    if (css === cssText) return;
    try {
      if (cssKey) webFrame.removeInsertedCSS(cssKey);
      cssKey = css ? webFrame.insertCSS(css) : null;
      cssText = css;
    } catch (err) {
      console.warn('[boosts] Could not apply styles', err);
    }
  }

  function run(script) {
    ran.set(script.id, script.rev);
    // Main world: the script sees the page as the page's own scripts do.
    webFrame.executeJavaScript(script.code).catch((err) => {
      console.warn(`[boosts] “${script.name}” didn’t run:`, err);
    });
  }

  function whenReady(fn) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function apply(payload) {
    if (!payload || typeof payload !== 'object') return;
    applyCss(typeof payload.css === 'string' ? payload.css : '');
    const scripts = Array.isArray(payload.scripts) ? payload.scripts : [];
    // A script that ran and is now off or different: only a fresh load takes it back.
    const stale = [...ran].some(([id, rev]) => !scripts.some((s) => s.id === id && s.rev === rev));
    if (stale) {
      if (document.visibilityState === 'visible') location.reload();
      else reloadWhenShown = true;
      return;
    }
    const fresh = scripts.filter((s) => !ran.has(s.id));
    if (fresh.length) whenReady(() => fresh.forEach(run));
  }

  // Before the page paints: a synchronous answer from memory in bg.
  try {
    apply(ipcRenderer.sendSync('nomad-boosts:page'));
  } catch {}

  ipcRenderer.on('nomad-boosts:changed', async () => {
    try {
      apply(await ipcRenderer.invoke('nomad-boosts:page-async'));
    } catch {}
  });
  document.addEventListener('visibilitychange', () => {
    if (reloadWhenShown && document.visibilityState === 'visible') location.reload();
  });

  const zapper = makeZapper();
  Object.defineProperty(window, '__nomadBoosts', {
    value: Object.freeze({
      startZap: (opts) => zapper.start(opts || {}),
      stopZap: () => zapper.stop(),
    }),
  });
}

// The zapper
// =

const ZAP_BLOCKED = [
  'click',
  'dblclick',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'contextmenu',
  'submit',
];

function makeZapper() {
  let active = false;
  let host = null;
  let root = null;
  let box = null;
  let label = null;
  let status = null;
  let msg = null;
  let target = null; // the element that would be hidden
  let below = []; // elements under `target` that ArrowUp climbed from, for ArrowDown
  let shift = false;
  let mouse = null; // last pointer position
  let boostId = null;
  let boostName = null;
  let history = []; // [{ boostId, selector }] picks this session, for Undo
  let pendingKey = null; // the picks, hidden here at once while bg saves them
  let frame = 0;
  let msgTimer = null;

  const count = (sel) => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return 0;
    }
  };

  function start({ boostId: id = null, name = null, at = null }) {
    boostId = id;
    boostName = name;
    history = [];
    if (!active) {
      active = true;
      build();
      for (const type of ZAP_BLOCKED) window.addEventListener(type, onBlocked, true);
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('scroll', schedule, { capture: true, passive: true });
      window.addEventListener('resize', schedule, { passive: true });
    }
    if (at && typeof at.x === 'number') {
      mouse = { x: at.x, y: at.y };
      setTarget(pickAt(at.x, at.y));
    }
    updateStatus();
  }

  function stop() {
    if (!active) return;
    active = false;
    for (const type of ZAP_BLOCKED) window.removeEventListener(type, onBlocked, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    host?.remove();
    host = root = box = label = status = msg = null;
    target = null;
    below = [];
    // The saved Boost's styles have these by now; until they arrive, keep the picks hidden.
    const key = pendingKey;
    pendingKey = null;
    if (key) setTimeout(() => webFrame.removeInsertedCSS(key), 1500);
  }

  // Drawing
  // -

  function build() {
    host = document.createElement('nomad-boost-zapper');
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; display: block !important;' +
      ' pointer-events: none !important; z-index: 2147483647 !important;';
    root = host.attachShadow({ mode: 'closed' });
    try {
      // A constructed sheet, because a page's CSP may refuse a <style> element.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(ZAPPER_CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {}
    box = div('box');
    label = div('label');
    const bar = div('bar');
    status = div('status');
    const hint = div('hint');
    hint.textContent =
      'Click to hide · Shift-click hides all like it · ↑ ↓ bigger or smaller · Esc when done';
    const undo = button('Undo', () => undoLast());
    undo.className = 'undo';
    const done = button('Done', () => stop());
    done.className = 'primary';
    msg = div('msg');
    const text = div('text');
    text.append(status, hint);
    bar.append(text, undo, done);
    root.append(box, label, bar, msg);
    document.documentElement.append(host);
  }

  function div(cls) {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  }

  function button(text, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.isTrusted) onClick();
    });
    return el;
  }

  function updateStatus() {
    if (!status) return;
    const n = history.length;
    const into = boostName ? ` in “${boostName}”` : '';
    status.textContent = n ? `${n} hidden${into}` : `Pick something on the page to hide${into}`;
    const undo = root.querySelector('.undo');
    if (undo) undo.disabled = !n;
  }

  function say(text) {
    if (!msg) return;
    msg.textContent = text;
    msg.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => msg && msg.classList.remove('show'), 3000);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function draw() {
    if (!box) return;
    if (!target || !target.isConnected) {
      box.hidden = label.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect();
    box.hidden = label.hidden = false;
    box.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
    box.style.width = Math.round(r.width) + 'px';
    box.style.height = Math.round(r.height) + 'px';
    const sel = selectorToHide(target);
    const n = sel ? count(sel) : 0;
    label.textContent = sel ? (n > 1 ? `${sel}  ×${n}` : sel) : 'Nothing like this to hide';
    const top = r.top > 26 ? r.top - 24 : Math.min(r.bottom + 4, window.innerHeight - 24);
    label.style.transform = `translate(${Math.max(4, Math.round(r.left))}px, ${Math.round(top)}px)`;
  }

  // Picking
  // -

  function pickAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host || el === document.documentElement || el === document.body) return null;
    return el;
  }

  function setTarget(el) {
    target = el;
    below = [];
    draw();
  }

  function selectorToHide(el) {
    if (shift) return similarSelectorFor(el);
    return selectorFor(el, count);
  }

  function onMove(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (e.target === host) return; // over the bar
    const el = pickAt(e.clientX, e.clientY);
    if (el && (el === target || below.includes(el) || target?.contains(el))) {
      // Still inside what ArrowUp picked: keep it.
      if (el !== target && !below.length) setTarget(el);
      return;
    }
    if (el !== target) setTarget(el);
  }

  function onBlocked(e) {
    if (e.target === host) return; // the bar's own buttons
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.isTrusted && e.button === 0) zap(e.shiftKey);
  }

  function onKey(e) {
    if (e.key === 'Shift') {
      shift = true;
      draw();
      return;
    }
    const handled =
      ['Escape', 'ArrowUp', 'ArrowDown'].includes(e.key) ||
      ((e.metaKey || e.ctrlKey) && e.key === 'z');
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowUp') {
      const up = target?.parentElement;
      if (up && up !== document.body && up !== document.documentElement) {
        below.push(target);
        target = up;
        draw();
      }
    } else if (e.key === 'ArrowDown') {
      if (below.length) {
        target = below.pop();
        draw();
      }
    } else undoLast();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') {
      shift = false;
      draw();
    }
  }

  // Saving
  // -

  function showPending() {
    const css = hideCss(history.map((h) => h.selector));
    try {
      if (pendingKey) webFrame.removeInsertedCSS(pendingKey);
      pendingKey = css ? webFrame.insertCSS(css) : null;
    } catch {}
  }

  async function zap(similar) {
    if (!target) return;
    shift = similar;
    const selector = selectorToHide(target);
    shift = false;
    if (!selector) {
      say(
        'This has no class to find others like it by. Click without Shift to hide just this one.'
      );
      return;
    }
    const pick = { boostId, selector };
    history.push(pick);
    showPending();
    updateStatus();
    target = null;
    below = [];
    draw();
    let res = null;
    try {
      res = await ipcRenderer.invoke('nomad-boosts:zap', { boostId, selector });
    } catch (err) {
      res = { error: err?.message || String(err) };
    }
    if (!res || res.error) {
      history = history.filter((h) => h !== pick);
      showPending();
      updateStatus();
      say('Not saved: ' + (res?.error || 'unknown error'));
      return;
    }
    // The first pick may have made the Boost; the rest go to the same one.
    pick.boostId = boostId = res.boostId;
    boostName = res.name || boostName;
    updateStatus();
    if (mouse) setTarget(pickAt(mouse.x, mouse.y));
  }

  async function undoLast() {
    const pick = history.pop();
    if (!pick) return;
    showPending();
    updateStatus();
    try {
      const res = await ipcRenderer.invoke('nomad-boosts:unzap', pick);
      if (res?.error) say('Not undone: ' + res.error);
    } catch {}
  }

  return { start, stop };
}

const ZAPPER_CSS = `
.box {
  position: absolute; top: 0; left: 0; box-sizing: border-box;
  border: 2px solid #e5484d; border-radius: 3px;
  background: rgba(229, 72, 77, 0.14);
  transition: transform 0.05s, width 0.05s, height 0.05s;
}
.label {
  position: absolute; top: 0; left: 0; max-width: min(520px, calc(100vw - 16px));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 2px 6px; border-radius: 4px;
  background: #e5484d; color: #fff;
  font: 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace;
}
[hidden] { display: none !important; }
.bar {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 10px 12px 10px 16px; border-radius: 10px;
  background: #24292f; color: #fff;
  font: 13px/1.35 system-ui, -apple-system, sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
}
.text { display: flex; flex-direction: column; min-width: 0; }
.status { font-weight: 600; }
.hint { opacity: 0.7; font-size: 12px; }
button {
  font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.25); background: transparent; color: inherit;
}
button:disabled { opacity: 0.4; cursor: default; }
button.primary { background: #2864dc; border-color: #2864dc; color: #fff; }
button:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 1px; }
.msg {
  position: absolute; left: 50%; bottom: 84px;
  transform: translate(-50%, 8px); opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px; border-radius: 8px;
  background: #b42318; color: #fff;
  font: 13px/1.4 system-ui, -apple-system, sans-serif;
}
.msg.show { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-color-scheme: dark) {
  .bar { background: #e9e9ec; color: #111; }
  button { border-color: rgba(0, 0, 0, 0.2); }
}
`;
