import * as rpc from 'pauls-electron-rpc';
import * as fs from './fg/fs';
import * as internal from './fg/internal';
import * as external from './fg/external';
import * as experimental from './fg/experimental';
import { contextBridge, webUtils } from 'electron';

// nomad.parseUrl — pure hyper:// URL parser (no RPC). Keep in sync with the mobile copy in
// mobile/lib/types.ts NOMAD_SHIM. Returns null for non-hyper URLs. `key` is as-written (hex or z32).
function parseUrl(url) {
  const m = /^hyper:\/\/([^/+?#]+)(?:\+([^/?#]+))?([^?#]*)(\?[^#]*)?/.exec(String(url || ''));
  if (!m) return null;
  return {
    url: String(url),
    origin: `hyper://${m[1]}/`,
    key: m[1],
    version: m[2] || null,
    path: m[3] || '/',
    search: m[4] || '',
  };
}

export const setup = function () {
  // setup APIs
  var nomad: any = {};
  if (
    ['nomad:', 'hyper:', 'https:', 'http:', 'data:'].includes(window.location.protocol) ||
    window.location.hostname.endsWith('hyperdrive.network') /* TEMPRARY */
  ) {
    // ADR-0010: nomad.hyperdrive + nomad.autobase are gone — one unified nomad.fs over the
    // (Autobase) drive backend. (bg still keeps hyperdrive/autobase impls internally behind fs.)
    nomad.fs = fs.setup(rpc);
    Object.assign(nomad, external.setup(rpc));
    // nomad.page — this page's own identity. On desktop the tab has a real hyper:// origin, so
    // location.href is authoritative; parseUrl null on non-hyper pages (nomad://, https…), where
    // frontends shouldn't assume a drive context. Mobile injects the same shape from its host
    // (see mobile/lib/types.ts NOMAD_SHIM) — templates use nomad.page instead of parsing location.
    nomad.parseUrl = parseUrl;
    nomad.page = parseUrl(window.location.href);
  }
  if (['nomad:', 'hyper:'].includes(window.location.protocol)) {
    contextBridge.exposeInMainWorld('experimental', experimental.setup(rpc)); // TODO remove?
  }
  if (
    window.location.protocol === 'nomad:' ||
    /* TEMPRARY */ window.location.hostname.endsWith('hyperdrive.network')
  ) {
    Object.assign(nomad, internal.setup(rpc));
  }
  if (Object.keys(nomad).length > 0) {
    contextBridge.exposeInMainWorld('nomad', nomad);
  }
  contextBridge.exposeInMainWorld('electronWebUtils', {
    getPathForFile: (file) => webUtils.getPathForFile(file),
  });
};
