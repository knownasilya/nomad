#!/usr/bin/env node
// Driver for the Nomad desktop app (Electron). Launches an ISOLATED Nomad — its own scratch profile,
// never ~/Library/Application Support/Nomad — and drives its first tab over the Chrome DevTools
// Protocol. Reads one command per line on stdin, runs them in order, and quits Nomad at EOF.
//
//   node .claude/skills/run-nomad/driver.mjs <<'EOF'
//   launch
//   go nomad://notes/
//   ss notes
//   EOF
//
// Commands: help · launch [keep] · go <url> · ss [name] · dark · light · focus · size <w> <h> [mobile]
//           eval <js> · text [selector] · click <selector> [| text] · type <text> · key <Key>
//           html <file> · targets · attach <url text | tab> · log [n] · wait <ms> · quit
//
// Env: NOMAD_RUN_DIR (profile + shots + logs; default $TMPDIR/nomad-run), NOMAD_RUN_PORT (9333).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const RUN_DIR = process.env.NOMAD_RUN_DIR || path.join(os.tmpdir(), 'nomad-run');
const PROFILE = path.join(RUN_DIR, 'profile');
const SHOTS = path.join(RUN_DIR, 'shots');
const LOG = path.join(RUN_DIR, 'nomad.log');
const PORT = Number(process.env.NOMAD_RUN_PORT || 9333);
// The same Electron `npm start` uses (scripts/tasks/start-cli.js).
const ELECTRON = createRequire(path.join(ROOT, 'scripts/tasks/start-cli.js'))('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

let child = null;
let tab = null; // Session on the first real tab

class Session {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    this.ready = new Promise((r) => (this.ws.onopen = r));
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30000);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    return [];
  }
}

function needTab() {
  if (!tab) throw new Error('launch first');
  return tab;
}

