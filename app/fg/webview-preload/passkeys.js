/*
Passkeys (webview preload, isolated world; ADR-0049).

Exposes a small bridge to the page's main world and injects ./passkeys-page.js there, so a site's
navigator.credentials.create()/get() with `publicKey` reaches Nomad's passkeys: bg (bg/ui/passkeys.js)
reads the origin from the sending frame, asks the user in Nomad's own prompt, and signs. The bridge
carries only the page's options and the request's id; anything a page sends it is checked in bg.

Only https pages and http://localhost (secure contexts) get it; elsewhere the browser's own
WebAuthn stays as it is.
*/

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { installPasskeyShim } from './passkeys-page';

function isEligible() {
  const { protocol, hostname } = window.location;
  const ok =
    protocol === 'https:' ||
    (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname));
  return ok && window.isSecureContext;
}

export function setupPasskeys() {
  if (!isEligible()) return;
  contextBridge.exposeInMainWorld('__nomadPasskeys', {
    create: (id, publicKey) => ipcRenderer.invoke('nomad-passkeys:create', { id: String(id), publicKey }),
    get: (id, publicKey) => ipcRenderer.invoke('nomad-passkeys:get', { id: String(id), publicKey }),
    cancel: (id) => ipcRenderer.invoke('nomad-passkeys:cancel', String(id)).catch(() => {}),
  });
  webFrame
    .executeJavaScript(`(${installPasskeyShim.toString()})(window.__nomadPasskeys, window); undefined`)
    .catch((err) => console.warn('[passkeys] could not set up', err));
}
