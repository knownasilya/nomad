// Page control: the AI Sidebar clicks, types and scrolls on the page in the user's tab (ADR-0028).
//
// Each turn of the sidebar has one session (createSession, made in runChat). Its first page action
// pins the tab the user is on; later actions go to that tab only, so a tab switch in the middle of a
// turn can't move a click onto another site. A tab the AI opened itself in the turn (openTab) can
// take over the pin. The webview preload (fg/webview-preload/page-control.js) lists the page's
// controls, finds a control's spot on screen and draws the AI's cursor and the "Nomad AI is using
// this page" bar; this module sends the clicks and keys as real input events
// (webContents.sendInputEvent / insertText), so the page sees them as the user's own.
//
// The rules (shared with nothing, kept pure for tests) are in ai/page-control.mjs: password,
// payment and file fields are off limits, a click that buys, sends, posts or deletes waits for the
// user's OK, and "allow on this site" lasts 30 days. The user's own click or key in the page ends
// the AI's control for the rest of the turn; Esc or the bar's Stop ends the turn.

import { ipcMain } from 'electron';
import * as sitedata from '../dbs/sitedata';
import * as logLib from '../logger';
import {
  PAGE_ACTION_PERM,
  PAGE_CONTROL_PERM,
  blockedMessage,
  blockedReason,
  describeControl,
  directionArg,
  grantUntil,
  pageOffLimits,
  parseKey,
  refArg,
  riskyWords,
  screenshotPoint,
  siteOf,
  snapshotForModel,
  storedGrant,
  textArg,
} from '../ai/page-control.mjs';

const logger = logLib.get().child({ category: 'ai', subcategory: 'page-control' });

// Electron runs a context-isolated preload in world 999; its globals are out of the page's reach.
const PRELOAD_WORLD = 999;
const CALL_TIMEOUT = 5000;
const LOAD_TIMEOUT = 10_000;
const TEXT_ROLES = ['textbox', 'searchbox', 'combobox', 'spinbutton'];

// The session whose bar shows in each tab, by webContents id: where the bar's Stop goes.
const shownIn = new Map();
// Each tab's page loads, counted, so a ref from before a navigation isn't used on the next page.
const loads = new WeakMap();
// Each tab's last screenshot, for clickAt: { url, load, width, height, cssWidth, cssHeight }.
const shots = new WeakMap();

export function setup() {
  ipcMain.on('nomad-page-control:user', (e, kind) => {
    const session = shownIn.get(e.sender.id);
    if (session) session.userDid(kind === 'stop' ? 'stop' : 'input');
  });
}

