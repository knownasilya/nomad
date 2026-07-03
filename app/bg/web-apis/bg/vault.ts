//
// Internal web API: nomad.vault — backs the Devices settings subpage. Available only to nomad://
// pages (internalOnly). Delegates to hyper/vault.js (the Vault primitive) and
// hyper/device-pairing.js (the blind-pairing handshake). See docs/multi-device-protocol.md.

import os from 'os';
import b4a from 'b4a';
import { EventEmitter } from 'events';
import * as vault from '../../hyper/vault';
import * as pairing from '../../hyper/device-pairing';

function thisPlatform() {
  return 'desktop';
}

function defaultDeviceName() {
  try {
    return `${os.hostname()} (${os.type()})`;
  } catch {
    return 'This device';
  }
}

// Identity of the current Device: its writer key in the Vault (null until a Vault exists here).
// Module-level so it can be reused without relying on `this` — pauls-electron-rpc invokes each
// exported method unbound, so `this` is not the API object.
async function getThisDeviceInfo() {
  const sess = await vault.getVault();
  const key = sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
  return { key, name: defaultDeviceName(), platform: thisPlatform() };
}

export default {
  async getStatus() {
    const sess = await vault.getVault();
    // Backfill the owner's own device record into the Vault index so it replicates to other
    // Devices (the creating Device never went through addDevice). Self-heals existing Vaults the
    // first time this page is opened.
    if (sess) {
      try {
        await vault.registerOwnDevice({ name: defaultDeviceName(), platform: thisPlatform() });
      } catch {}
    }
    const devices = sess ? await vault.listDevices() : [];
    return {
      hasVault: !!sess,
      thisDevice: await getThisDeviceInfo(),
      deviceCount: devices.length,
    };
  },

  async getThisDevice() {
    return getThisDeviceInfo();
  },

  async listDevices() {
    return vault.listDevices();
  },

  async listSpaces() {
    return vault.listSpaces();
  },

  // Member side: ensure a Vault exists, then mint an invite code.
  async createInvite() {
    const code = await pairing.createInvite();
    // createInvite ensures the Vault exists; record the owner now so the device you're about to
    // pair sees this Device in its list (not just itself).
    try {
      await vault.registerOwnDevice({ name: defaultDeviceName(), platform: thisPlatform() });
    } catch {}
    return { code };
  },

  async listPendingRequests() {
    return pairing.listPendingRequests();
  },

  watchPendingRequests() {
    const emitter: any = new EventEmitter();
    const onChange = () => emitter.emit('changed', {});
    pairing.events.on('request', onChange);
    pairing.events.on('request-resolved', onChange);
    emitter.close = () => {
      pairing.events.removeListener('request', onChange);
      pairing.events.removeListener('request-resolved', onChange);
    };
    return emitter;
  },

  async approveDevice(deviceKey) {
    return pairing.approveDevice(deviceKey);
  },

  async denyDevice(deviceKey) {
    return pairing.denyDevice(deviceKey);
  },

  // Candidate side: join an existing identity by entering an invite code from a trusted Device.
  // Once paired, mirror the Vault's Spaces into the local spaces DB so they appear on this Device.
  async submitInvite(code, opts: any = {}) {
    const res = await pairing.submitInvite(code, {
      name: opts.name || defaultDeviceName(),
      platform: thisPlatform(),
    } as any);
    try {
      await vault.syncSpacesFromVault();
    } catch {}
    return res;
  },

  async renameDevice(deviceKey, name) {
    return vault.renameDevice(deviceKey, name);
  },

  async removeDevice(deviceKey) {
    return vault.removeDevice(deviceKey);
  },
};