const COMMANDS = {
  help() {
    out('commands:', Object.keys(COMMANDS).join(', '));
  },

  // Start Nomad on a fresh scratch profile ("launch keep" reuses the last one), finish the first-run
  // setup window, and attach to the first tab.
  async launch(arg) {
    if (child) return out('already launched');
    if (arg !== 'keep') fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.mkdirSync(PROFILE, { recursive: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    // VS Code's terminal exports ELECTRON_RUN_AS_NODE=1, which makes Electron start as plain Node.
    const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
    const logFd = fs.openSync(LOG, 'w');
    child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, path.join(ROOT, 'app')], {
      env: { ...env, NOMAD_USER_DATA_PATH: PROFILE, NOMAD_MCP: '0', NOMAD_DEV_MODE: '1' },
      stdio: ['ignore', logFd, logFd],
    });
    child.on('exit', (code) => {
      if (child) out(`nomad exited (${code})`);
      child = null;
      tab = null;
    });
    let setupDone = false;
    for (let i = 0; i < 180 && !tab; i++) {
      await sleep(500);
      if (!child) throw new Error(`Nomad exited during launch; see ${LOG}`);
      const ts = await targets();
      // A fresh profile opens nomad://setup first and blocks startup until it's done.
      const setup = ts.find((t) => t.url.startsWith('nomad://setup'));
      if (setup && !setupDone) {
        const s = new Session(setup.webSocketDebuggerUrl);
        await s.ready;
        await sleep(1500);
        await s.eval('nomad.browser.updateSetupState({ migrated08to09: 1, profileSetup: 1 })').catch(() => {});
        setupDone = true;
        continue;
      }
      // The splash (nomad://init) and the shell's own windows are pages too; skip them.
      const t = ts.find((t) => t.type === 'page' && t.url && !/^nomad:\/\/(setup|init)|shell-window|shell-menus|prompts|modals|perm|overlay|tab-switcher/.test(t.url));
      if (t) {
        tab = new Session(t.webSocketDebuggerUrl);
        await tab.ready;
        await tab.send('Page.enable');
        await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
        out('launched:', t.url, `(profile ${PROFILE})`);
      }
    }
    if (!tab) throw new Error(`no tab after 90s; see ${LOG}`);
  },

  async go(url) {
    await needTab().send('Page.navigate', { url });
    await sleep(2500);
    out('at', await tab.eval('location.href'));
  },

  async ss(name) {
    const { data } = await needTab().send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, (name || `ss-${Date.now()}`) + '.png');
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    out('screenshot:', f);
  },

  // prefers-color-scheme for the page; the app-stdlib tokens follow it.
  async dark() {
    await needTab().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    out('scheme: dark');
  },
  async light() {
    await needTab().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    out('scheme: light');
  },

  // A driven window never has OS focus, so focus-dependent UI (the Notes editor's Live Preview
  // shows Markdown only where the cursor is, and only while focused) needs focus emulated.
  async focus() {
    await needTab().send('Emulation.setFocusEmulationEnabled', { enabled: true });
    out('focus emulation on');
  },

  async size(arg = '') {
    const [w, h, mobile] = arg.split(/\s+/);
    await needTab().send('Emulation.setDeviceMetricsOverride', {
      width: Number(w) || 1100,
      height: Number(h) || 720,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile: !!mobile,
    });
    out('size', w, h, mobile ? 'mobile' : '');
  },

  // Runs in the page (awaits promises). Pages under nomad:// have window.nomad, incl. nomad.vault.
  async eval(js) {
    out(JSON.stringify(await needTab().eval(js)));
  },

  // Text of the page or of a selector, including shadow roots (settings, library are Lit components).
  async text(sel) {
    const t = await needTab().eval(`(function walk(n) {
      if (!n) return '(not found)';
      let t = '';
      if (n.shadowRoot) t += walk(n.shadowRoot);
      for (const c of n.childNodes) t += c.nodeType === 3 ? c.textContent : c.nodeType === 1 && /^(SCRIPT|STYLE)$/.test(c.tagName) ? '' : walk(c);
      return t;
    })(${sel ? `document.querySelector(${JSON.stringify(sel)})` : 'document.body'})`);
    out(t.replace(/[ \t]*\n[\s]*/g, '\n').trim());
  },

  // "click <selector>" or "click <selector> | <exact text>". Dispatches mousedown, mouseup, click on
  // the element, so it works for CodeMirror widgets (which act on mousedown) and plain buttons.
  async click(arg = '') {
    const [sel, text] = arg.split(/\s*\|\s*/);
    const r = await needTab().eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : 'true'});
      if (!el) return 'NOT FOUND';
      for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      return 'ok';
    })()`);
    out('click', arg, '->', r);
  },

  // Types into whatever has focus (focus an editor first, e.g. with eval).
  async type(text) {
    await needTab().send('Input.insertText', { text });
    out('typed', JSON.stringify(text));
  },

  async key(name) {
    const codes = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
    const vk = codes[name] || 0;
    for (const type of ['keyDown', 'keyUp']) {
      await needTab().send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: vk });
    }
    out('key', name);
  },

  // Show an HTML page in the tab: an .html file, or a generated TS module that exports one string
  // (mobile/lib/noteEditorHtml.ts — the phone's Notes editor page).
  async html(file) {
    const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
    const html = file.endsWith('.ts') ? JSON.parse(src.slice(src.indexOf('= ') + 2, src.indexOf('\nexport'))) : src;
    await needTab().send('Page.navigate', { url: 'about:blank' });
    await sleep(800);
    const { frameTree } = await tab.send('Page.getFrameTree');
    await tab.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await sleep(800);
    out('loaded', file, `(${Math.round(html.length / 1024)} KB)`);
  },

  async targets() {
    for (const t of await targets()) out(` ${t.type}  ${t.url}`);
  },

  // Drive another page instead of the tab: the first target whose URL contains `match`.
  // "attach shell-window" reaches the browser chrome (tab strip, Tab Sidebar, navbar);
  // "attach tab" goes back to the first tab.
  async attach(match) {
    const ts = await targets();
    const t =
      match === 'tab'
        ? ts.find((t) => t.type === 'page' && t.url && !/^nomad:\/\/(setup|init)|shell-window|shell-menus|prompts|modals|perm|overlay|tab-switcher/.test(t.url))
        : ts.find((t) => t.url.includes(match));
    if (!t) throw new Error('no target matching ' + match + ' (see: targets)');
    tab = new Session(t.webSocketDebuggerUrl);
    await tab.ready;
    await tab.send('Page.enable');
    out('attached:', t.url);
  },

  async log(n) {
    const lines = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n') : [];
    out(lines.slice(-(Number(n) || 20)).join('\n'));
  },

  async wait(ms) {
    await sleep(Number(ms) || 1000);
  },

  async quit() {
    const c = child;
    child = null;
    tab = null;
    if (!c) return;
    c.kill('SIGTERM');
    await sleep(1500);
    try {
      process.kill(c.pid, 0);
      c.kill('SIGKILL');
    } catch {}
    out('quit');
  },
};

// Run lines strictly in order: a piped script delivers them all at once.
let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  queue = queue.then(async () => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const sp = trimmed.indexOf(' ');
    const cmd = sp === -1 ? trimmed : trimmed.slice(0, sp);
    const arg = sp === -1 ? '' : trimmed.slice(sp + 1);
    const fn = COMMANDS[cmd];
    if (!fn) return out('unknown:', cmd, '- try: help');
    out('>', trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed);
    try {
      await fn(arg);
    } catch (e) {
      out('ERROR:', e.message);
    }
  });
});
rl.on('close', () => {
  queue.then(() => COMMANDS.quit()).then(() => process.exit(0));
});
process.on('SIGINT', () => COMMANDS.quit().then(() => process.exit(130)));