// One turn's page control. `requestPermission` is the turn's permission function; `stopTurn`
// ends the turn (the bar's Stop and Esc).
export function createSession({ requestPermission, stopTurn }) {
  let pinned = null;
  let stopped = false;
  let tookOver = false;
  let confirms = 0;
  const opened = new WeakSet(); // tabs this turn opened (openTab)
  const answers = new Map(); // site -> Promise<boolean>, this turn's answers
  const snapLoad = new WeakMap(); // tab -> the page load its last snapshot was of
  const touched = new Set(); // tabs whose bar this session showed
  const reshow = new Map(); // tab -> its dom-ready listener

  function pick(tab) {
    const current = tab?.sender;
    if (!current || typeof current.sendInputEvent !== 'function' || isGone(current)) {
      throw new Error("There's no page open in the user's tab on this computer.");
    }
    if (pinned && isGone(pinned)) {
      throw new Error(
        'The tab you were working in was closed. Stop, and tell the user what you did.'
      );
    }
    if (!pinned || (current !== pinned && opened.has(current))) pinned = current;
    else if (current !== pinned) {
      const title = pinned.getTitle() || pinned.getURL();
      throw new Error(
        `The user switched to another tab. You were working in "${title}", and page actions only work ` +
          'there. Tell the user, and ask them to switch back if they want you to go on.'
      );
    }
    track(pinned);
    const off = pageOffLimits(pinned.getURL());
    if (off) throw new Error(off);
    return pinned;
  }

  async function allowed(wc) {
    const url = wc.getURL();
    const site = siteOf(url);
    if (!answers.has(site)) answers.set(site, ask(wc, url));
    if (!(await answers.get(site))) {
      throw new Error(
        `The user didn't allow you to click and type on ${site}. Don't try again; tell them you need their ` +
          'OK to use that site, or that they can do it themselves.'
      );
    }
  }

  async function ask(wc, url) {
    const stored = storedGrant(
      await sitedata.getPermission(url, PAGE_CONTROL_PERM).catch(() => null)
    );
    if (stored !== 'ask') return stored === 'allow';
    const ok = await requestPermission(PAGE_CONTROL_PERM, wc);
    if (ok) await sitedata.set(url, 'perm:' + PAGE_CONTROL_PERM, grantUntil()).catch(() => {});
    return !!ok;
  }

  // The user's OK for one click that spends, sends, posts or deletes.
  async function confirm(wc, what) {
    const ok = await requestPermission(`${PAGE_ACTION_PERM}:${++confirms}`, wc, { action: what });
    if (!ok) {
      throw new Error(
        `The user said no to: ${what}. Don't do it; ask them what they want instead.`
      );
    }
  }

  async function checkRisk(wc, control, verb = 'click') {
    const words = riskyWords(control?.name);
    if (words) await confirm(wc, `${verb} ${describeControl(control)}`);
  }

  // A control's spot, after checking the ref is from this page and the control can be used.
  async function targetOf(wc, ref) {
    if (snapLoad.get(wc) !== loads.get(wc)) {
      throw new Error(
        'The page changed since your last snapshot. Call snapshotPage again for fresh refs.'
      );
    }
    const t = await call(wc, `target(${ref})`);
    if (!t)
      throw new Error("Nomad can't reach this page's controls right now. Try snapshotPage again.");
    if (t.error === 'stale') {
      throw new Error(
        `Control ${ref} is gone from the page. Call snapshotPage again for fresh refs.`
      );
    }
    if (t.error)
      throw new Error(`Control ${ref} isn't visible on the page. Scroll, or snapshot again.`);
    const blocked = blockedReason(t.control);
    if (blocked) throw new Error(blockedMessage(blocked));
    if (t.control.disabled) throw new Error(`${describeControl(t.control)} is disabled.`);
    if (t.coveredBy) {
      throw new Error(
        `${describeControl(t.control)} is covered by ${describeControl(t.coveredBy)} (ref ${t.coveredBy.ref}), ` +
          'which would get the click. Close or answer that first.'
      );
    }
    return t;
  }

  function begin(wc, emitter, name, summary) {
    if (!touched.has(wc)) {
      touched.add(wc);
      // A new page load draws nothing until told to: show the bar again on it.
      const onReady = () => {
        if (!stopped && !tookOver) call(wc, 'show()');
      };
      wc.on('dom-ready', onReady);
      reshow.set(wc, onReady);
    }
    shownIn.set(wc.id, session);
    call(wc, 'show()');
    if (emitter && summary) emitter.emit('tool', { phase: 'detail', name, summary });
  }

  async function click(wc, x, y) {
    await call(wc, `moveCursor(${num(x)}, ${num(y)})`);
    const z = zoom(wc);
    const at = { x: Math.round(x * z), y: Math.round(y * z) };
    wc.focus();
    await call(wc, 'acting(1500)');
    wc.sendInputEvent({ type: 'mouseMove', ...at });
    wc.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
    call(wc, 'ripple()');
    await delay(120);
    await call(wc, 'acting(200)');
  }

  async function key(wc, k) {
    wc.focus();
    await call(wc, 'acting(1500)');
    wc.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, modifiers: k.modifiers });
    if (k.char) wc.sendInputEvent({ type: 'char', keyCode: k.char, modifiers: k.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, modifiers: k.modifiers });
    await delay(80);
    await call(wc, 'acting(200)');
  }

  // Enter in a form submits it: the form's submit button says what that does.
  async function checkSubmit(wc, ref) {
    const res = await call(wc, `formOf(${ref || 0})`);
    const submit = res?.form?.submit;
    if (submit) await checkRisk(wc, submit, 'submit the form with');
  }

  // After an action: wait for the page to settle, then what changed and the controls now on screen.
  async function after(wc, did, before) {
    await settle(wc);
    if (isGone(wc)) return JSON.stringify({ did, note: 'The tab closed.' });
    const snap = await snapshot(wc);
    /** @type {Record<string, any>} */
    const out = { did, ...snapshotForModel(snap, { onlyInView: true }) };
    if (snap && before && snap.url !== before) out.navigated = true;
    return JSON.stringify(out);
  }

  async function snapshot(wc) {
    const snap = await call(wc, 'snapshot()', 8000);
    if (snap) snapLoad.set(wc, loads.get(wc));
    return snap;
  }

  const session = {
    // A tab the AI opened this turn may take over the pin.
    noteOpened(wc) {
      if (wc) opened.add(wc);
    },

    userDid(kind) {
      if (kind === 'stop') {
        stopped = true;
        session.end();
        try {
          stopTurn();
        } catch {}
      } else {
        tookOver = true;
      }
    },

    /**
     * @param {string} name
     * @param {Record<string, any>} args
     * @param {{ tab?: any, emitter?: any }} [ctx]
     */
    async run(name, args, { tab, emitter } = {}) {
      if (stopped) throw new Error('The user stopped you. Stop, and tell them what you did.');
      if (tookOver) {
        throw new Error(
          "The user started using the page themselves, so you're not controlling it anymore this turn. Tell " +
            "them what you did and what's left; don't click or type again unless they ask."
        );
      }
      const a = args || {};
      const wc = pick(tab);

      if (name === 'snapshotPage') {
        const snap = await snapshot(wc);
        if (!snap)
          throw new Error(
            "Nomad can't read this page's controls. It may still be loading; try again."
          );
        return JSON.stringify(snapshotForModel(snap));
      }

      await allowed(wc);
      const before = wc.getURL();

      switch (name) {
        case 'clickElement': {
          const ref = refArg(a);
          const t = await targetOf(wc, ref);
          await checkRisk(wc, t.control);
          const did = `Clicked ${describeControl(t.control)}`;
          begin(wc, emitter, name, `Clicking ${describeControl(t.control)}`);
          await click(wc, t.x, t.y);
          return after(wc, did, before);
        }
        case 'typeText': {
          const ref = refArg(a);
          const text = textArg(a);
          const t = await targetOf(wc, ref);
          if (!TEXT_ROLES.includes(t.control.role) || t.control.tag === 'select') {
            throw new Error(
              `${describeControl(t.control)} isn't a text field. Pick a textbox from snapshotPage.`
            );
          }
          if (a.submit) await checkSubmit(wc, ref);
          begin(wc, emitter, name, `Typing in ${describeControl(t.control)}`);
          await click(wc, t.x, t.y);
          const sel = await call(
            wc,
            `selectContents(${ref}, ${a.clear === false ? 'true' : 'false'})`
          );
          if (sel?.error === 'not-editable')
            throw new Error(`${describeControl(t.control)} can't be typed in.`);
          await call(wc, 'acting(1500)');
          if (text) wc.insertText(text);
          await delay(60);
          await call(wc, 'acting(200)');
          if (a.submit) await key(wc, parseKey('Enter'));
          return after(
            wc,
            `Typed into ${describeControl(t.control)}${a.submit ? ' and pressed Enter' : ''}`,
            before
          );
        }
        case 'pressKey': {
          const k = parseKey(a.key);
          const focus = (await call(wc, 'focused()'))?.control || null;
          if (focus && k.char) {
            const blocked = blockedReason(focus);
            if (blocked) throw new Error(blockedMessage(blocked));
          }
          if (k.keyCode === 'Enter' && focus) {
            if (focus.role === 'button' || focus.role === 'link') await checkRisk(wc, focus);
            else await checkSubmit(wc, focus.ref);
          }
          begin(wc, emitter, name, `Pressing ${a.key}`);
          await key(wc, k);
          return after(wc, `Pressed ${a.key}`, before);
        }
        case 'selectOption': {
          const ref = refArg(a);
          if (a.value == null || a.value === '')
            throw new Error('Pass `value`, the option to choose');
          const t = await targetOf(wc, ref);
          begin(
            wc,
            emitter,
            name,
            `Choosing “${String(a.value).slice(0, 40)}” in ${describeControl(t.control)}`
          );
          await call(wc, `moveCursor(${num(t.x)}, ${num(t.y)})`);
          const res = await call(wc, `selectOption(${ref}, ${JSON.stringify(String(a.value))})`);
          if (!res) throw new Error("Nomad can't reach this page's controls right now.");
          if (res.error === 'not-select') {
            throw new Error(
              `${describeControl(t.control)} isn't a plain dropdown. Click it with clickElement, then click the option.`
            );
          }
          if (res.error === 'no-option') {
            throw new Error(
              `No option matches "${a.value}". The options are: ${res.options.join(', ')}`
            );
          }
          if (res.error) throw new Error(`Couldn't choose "${a.value}".`);
          call(wc, 'ripple()');
          return after(wc, `Chose “${res.chosen}” in ${describeControl(t.control)}`, before);
        }
        case 'scrollPage': {
          const direction = directionArg(a);
          const ref = a.ref == null ? 0 : refArg(a);
          if (ref && snapLoad.get(wc) !== loads.get(wc)) {
            throw new Error(
              'The page changed since your last snapshot. Call snapshotPage again for fresh refs.'
            );
          }
          begin(wc, emitter, name, `Scrolling ${direction}`);
          const res = await call(wc, `scroll(${ref}, ${JSON.stringify(direction)})`);
          if (!res) throw new Error("Nomad can't scroll this page right now.");
          if (res.error)
            throw new Error(`Control ${ref} is gone from the page. Call snapshotPage again.`);
          await call(wc, `moveCursor(${num(res.x)}, ${num(res.y)})`);
          const did = !res.moved
            ? `Couldn't scroll ${direction}: already at the ${direction === 'up' || direction === 'top' ? 'top' : 'end'}`
            : `Scrolled ${direction}${res.atEnd ? ', to the end' : res.atTop ? ', to the top' : ''}`;
          return after(wc, did, before);
        }
        case 'clickAt': {
          const shot = shots.get(wc);
          const fresh =
            shot && shot.url === wc.getURL() && shot.load === loads.get(wc) ? shot : null;
          const p = screenshotPoint(a, fresh);
          const info = await call(wc, `pointInfo(${num(p.x)}, ${num(p.y)})`);
          const control = info?.control || null;
          if (control) {
            const blocked = blockedReason(control);
            if (blocked) throw new Error(blockedMessage(blocked));
            await checkRisk(wc, control);
          }
          const what = control
            ? describeControl(control)
            : `the page at ${Math.round(a.x)}, ${Math.round(a.y)}`;
          begin(wc, emitter, name, `Clicking ${what}`);
          await click(wc, p.x, p.y);
          return after(wc, `Clicked ${what}`, before);
        }
        default:
          throw new Error(`Unknown page action: ${name}`);
      }
    },

    // The turn is over: take the cursor and bar off every page this session drew on.
    end() {
      for (const wc of touched) {
        if (shownIn.get(wc.id) === session) shownIn.delete(wc.id);
        const onReady = reshow.get(wc);
        if (!isGone(wc)) {
          if (onReady) wc.removeListener('dom-ready', onReady);
          call(wc, 'hide()');
        }
      }
      touched.clear();
      reshow.clear();
    },
  };
  return session;
}

