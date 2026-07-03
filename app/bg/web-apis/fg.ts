import * as rpc from 'pauls-electron-rpc';
import * as fs from './fg/fs';
import * as internal from './fg/internal';
import * as external from './fg/external';
import * as experimental from './fg/experimental';
import { contextBridge, webUtils } from 'electron';

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
