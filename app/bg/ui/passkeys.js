// Passkeys (ADR-0049): a website's navigator.credentials.create()/get() with `publicKey`, answered by
// Nomad. The page's shim (fg/webview-preload/passkeys.js) sends the options here; this module reads
// the origin from the frame that sent them (never from the page), asks the user in the `passkey`
// modal (fg/modals/passkey.js), and runs the ceremony (bg/passkeys/ceremony.mjs) with the keys in
// bg/passkeys/store.js. The user can always hand the request to the computer's own WebAuthn instead
// ("Use a phone or security key"), which is what the page gets back as { fallback: true }.
//
// A page in a frame from another site than the tab's falls back too: Nomad's passkeys answer only
// the page in the tab and its same-origin frames.

import { ipcMain, systemPreferences } from 'electron';
import crypto from 'crypto';
import { getDomain } from 'tldts';
import * as store from '../passkeys/store';
import * as ceremony from '../passkeys/ceremony.mjs';
import * as R from '../../../shared/passkeys.mjs';
import * as modals from './subwindows/modals';
import * as tabManager from './tabs/manager';
import * as logLib from '../logger';

const logger = logLib.get().child({ category: 'browser', subcategory: 'passkeys' });

/** @type {Map<string, () => void>} `${webContentsId}:${requestId}` -> cancel the open prompt */
const pending = new Map();

const sha256 = (bytes) => new Uint8Array(crypto.createHash('sha256').update(bytes).digest());
const registrable = (host) => getDomain(host, { allowPrivateDomains: true }) || (host === 'localhost' ? host : null);

export function setup() {
  store.load().catch(() => {});
  ipcMain.handle('nomad-passkeys:create', (e, req) => run(e, req, 'create'));
  ipcMain.handle('nomad-passkeys:get', (e, req) => run(e, req, 'get'));
  ipcMain.handle('nomad-passkeys:cancel', (e, id) => {
    pending.get(`${e.sender.id}:${id}`)?.();
  });
}

// The page's origin and host, from the frame that sent the IPC. Null when Nomad's passkeys don't
// answer it (not https or localhost, or a frame from another site than the tab's page).
function pageOf(e) {
  const frame = e.senderFrame;
  if (!frame) return null;
  const page = R.pageOrigin(frame.url);
  if (!page) return null;
  const top = frame.top;
  if (top && top !== frame) {
    const t = R.pageOrigin(top.url);
    if (!t || t.origin !== page.origin) return null;
  }
  return page;
}

async function run(e, req, kind) {
  const page = pageOf(e);
  if (!page) return { fallback: true };
  const wc = e.sender;
  const reqKey = `${wc.id}:${String(req?.id || '')}`;
  try {
    const args = {
      publicKey: req?.publicKey,
      page,
      store,
      sha256,
      registrable,
      ask: (prompt) => ask(wc, reqKey, page, prompt),
    };
    return kind === 'create' ? await ceremony.register(args) : await ceremony.authenticate(args);
  } catch (err) {
    if (err instanceof R.PasskeyError) return { error: { name: err.domName, message: err.message } };
    logger.warn('Passkey request failed', { error: err?.message });
    return { error: { name: 'NotAllowedError', message: 'The passkey request didn’t finish' } };
  } finally {
    pending.delete(reqKey);
  }
}

// Ask the user in the tab's `passkey` modal. Gone when the page aborts or the timeout passes.
async function ask(wc, reqKey, page, prompt) {
  const tab = tabManager.findTab(wc);
  if (!tab) throw new R.PasskeyError('NotAllowedError', 'Passkeys work in a tab');
  const status = prompt.kind === 'create' ? await store.encryptionStatus() : { ok: true };
  const params = {
    ...prompt,
    site: { host: page.host, origin: page.origin, secure: page.origin.startsWith('https:'), icon: `asset:favicon:${page.origin}/` },
    canSave: status.ok,
    reason: status.reason,
    touchId: touchIdAvailable() && prompt.userVerification !== 'discouraged',
  };
  let timer = null;
  const ended = new Promise((resolve) => {
    pending.set(reqKey, () => resolve({ action: 'deny' }));
    timer = setTimeout(() => resolve({ action: 'deny' }), prompt.timeout);
  });
  let answer;
  try {
    answer = await Promise.race([
      modals.create(wc, 'passkey', params).catch((err) => {
        if (err?.name === 'ModalActiveError')
          throw new R.PasskeyError('NotAllowedError', 'Another prompt is open in this tab');
        return { action: 'deny' };
      }),
      ended.then((a) => {
        modals.close(tab);
        return a;
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (!answer || answer.action !== 'allow' || prompt.kind === 'exists' || prompt.kind === 'none') return answer;
  // User verification: Touch ID where this Mac has it. Elsewhere the click in Nomad's own prompt, which
  // a page can't draw or press, is the user's yes (ADR-0049 §4).
  if (params.touchId) {
    try {
      await systemPreferences.promptTouchID(
        prompt.kind === 'create' ? `save a passkey for ${prompt.rpId}` : `sign in to ${prompt.rpId}`
      );
    } catch {
      return { action: 'deny' };
    }
  }
  return { ...answer, verified: prompt.userVerification !== 'discouraged' };
}

function touchIdAvailable() {
  try {
    return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
  } catch {
    return false;
  }
}

// For My Library → Passkeys (web-apis/bg/passkeys.ts).
export { store };