// screenshotCurrentPage took this tab's picture at `size` (the image the model sees): clickAt's
// x and y are pixels in it.
export async function noteScreenshot(wc, size) {
  if (!wc || isGone(wc) || !size?.width || !size?.height) return;
  track(wc);
  const view = await call(wc, 'viewport()');
  if (!view) return;
  shots.set(wc, {
    url: wc.getURL(),
    load: loads.get(wc),
    width: size.width,
    height: size.height,
    cssWidth: view.width,
    cssHeight: view.height,
  });
}

function track(wc) {
  if (loads.has(wc)) return;
  loads.set(wc, 0);
  wc.on('did-navigate', () => loads.set(wc, (loads.get(wc) || 0) + 1));
}

function call(wc, expr, timeout = CALL_TIMEOUT) {
  if (isGone(wc)) return Promise.resolve(null);
  const code = `(window.__nomadPageControl ? window.__nomadPageControl.${expr} : null)`;
  return Promise.race([
    wc.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD, [{ code }]),
    new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
  ]).catch((err) => {
    logger.debug('Page call failed', { expr: expr.slice(0, 40), error: err?.message });
    return null;
  });
}

// Wait for a navigation the action started, then for the page's DOM to go still.
async function settle(wc) {
  await delay(80);
  if (isGone(wc)) return;
  if (wc.isLoading()) {
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wc.removeListener('did-stop-loading', done);
        resolve(undefined);
      };
      const timer = setTimeout(done, LOAD_TIMEOUT);
      wc.on('did-stop-loading', done);
    });
  }
  await call(wc, 'quiet(350, 2500)', 3500);
}

function zoom(wc) {
  try {
    return wc.getZoomFactor() || 1;
  } catch {
    return 1;
  }
}

function isGone(wc) {
  return !wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed());
}

function num(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
